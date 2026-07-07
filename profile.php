<?php
require __DIR__ . '/config.php';
$user = require_login();

$msg = '';
$err = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_check($_POST['csrf'] ?? null)) {
        $err = 'Sesi kedaluwarsa, silakan coba lagi.';
    } elseif (($_POST['form'] ?? '') === 'profile') {
        $name = trim($_POST['name'] ?? '');
        if (mb_strlen($name) < 2) {
            $err = 'Nama minimal 2 karakter.';
        } else {
            db()->prepare('UPDATE users SET name = ? WHERE id = ?')->execute([$name, $user['id']]);
            $user['name'] = $name;
            $msg = 'Nama berhasil diperbarui.';
        }
    } elseif (($_POST['form'] ?? '') === 'password') {
        $cur  = $_POST['current_password'] ?? '';
        $new  = $_POST['new_password'] ?? '';
        $new2 = $_POST['new_password2'] ?? '';
        $st = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
        $st->execute([$user['id']]);
        $hash = $st->fetchColumn();
        if (!password_verify($cur, $hash)) {
            $err = 'Kata sandi saat ini salah.';
        } elseif (strlen($new) < 6) {
            $err = 'Kata sandi baru minimal 6 karakter.';
        } elseif ($new !== $new2) {
            $err = 'Konfirmasi kata sandi tidak sama.';
        } else {
            db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
                ->execute([password_hash($new, PASSWORD_DEFAULT), $user['id']]);
            $msg = 'Kata sandi berhasil diganti.';
        }
    }
}
$initial = mb_strtoupper(mb_substr($user['name'], 0, 1));
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Akun Saya — <?= e(APP_NAME) ?></title>
<link rel="stylesheet" href="assets/css/app.css">
</head>
<body>
<header class="topbar">
  <a href="dashboard.php" class="brand" style="text-decoration:none;color:inherit">
    <span class="brand-mark" aria-hidden="true"></span>
    <h1><?= e(APP_NAME) ?></h1>
  </a>
  <div class="topbar-right">
    <span class="user-chip"><span class="avatar"><?= e($initial) ?></span> <?= e($user['name']) ?></span>
    <a href="logout.php" class="btn btn-ghost btn-sm">Keluar</a>
  </div>
</header>

<main class="page" style="max-width:520px">
  <div class="page-head">
    <div>
      <h2>Akun Saya</h2>
      <p class="sub"><?= e($user['email']) ?></p>
    </div>
    <a class="btn" href="dashboard.php">&larr; Kembali</a>
  </div>

  <?php if ($msg): ?><div class="alert alert-success"><?= e($msg) ?></div><?php endif; ?>
  <?php if ($err): ?><div class="alert alert-error"><?= e($err) ?></div><?php endif; ?>

  <div class="tree-card" style="margin-bottom:16px">
    <h3>Profil</h3>
    <form method="post">
      <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
      <input type="hidden" name="form" value="profile">
      <label class="field">
        <span>Nama lengkap</span>
        <input type="text" name="name" value="<?= e($user['name']) ?>" required>
      </label>
      <button type="submit" class="btn btn-primary">Simpan</button>
    </form>
  </div>

  <div class="tree-card">
    <h3>Ganti kata sandi</h3>
    <form method="post">
      <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
      <input type="hidden" name="form" value="password">
      <label class="field">
        <span>Kata sandi saat ini</span>
        <input type="password" name="current_password" required autocomplete="current-password">
      </label>
      <label class="field">
        <span>Kata sandi baru <small>(minimal 6 karakter)</small></span>
        <input type="password" name="new_password" required minlength="6" autocomplete="new-password">
      </label>
      <label class="field">
        <span>Ulangi kata sandi baru</span>
        <input type="password" name="new_password2" required minlength="6" autocomplete="new-password">
      </label>
      <button type="submit" class="btn btn-primary">Ganti kata sandi</button>
    </form>
  </div>
</main>
</body>
</html>
