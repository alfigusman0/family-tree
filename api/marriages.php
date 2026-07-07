<?php
/**
 * API pernikahan.
 *
 * POST   {tree_id, person1_id, person2_id, marriage_date?, status?}  → nikahkan dua orang yang sudah ada
 * PUT    ?id=..  {marriage_date?, divorce_date?, status?, marriage_order?}
 * DELETE ?id=..
 */
require __DIR__ . '/../config.php';

$user   = api_user();
$uid    = (int) $user['id'];
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') {
    $in     = read_json_body();
    $treeId = (int) ($in['tree_id'] ?? 0);
    require_tree_access($treeId, $uid, true);

    $ids = [(int) ($in['person1_id'] ?? 0), (int) ($in['person2_id'] ?? 0)];
    if ($ids[0] === $ids[1]) {
        json_error('Pilih dua orang yang berbeda.');
    }
    $pair = [];
    foreach ($ids as $id) {
        $st = db()->prepare('SELECT id, full_name, gender FROM persons WHERE id = ? AND tree_id = ?');
        $st->execute([$id, $treeId]);
        $p = $st->fetch();
        if (!$p) {
            json_error('Anggota keluarga tidak ditemukan di pohon ini.', 404);
        }
        $pair[] = $p;
    }
    if ($pair[0]['gender'] === $pair[1]['gender']) {
        json_error('Pasangan harus terdiri dari satu laki-laki dan satu perempuan (mengikuti struktur ayah/ibu silsilah).');
    }
    $husband = $pair[0]['gender'] === 'L' ? $pair[0] : $pair[1];
    $wife    = $pair[0]['gender'] === 'P' ? $pair[0] : $pair[1];

    $st = db()->prepare('SELECT GREATEST(
        (SELECT COUNT(*) FROM marriages WHERE husband_id = ?),
        (SELECT COUNT(*) FROM marriages WHERE wife_id = ?)) AS n');
    $st->execute([$husband['id'], $wife['id']]);
    $order = (int) $st->fetchColumn() + 1;

    $date   = trim($in['marriage_date'] ?? '');
    $status = in_array($in['status'] ?? '', ['married', 'divorced', 'widowed'], true) ? $in['status'] : 'married';

    try {
        $st = db()->prepare('INSERT INTO marriages (tree_id, husband_id, wife_id, marriage_date, status, marriage_order) VALUES (?, ?, ?, ?, ?, ?)');
        $st->execute([$treeId, $husband['id'], $wife['id'], $date ?: null, $status, $order]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            json_error('Kedua orang ini sudah tercatat sebagai pasangan.');
        }
        throw $e;
    }

    log_activity($treeId, $uid, 'marriage_add', 'Mencatat pernikahan ' . $husband['full_name'] . ' & ' . $wife['full_name']);
    json_out(['ok' => true, 'marriage_id' => (int) db()->lastInsertId()]);
}

/* PUT & DELETE: ambil pernikahan dan cek akses */
$marriageId = (int) ($_GET['id'] ?? 0);
$st = db()->prepare('SELECT * FROM marriages WHERE id = ?');
$st->execute([$marriageId]);
$m = $st->fetch();
if (!$m) {
    json_error('Data pernikahan tidak ditemukan.', 404);
}
require_tree_access((int) $m['tree_id'], $uid, true);

if ($method === 'PUT') {
    $in = read_json_body();
    $status = in_array($in['status'] ?? '', ['married', 'divorced', 'widowed'], true) ? $in['status'] : $m['status'];
    $mdate  = array_key_exists('marriage_date', $in) ? (trim($in['marriage_date']) ?: null) : $m['marriage_date'];
    $ddate  = array_key_exists('divorce_date', $in) ? (trim($in['divorce_date']) ?: null) : $m['divorce_date'];
    $order  = isset($in['marriage_order']) ? max(1, (int) $in['marriage_order']) : (int) $m['marriage_order'];

    db()->prepare('UPDATE marriages SET marriage_date=?, divorce_date=?, status=?, marriage_order=? WHERE id=?')
        ->execute([$mdate, $ddate, $status, $order, $marriageId]);
    log_activity((int) $m['tree_id'], $uid, 'marriage_edit', 'Memperbarui data pernikahan');
    json_out(['ok' => true]);
}

if ($method === 'DELETE') {
    db()->prepare('DELETE FROM marriages WHERE id = ?')->execute([$marriageId]);
    log_activity((int) $m['tree_id'], $uid, 'marriage_delete', 'Menghapus data pernikahan');
    json_out(['ok' => true]);
}

json_error('Metode tidak didukung.', 405);
