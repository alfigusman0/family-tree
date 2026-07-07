<?php
/**
 * Halaman tautan undangan: join.php?code=XXXX
 * Login dulu bila perlu, lalu otomatis bergabung sesuai jenis kodenya.
 */
require __DIR__ . '/config.php';
$user = require_login();

$code = strtoupper(trim($_GET['code'] ?? ''));
$error = '';

if ($code !== '') {
    $st = db()->prepare('SELECT id, name, share_code_edit, share_code_view FROM trees WHERE share_code_edit = ? OR share_code_view = ?');
    $st->execute([$code, $code]);
    $tree = $st->fetch();
    if ($tree) {
        $role = ($code === $tree['share_code_edit']) ? 'editor' : 'viewer';
        $existing = tree_role((int) $tree['id'], (int) $user['id']);
        if ($existing === null) {
            db()->prepare('INSERT INTO tree_members (tree_id, user_id, role) VALUES (?, ?, ?)')
                ->execute([$tree['id'], $user['id'], $role]);
            log_activity((int) $tree['id'], (int) $user['id'], 'member_join', $user['name'] . ' bergabung sebagai ' . ($role === 'editor' ? 'editor' : 'penampil'));
        } elseif ($existing === 'viewer' && $role === 'editor') {
            db()->prepare('UPDATE tree_members SET role = "editor" WHERE tree_id = ? AND user_id = ?')
                ->execute([$tree['id'], $user['id']]);
        }
        header('Location: tree.php?id=' . (int) $tree['id']);
        exit;
    }
    $error = 'Kode undangan tidak ditemukan atau sudah tidak berlaku.';
} else {
    $error = 'Tautan undangan tidak lengkap.';
}
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Undangan — <?= e(APP_NAME) ?></title>
<link rel="stylesheet" href="<?= asset('assets/css/app.css') ?>">
</head>
<body class="auth-body">
<main class="auth-card">
  <div class="brand">
    <span class="brand-mark" aria-hidden="true"></span>
    <h1><?= e(APP_NAME) ?></h1>
  </div>
  <div class="alert alert-error" style="margin-top:16px"><?= e($error) ?></div>
  <a class="btn btn-block" href="dashboard.php">Kembali ke beranda</a>
</main>
</body>
</html>
