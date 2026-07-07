<?php
require __DIR__ . '/config.php';
$user = require_login();

$treeId = (int) ($_GET['id'] ?? 0);
$role = tree_role($treeId, (int) $user['id']);
if ($role === null) {
    http_response_code(403);
    ?><!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Akses ditolak</title><link rel="stylesheet" href="<?= asset('assets/css/app.css') ?>"></head>
    <body class="auth-body"><main class="auth-card"><h1 style="font-size:20px">Akses ditolak</h1>
    <p style="color:var(--ink-2)">Anda bukan anggota pohon keluarga ini. Minta kode undangan kepada pemiliknya.</p>
    <a class="btn btn-block" href="dashboard.php">Kembali ke beranda</a></main></body></html><?php
    exit;
}

$st = db()->prepare('SELECT * FROM trees WHERE id = ?');
$st->execute([$treeId]);
$tree = $st->fetch();
$canEdit = in_array($role, ['owner', 'editor'], true);
$initial = mb_strtoupper(mb_substr($user['name'], 0, 1));
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($tree['name']) ?> — <?= e(APP_NAME) ?></title>
<link rel="stylesheet" href="<?= asset('assets/css/app.css') ?>">
</head>
<body>
<header class="topbar">
  <div style="display:flex;align-items:center;gap:12px;min-width:0">
    <a href="dashboard.php" class="btn btn-ghost btn-sm" title="Kembali">&larr;</a>
    <a href="dashboard.php" class="brand" style="text-decoration:none;color:inherit">
      <span class="brand-mark" aria-hidden="true"></span>
    </a>
    <div style="min-width:0">
      <h1 style="font-size:16px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><?= e($tree['name']) ?></h1>
      <div style="font-size:12px;color:var(--ink-3)" id="tree-stats"></div>
    </div>
  </div>
  <div class="topbar-right">
    <button class="btn btn-sm" id="btn-share">Bagikan</button>
    <a href="profile.php" class="user-chip" title="Akun saya"><span class="avatar"><?= e($initial) ?></span></a>
  </div>
</header>

<div class="tree-layout">
  <div class="tree-canvas-wrap" id="canvas-wrap">
    <div class="canvas-toolbar">
      <?php if ($canEdit): ?>
      <button class="btn btn-primary btn-sm" id="btn-add-person">+ Tambah anggota</button>
      <button class="btn btn-sm" id="btn-import-kk">Import Kartu Keluarga</button>
      <?php endif; ?>
      <button class="btn btn-sm" id="btn-search">Cari orang</button>
    </div>
    <svg id="tree-svg" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="canvas-zoom">
      <button class="btn" id="zoom-in" title="Perbesar">+</button>
      <button class="btn" id="zoom-out" title="Perkecil">&minus;</button>
      <button class="btn" id="zoom-fit" title="Muat semua" style="font-size:12px">Fit</button>
    </div>
    <div class="canvas-hint">Seret untuk geser · scroll / cubit untuk zoom · klik kartu untuk detail</div>
  </div>

  <aside class="side-panel" id="side-panel">
    <div class="side-tabs">
      <button data-tab="detail" class="active">Detail</button>
      <button data-tab="members">Kolaborator</button>
      <button data-tab="activity">Aktivitas</button>
    </div>
    <div class="side-panel-body" id="panel-body"></div>
  </aside>
</div>

<!-- modal: form person (tambah/edit) -->
<div class="modal-backdrop" id="modal-person">
  <div class="modal">
    <h3><span id="person-form-title">Tambah anggota</span> <button class="modal-close" data-close>&times;</button></h3>
    <div id="person-form-context" style="font-size:13px;color:var(--ink-2);margin-bottom:12px"></div>
    <div class="field-row">
      <label class="field" style="flex:2">
        <span>Nama lengkap *</span>
        <input type="text" id="pf-name" autocomplete="off">
      </label>
      <label class="field">
        <span>Panggilan</span>
        <input type="text" id="pf-nickname" autocomplete="off">
      </label>
    </div>
    <div class="field-row">
      <label class="field">
        <span>Jenis kelamin *</span>
        <select id="pf-gender">
          <option value="L">Laki-laki</option>
          <option value="P">Perempuan</option>
        </select>
      </label>
      <label class="field">
        <span>NIK <small>(opsional)</small></span>
        <input type="text" id="pf-nik" inputmode="numeric" autocomplete="off">
      </label>
    </div>
    <div class="field-row">
      <label class="field">
        <span>Tempat lahir</span>
        <input type="text" id="pf-birthplace" autocomplete="off">
      </label>
      <label class="field">
        <span>Tanggal lahir</span>
        <input type="date" id="pf-birthdate">
      </label>
    </div>
    <label class="checkbox-line"><input type="checkbox" id="pf-deceased"> Sudah meninggal</label>
    <label class="field" id="pf-deathdate-wrap" style="display:none">
      <span>Tanggal wafat</span>
      <input type="date" id="pf-deathdate">
    </label>
    <label class="field">
      <span>Catatan</span>
      <textarea id="pf-notes" rows="2"></textarea>
    </label>
    <div class="modal-foot">
      <button class="btn" data-close>Batal</button>
      <button class="btn btn-primary" id="pf-submit">Simpan</button>
    </div>
  </div>
