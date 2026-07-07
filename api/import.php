<?php
/**
 * Import hasil pembacaan Kartu Keluarga (setelah direview pengguna di layar review).
 *
 * POST JSON:
 * {
 *   tree_id: 1,
 *   rows: [
 *     { full_name, nik, gender:'L'|'P', birth_place, birth_date:'YYYY-MM-DD'|null,
 *       relation: 'kepala'|'istri'|'suami'|'anak'|'lainnya',
 *       existing_id: null|int   // jika dipetakan ke person yang sudah ada di pohon
 *     }, ...
 *   ]
 * }
 *
 * Logika relasi:
 *  - 'kepala'  → kepala keluarga (jangkar).
 *  - 'istri'   → dinikahkan dengan kepala (kepala harus L). Boleh lebih dari satu (poligami).
 *  - 'suami'   → dinikahkan dengan kepala (kepala harus P).
 *  - 'anak'    → father/mother diambil dari kepala + pasangan pertama yang cocok jenis kelaminnya.
 *                (bisa disesuaikan lagi lewat edit person setelah import)
 */
require __DIR__ . '/../config.php';

$user = api_user();
$uid  = (int) $user['id'];

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metode tidak didukung.', 405);
}

$in     = read_json_body();
$treeId = (int) ($in['tree_id'] ?? 0);
require_tree_access($treeId, $uid, true);

$rows = is_array($in['rows'] ?? null) ? $in['rows'] : [];
if (!$rows) {
    json_error('Tidak ada data untuk diimpor.');
}
if (count($rows) > 40) {
    json_error('Maksimal 40 baris per import.');
}

$pdo = db();
$pdo->beginTransaction();

try {
    $ids      = [];   // index baris → person_id
    $kepalaIdx = null;
    $spouseIdx = [];  // index baris istri/suami
    $childIdx  = [];

    // 1. buat / petakan semua person
    foreach ($rows as $i => $r) {
        $name = trim($r['full_name'] ?? '');
        $gender = ($r['gender'] ?? '') === 'P' ? 'P' : 'L';
        $rel  = $r['relation'] ?? 'lainnya';

        if ($name === '') {
            throw new RuntimeException('Baris ' . ($i + 1) . ': nama wajib diisi.');
        }

        if (!empty($r['existing_id'])) {
            $st = $pdo->prepare('SELECT id, gender FROM persons WHERE id = ? AND tree_id = ?');
            $st->execute([(int) $r['existing_id'], $treeId]);
            $ex = $st->fetch();
            if (!$ex) {
                throw new RuntimeException('Baris ' . ($i + 1) . ': person yang dipetakan tidak ditemukan.');
            }
            $ids[$i] = (int) $ex['id'];
        } else {
            $birth = trim($r['birth_date'] ?? '');
            if ($birth !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $birth)) {
                $birth = '';
            }
            $nik = preg_replace('/\D+/', '', $r['nik'] ?? '');
            $st = $pdo->prepare(
                'INSERT INTO persons (tree_id, full_name, gender, nik, birth_place, birth_date, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            );
            $st->execute([
                $treeId, mb_substr($name, 0, 150), $gender,
                $nik !== '' ? substr($nik, 0, 20) : null,
                mb_substr(trim($r['birth_place'] ?? ''), 0, 120) ?: null,
                $birth ?: null, $uid,
            ]);
            $ids[$i] = (int) $pdo->lastInsertId();
        }

        if ($rel === 'kepala' && $kepalaIdx === null) {
            $kepalaIdx = $i;
        } elseif ($rel === 'istri' || $rel === 'suami') {
            $spouseIdx[] = $i;
        } elseif ($rel === 'anak') {
            $childIdx[] = $i;
        }
    }

    // 2. pernikahan kepala keluarga dengan istri/suami
    $marriedSpouses = []; // person_id pasangan kepala
    if ($kepalaIdx !== null) {
        $kepalaId = $ids[$kepalaIdx];
        $st = $pdo->prepare('SELECT gender FROM persons WHERE id = ?');
        $st->execute([$kepalaId]);
        $kepalaGender = $st->fetchColumn();

        $order = 0;
        foreach ($spouseIdx as $i) {
            $spouseId = $ids[$i];
            $st = $pdo->prepare('SELECT gender FROM persons WHERE id = ?');
            $st->execute([$spouseId]);
            $spouseGender = $st->fetchColumn();
            if ($spouseGender === $kepalaGender) {
                continue; // data tidak konsisten — lewati, jangan gagalkan seluruh import
            }
            $husband = $kepalaGender === 'L' ? $kepalaId : $spouseId;
            $wife    = $kepalaGender === 'L' ? $spouseId : $kepalaId;

            $st = $pdo->prepare('SELECT id FROM marriages WHERE husband_id = ? AND wife_id = ?');
            $st->execute([$husband, $wife]);
            if (!$st->fetch()) {
                $order++;
                $pdo->prepare('INSERT INTO marriages (tree_id, husband_id, wife_id, marriage_order) VALUES (?, ?, ?, ?)')
                    ->execute([$treeId, $husband, $wife, $order]);
            }
            $marriedSpouses[] = $spouseId;
        }

        // 3. anak-anak: ayah/ibu = kepala + pasangan pertama (dapat dikoreksi manual jika poligami)
        $fatherId = null;
        $motherId = null;
        if ($kepalaGender === 'L') {
            $fatherId = $kepalaId;
            $motherId = $marriedSpouses[0] ?? null;
        } else {
            $motherId = $kepalaId;
            $fatherId = $marriedSpouses[0] ?? null;
        }
        foreach ($childIdx as $i) {
            $pdo->prepare('UPDATE persons SET father_id = COALESCE(father_id, ?), mother_id = COALESCE(mother_id, ?) WHERE id = ?')
                ->execute([$fatherId, $motherId, $ids[$i]]);
        }
    }

    $pdo->commit();
} catch (RuntimeException $e) {
    $pdo->rollBack();
    json_error($e->getMessage());
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

log_activity($treeId, $uid, 'import_kk', 'Mengimpor ' . count($rows) . ' anggota dari Kartu Keluarga');
json_out(['ok' => true, 'imported' => count($ids)]);
