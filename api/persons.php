<?php
/**
 * API anggota keluarga (person).
 *
 * POST   buat person baru, opsional langsung dengan relasi:
 *        relation: {type:'spouse',  person_id}                → nikahkan dengan person_id
 *        relation: {type:'child',   father_id?, mother_id?}   → jadikan anak dari ayah/ibu
 *        relation: {type:'parent',  child_id, parent_role}    → jadikan ayah/ibu dari child_id
 * PUT    perbarui person (?id=..)
 * DELETE hapus person (?id=..)
 */
require __DIR__ . '/../config.php';

$user   = api_user();
$uid    = (int) $user['id'];
$method = $_SERVER['REQUEST_METHOD'];

/** Validasi & normalisasi field person dari input. */
function person_fields(array $in): array
{
    $name = trim($in['full_name'] ?? '');
    if ($name === '') {
        json_error('Nama lengkap wajib diisi.');
    }
    $gender = $in['gender'] ?? '';
    if (!in_array($gender, ['L', 'P'], true)) {
        json_error('Jenis kelamin wajib dipilih.');
    }
    $birth = trim($in['birth_date'] ?? '');
    $death = trim($in['death_date'] ?? '');
    foreach (['birth' => $birth, 'death' => $death] as $label => $d) {
        if ($d !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
            json_error('Format tanggal tidak valid (gunakan YYYY-MM-DD).');
        }
    }
    $nik = preg_replace('/\D+/', '', $in['nik'] ?? '');
    return [
        'full_name'   => mb_substr($name, 0, 150),
        'nickname'    => mb_substr(trim($in['nickname'] ?? ''), 0, 80) ?: null,
        'gender'      => $gender,
        'nik'         => $nik !== '' ? substr($nik, 0, 20) : null,
        'birth_place' => mb_substr(trim($in['birth_place'] ?? ''), 0, 120) ?: null,
        'birth_date'  => $birth ?: null,
        'death_date'  => $death ?: null,
        'is_deceased' => !empty($in['is_deceased']) ? 1 : 0,
        'notes'       => trim($in['notes'] ?? '') ?: null,
    ];
}

/** Pastikan person ada di pohon yang sama; kembalikan barisnya. */
function person_in_tree(int $personId, int $treeId): array
{
    $st = db()->prepare('SELECT * FROM persons WHERE id = ? AND tree_id = ?');
    $st->execute([$personId, $treeId]);
    $p = $st->fetch();
    if (!$p) {
        json_error('Anggota keluarga tidak ditemukan di pohon ini.', 404);
    }
    return $p;
}

/** Buat pernikahan antara dua person (urutan otomatis mengikuti jumlah pernikahan sebelumnya). */
function create_marriage(int $treeId, array $a, array $b, string $status = 'married'): int
{
    if ($a['gender'] === $b['gender']) {
        json_error('Pasangan harus terdiri dari satu laki-laki dan satu perempuan (mengikuti struktur ayah/ibu silsilah).');
    }
    $husband = $a['gender'] === 'L' ? $a : $b;
    $wife    = $a['gender'] === 'P' ? $a : $b;

    // urutan = pernikahan ke-berapa bagi pihak yang paling banyak menikah
    $st2 = db()->prepare('SELECT GREATEST(
        (SELECT COUNT(*) FROM marriages WHERE husband_id = ?),
        (SELECT COUNT(*) FROM marriages WHERE wife_id = ?)) AS n');
    $st2->execute([$husband['id'], $wife['id']]);
    $order = (int) $st2->fetchColumn() + 1;

    try {
        $ins = db()->prepare('INSERT INTO marriages (tree_id, husband_id, wife_id, status, marriage_order) VALUES (?, ?, ?, ?, ?)');
        $ins->execute([$treeId, $husband['id'], $wife['id'], $status, $order]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            json_error('Kedua orang ini sudah tercatat sebagai pasangan.');
        }
        throw $e;
    }
    return (int) db()->lastInsertId();
}