</div>

<!-- modal: pilih orang tua kedua saat menambah anak -->
<div class="modal-backdrop" id="modal-choose-parent">
  <div class="modal">
    <h3>Siapa orang tua satunya? <button class="modal-close" data-close>&times;</button></h3>
    <p style="font-size:13.5px;color:var(--ink-2)" id="choose-parent-desc"></p>
    <div class="field">
      <select id="choose-parent-select"></select>
    </div>
    <div class="modal-foot">
      <button class="btn" data-close>Batal</button>
      <button class="btn btn-primary" id="choose-parent-ok">Lanjut</button>
    </div>
  </div>
</div>

<!-- modal: nikahkan dengan orang yang sudah ada -->
<div class="modal-backdrop" id="modal-marry-existing">
  <div class="modal">
    <h3>Catat pernikahan <button class="modal-close" data-close>&times;</button></h3>
    <p style="font-size:13.5px;color:var(--ink-2)" id="marry-desc"></p>
    <input type="search" id="marry-search" placeholder="Cari nama…">
    <div class="person-pick-list" id="marry-list"></div>
  </div>
</div>

<!-- modal: edit pernikahan -->
<div class="modal-backdrop" id="modal-marriage">
  <div class="modal">
    <h3>Data pernikahan <button class="modal-close" data-close>&times;</button></h3>
    <p style="font-size:14px" id="marriage-couple"></p>
    <div class="field-row">
      <label class="field">
        <span>Status</span>
        <select id="mf-status">
          <option value="married">Menikah</option>
          <option value="divorced">Bercerai</option>
          <option value="widowed">Ditinggal wafat</option>
        </select>
      </label>
      <label class="field">
        <span>Pernikahan ke-</span>
        <input type="number" id="mf-order" min="1" value="1">
      </label>
    </div>
    <div class="field-row">
      <label class="field">
        <span>Tanggal menikah</span>
        <input type="date" id="mf-date">
      </label>
      <label class="field">
        <span>Tanggal cerai</span>
        <input type="date" id="mf-divorce">
      </label>
    </div>
    <div class="modal-foot" style="justify-content:space-between">
      <button class="btn btn-danger" id="mf-delete">Hapus pernikahan</button>
      <div style="display:flex;gap:10px">
        <button class="btn" data-close>Batal</button>
        <button class="btn btn-primary" id="mf-submit">Simpan</button>
      </div>
    </div>
  </div>
</div>

<!-- modal: cari orang -->
<div class="modal-backdrop" id="modal-search">
  <div class="modal">
    <h3>Cari orang <button class="modal-close" data-close>&times;</button></h3>
    <input type="search" id="search-input" placeholder="Ketik nama…">
    <div class="person-pick-list" id="search-list"></div>
  </div>
</div>

