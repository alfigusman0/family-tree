<?php
require __DIR__ . '/config.php';

if (current_user()) {
    header('Location: dashboard.php');
    exit;
}

$error = '';
$email = '';
$next  = $_GET['next'] ?? ($_POST['next'] ?? 'dashboard.php');
// hanya izinkan redirect internal (tolak URL absolut / protocol-relative)
if (!is_string($next) || $next === '' || strpos($next, '//') === 0 || strpos($next, ':') !== false) {
    $next = 'dashboard.php';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_check($_POST['csrf'] ?? null)) {
        $error = 'Sesi kedaluwarsa, silakan coba lagi.';
    } else {
        $email    = trim($_POST['email'] ?? '');
        $password = $_POST['password'] ?? '';
        $st = db()->prepare('SELECT id, password_hash FROM users WHERE email = ?');
        $st->execute([$email]);
        $row = $st->fetch();
        if ($row && password_verify($password, $row['password_hash'])) {
            session_regenerate_id(true);
            $_SESSION['user_id'] = (int) $row['id'];
            header('Location: ' . $next);
            exit;
        }
        $error = 'Email atau kata sandi salah.';
    }
}
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Masuk — <?= e(APP_NAME) ?></title>
<link rel="stylesheet" href="assets/css/app.css">
</head>
<body class="auth-body">
<main class="auth-card">
  <div class="brand">
    <span class="brand-mark" aria-hidden="true"></span>
    <h1><?= e(APP_NAME) ?></h1>
  </div>
  <p class="auth-sub">Pohon keluarga bersama — mudah dibuat, mudah dibagikan.</p>

  <?php if ($error): ?><div class="alert alert-error"><?= e($error) ?></div><?php endif; ?>

  <form method="post" novalidate>
    <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
    <input type="hidden" name="next" value="<?= e($next) ?>">
    <label class="field">
      <span>Email</span>
      <input type="email" name="email" value="<?= e($email) ?>" required autofocus autocomplete="email">
    </label>
    <label class="field">
      <span>Kata sandi</span>
      <input type="password" name="password" required autocomplete="current-password">
    </label>
    <button type="submit" class="btn btn-primary btn-block">Masuk</button>
  </form>

  <p class="auth-switch">Belum punya akun? <a href="register.php">Daftar gratis</a></p>
</main>
</body>
</html>
