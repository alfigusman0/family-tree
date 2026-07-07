<?php
/**
 * Family Tree — konfigurasi & helper bersama.
 */

date_default_timezone_set('Asia/Jakarta');

// Kredensial per-lingkungan berada di config.local.php (tidak ikut git).
$__local = __DIR__ . '/config.local.php';
if (is_file($__local)) {
    require $__local;
}
defined('DB_HOST') || define('DB_HOST', '127.0.0.1');
defined('DB_NAME') || define('DB_NAME', 'family_tree');
defined('DB_USER') || define('DB_USER', 'root');
defined('DB_PASS') || define('DB_PASS', '');

define('APP_NAME', 'Silsilah');
define('UPLOAD_DIR', __DIR__ . '/uploads');
define('UPLOAD_URL', 'uploads');
define('MAX_PHOTO_BYTES', 5 * 1024 * 1024); // 5 MB

if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            // DB berada di host lain — koneksi persisten memangkas latensi per request
            PDO::ATTR_PERSISTENT         => true,
        ]);
    }
    return $pdo;
}

/* ---------- auth ---------- */

function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    static $user = null;
    if ($user === null) {
        $st = db()->prepare('SELECT id, name, email, created_at FROM users WHERE id = ?');
        $st->execute([$_SESSION['user_id']]);
        $user = $st->fetch() ?: null;
        if ($user === null) {
            unset($_SESSION['user_id']);
        }
    }
    return $user;
}

function require_login(): array
{
    $user = current_user();
    if (!$user) {
        $to = urlencode($_SERVER['REQUEST_URI'] ?? 'dashboard.php');
        header('Location: login.php?next=' . $to);
        exit;
    }
    return $user;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
    return $_SESSION['csrf'];
}

function csrf_check(?string $token): bool
{
    return is_string($token) && $token !== '' && hash_equals($_SESSION['csrf'] ?? '', $token);
}

/* ---------- API helpers ---------- */

function json_out($data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error(string $message, int $code = 400): void
{
    json_out(['ok' => false, 'error' => $message], $code);
}

function api_user(): array
{
    $user = current_user();
    if (!$user) {
        json_error('Anda harus login terlebih dahulu.', 401);
    }
    // Semua request yang mengubah data wajib membawa token CSRF.
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf'] ?? null);
        if (!csrf_check($token)) {
            json_error('Sesi kedaluwarsa, silakan muat ulang halaman.', 419);
        }
    }
    return $user;
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/* ---------- otorisasi pohon ---------- */

function tree_role(int $treeId, int $userId): ?string
{
    $st = db()->prepare('SELECT role FROM tree_members WHERE tree_id = ? AND user_id = ?');
    $st->execute([$treeId, $userId]);
    $row = $st->fetch();
    return $row ? $row['role'] : null;
}

/** Pastikan user adalah anggota pohon; kembalikan perannya. */
function require_tree_access(int $treeId, int $userId, bool $needEdit = false): string
{
    $role = tree_role($treeId, $userId);
    if ($role === null) {
        json_error('Anda tidak memiliki akses ke pohon keluarga ini.', 403);
    }
    if ($needEdit && $role === 'viewer') {
        json_error('Anda hanya memiliki akses lihat pada pohon ini.', 403);
    }
    return $role;
}

function log_activity(int $treeId, ?int $userId, string $action, string $detail = ''): void
{
    $st = db()->prepare('INSERT INTO activities (tree_id, user_id, action, detail) VALUES (?, ?, ?, ?)');
    $st->execute([$treeId, $userId, $action, mb_substr($detail, 0, 255)]);
}

function share_code(): string
{
    // Kode ramah manusia, tanpa karakter ambigu (0/O, 1/I/l).
    $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    $code = '';
    for ($i = 0; $i < 10; $i++) {
        $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    return $code;
}

/* ---------- util tampilan ---------- */

function e(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

/** URL asset dengan versi (cache busting untuk CDN/Cloudflare). */
function asset(string $path): string
{
    $file = __DIR__ . '/' . $path;
    $v = is_file($file) ? (string) filemtime($file) : '1';
    return e($path . '?v=' . $v);
}
