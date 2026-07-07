<?php
require __DIR__ . '/config.php';

if (current_user()) {
    header('Location: dashboard.php');
    exit;
}

$error = '';
$name  = '';
$email = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_check($_POST['csrf'] ?? null)) {
        $error = 'Sesi kedaluwarsa, silakan coba lagi.';
    } else {
        $name     = trim($_POST['name'] ?? '');
        $email    = trim($_POST['email'] ?? '');
        $password = $_POST['password'] ?? '';

        if ($name === '' || mb_strlen($name) < 2) {
            $error = 'Nama minimal 2 karakter.';
        } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $error = 'Format email tidak valid.';
        } elseif (strlen($password) < 6) {
            $error = 'Kata sandi minimal 6 karakter.';
        } else {
            $st = db()->prepare('SELECT id FROM users WHERE email = ?');
            $st->execute([$email]);
            if ($st->fetch()) {
                $error = 'Email sudah terdaftar. Silakan masuk.';
            } else {
                $st = db()->prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)');
                $st->execute([$name, $email, password_hash($password, PASSWORD_DEFAULT)]);
                session_regenerate_id(true);
                $_SESSION['user_id'] = (int) db()->lastInsertId();
                header('Location: dashboard.php');
                exit;
            }
        }
    }
}
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daftar — <?= e(APP_NAME) ?></title>
<link rel="stylesheet" href="assets/css/app.css">
</head>
<body class="auth-body">
<main class="auth-card">
  <div class="brand">
    <span class="brand-mark" aria-hidden="true"></span>
    <h1><?= e(APP_NAME) ?></h1>
  </div>
  <p class="auth-sub">Buat akun untuk mulai menyusun pohon keluarga Anda.</p>

  <?php if ($error): ?><div class="alert alert-error"><?= e($error) ?></div><?php endif; ?>

  <form method="post" novalidate>
    <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
    <label class="field">
      <span>Nama lengkap</span>
      <input type="text" name="name" value="<?= e($name) ?>" required autofocus autocomplete="name">
    </label>
    <label class="field">
      <span>Email</span>
      <input type="email" name="email" value="<?= e($email) ?>" required autocomplete="email">
    </label>
    <label class="field">
      <span>Kata sandi <small>(minimal 6 karakter)</small></span>
      <input type="password" name="password" required autocomplete="new-password" minlength="6">
    </label>
    <button type="submit" class="btn btn-primary btn-block">Daftar</button>
  </form>

  <p class="auth-switch">Sudah punya akun? <a href="login.php">Masuk</a></p>
</main>
</body>
</html>