<!-- modal: bagikan -->
<div class="modal-backdrop" id="modal-share">
  <div class="modal">
    <h3>Bagikan pohon ini <button class="modal-close" data-close>&times;</button></h3>
    <p style="font-size:13.5px;color:var(--ink-2)">Siapa pun yang punya kode/tautan di bawah bisa bergabung setelah membuat akun. Pengedit bisa ikut menambah &amp; mengubah data; penampil hanya bisa melihat.</p>
    <div class="share-box">
      <div class="row">
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--ink-2)">Undang sebagai PENGEDIT</div>
          <div class="code" id="code-edit"><?= e($tree['share_code_edit']) ?></div>
        </div>
        <button class="btn btn-sm" data-copy="edit">Salin tautan</button>
      </div>
      <div class="desc">Cocok untuk anggota keluarga yang ikut mengisi data.</div>
    </div>
    <div class="share-box">
      <div class="row">
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--ink-2)">Undang sebagai PENAMPIL</div>
          <div class="code" id="code-view"><?= e($tree['share_code_view']) ?></div>
        </div>
        <button class="btn btn-sm" data-copy="view">Salin tautan</button>
      </div>
      <div class="desc">Hanya bisa melihat pohon, tidak bisa mengubah.</div>
    </div>
    <?php if ($role === 'owner'): ?>
    <button class="btn btn-sm" id="btn-regen-codes">Ganti kedua kode (kode lama hangus)</button>
    <?php endif; ?>
  </div>
</div>

<!-- modal: import KK -->
<div class="modal-backdrop" id="modal-import">
  <div class="modal modal-wide">
    <h3>Import dari Kartu Keluarga <button class="modal-close" data-close>&times;</button></h3>
    <div id="import-step-upload">
      <p style="font-size:13.5px;color:var(--ink-2)">Unggah foto/scan Kartu Keluarga (JPG/PNG) atau file PDF. Data akan dibaca otomatis, lalu Anda periksa dan perbaiki sebelum dimasukkan ke pohon.</p>
      <div class="drop-zone" id="kk-drop">
        <strong>Klik untuk memilih file</strong> atau seret file ke sini<br>
        <span style="font-size:13px">JPG, PNG, atau PDF — maks 15 MB</span>
      </div>
      <input type="file" id="kk-file" accept=".jpg,.jpeg,.png,.webp,.pdf" style="display:none">
      <div class="ocr-progress" id="ocr-progress" style="display:none">
        <span id="ocr-status">Menyiapkan…</span>
        <div class="ocr-bar"><div id="ocr-bar-fill"></div></div>
      </div>
    </div>
    <div id="import-step-review" style="display:none">
      <p style="font-size:13.5px;color:var(--ink-2)">
        Periksa hasil pembacaan di bawah. Perbaiki yang keliru, atur kolom <strong>Hubungan</strong>
        (kepala keluarga / istri / suami / anak), lalu klik <strong>Import ke pohon</strong>.
        Untuk keluarga poligami: tandai semua istri dengan "Istri" — pernikahan ke-1, ke-2, dst. dicatat otomatis.
        Kolom <strong>Nama ayah/ibu</strong> ikut dimasukkan ke pohon: jika nama tersebut sudah ada
        (di pohon atau di daftar ini), orangnya langsung direlasikan — tidak dibuat ganda.
      </p>
      <div class="review-table-wrap">
        <table class="review-table">
          <thead>
            <tr>
              <th>Nama lengkap</th><th>NIK</th><th>JK</th><th>Tempat lahir</th>
              <th>Tgl lahir</th><th>Hubungan</th><th>Nama ayah</th><th>Nama ibu</th><th></th>
            </tr>
          </thead>
          <tbody id="review-rows"></tbody>
        </table>
      </div>
      <div style="margin-top:10px">
        <button class="btn btn-sm" id="review-add-row">+ Tambah baris</button>
      </div>
      <div class="modal-foot">
        <button class="btn" id="review-back">Ulangi unggah</button>
        <button class="btn btn-primary" id="review-import">Import ke pohon</button>
      </div>
    </div>
  </div>
</div>

<script>
window.CSRF    = <?= json_encode(csrf_token()) ?>;
window.TREE_ID = <?= (int) $treeId ?>;
window.CAN_EDIT = <?= $canEdit ? 'true' : 'false' ?>;
window.MY_ROLE  = <?= json_encode($role) ?>;
window.MY_USER_ID = <?= (int) $user['id'] ?>;
window.SHARE_EDIT = <?= json_encode($tree['share_code_edit']) ?>;
window.SHARE_VIEW = <?= json_encode($tree['share_code_view']) ?>;
</script>
<script src="<?= asset('assets/js/api.js') ?>"></script>
<script src="<?= asset('assets/js/tree-renderer.js') ?>"></script>
<script src="<?= asset('assets/js/tree-page.js') ?>"></script>
<script src="<?= asset('assets/js/import-kk.js') ?>"></script>
</body>
</html>
