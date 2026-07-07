<?php
/**
 * Tampilan tamu: view.php?t=TOKEN — lihat pohon tanpa login, read-only,
 * selama tautan belum kedaluwarsa.
 */
require __DIR__ . '/config.php';

$token = trim($_GET['t'] ?? '');
$tree  = null;
$link  = null;

if ($token !== '' && preg_match('/^[a-f0-9]{32}$/', $token)) {
    $st = db()->prepare(
        'SELECT sl.expires_at, t.id, t.name, t.description
         FROM share_links sl JOIN trees t ON t.id = sl.tree_id
         WHERE sl.token = ? AND sl.expires_at >= NOW()'
    );
    $st->execute([$token]);
    $link = $st->fetch();
}

if (!$link) {
    http_response_code(410);
    ?><!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tautan tidak berlaku — <?= e(APP_NAME) ?></title><link rel="stylesheet" href="<?= asset('assets/css/app.css') ?>"></head>
    <body class="auth-body"><main class="auth-card">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><h1><?= e(APP_NAME) ?></h1></div>
      <div class="alert alert-error" style="margin-top:16px">Tautan tamu tidak ditemukan atau sudah kedaluwarsa. Minta tautan baru kepada pemilik pohon.</div>
      <a class="btn btn-block" href="login.php">Masuk / daftar akun</a>
    </main></body></html><?php
    exit;
}

$treeId = (int) $link['id'];
$st = db()->prepare(
    'SELECT id, full_name, nickname, gender, nik, birth_place, birth_date, birth_order,
            death_date, is_deceased, photo, father_id, mother_id
     FROM persons WHERE tree_id = ?'
);
$st->execute([$treeId]);
$persons = $st->fetchAll();
// tamu tidak perlu melihat NIK lengkap
foreach ($persons as &$p) {
    unset($p['nik']);
}
unset($p);

$st = db()->prepare(
    'SELECT id, husband_id, wife_id, marriage_date, divorce_date, status, marriage_order
     FROM marriages WHERE tree_id = ?'
);
$st->execute([$treeId]);
$marriages = $st->fetchAll();

$expiresLabel = date('d-m-Y H:i', strtotime($link['expires_at']));
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?= e($link['name']) ?> — <?= e(APP_NAME) ?></title>
<link rel="stylesheet" href="<?= asset('assets/css/app.css') ?>">
</head>
<body>
<header class="topbar">
  <div style="display:flex;align-items:center;gap:12px;min-width:0">
    <span class="brand"><span class="brand-mark" aria-hidden="true"></span></span>
    <div style="min-width:0">
      <h1 style="font-size:16px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><?= e($link['name']) ?></h1>
      <div style="font-size:12px;color:var(--ink-3)">Tampilan tamu · berlaku s.d. <?= e($expiresLabel) ?></div>
    </div>
  </div>
  <div class="topbar-right">
    <span class="badge badge-viewer">Hanya lihat</span>
  </div>
</header>

<div class="tree-layout">
  <div class="tree-canvas-wrap" id="canvas-wrap">
    <svg id="tree-svg" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="canvas-zoom">
      <button class="btn" id="zoom-in" title="Perbesar">+</button>
      <button class="btn" id="zoom-out" title="Perkecil">&minus;</button>
      <button class="btn" id="zoom-fit" title="Muat semua" style="font-size:12px">Fit</button>
    </div>
    <div class="canvas-hint">Seret untuk geser · scroll / cubit untuk zoom · klik kartu untuk detail</div>
  </div>
  <aside class="side-panel">
    <div class="side-panel-head"><h3>Detail</h3></div>
    <div class="side-panel-body" id="panel-body">
      <p style="color:var(--ink-2);font-size:14px">Klik salah satu kartu untuk melihat detailnya.</p>
    </div>
  </aside>
</div>

<script>
window.GUEST_DATA = {
  persons: <?= json_encode($persons, JSON_UNESCAPED_UNICODE) ?>,
  marriages: <?= json_encode($marriages, JSON_UNESCAPED_UNICODE) ?>
};
</script>
<script src="<?= asset('assets/js/tree-renderer.js') ?>"></script>
<script>
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmtDate = d => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    const bln = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return Number(day) + ' ' + (bln[Number(m)] || '') + ' ' + y;
  };

  const byId = new Map(window.GUEST_DATA.persons.map(p => [Number(p.id), p]));
  const panel = document.getElementById('panel-body');

  const renderer = new TreeRenderer(document.getElementById('tree-svg'), {
    canEdit: false,
    treeId: 'guest',
    onSelect(id) {
      renderer.select(id);
      const p = byId.get(Number(id));
      if (!p) return;
      const f = p.father_id ? byId.get(Number(p.father_id)) : null;
      const m = p.mother_id ? byId.get(Number(p.mother_id)) : null;
      panel.innerHTML = `
        <div class="person-summary">
          ${p.photo ? `<img class="person-photo" src="uploads/${esc(p.photo)}" alt="">`
                    : `<span class="person-photo">${esc((p.full_name || '?').charAt(0).toUpperCase())}</span>`}
          <h4>${esc(p.full_name)}${Number(p.is_deceased) ? ' †' : ''}</h4>
          <div class="sub">
            ${p.gender === 'L' ? 'Laki-laki' : 'Perempuan'}${p.birth_order ? ' · anak ke-' + Number(p.birth_order) : ''}<br>
            ${p.birth_place || p.birth_date ? 'Lahir: ' + esc(p.birth_place || '') + (p.birth_date ? (p.birth_place ? ', ' : '') + fmtDate(p.birth_date) : '') + '<br>' : ''}
            ${p.death_date ? 'Wafat: ' + fmtDate(p.death_date) : ''}
          </div>
        </div>
        <div class="section-label">Orang tua</div>
        <ul class="rel-list">
          ${f ? `<li><span class="who">${esc(f.full_name)}</span><span class="tag">Ayah</span></li>` : ''}
          ${m ? `<li><span class="who">${esc(m.full_name)}</span><span class="tag">Ibu</span></li>` : ''}
          ${!f && !m ? '<li style="color:var(--ink-3)">Belum dicatat</li>' : ''}
        </ul>`;
    },
    onDeselect() {
      renderer.select(null);
      panel.innerHTML = '<p style="color:var(--ink-2);font-size:14px">Klik salah satu kartu untuk melihat detailnya.</p>';
    },
  });
  renderer.setData(window.GUEST_DATA.persons, window.GUEST_DATA.marriages);
  renderer.render();
  renderer.fit();

  document.getElementById('zoom-in').addEventListener('click', () => renderer.zoomBy(1.2));
  document.getElementById('zoom-out').addEventListener('click', () => renderer.zoomBy(0.83));
  document.getElementById('zoom-fit').addEventListener('click', () => renderer.fit());
})();
</script>
</body>
</html>
