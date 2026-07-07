<?php
/**
 * Import hasil pembacaan Kartu Keluarga (setelah direview pengguna).
 *
 * POST JSON:
 * {
 *   tree_id: 1,
 *   rows: [
 *     { full_name, nik, gender:'L'|'P', birth_place, birth_date:'YYYY-MM-DD'|'',
 *       relation: 'kepala'|'istri'|'suami'|'anak'|'lainnya',
 *       father_name: '', mother_name: '',   // dari kolom "Nama Orang Tua" KK
 *       marriage_date: 'YYYY-MM-DD'|'' }, ...
 *   ]
 * }
 *
 * Logika:
 *  - Anggota dicocokkan dengan yang sudah ada di pohon lewat NIK, atau
 *    (bila NIK kosong) lewat nama persis — tidak dibuat ganda.
 *  - Nama ayah/ibu dicocokkan dengan anggota yang sudah ada (atau sesama baris
 *    import) lewat nama; bila belum ada, dibuat baru, lalu direlasikan sebagai
 *    orang tua. Pasangan ayah+ibu otomatis tercatat menikah.
 *  - 'istri'/'suami' dinikahkan dengan kepala keluarga (mendukung poligami,
 *    urutan pernikahan otomatis; tanggal menikah dari KK ikut tercatat).
 *  - 'anak' tanpa nama ayah/ibu di-fallback ke kepala + pasangan pertamanya.
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

/** Normalisasi nama untuk pencocokan: huruf besar, spasi tunggal, tanpa titik/koma. */
function norm_name(string $s): string
{
    $s = mb_strtoupper(trim($s));
    $s = str_replace(['.', ','], ' ', $s);
    return preg_replace('/\s+/', ' ', $s);
}

function valid_date(string $s): ?string
{
    $s = trim($s);
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) ? $s : null;
}

$pdo = db();
$pdo->beginTransaction();

$stats = ['created' => 0, 'matched' => 0, 'parents_created' => 0, 'parents_matched' => 0];

