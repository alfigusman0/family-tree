<?php
/**
 * API pohon keluarga: buat, ubah, hapus, bagikan, kelola anggota, log aktivitas.
 *
 * GET  ?action=members&tree_id=..    daftar anggota kolaborasi
 * GET  ?action=activity&tree_id=..   log aktivitas terakhir
 * POST {action:create, name, description}
 * POST {action:join, code}
 * POST {action:rename, tree_id, name, description}
 * POST {action:regenerate_codes, tree_id}
 * POST {action:set_role, tree_id, user_id, role}
 * POST {action:remove_member, tree_id, user_id}
 * POST {action:leave, tree_id}
 * POST {action:delete, tree_id}
 */
require __DIR__ . '/../config.php';

$user   = api_user();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $action = $_GET['action'] ?? '';
    $treeId = (int) ($_GET['tree_id'] ?? 0);
    require_tree_access($treeId, (int) $user['id']);

    if ($action === 'members') {
        $st = db()->prepare(
            'SELECT tm.user_id, tm.role, u.name, u.email
             FROM tree_members tm JOIN users u ON u.id = tm.user_id
             WHERE tm.tree_id = ? ORDER BY FIELD(tm.role, "owner","editor","viewer"), u.name'
        );
        $st->execute([$treeId]);
        json_out(['ok' => true, 'members' => $st->fetchAll()]);
    }

    if ($action === 'guest_links') {
        db()->prepare('DELETE FROM share_links WHERE tree_id = ? AND expires_at < NOW()')->execute([$treeId]);
        $st = db()->prepare(
            'SELECT sl.id, sl.token, sl.expires_at, u.name AS created_by_name
             FROM share_links sl LEFT JOIN users u ON u.id = sl.created_by
             WHERE sl.tree_id = ? ORDER BY sl.id DESC'
        );
        $st->execute([$treeId]);
        json_out(['ok' => true, 'links' => $st->fetchAll()]);
    }

    if ($action === 'activity') {
        $st = db()->prepare(
            'SELECT a.action, a.detail, a.created_at, u.name AS user_name
             FROM activities a LEFT JOIN users u ON u.id = a.user_id
             WHERE a.tree_id = ? ORDER BY a.id DESC LIMIT 50'
        );
        $st->execute([$treeId]);
        json_out(['ok' => true, 'activities' => $st->fetchAll()]);
    }

    json_error('Aksi tidak dikenal.');
}

if ($method !== 'POST') {
    json_error('Metode tidak didukung.', 405);
}

$in     = read_json_body();
$action = $in['action'] ?? '';
$uid    = (int) $user['id'];

