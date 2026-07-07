# Silsilah — Aplikasi Pohon Keluarga Kolaboratif

Aplikasi web pohon keluarga berbahasa Indonesia: mudah dipakai, bisa dibagikan
dan diisi bersama, mendukung **poligami/menikah lagi**, upload foto, serta
**import otomatis dari Kartu Keluarga** (PDF maupun foto/scan).

## Fitur

- **Multi pengguna & multi pohon** — setiap akun bisa membuat banyak pohon keluarga.
- **Kolaborasi** — bagikan lewat tautan/kode undangan. Dua jenis kode:
  - *Pengedit*: bisa menambah & mengubah data;
  - *Penampil*: hanya melihat.
  Pemilik bisa mengatur peran, mengeluarkan anggota, dan mengganti kode
  (tautan lama otomatis hangus). Semua perubahan tercatat di tab **Aktivitas**.
- **Poligami & menikah lagi** — satu orang boleh punya banyak pernikahan
  (dengan urutan ke-1, ke-2, …, status menikah/cerai/ditinggal wafat).
  Anak selalu terhubung ke ayah **dan** ibu masing-masing, jadi:
  *ibu menikah 2× dengan anak dari kedua suami* tampil benar di pohon,
  dan saat menambah anak dari orang yang menikah >1×, aplikasi menanyakan
  "dari pernikahan yang mana".
- **Import Kartu Keluarga** — unggah PDF atau foto KK:
  - PDF dengan teks tertanam dibaca langsung (paling akurat);
  - PDF hasil scan / foto dibaca dengan OCR (Tesseract.js, bahasa Indonesia);
  - hasil bacaan tampil di **tabel review yang bisa diedit penuh** sebelum
    dimasukkan — kepala keluarga, istri (boleh lebih dari satu), suami, dan
    anak otomatis dihubungkan.
- **Foto profil** — unggah JPG/PNG/WebP (maks 5 MB), otomatis diperkecil di server.
- **Kanvas interaktif** — seret untuk geser, scroll/cubit dua jari untuk zoom,
  klik kartu untuk detail, tombol **+** pada kartu untuk menambah keluarga
  langsung dari kanvas; tombol *Fit* memuat seluruh pohon. Responsive untuk HP.
- **Lipat cabang** — tombol kecil di bawah kartu menyembunyikan/menampilkan
  seluruh keturunan (badge menunjukkan jumlah yang tersembunyi); tersimpan
  per pohon di browser.
- **Urutan anak** — field "Anak ke-" menentukan posisi antar saudara
  (fallback: tanggal lahir). Import KK mengisinya otomatis sesuai urutan baris.
- **Status meninggal** — checkbox + tanggal wafat, tersedia juga di tabel
  review import; kartu menampilkan tanda †.

## Teknologi

- PHP 7.4+ (tanpa framework), MySQL 8, PDO prepared statements.
- Frontend vanilla JS + SVG renderer buatan sendiri (tanpa build step).
- OCR di sisi browser: Tesseract.js + pdf.js (dimuat dari CDN saat dibutuhkan —
  butuh koneksi internet saat import KK pertama kali).

## Instalasi

1. Letakkan folder ini di `htdocs` (sudah: `C:\xampp\htdocs\projects\family-tree`).
2. Buat skema database (sudah dijalankan; untuk server baru):
   ```
   mysql -h 192.168.18.142 -u alfi -p -e "CREATE DATABASE family_tree CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
   mysql -h 192.168.18.142 -u alfi -p family_tree < database/schema.sql
   ```
3. Sesuaikan kredensial DB di `config.php` bila berubah.
4. Buka `http://localhost/projects/family-tree/` (via Apache XAMPP), atau
   jalankan `php -S localhost:8123` di folder ini.

## Cara pakai singkat

1. **Daftar** akun → **Buat pohon baru**.
2. Tambah satu orang (biasanya yang tertua), lalu kembangkan dari kartunya:
   **+ Pasangan**, **+ Anak**, **+ Ayah**, **+ Ibu** — atau **Import Kartu Keluarga**.
3. Klik **Bagikan** → salin tautan *pengedit* dan kirim ke anggota keluarga
   lain; mereka mendaftar, lalu bisa ikut mengisi.

## Struktur data (ringkas)

- `persons.father_id / mother_id` — relasi orang tua per individu; inilah yang
  membuat poligami didukung alami (dua anak seibu boleh berbeda ayah).
- `marriages` — pasangan + urutan pernikahan + status; satu orang boleh muncul
  di banyak baris.
- `tree_members` — peran kolaborator per pohon (owner/editor/viewer).
- `activities` — jejak perubahan untuk kolaborasi.

## Catatan keamanan

- Password di-hash (bcrypt), semua query pakai prepared statement, output
  di-escape, API dilindungi token CSRF, folder `uploads/` menolak eksekusi skrip.
- Ganti nama & kata sandi tersedia di halaman **Akun Saya** (klik avatar).
- Kredensial database disimpan di `config.local.php` (tidak ikut git) —
  salin dari `config.local.example.php`.
- Belum ada: verifikasi email & reset password via email.