try {
    /* ---- indeks anggota yang sudah ada di pohon ---- */
    $st = $pdo->prepare('SELECT id, full_name, gender, nik, father_id, mother_id FROM persons WHERE tree_id = ?');
    $st->execute([$treeId]);
    $byName = [];  // norm_name → [row, ...]
    $byNik  = [];  // nik → row
    foreach ($st->fetchAll() as $p) {
        $byName[norm_name($p['full_name'])][] = $p;
        if ($p['nik']) {
            $byNik[$p['nik']] = $p;
        }
    }

    $insertPerson = $pdo->prepare(
        'INSERT INTO persons (tree_id, full_name, gender, nik, birth_place, birth_date, birth_order,
                              is_deceased, death_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $createPerson = function (string $name, string $gender, string $nik = '', string $birthPlace = '',
                              ?string $birthDate = null, ?int $birthOrder = null,
                              int $isDeceased = 0, ?string $deathDate = null)
        use ($insertPerson, $pdo, $treeId, $uid, &$byName, &$byNik): array {
        $insertPerson->execute([
            $treeId, mb_substr($name, 0, 150), $gender,
            $nik !== '' ? substr($nik, 0, 20) : null,
            mb_substr($birthPlace, 0, 120) ?: null,
            $birthDate, $birthOrder, $isDeceased, $deathDate, $uid,
        ]);
        $p = [
            'id' => (int) $pdo->lastInsertId(), 'full_name' => $name, 'gender' => $gender,
            'nik' => $nik ?: null, 'father_id' => null, 'mother_id' => null,
        ];
        $byName[norm_name($name)][] = $p;
        if ($nik !== '') {
            $byNik[$nik] = $p;
        }
        return $p;
    };

    /** Cari orang berdasarkan nama (opsional filter gender). */
    $findByName = function (string $name, ?string $gender) use (&$byName): ?array {
        $key = norm_name($name);
        foreach ($byName[$key] ?? [] as $p) {
            if ($gender === null || $p['gender'] === $gender) {
                return $p;
            }
        }
        return null;
    };

    /** Pastikan pernikahan husband+wife tercatat; kembalikan true bila baru dibuat. */
    $ensureMarriage = function (int $husbandId, int $wifeId, ?string $date = null) use ($pdo, $treeId): bool {
        $st = $pdo->prepare('SELECT id FROM marriages WHERE husband_id = ? AND wife_id = ?');
        $st->execute([$husbandId, $wifeId]);
        if ($st->fetch()) {
            return false;
        }
        $st = $pdo->prepare('SELECT GREATEST(
            (SELECT COUNT(*) FROM marriages WHERE husband_id = ?),
            (SELECT COUNT(*) FROM marriages WHERE wife_id = ?)) AS n');
        $st->execute([$husbandId, $wifeId]);
        $order = (int) $st->fetchColumn() + 1;
        $pdo->prepare('INSERT INTO marriages (tree_id, husband_id, wife_id, marriage_date, marriage_order) VALUES (?, ?, ?, ?, ?)')
            ->execute([$treeId, $husbandId, $wifeId, $date, $order]);
        return true;
    };

    /* ---- pass 1: buat / cocokkan anggota dari setiap baris ---- */
    $persons   = [];   // index baris → person array
    $kepalaIdx = null;
    $spouseIdx = [];
    $childIdx  = [];

    foreach ($rows as $i => $r) {
        $name   = trim($r['full_name'] ?? '');
        $gender = ($r['gender'] ?? '') === 'P' ? 'P' : 'L';
        $nik    = preg_replace('/\D+/', '', $r['nik'] ?? '');
        $rel    = $r['relation'] ?? 'lainnya';
        $order  = (int) ($r['birth_order'] ?? 0);
        $order  = ($order >= 1 && $order <= 99) ? $order : null;
        $dead   = !empty($r['is_deceased']) ? 1 : 0;
        $death  = valid_date($r['death_date'] ?? '');

        if ($name === '') {
            throw new RuntimeException('Baris ' . ($i + 1) . ': nama wajib diisi.');
        }

        $person = null;
        if ($nik !== '' && isset($byNik[$nik])) {
            $person = $byNik[$nik];               // cocok lewat NIK (paling kuat)
        } else {
            $person = $findByName($name, $gender); // cocok lewat nama persis
        }

        if ($person) {
            $stats['matched']++;
            // lengkapi data yang masih kosong pada anggota lama
            $upd = [];
            $par = [];
            if ($nik !== '' && empty($person['nik'])) { $upd[] = 'nik = ?'; $par[] = substr($nik, 0, 20); }
            if (valid_date($r['birth_date'] ?? '')) { $upd[] = 'birth_date = COALESCE(birth_date, ?)'; $par[] = valid_date($r['birth_date']); }
            if (trim($r['birth_place'] ?? '') !== '') { $upd[] = 'birth_place = COALESCE(birth_place, ?)'; $par[] = mb_substr(trim($r['birth_place']), 0, 120); }
            if ($order !== null) { $upd[] = 'birth_order = COALESCE(birth_order, ?)'; $par[] = $order; }
            if ($dead) { $upd[] = 'is_deceased = 1'; }
            if ($death !== null) { $upd[] = 'death_date = COALESCE(death_date, ?)'; $par[] = $death; }
            if ($upd) {
                $par[] = $person['id'];
                $pdo->prepare('UPDATE persons SET ' . implode(', ', $upd) . ' WHERE id = ?')->execute($par);
            }
        } else {
            $person = $createPerson(
                $name, $gender, $nik, trim($r['birth_place'] ?? ''),
                valid_date($r['birth_date'] ?? ''), $order, $dead, $death
            );
            $stats['created']++;
        }
        $persons[$i] = $person;

        if ($rel === 'kepala' && $kepalaIdx === null) {
            $kepalaIdx = $i;
        } elseif ($rel === 'istri' || $rel === 'suami') {
            $spouseIdx[] = $i;
        } elseif ($rel === 'anak') {
            $childIdx[] = $i;
        }
    }

    /* ---- pass 2: nama ayah & ibu → cocokkan / buat, lalu relasikan ---- */
    foreach ($rows as $i => $r) {
        $fatherName = trim($r['father_name'] ?? '');
        $motherName = trim($r['mother_name'] ?? '');
        if ($fatherName === '-') $fatherName = '';
        if ($motherName === '-') $motherName = '';
        if ($fatherName === '' && $motherName === '') {
            continue;
        }

        $father = null;
        $mother = null;
        if ($fatherName !== '') {
            $father = $findByName($fatherName, 'L');
            if ($father) {
                $stats['parents_matched']++;
            } else {
                $father = $createPerson($fatherName, 'L');
                $stats['parents_created']++;
            }
        }
        if ($motherName !== '') {
            $mother = $findByName($motherName, 'P');
            if ($mother) {
                $stats['parents_matched']++;
            } else {
                $mother = $createPerson($motherName, 'P');
                $stats['parents_created']++;
            }
        }

        // relasikan sebagai orang tua (jangan menimpa relasi yang sudah ada)
        $pdo->prepare('UPDATE persons SET father_id = COALESCE(father_id, ?), mother_id = COALESCE(mother_id, ?) WHERE id = ?')
            ->execute([$father['id'] ?? null, $mother['id'] ?? null, $persons[$i]['id']]);

        // ayah + ibu otomatis tercatat sebagai pasangan
        if ($father && $mother) {
            $ensureMarriage((int) $father['id'], (int) $mother['id']);
        }
    }

    /* ---- pass 3: pernikahan kepala keluarga ↔ istri/suami ---- */
    $marriedSpouses = [];
    if ($kepalaIdx !== null) {
        $kepala = $persons[$kepalaIdx];
        foreach ($spouseIdx as $i) {
            $spouse = $persons[$i];
            if ($spouse['gender'] === $kepala['gender']) {
                continue; // data tidak konsisten — lewati
            }
            $husband = $kepala['gender'] === 'L' ? $kepala : $spouse;
            $wife    = $kepala['gender'] === 'L' ? $spouse : $kepala;
            $ensureMarriage((int) $husband['id'], (int) $wife['id'], valid_date($rows[$i]['marriage_date'] ?? ''));
            $marriedSpouses[] = $spouse;
        }

        /* ---- pass 4: fallback anak tanpa nama ayah/ibu ---- */
        $fatherId = null;
        $motherId = null;
        if ($kepala['gender'] === 'L') {
            $fatherId = (int) $kepala['id'];
            $motherId = isset($marriedSpouses[0]) ? (int) $marriedSpouses[0]['id'] : null;
        } else {
            $motherId = (int) $kepala['id'];
            $fatherId = isset($marriedSpouses[0]) ? (int) $marriedSpouses[0]['id'] : null;
        }
        foreach ($childIdx as $i) {
            if (trim($rows[$i]['father_name'] ?? '') !== '' || trim($rows[$i]['mother_name'] ?? '') !== '') {
                continue; // sudah ditangani pass 2
            }
            $pdo->prepare('UPDATE persons SET father_id = COALESCE(father_id, ?), mother_id = COALESCE(mother_id, ?) WHERE id = ?')
                ->execute([$fatherId, $motherId, $persons[$i]['id']]);
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

log_activity($treeId, $uid, 'import_kk', sprintf(
    'Import KK: %d baru, %d dicocokkan, %d orang tua baru, %d orang tua terhubung',
    $stats['created'], $stats['matched'], $stats['parents_created'], $stats['parents_matched']
));

json_out(array_merge(['ok' => true], $stats));
