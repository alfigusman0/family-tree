<?php
require __DIR__ . '/config.php';
$user = require_login();

$st = db()->prepare(
    'SELECT t.id, t.name, t.description, t.created_at, tm.role,
            (SELECT COUNT(*) FROM persons p WHERE p.tree_id = t.id)      AS person_count,
            (SELECT COUNT(*) FROM tree_members m2 WHERE m2.tree_id = t.id) AS member_count
     FROM trees t
     JOIN tree_members tm ON tm.tree_id = t.id AND tm.user_id = ?
     ORDER BY t.created_at DESC'
);
$st->execute([$user['id']]);
$trees = $st->fetchAll();

$roleLabel = ['owner' => 'Pemilik', 'editor' => 'Editor', 'viewer' => 'Penampil'];
$initial = mb_strtoupper(mb_substr($user['name'], 0, 1));
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pohon Keluarga Saya — <?= e(APP_NAME) ?></title>
<link rel="stylesheet" href="assets/css/app.css">
</head>
<body>
<header class="topbar">
  <a href="dashboard.php" class="brand" style="text-decoration:none;color:inherit">
    <span class="brand-mark" aria-hidden="true"></span>
    <h1><?= e(APP_NAME) ?></h1>
  </a>
  <div class="topbar-right">
    <a href="profile.php" class="user-chip" style="text-decoration:none" title="Akun saya"><span class="avatar"><?= e($initial) ?></span> <span class="user-name"><?= e($user['name']) ?></span></a>
    <a href="logout.php" class="btn btn-ghost btn-sm">Keluar</a>
  </div>
</header>

<main class="page">
  <div class="page-head">
    <div>
      <h2>Pohon Keluarga Saya</h2>
      <p class="sub">Buat pohon baru, atau gabung ke pohon keluarga yang dibagikan kepada Anda.</p>
    </div>
    <div class="page-actions">
      <button class="btn" id="btn-join">Gabung dengan kode</button>
      <button class="btn btn-primary" id="btn-create">+ Buat pohon baru</button>
    </div>
  </div>

  <div id="flash"></div>

  <?php if (!$trees): ?>
    <div class="empty-state">
      <h3>Belum ada pohon keluarga</h3>
      <p>Mulai dengan membuat pohon keluarga pertama Anda, lalu undang anggota keluarga lain untuk mengisinya bersama.</p>
      <button class="btn btn-primary" onclick="document.getElementById('btn-create').click()">+ Buat pohon baru</button>
    </div>
  <?php else: ?>
    <div class="tree-grid">
      <?php foreach ($trees as $t): ?>
        <div class="tree-card">
          <h3><a href="tree.php?id=<?= (int) $t['id'] ?>"><?= e($t['name']) ?></a></h3>
          <div class="desc"><?= e($t['description'] ?: 'Tanpa deskripsi.') ?></div>
          <div class="meta">
            <span><?= (int) $t['person_count'] ?> anggota · <?= (int) $t['member_count'] ?> kolaborator</span>
            <span class="badge badge-<?= e($t['role']) ?>"><?= e($roleLabel[$t['role']] ?? $t['role']) ?></span>
          </div>
        </div>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>
</main>

<!-- modal: buat pohon -->
<div class="modal-backdrop" id="modal-create">
  <div class="modal">
    <h3>Buat pohon keluarga <button class="modal-close" data-close>&times;</button></h3>
    <label class="field">
      <span>Nama pohon</span>
      <input type="text" id="create-name" placeholder="cth. Keluarga Besar Gusman">
    </label>
    <label class="field">
      <span>Deskripsi <small>(opsional)</small></span>
      <textarea id="create-desc" placeholder="Catatan singkat tentang pohon ini"></textarea>
    </label>
    <div class="modal-foot">
      <button class="btn" data-close>Batal</button>
      <button class="btn btn-primary" id="create-submit">Buat</button>
    </div>
  </div>
</div>

<!-- modal: gabung -->
<div class="modal-backdrop" id="modal-join">
  <div class="modal">
    <h3>Gabung ke pohon keluarga <button class="modal-close" data-close>&times;</button></h3>
    <p style="color:var(--ink-2);font-size:14px">Masukkan kode undangan yang Anda terima dari pemilik pohon.</p>
    <label class="field">
      <span>Kode undangan</span>
      <input type="text" id="join-code" placeholder="cth. K7MPQ2XW4N" style="text-transform:uppercase;letter-spacing:.1em">
    </label>
    <div class="modal-foot">
      <button class="btn" data-close>Batal</button>
      <button class="btn btn-primary" id="join-submit">Gabung</button>
    </div>
  </div>
</div>

<script>
window.CSRF = <?= json_encode(csrf_token()) ?>;
</script>
<script src="assets/js/api.js"></script>
<script>
(function () {
  const openModal  = id => document.getElementById(id).classList.add('open');
  const closeModal = el => el.closest('.modal-backdrop').classList.remove('open');
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b)));
  document.querySelectorAll('.modal-backdrop').forEach(m =>
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));

  document.getElementById('btn-create').addEventListener('click', () => { openModal('modal-create'); document.getElementById('create-name').focus(); });
  document.getElementById('btn-join').addEventListener('click', () => { openModal('modal-join'); document.getElementById('join-code').focus(); });

  document.getElementById('create-submit').addEventListener('click', async () => {
    const name = document.getElementById('create-name').value.trim();
    if (!name) { alert('Nama pohon wajib diisi.'); return; }
    try {
      const r = await api.post('api/trees.php', { action: 'create', name, description: document.getElementById('create-desc').value });
      location.href = 'tree.php?id=' + r.tree_id;
    } catch (err) { alert(err.message); }
  });

  document.getElementById('join-submit').addEventListener('click', async () => {
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    if (!code) { alert('Kode undangan wajib diisi.'); return; }
    try {
      const r = await api.post('api/trees.php', { action: 'join', code });
      location.href = 'tree.php?id=' + r.tree_id;
    } catch (err) { alert(err.message); }
  });

  ['create-name', 'join-code'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') (id === 'create-name' ? document.getElementById('create-submit') : document.getElementById('join-submit')).click();
    });
  });
})();
</script>
</body>
</html>
