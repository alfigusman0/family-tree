/* Logika halaman pohon keluarga. */
(function () {
  'use strict';

  const state = {
    persons: [],
    marriages: [],
    byId: new Map(),
    selectedId: null,
    tab: 'detail',
  };

  const svg = document.getElementById('tree-svg');
  const renderer = new TreeRenderer(svg, {
    canEdit: window.CAN_EDIT,
    treeId: window.TREE_ID,
    onSelect(id) { selectPerson(id); },
    onDeselect() { selectPerson(null); hidePlusMenu(); },
    onPlus(id, cx, cy) { selectPerson(id); showPlusMenu(id, cx, cy); },
  });

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const fmtDate = d => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    const bulan = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${Number(day)} ${bulan[Number(m)] || ''} ${y}`;
  };

  /* ---------- data ---------- */

  async function loadData(keepView) {
    const r = await api.get('api/tree_data.php?tree_id=' + window.TREE_ID);
    state.persons = r.persons;
    state.marriages = r.marriages;
    state.byId = new Map(state.persons.map(p => [Number(p.id), p]));
    renderer.setData(state.persons, state.marriages);
    renderer.selectedId = state.selectedId;
    renderer.render();
    if (!keepView) renderer.fit();
    document.getElementById('tree-stats').textContent =
      state.persons.length + ' anggota keluarga';
    renderPanel();
  }

  function selectPerson(id) {
    state.selectedId = id;
    renderer.select(id);
    state.tab = 'detail';
    setActiveTab('detail');
    renderPanel();
  }

  /* ---------- panel samping ---------- */

  const panelBody = document.getElementById('panel-body');

  function setActiveTab(tab) {
    document.querySelectorAll('.side-tabs button').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab));
  }

  document.querySelectorAll('.side-tabs button').forEach(b => {
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      setActiveTab(state.tab);
      renderPanel();
    });
  });

  function renderPanel() {
    if (state.tab === 'detail') renderDetailTab();
    else if (state.tab === 'members') renderMembersTab();
    else renderActivityTab();
  }

  function renderDetailTab() {
    const p = state.selectedId ? state.byId.get(Number(state.selectedId)) : null;
    if (!p) {
      panelBody.innerHTML = `
        <div style="text-align:center;padding:26px 6px;color:var(--ink-2)">
          ${state.persons.length === 0
            ? `<h4 style="margin:0 0 6px;color:var(--ink)">Pohon masih kosong</h4>
               <p style="font-size:14px">Mulai dengan menambahkan satu orang — biasanya orang tertua yang Anda ketahui — lalu kembangkan dari sana. Atau import langsung dari Kartu Keluarga.</p>
               ${window.CAN_EDIT ? '<button class="btn btn-primary" id="empty-add">+ Tambah anggota pertama</button>' : ''}`
            : `<p style="font-size:14px">Klik salah satu kartu pada pohon untuk melihat detail &amp; menambah keluarga dari orang tersebut.</p>`}
        </div>`;
      const b = document.getElementById('empty-add');
      if (b) b.addEventListener('click', () => openPersonForm({ mode: 'add' }));
      return;
    }

    const father = p.father_id ? state.byId.get(Number(p.father_id)) : null;
    const mother = p.mother_id ? state.byId.get(Number(p.mother_id)) : null;
    const myMarriages = state.marriages
      .filter(m => Number(m.husband_id) === Number(p.id) || Number(m.wife_id) === Number(p.id))
      .sort((a, b) => a.marriage_order - b.marriage_order);
    const children = state.persons.filter(c =>
      Number(c.father_id) === Number(p.id) || Number(c.mother_id) === Number(p.id));

    const statusLabel = { married: 'menikah', divorced: 'bercerai', widowed: 'ditinggal wafat' };
    const genderLabel = p.gender === 'L' ? 'Laki-laki' : 'Perempuan';
    const initial = esc((p.full_name || '?').charAt(0).toUpperCase());

    let html = `
      <div class="person-summary">
        ${p.photo
          ? `<img class="person-photo" src="uploads/${esc(p.photo)}" alt="">`
          : `<span class="person-photo">${initial}</span>`}
        ${window.CAN_EDIT ? `<div><button class="btn btn-ghost btn-sm" id="btn-photo">${p.photo ? 'Ganti foto' : 'Unggah foto'}</button>
          <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" style="display:none"></div>` : ''}
        <h4>${esc(p.full_name)}${Number(p.is_deceased) ? ' <span title="almarhum/almarhumah">†</span>' : ''}</h4>
        <div class="sub">
          ${genderLabel}${p.birth_order ? ' · anak ke-' + Number(p.birth_order) : ''}${p.nickname ? ' · dipanggil ' + esc(p.nickname) : ''}<br>
          ${p.birth_place || p.birth_date ? 'Lahir: ' + esc(p.birth_place || '') + (p.birth_date ? (p.birth_place ? ', ' : '') + fmtDate(p.birth_date) : '') + '<br>' : ''}
          ${p.death_date ? 'Wafat: ' + fmtDate(p.death_date) + '<br>' : ''}
          ${p.nik ? 'NIK: ' + esc(p.nik) : ''}
        </div>
        ${p.notes ? `<div class="sub" style="margin-top:6px;font-style:italic">${esc(p.notes)}</div>` : ''}
      </div>`;

    // orang tua
    html += `<div class="section-label">Orang tua</div><ul class="rel-list">`;
    if (father) html += relItem(father, 'Ayah');
    if (mother) html += relItem(mother, 'Ibu');
    if (!father && !mother) html += `<li style="color:var(--ink-3)">Belum dicatat</li>`;
    html += `</ul>`;

    // pasangan
    html += `<div class="section-label">Pasangan${myMarriages.length > 1 ? ' (' + myMarriages.length + ' pernikahan)' : ''}</div><ul class="rel-list">`;
    if (myMarriages.length === 0) html += `<li style="color:var(--ink-3)">Belum dicatat</li>`;
    for (const m of myMarriages) {
      const spouseId = Number(m.husband_id) === Number(p.id) ? Number(m.wife_id) : Number(m.husband_id);
      const s = state.byId.get(spouseId);
      if (!s) continue;
      html += `<li>
        <span class="who" data-goto="${s.id}">${esc(s.full_name)}</span>
        <span class="tag">ke-${m.marriage_order} · ${statusLabel[m.status] || m.status}</span>
        ${window.CAN_EDIT ? `<button class="btn btn-ghost btn-sm" data-marriage="${m.id}" title="Atur pernikahan">&#9998;</button>` : ''}
      </li>`;
    }
    html += `</ul>`;

    // anak (dikelompokkan per pasangan — penting untuk poligami)
    html += `<div class="section-label">Anak (${children.length})</div>`;
    if (children.length === 0) {
      html += `<ul class="rel-list"><li style="color:var(--ink-3)">Belum dicatat</li></ul>`;
    } else {
      const groups = new Map();
      for (const c of children) {
        const otherId = p.gender === 'L' ? (c.mother_id || 0) : (c.father_id || 0);
        if (!groups.has(Number(otherId))) groups.set(Number(otherId), []);
        groups.get(Number(otherId)).push(c);
      }
      const sortKids = arr => arr.slice().sort((a, b) => {
        const oa = Number(a.birth_order) || 999;
        const ob = Number(b.birth_order) || 999;
        if (oa !== ob) return oa - ob;
        const da = a.birth_date || '9999-99-99';
        const db = b.birth_date || '9999-99-99';
        return da < db ? -1 : da > db ? 1 : Number(a.id) - Number(b.id);
      });
      for (const [otherId, kids] of groups) {
        const other = otherId ? state.byId.get(otherId) : null;
        if (groups.size > 1 || other) {
          html += `<div style="font-size:12.5px;color:var(--ink-3);margin:4px 0 4px 2px">dengan ${other ? esc(other.full_name) : 'pasangan tidak tercatat'}:</div>`;
        }
        html += `<ul class="rel-list">`;
        for (const c of sortKids(kids)) {
          html += relItem(c, (c.birth_order ? 'ke-' + Number(c.birth_order) + ' · ' : '') + (c.gender === 'L' ? 'L' : 'P'));
        }
        html += `</ul>`;
      }
    }

    // aksi cepat
    if (window.CAN_EDIT) {
      html += `
        <div class="quick-actions">
          <button class="btn btn-sm" id="qa-spouse">+ Pasangan</button>
          <button class="btn btn-sm" id="qa-child">+ Anak</button>
          ${!father ? '<button class="btn btn-sm" id="qa-father">+ Ayah</button>' : ''}
          ${!mother ? '<button class="btn btn-sm" id="qa-mother">+ Ibu</button>' : ''}
          <button class="btn btn-sm" id="qa-edit">Edit data</button>
          <button class="btn btn-danger btn-sm" id="qa-delete">Hapus</button>
        </div>
        <div style="margin-top:8px">
          <button class="btn btn-ghost btn-sm" id="qa-marry-existing">Nikahkan dengan orang yang sudah ada di pohon…</button>
        </div>`;
    }

    panelBody.innerHTML = html;

    // ikatan event
    panelBody.querySelectorAll('[data-goto]').forEach(elm =>
      elm.addEventListener('click', () => {
        selectPerson(Number(elm.dataset.goto));
        renderer.focusPerson(Number(elm.dataset.goto));
      }));
    panelBody.querySelectorAll('[data-marriage]').forEach(elm =>
      elm.addEventListener('click', () => openMarriageModal(Number(elm.dataset.marriage))));

    if (!window.CAN_EDIT) return;

    const btnPhoto = document.getElementById('btn-photo');
    if (btnPhoto) {
      const input = document.getElementById('photo-input');
      btnPhoto.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        const fd = new FormData();
        fd.append('photo', input.files[0]);
        fd.append('person_id', p.id);
        try {
          await api.upload('api/upload.php', fd);
          await loadData(true);
        } catch (err) { alert(err.message); }
      });
    }

    const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
    on('qa-spouse', () => addSpouse(p));
    on('qa-child', () => startAddChild(p));
    on('qa-father', () => addParent(p, 'L'));
    on('qa-mother', () => addParent(p, 'P'));
    on('qa-edit', () => openPersonForm({ mode: 'edit', person: p }));
    on('qa-delete', async () => {
      if (!confirm(`Hapus ${p.full_name} dari pohon?\nRelasi pernikahan ikut terhapus; anak-anaknya tetap ada namun relasi orang tuanya dilepas.`)) return;
      try {
        await api.del('api/persons.php?id=' + p.id);
        state.selectedId = null;
        await loadData(true);
      } catch (err) { alert(err.message); }
    });
    on('qa-marry-existing', () => openMarryExisting(p));
  }

  function relItem(person, tag) {
    return `<li>
      <span class="who" data-goto="${person.id}">${esc(person.full_name)}</span>
      <span class="tag">${esc(tag)}</span>
    </li>`;
  }

  /* ---------- tab kolaborator ---------- */

  async function renderMembersTab() {
    panelBody.innerHTML = '<p style="color:var(--ink-3)">Memuat…</p>';
    let members;
    try {
      const r = await api.get('api/trees.php?action=members&tree_id=' + window.TREE_ID);
      members = r.members;
    } catch (err) {
      panelBody.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      return;
    }
    const roleLabel = { owner: 'Pemilik', editor: 'Editor', viewer: 'Penampil' };
    const isOwner = window.MY_ROLE === 'owner';

    let html = `
      <button class="btn btn-primary btn-block" id="mem-share">Bagikan tautan undangan</button>
      <div class="section-label">Anggota kolaborasi (${members.length})</div>`;
    for (const m of members) {
      const isSelf = Number(m.user_id) === Number(window.MY_USER_ID);
      html += `<div class="member-row">
        <div class="grow">
          <div>${esc(m.name)}${isSelf ? ' <span style="color:var(--ink-3)">(Anda)</span>' : ''}</div>
          <div class="email">${esc(m.email)}</div>
        </div>
        ${isOwner && m.role !== 'owner'
          ? `<select data-role-user="${m.user_id}" class="btn-sm" style="width:auto;padding:4px 6px">
               <option value="editor"${m.role === 'editor' ? ' selected' : ''}>Editor</option>
               <option value="viewer"${m.role === 'viewer' ? ' selected' : ''}>Penampil</option>
             </select>
             <button class="btn btn-ghost btn-sm" data-remove-user="${m.user_id}" title="Keluarkan">&times;</button>`
          : `<span class="badge badge-${esc(m.role)}">${roleLabel[m.role] || m.role}</span>`}
      </div>`;
    }
    if (!isOwner) {
      html += `<div style="margin-top:14px"><button class="btn btn-danger btn-sm" id="mem-leave">Keluar dari pohon ini</button></div>`;
    } else {
      html += `<div class="section-label">Zona berbahaya</div>
        <button class="btn btn-danger btn-sm" id="tree-delete">Hapus pohon ini beserta seluruh datanya</button>`;
    }
    panelBody.innerHTML = html;

    document.getElementById('mem-share').addEventListener('click', () =>
      document.getElementById('modal-share').classList.add('open'));

    panelBody.querySelectorAll('[data-role-user]').forEach(sel =>
      sel.addEventListener('change', async () => {
        try {
          await api.post('api/trees.php', { action: 'set_role', tree_id: window.TREE_ID, user_id: Number(sel.dataset.roleUser), role: sel.value });
        } catch (err) { alert(err.message); renderMembersTab(); }
      }));
    panelBody.querySelectorAll('[data-remove-user]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirm('Keluarkan anggota ini dari pohon?')) return;
        try {
          await api.post('api/trees.php', { action: 'remove_member', tree_id: window.TREE_ID, user_id: Number(btn.dataset.removeUser) });
          renderMembersTab();
        } catch (err) { alert(err.message); }
      }));
    const leave = document.getElementById('mem-leave');
    if (leave) leave.addEventListener('click', async () => {
      if (!confirm('Keluar dari pohon ini? Anda perlu kode undangan untuk bergabung kembali.')) return;
      try {
        await api.post('api/trees.php', { action: 'leave', tree_id: window.TREE_ID });
        location.href = 'dashboard.php';
      } catch (err) { alert(err.message); }
    });
    const del = document.getElementById('tree-delete');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('HAPUS pohon ini beserta SEMUA anggota, foto, dan riwayatnya? Tindakan ini tidak bisa dibatalkan.')) return;
      if (!confirm('Yakin? Sekali lagi: seluruh data pohon akan hilang permanen.')) return;
      try {
        await api.post('api/trees.php', { action: 'delete', tree_id: window.TREE_ID });
        location.href = 'dashboard.php';
      } catch (err) { alert(err.message); }
    });
  }

  /* ---------- tab aktivitas ---------- */

  async function renderActivityTab() {
    panelBody.innerHTML = '<p style="color:var(--ink-3)">Memuat…</p>';
    try {
      const r = await api.get('api/trees.php?action=activity&tree_id=' + window.TREE_ID);
      if (!r.activities.length) {
        panelBody.innerHTML = '<p style="color:var(--ink-3)">Belum ada aktivitas.</p>';
        return;
      }
      panelBody.innerHTML = r.activities.map(a => `
        <div class="activity-item">
          <span class="who">${esc(a.user_name || 'Seseorang')}</span> — ${esc(a.detail || a.action)}
          <div class="when">${esc(a.created_at)}</div>
        </div>`).join('');
    } catch (err) {
      panelBody.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  }

  /* ---------- modal util ---------- */

  document.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => b.closest('.modal-backdrop').classList.remove('open')));
  document.querySelectorAll('.modal-backdrop').forEach(m =>
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));

  const openModal  = id => document.getElementById(id).classList.add('open');
  const closeModal = id => document.getElementById(id).classList.remove('open');

  /* ---------- form person ---------- */

  let personFormCtx = null;

  function openPersonForm(ctx) {
    personFormCtx = ctx;
    const isEdit = ctx.mode === 'edit';
    const p = ctx.person || {};
    document.getElementById('person-form-title').textContent = isEdit ? 'Edit data anggota' : 'Tambah anggota';
    document.getElementById('person-form-context').innerHTML = ctx.context || '';
    document.getElementById('pf-name').value = p.full_name || '';
    document.getElementById('pf-nickname').value = p.nickname || '';
    document.getElementById('pf-nik').value = p.nik || '';
    document.getElementById('pf-birthplace').value = p.birth_place || '';
    document.getElementById('pf-birthdate').value = p.birth_date || '';
    document.getElementById('pf-birthorder').value = p.birth_order || '';
    document.getElementById('pf-deathdate').value = p.death_date || '';
    document.getElementById('pf-notes').value = p.notes || '';
    const deceased = document.getElementById('pf-deceased');
    deceased.checked = !!Number(p.is_deceased);
    document.getElementById('pf-deathdate-wrap').style.display = deceased.checked ? '' : 'none';

    const genderSel = document.getElementById('pf-gender');
    genderSel.value = ctx.lockGender || p.gender || 'L';
    genderSel.disabled = !!ctx.lockGender;

    openModal('modal-person');
    document.getElementById('pf-name').focus();
  }

  document.getElementById('pf-deceased').addEventListener('change', function () {
    document.getElementById('pf-deathdate-wrap').style.display = this.checked ? '' : 'none';
  });

  document.getElementById('pf-submit').addEventListener('click', async () => {
    const ctx = personFormCtx || { mode: 'add' };
    const body = {
      full_name:  document.getElementById('pf-name').value.trim(),
      nickname:   document.getElementById('pf-nickname').value.trim(),
      gender:     document.getElementById('pf-gender').value,
      nik:        document.getElementById('pf-nik').value.trim(),
      birth_place: document.getElementById('pf-birthplace').value.trim(),
      birth_date: document.getElementById('pf-birthdate').value,
      birth_order: Number(document.getElementById('pf-birthorder').value) || null,
      death_date: document.getElementById('pf-deceased').checked ? document.getElementById('pf-deathdate').value : '',
      is_deceased: document.getElementById('pf-deceased').checked ? 1 : 0,
      notes:      document.getElementById('pf-notes').value.trim(),
    };
    if (!body.full_name) { alert('Nama lengkap wajib diisi.'); return; }

    try {
      if (ctx.mode === 'edit') {
        await api.put('api/persons.php?id=' + ctx.person.id, body);
      } else {
        body.tree_id = window.TREE_ID;
        if (ctx.relation) body.relation = ctx.relation;
        const r = await api.post('api/persons.php', body);
        state.selectedId = r.person_id;
      }
      closeModal('modal-person');
      await loadData(true);
      renderer.select(state.selectedId);
    } catch (err) { alert(err.message); }
  });

  /* ---------- aksi tambah keluarga (dipakai panel & menu + di kanvas) ---------- */

  function addSpouse(p) {
    openPersonForm({
      mode: 'add',
      relation: { type: 'spouse', person_id: Number(p.id) },
      lockGender: p.gender === 'L' ? 'P' : 'L',
      context: `Menambahkan pasangan untuk <strong>${esc(p.full_name)}</strong>. Jika sudah punya pasangan sebelumnya, ini otomatis tercatat sebagai pernikahan berikutnya (poligami/menikah lagi didukung).`,
    });
  }

  function addParent(p, gender) {
    openPersonForm({
      mode: 'add',
      relation: { type: 'parent', child_id: Number(p.id), marry_other_parent: true },
      lockGender: gender,
      context: `Menambahkan <strong>${gender === 'L' ? 'ayah' : 'ibu'}</strong> dari ${esc(p.full_name)}.`,
    });
  }

  /* ---------- menu + pada kartu di kanvas ---------- */

  const canvasWrap = document.getElementById('canvas-wrap');
  const plusMenu = document.createElement('div');
  plusMenu.className = 'plus-menu';
  canvasWrap.appendChild(plusMenu);

  function hidePlusMenu() { plusMenu.classList.remove('open'); }

  function showPlusMenu(personId, clientX, clientY) {
    const p = state.byId.get(Number(personId));
    if (!p || !window.CAN_EDIT) return;

    const actions = [
      { label: '+ Pasangan', run: () => addSpouse(p) },
      { label: '+ Anak', run: () => startAddChild(p) },
    ];
    if (!p.father_id) actions.push({ label: '+ Ayah', run: () => addParent(p, 'L') });
    if (!p.mother_id) actions.push({ label: '+ Ibu', run: () => addParent(p, 'P') });
    actions.push({ label: '✎ Edit data', run: () => openPersonForm({ mode: 'edit', person: p }) });

    plusMenu.innerHTML = `<div class="pm-title">${esc(p.full_name)}</div>`;
    actions.forEach(a => {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.addEventListener('click', () => { hidePlusMenu(); a.run(); });
      plusMenu.appendChild(b);
    });

    // posisikan dekat tombol +, tetap di dalam area kanvas
    const rect = canvasWrap.getBoundingClientRect();
    plusMenu.classList.add('open');
    let x = clientX - rect.left + 8;
    let y = clientY - rect.top + 8;
    x = Math.min(x, rect.width - plusMenu.offsetWidth - 10);
    y = Math.min(y, rect.height - plusMenu.offsetHeight - 10);
    plusMenu.style.left = Math.max(8, x) + 'px';
    plusMenu.style.top = Math.max(8, y) + 'px';
  }

  // tutup menu saat kanvas digeser / di-zoom / klik area kosong
  svg.addEventListener('pointerdown', hidePlusMenu);
  svg.addEventListener('wheel', hidePlusMenu, { passive: true });
  svg.addEventListener('touchstart', hidePlusMenu, { passive: true });

  /* ---------- tambah anak (pilih orang tua kedua) ---------- */

  function startAddChild(p) {
    const myMarriages = state.marriages
      .filter(m => Number(m.husband_id) === Number(p.id) || Number(m.wife_id) === Number(p.id))
      .sort((a, b) => a.marriage_order - b.marriage_order);

    const proceed = (otherParentId) => {
      const fatherId = p.gender === 'L' ? Number(p.id) : (otherParentId || null);
      const motherId = p.gender === 'P' ? Number(p.id) : (otherParentId || null);
      const other = otherParentId ? state.byId.get(Number(otherParentId)) : null;
      openPersonForm({
        mode: 'add',
        relation: { type: 'child', father_id: fatherId, mother_id: motherId },
        context: `Menambahkan <strong>anak</strong> dari ${esc(p.full_name)}${other ? ' &amp; ' + esc(other.full_name) : ' (pasangan tidak dicatat)'}.`,
      });
    };

    if (myMarriages.length === 0) { proceed(null); return; }
    if (myMarriages.length === 1) {
      const m = myMarriages[0];
      proceed(Number(m.husband_id) === Number(p.id) ? Number(m.wife_id) : Number(m.husband_id));
      return;
    }
    // lebih dari satu pernikahan → biarkan pengguna memilih (kunci untuk poligami)
    const sel = document.getElementById('choose-parent-select');
    sel.innerHTML = '';
    for (const m of myMarriages) {
      const spouseId = Number(m.husband_id) === Number(p.id) ? Number(m.wife_id) : Number(m.husband_id);
      const s = state.byId.get(spouseId);
      if (!s) continue;
      const opt = document.createElement('option');
      opt.value = spouseId;
      opt.textContent = s.full_name + ' (pernikahan ke-' + m.marriage_order + ')';
      sel.appendChild(opt);
    }
    const optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = 'Tidak dicatat / bukan dari pasangan di atas';
    sel.appendChild(optNone);

    document.getElementById('choose-parent-desc').innerHTML =
      `<strong>${esc(p.full_name)}</strong> memiliki ${myMarriages.length} pernikahan. Pilih dari pernikahan yang mana anak ini lahir:`;
    openModal('modal-choose-parent');
    document.getElementById('choose-parent-ok').onclick = () => {
      closeModal('modal-choose-parent');
      proceed(sel.value ? Number(sel.value) : null);
    };
  }

  /* ---------- nikahkan dengan orang yang sudah ada ---------- */

  function openMarryExisting(p) {
    const already = new Set();
    state.marriages.forEach(m => {
      if (Number(m.husband_id) === Number(p.id)) already.add(Number(m.wife_id));
      if (Number(m.wife_id) === Number(p.id)) already.add(Number(m.husband_id));
    });
    const candidates = state.persons.filter(c =>
      c.gender !== p.gender && Number(c.id) !== Number(p.id) && !already.has(Number(c.id)));

    document.getElementById('marry-desc').innerHTML =
      `Pilih pasangan untuk <strong>${esc(p.full_name)}</strong>. Pernikahan baru otomatis tercatat sebagai pernikahan berikutnya.`;
    const listEl = document.getElementById('marry-list');
    const searchEl = document.getElementById('marry-search');
    searchEl.value = '';

    const renderList = () => {
      const q = searchEl.value.trim().toLowerCase();
      const filtered = candidates.filter(c => !q || c.full_name.toLowerCase().includes(q));
      listEl.innerHTML = filtered.length
        ? filtered.map(c => `<button data-marry-id="${c.id}">
            ${esc(c.full_name)} <span class="g">${c.gender === 'L' ? 'Laki-laki' : 'Perempuan'}${c.birth_date ? ' · ' + c.birth_date.slice(0, 4) : ''}</span>
          </button>`).join('')
        : '<p style="color:var(--ink-3);padding:8px">Tidak ada kandidat yang cocok.</p>';
      listEl.querySelectorAll('[data-marry-id]').forEach(b =>
        b.addEventListener('click', async () => {
          try {
            await api.post('api/marriages.php', {
              tree_id: window.TREE_ID,
              person1_id: Number(p.id),
              person2_id: Number(b.dataset.marryId),
            });
            closeModal('modal-marry-existing');
            await loadData(true);
          } catch (err) { alert(err.message); }
        }));
    };
    searchEl.oninput = renderList;
    renderList();
    openModal('modal-marry-existing');
    searchEl.focus();
  }

  /* ---------- edit pernikahan ---------- */

  function openMarriageModal(marriageId) {
    const m = state.marriages.find(x => Number(x.id) === marriageId);
    if (!m) return;
    const h = state.byId.get(Number(m.husband_id));
    const w = state.byId.get(Number(m.wife_id));
    document.getElementById('marriage-couple').innerHTML =
      `<strong>${esc(h ? h.full_name : '?')}</strong> &amp; <strong>${esc(w ? w.full_name : '?')}</strong>`;
    document.getElementById('mf-status').value = m.status;
    document.getElementById('mf-order').value = m.marriage_order;
    document.getElementById('mf-date').value = m.marriage_date || '';
    document.getElementById('mf-divorce').value = m.divorce_date || '';
    openModal('modal-marriage');

    document.getElementById('mf-submit').onclick = async () => {
      try {
        await api.put('api/marriages.php?id=' + m.id, {
          status: document.getElementById('mf-status').value,
          marriage_order: Number(document.getElementById('mf-order').value) || 1,
          marriage_date: document.getElementById('mf-date').value,
          divorce_date: document.getElementById('mf-divorce').value,
        });
        closeModal('modal-marriage');
        await loadData(true);
      } catch (err) { alert(err.message); }
    };
    document.getElementById('mf-delete').onclick = async () => {
      if (!confirm('Hapus catatan pernikahan ini? (Kedua orang tetap ada di pohon.)')) return;
      try {
        await api.del('api/marriages.php?id=' + m.id);
        closeModal('modal-marriage');
        await loadData(true);
      } catch (err) { alert(err.message); }
    };
  }

  /* ---------- pencarian ---------- */

  document.getElementById('btn-search').addEventListener('click', () => {
    const listEl = document.getElementById('search-list');
    const input = document.getElementById('search-input');
    input.value = '';
    const renderList = () => {
      const q = input.value.trim().toLowerCase();
      const filtered = state.persons.filter(c => !q || c.full_name.toLowerCase().includes(q)).slice(0, 30);
      listEl.innerHTML = filtered.map(c => `<button data-goto-id="${c.id}">
          ${esc(c.full_name)} <span class="g">${c.gender === 'L' ? 'L' : 'P'}${c.birth_date ? ' · ' + c.birth_date.slice(0, 4) : ''}</span>
        </button>`).join('') || '<p style="color:var(--ink-3);padding:8px">Tidak ditemukan.</p>';
      listEl.querySelectorAll('[data-goto-id]').forEach(b =>
        b.addEventListener('click', () => {
          closeModal('modal-search');
          selectPerson(Number(b.dataset.gotoId));
          renderer.focusPerson(Number(b.dataset.gotoId));
        }));
    };
    input.oninput = renderList;
    renderList();
    openModal('modal-search');
    input.focus();
  });

  /* ---------- toolbar ---------- */

  const btnAdd = document.getElementById('btn-add-person');
  if (btnAdd) btnAdd.addEventListener('click', () => openPersonForm({
    mode: 'add',
    context: state.persons.length
      ? 'Orang ini akan ditambahkan tanpa relasi. Anda bisa menikahkan / menghubungkannya setelahnya, atau lebih mudah: pilih orang di pohon lalu gunakan tombol + Pasangan / + Anak / + Ayah / + Ibu.'
      : '',
  }));

  document.getElementById('btn-share').addEventListener('click', () => openModal('modal-share'));

  document.querySelectorAll('[data-copy]').forEach(btn =>
    btn.addEventListener('click', async () => {
      const code = btn.dataset.copy === 'edit' ? window.SHARE_EDIT : window.SHARE_VIEW;
      const url = location.origin + location.pathname.replace(/tree\.php$/, 'join.php') + '?code=' + code;
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = 'Tersalin ✓';
      } catch (e) {
        prompt('Salin tautan ini:', url);
      }
      setTimeout(() => { btn.textContent = 'Salin tautan'; }, 1600);
    }));

  const regen = document.getElementById('btn-regen-codes');
  if (regen) regen.addEventListener('click', async () => {
    if (!confirm('Ganti kedua kode undangan? Tautan lama tidak akan berlaku lagi.')) return;
    try {
      const r = await api.post('api/trees.php', { action: 'regenerate_codes', tree_id: window.TREE_ID });
      window.SHARE_EDIT = r.share_code_edit;
      window.SHARE_VIEW = r.share_code_view;
      document.getElementById('code-edit').textContent = r.share_code_edit;
      document.getElementById('code-view').textContent = r.share_code_view;
    } catch (err) { alert(err.message); }
  });

  document.getElementById('zoom-in').addEventListener('click', () => renderer.zoomBy(1.2));
  document.getElementById('zoom-out').addEventListener('click', () => renderer.zoomBy(0.83));
  document.getElementById('zoom-fit').addEventListener('click', () => renderer.fit());

  /* ---------- ekspor untuk import-kk.js ---------- */
  window.SilsilahApp = { loadData, state };

  /* ---------- mulai ---------- */
  loadData(false).catch(err => {
    panelBody.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  });
})();