if ($method === 'POST') {
    $in     = read_json_body();
    $treeId = (int) ($in['tree_id'] ?? 0);
    require_tree_access($treeId, $uid, true);

    $f = person_fields($in);

    $fatherId = null;
    $motherId = null;
    $relation = is_array($in['relation'] ?? null) ? $in['relation'] : null;

    // relasi 'child': validasi orang tua dulu sebelum insert
    if ($relation && ($relation['type'] ?? '') === 'child') {
        if (!empty($relation['father_id'])) {
            $fa = person_in_tree((int) $relation['father_id'], $treeId);
            if ($fa['gender'] !== 'L') {
                json_error('Ayah harus berjenis kelamin laki-laki.');
            }
            $fatherId = (int) $fa['id'];
        }
        if (!empty($relation['mother_id'])) {
            $mo = person_in_tree((int) $relation['mother_id'], $treeId);
            if ($mo['gender'] !== 'P') {
                json_error('Ibu harus berjenis kelamin perempuan.');
            }
            $motherId = (int) $mo['id'];
        }
        if ($fatherId === null && $motherId === null) {
            json_error('Pilih minimal satu orang tua.');
        }
    }

    $st = db()->prepare(
        'INSERT INTO persons (tree_id, full_name, nickname, gender, nik, birth_place, birth_date, death_date,
                              is_deceased, father_id, mother_id, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $st->execute([
        $treeId, $f['full_name'], $f['nickname'], $f['gender'], $f['nik'], $f['birth_place'],
        $f['birth_date'], $f['death_date'], $f['is_deceased'], $fatherId, $motherId, $f['notes'], $uid,
    ]);
    $personId = (int) db()->lastInsertId();
    $new      = ['id' => $personId, 'gender' => $f['gender']];

    if ($relation) {
        $type = $relation['type'] ?? '';
        if ($type === 'spouse') {
            $partner = person_in_tree((int) ($relation['person_id'] ?? 0), $treeId);
            create_marriage($treeId, $new, $partner);
        } elseif ($type === 'parent') {
            $child = person_in_tree((int) ($relation['child_id'] ?? 0), $treeId);
            $col   = $f['gender'] === 'L' ? 'father_id' : 'mother_id';
            db()->prepare("UPDATE persons SET $col = ? WHERE id = ?")->execute([$personId, $child['id']]);
            // jika orang tua satunya sudah ada, otomatis catat sebagai pasangan (abaikan jika sudah ada)
            $otherCol = $col === 'father_id' ? 'mother_id' : 'father_id';
            if (!empty($child[$otherCol]) && !empty($relation['marry_other_parent'])) {
                $other = person_in_tree((int) $child[$otherCol], $treeId);
                $st = db()->prepare('SELECT id FROM marriages WHERE (husband_id = ? AND wife_id = ?) OR (husband_id = ? AND wife_id = ?)');
                $st->execute([$personId, $other['id'], $other['id'], $personId]);
                if (!$st->fetch()) {
                    create_marriage($treeId, $new, $other);
                }
            }
        }
    }

    log_activity($treeId, $uid, 'person_add', 'Menambahkan ' . $f['full_name']);
    json_out(['ok' => true, 'person_id' => $personId]);
}

if ($method === 'PUT') {
    $in       = read_json_body();
    $personId = (int) ($_GET['id'] ?? ($in['id'] ?? 0));

    $st = db()->prepare('SELECT * FROM persons WHERE id = ?');
    $st->execute([$personId]);
    $p = $st->fetch();
    if (!$p) {
        json_error('Anggota keluarga tidak ditemukan.', 404);
    }
    $treeId = (int) $p['tree_id'];
    require_tree_access($treeId, $uid, true);

    $f = person_fields($in);

    // perubahan orang tua (opsional, boleh null untuk melepas relasi)
    $fatherId = $p['father_id'];
    $motherId = $p['mother_id'];
    if (array_key_exists('father_id', $in)) {
        $fatherId = null;
        if (!empty($in['father_id'])) {
            $fa = person_in_tree((int) $in['father_id'], $treeId);
            if ($fa['gender'] !== 'L') {
                json_error('Ayah harus berjenis kelamin laki-laki.');
            }
            if ((int) $fa['id'] === $personId) {
                json_error('Seseorang tidak bisa menjadi orang tuanya sendiri.');
            }
            $fatherId = (int) $fa['id'];
        }
    }
    if (array_key_exists('mother_id', $in)) {
        $motherId = null;
        if (!empty($in['mother_id'])) {
            $mo = person_in_tree((int) $in['mother_id'], $treeId);
            if ($mo['gender'] !== 'P') {
                json_error('Ibu harus berjenis kelamin perempuan.');
            }
            if ((int) $mo['id'] === $personId) {
                json_error('Seseorang tidak bisa menjadi orang tuanya sendiri.');
            }
            $motherId = (int) $mo['id'];
        }
    }

    // jika jenis kelamin berubah, pastikan tidak bertentangan dengan relasi yang ada
    if ($f['gender'] !== $p['gender']) {
        $st = db()->prepare('SELECT COUNT(*) FROM marriages WHERE husband_id = ? OR wife_id = ?');
        $st->execute([$personId, $personId]);
        $st2 = db()->prepare('SELECT COUNT(*) FROM persons WHERE father_id = ? OR mother_id = ?');
        $st2->execute([$personId, $personId]);
        if ((int) $st->fetchColumn() > 0 || (int) $st2->fetchColumn() > 0) {
            json_error('Jenis kelamin tidak dapat diubah karena orang ini sudah memiliki relasi pasangan/anak. Hapus relasinya dulu.');
        }
    }

    $st = db()->prepare(
        'UPDATE persons SET full_name=?, nickname=?, gender=?, nik=?, birth_place=?, birth_date=?,
                death_date=?, is_deceased=?, father_id=?, mother_id=?, notes=? WHERE id=?'
    );
    $st->execute([
        $f['full_name'], $f['nickname'], $f['gender'], $f['nik'], $f['birth_place'], $f['birth_date'],
        $f['death_date'], $f['is_deceased'], $fatherId, $motherId, $f['notes'], $personId,
    ]);

    log_activity($treeId, $uid, 'person_edit', 'Memperbarui data ' . $f['full_name']);
    json_out(['ok' => true]);
}

if ($method === 'DELETE') {
    $personId = (int) ($_GET['id'] ?? 0);
    $st = db()->prepare('SELECT * FROM persons WHERE id = ?');
    $st->execute([$personId]);
    $p = $st->fetch();
    if (!$p) {
        json_error('Anggota keluarga tidak ditemukan.', 404);
    }
    require_tree_access((int) $p['tree_id'], $uid, true);

    if ($p['photo']) {
        $path = UPLOAD_DIR . '/' . basename($p['photo']);
        if (is_file($path)) {
            @unlink($path);
        }
    }
    db()->prepare('DELETE FROM persons WHERE id = ?')->execute([$personId]);
    log_activity((int) $p['tree_id'], $uid, 'person_delete', 'Menghapus ' . $p['full_name']);
    json_out(['ok' => true]);
}

json_error('Metode tidak didukung.', 405);
