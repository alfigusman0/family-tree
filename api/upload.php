<?php
/**
 * POST multipart: photo (file), person_id  →  simpan foto profil anggota keluarga.
 */
require __DIR__ . '/../config.php';

$user = api_user();
$uid  = (int) $user['id'];

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metode tidak didukung.', 405);
}

$personId = (int) ($_POST['person_id'] ?? 0);
$st = db()->prepare('SELECT * FROM persons WHERE id = ?');
$st->execute([$personId]);
$p = $st->fetch();
if (!$p) {
    json_error('Anggota keluarga tidak ditemukan.', 404);
}
require_tree_access((int) $p['tree_id'], $uid, true);

if (empty($_FILES['photo']) || $_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
    json_error('Tidak ada file yang terunggah atau unggahan gagal.');
}
$file = $_FILES['photo'];
if ($file['size'] > MAX_PHOTO_BYTES) {
    json_error('Ukuran foto maksimal 5 MB.');
}

$info = @getimagesize($file['tmp_name']);
$allowed = [
    IMAGETYPE_JPEG => 'jpg',
    IMAGETYPE_PNG  => 'png',
    IMAGETYPE_WEBP => 'webp',
];
if (!$info || !isset($allowed[$info[2]])) {
    json_error('Format foto harus JPG, PNG, atau WebP.');
}
$ext = $allowed[$info[2]];

if (!is_dir(UPLOAD_DIR)) {
    mkdir(UPLOAD_DIR, 0775, true);
}

$filename = 'p' . $personId . '_' . bin2hex(random_bytes(8)) . '.' . $ext;
$dest     = UPLOAD_DIR . '/' . $filename;
if (!move_uploaded_file($file['tmp_name'], $dest)) {
    json_error('Gagal menyimpan file di server.', 500);
}

// perkecil sisi terpanjang menjadi maks 600 px agar hemat & cepat dimuat
list($w, $h) = $info;
$max = 600;
if ($w > $max || $h > $max) {
    $scale = min($max / $w, $max / $h);
    $nw = (int) round($w * $scale);
    $nh = (int) round($h * $scale);
    $src = null;
    switch ($info[2]) {
        case IMAGETYPE_JPEG: $src = @imagecreatefromjpeg($dest); break;
        case IMAGETYPE_PNG:  $src = @imagecreatefrompng($dest);  break;
        case IMAGETYPE_WEBP: $src = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($dest) : null; break;
    }
    if ($src) {
        $dst = imagecreatetruecolor($nw, $nh);
        if ($info[2] === IMAGETYPE_PNG) {
            imagealphablending($dst, false);
            imagesavealpha($dst, true);
        }
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
        switch ($info[2]) {
            case IMAGETYPE_JPEG: imagejpeg($dst, $dest, 85); break;
            case IMAGETYPE_PNG:  imagepng($dst, $dest, 6);   break;
            case IMAGETYPE_WEBP: imagewebp($dst, $dest, 85); break;
        }
        imagedestroy($src);
        imagedestroy($dst);
    }
}

// hapus foto lama
if ($p['photo']) {
    $old = UPLOAD_DIR . '/' . basename($p['photo']);
    if (is_file($old)) {
        @unlink($old);
    }
}

db()->prepare('UPDATE persons SET photo = ? WHERE id = ?')->execute([$filename, $personId]);
log_activity((int) $p['tree_id'], $uid, 'photo_upload', 'Mengunggah foto ' . $p['full_name']);

json_out(['ok' => true, 'photo' => $filename, 'url' => UPLOAD_URL . '/' . $filename]);