if ($action === 'create') {
    $name = trim($in['name'] ?? '');
    if ($name === '') {
        json_error('Nama pohon keluarga wajib diisi.');
    }
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('INSERT INTO trees (name, description, owner_id, share_code_edit, share_code_view) VALUES (?, ?, ?, ?, ?)');
        $st->execute([$name, trim($in['description'] ?? '') ?: null, $uid, share_code(), share_code()]);
        $treeId = (int) $pdo->lastInsertId();
        $pdo->prepare('INSERT INTO tree_members (tree_id, user_id, role) VALUES (?, ?, "owner")')->execute([$treeId, $uid]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    log_activity($treeId, $uid, 'tree_create', 'Membuat pohon "' . $name . '"');
    json_out(['ok' => true, 'tree_id' => $treeId]);
}

if ($action === 'join') {
    $code = strtoupper(trim($in['code'] ?? ''));
    if ($code === '') {
        json_error('Kode undangan wajib diisi.');
    }
    $st = db()->prepare('SELECT id, name, share_code_edit, share_code_view FROM trees WHERE share_code_edit = ? OR share_code_view = ?');
    $st->execute([$code, $code]);
    $tree = $st->fetch();
    if (!$tree) {
        json_error('Kode undangan tidak ditemukan. Periksa kembali kodenya.');
    }
    $role = ($code === $tree['share_code_edit']) ? 'editor' : 'viewer';

    $existing = tree_role((int) $tree['id'], $uid);
    if ($existing === null) {
        db()->prepare('INSERT INTO tree_members (tree_id, user_id, role) VALUES (?, ?, ?)')
            ->execute([$tree['id'], $uid, $role]);
        log_activity((int) $tree['id'], $uid, 'member_join', $user['name'] . ' bergabung sebagai ' . ($role === 'editor' ? 'editor' : 'penampil'));
    } elseif ($existing === 'viewer' && $role === 'editor') {
        db()->prepare('UPDATE tree_members SET role = "editor" WHERE tree_id = ? AND user_id = ?')
            ->execute([$tree['id'], $uid]);
    }
    json_out(['ok' => true, 'tree_id' => (int) $tree['id'], 'tree_name' => $tree['name']]);
}

/* aksi berikut membutuhkan keanggotaan pohon */
$treeId = (int) ($in['tree_id'] ?? 0);
$role   = require_tree_access($treeId, $uid);

if ($action === 'create_guest_link') {
    if ($role === 'viewer') {
        json_error('Hanya pemilik/editor yang dapat membuat tautan tamu.', 403);
    }
    $days = (int) ($in['days'] ?? 7);
    if (!in_array($days, [1, 3, 7, 30], true)) {
        $days = 7;
    }
    $token = bin2hex(random_bytes(16));
    db()->prepare('INSERT INTO share_links (tree_id, token, expires_at, created_by) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), ?)')
        ->execute([$treeId, $token, $days, $uid]);
    log_activity($treeId, $uid, 'guest_link', 'Membuat tautan tamu (berlaku ' . $days . ' hari)');
    $st = db()->prepare('SELECT expires_at FROM share_links WHERE token = ?');
    $st->execute([$token]);
    json_out(['ok' => true, 'token' => $token, 'expires_at' => $st->fetchColumn()]);
}

if ($action === 'delete_guest_link') {
    if ($role === 'viewer') {
        json_error('Hanya pemilik/editor yang dapat menghapus tautan tamu.', 403);
    }
    db()->prepare('DELETE FROM share_links WHERE id = ? AND tree_id = ?')
        ->execute([(int) ($in['link_id'] ?? 0), $treeId]);
    json_out(['ok' => true]);
}

if ($action === 'rename') {
    if ($role !== 'owner') {
        json_error('Hanya pemilik yang dapat mengubah nama pohon.', 403);
    }
    $name = trim($in['name'] ?? '');
    if ($name === '') {
        json_error('Nama pohon wajib diisi.');
    }
    db()->prepare('UPDATE trees SET name = ?, description = ? WHERE id = ?')
        ->execute([$name, trim($in['description'] ?? '') ?: null, $treeId]);
    json_out(['ok' => true]);
}

if ($action === 'regenerate_codes') {
    if ($role !== 'owner') {
        json_error('Hanya pemilik yang dapat mengganti kode undangan.', 403);
    }
    $edit = share_code();
    $view = share_code();
    db()->prepare('UPDATE trees SET share_code_edit = ?, share_code_view = ? WHERE id = ?')
        ->execute([$edit, $view, $treeId]);
    json_out(['ok' => true, 'share_code_edit' => $edit, 'share_code_view' => $view]);
}

if ($action === 'set_role') {
    if ($role !== 'owner') {
        json_error('Hanya pemilik yang dapat mengubah peran anggota.', 403);
    }
    $target  = (int) ($in['user_id'] ?? 0);
    $newRole = $in['role'] ?? '';
    if (!in_array($newRole, ['editor', 'viewer'], true)) {
        json_error('Peran tidak valid.');
    }
    if ($target === $uid) {
        json_error('Anda tidak dapat mengubah peran Anda sendiri.');
    }
    db()->prepare('UPDATE tree_members SET role = ? WHERE tree_id = ? AND user_id = ? AND role <> "owner"')
        ->execute([$newRole, $treeId, $target]);
    json_out(['ok' => true]);
}

if ($action === 'remove_member') {
    if ($role !== 'owner') {
        json_error('Hanya pemilik yang dapat mengeluarkan anggota.', 403);
    }
    $target = (int) ($in['user_id'] ?? 0);
    if ($target === $uid) {
        json_error('Pemilik tidak dapat mengeluarkan dirinya sendiri.');
    }
    db()->prepare('DELETE FROM tree_members WHERE tree_id = ? AND user_id = ? AND role <> "owner"')
        ->execute([$treeId, $target]);
    json_out(['ok' => true]);
}

if ($action === 'leave') {
    if ($role === 'owner') {
        json_error('Pemilik tidak dapat keluar dari pohonnya sendiri. Hapus pohon jika sudah tidak diperlukan.');
    }
    db()->prepare('DELETE FROM tree_members WHERE tree_id = ? AND user_id = ?')->execute([$treeId, $uid]);
    json_out(['ok' => true]);
}

if ($action === 'delete') {
    if ($role !== 'owner') {
        json_error('Hanya pemilik yang dapat menghapus pohon.', 403);
    }
    // hapus foto-foto terkait dari disk
    $st = db()->prepare('SELECT photo FROM persons WHERE tree_id = ? AND photo IS NOT NULL');
    $st->execute([$treeId]);
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $photo) {
        $path = UPLOAD_DIR . '/' . basename($photo);
        if (is_file($path)) {
            @unlink($path);
        }
    }
    db()->prepare('DELETE FROM trees WHERE id = ?')->execute([$treeId]);
    json_out(['ok' => true]);
}

json_error('Aksi tidak dikenal.');
