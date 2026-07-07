/**
 * TreeRenderer — merender pohon keluarga ke dalam SVG.
 *
 * Mendukung:
 *  - poligami: satu orang boleh punya banyak pernikahan; setiap pernikahan
 *    digambar sebagai "jalur bus" tersendiri di bawah kartu, dan anak-anak
 *    dikelompokkan per pernikahan;
 *  - anak dengan satu orang tua saja;
 *  - pernikahan antar cabang (digambar sebagai garis penghubung putus-putus);
 *  - pan (seret), zoom (scroll / cubit dua jari), klik kartu untuk memilih.
 */
(function (global) {
  'use strict';

  const CARD_W = 172;
  const CARD_H = 64;
  const SIB_GAP = 26;      // jarak antar blok saudara
  const SPOUSE_GAP = 26;   // jarak antar kartu pasangan dalam satu baris
  const GROUP_GAP = 44;    // jarak antar kelompok anak dari pernikahan berbeda
  const ROOT_GAP = 90;     // jarak antar pohon akar
  const NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs) {
    const node = document.createElementNS(NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function yearOf(dateStr) {
    if (!dateStr) return '';
    const m = String(dateStr).match(/^(\d{4})/);
    return m ? m[1] : '';
  }

  function wrapName(name, maxChars) {
    const words = String(name).trim().split(/\s+/);
    const lines = [''];
    for (const w of words) {
      const cur = lines[lines.length - 1];
      if (cur === '') lines[lines.length - 1] = w;
      else if ((cur + ' ' + w).length <= maxChars) lines[lines.length - 1] = cur + ' ' + w;
      else lines.push(w);
    }
    if (lines.length > 2) {
      lines.length = 2;
      lines[1] = lines[1].slice(0, maxChars - 1) + '…';
    }
    return lines;
  }

  class TreeRenderer {
    constructor(svg, opts) {
      this.svg = svg;
      this.opts = opts || {};
      this.persons = new Map();
      this.marriages = [];
      this.positions = new Map();  // personId -> {x, y}
      this.selectedId = null;
      this.tx = 40; this.ty = 40; this.scale = 1;

      this.root = el('g', {});
      this.svg.appendChild(this.root);
      this._bindPanZoom();
    }

    setData(persons, marriages) {
      this.persons = new Map();
      persons.forEach(p => this.persons.set(Number(p.id), p));
      this.marriages = marriages.map(m => ({
        id: Number(m.id),
        husband_id: Number(m.husband_id),
        wife_id: Number(m.wife_id),
        status: m.status,
        marriage_order: Number(m.marriage_order || 1),
      }));
    }

    select(id) {
      this.selectedId = id;
      this.root.querySelectorAll('.node-card').forEach(g => {
        g.classList.toggle('selected', Number(g.dataset.id) === Number(id));
      });
    }

    /* ================= tata letak ================= */

    _marriagesOf(pid) {
      return this.marriages
        .filter(m => m.husband_id === pid || m.wife_id === pid)
        .sort((a, b) => a.marriage_order - b.marriage_order || a.id - b.id);
    }

    _childrenOfPair(fatherId, motherId) {
      const out = [];
      this.persons.forEach(p => {
        const f = p.father_id ? Number(p.father_id) : null;
        const mo = p.mother_id ? Number(p.mother_id) : null;
        if (f === (fatherId || null) && mo === (motherId || null)) out.push(p);
      });
      return this._sortByBirth(out);
    }

    _childrenOfSingle(pid, gender) {
      // anak yang hanya tercatat punya satu orang tua = orang ini
      const out = [];
      this.persons.forEach(p => {
        const f = p.father_id ? Number(p.father_id) : null;
        const mo = p.mother_id ? Number(p.mother_id) : null;
        if (gender === 'L' && f === pid && mo === null) out.push(p);
        if (gender === 'P' && mo === pid && f === null) out.push(p);
      });
      return this._sortByBirth(out);
    }

    _sortByBirth(arr) {
      return arr.sort((a, b) => {
        const da = a.birth_date || '9999-99-99';
        const db = b.birth_date || '9999-99-99';
        return da < db ? -1 : da > db ? 1 : Number(a.id) - Number(b.id);
      });
    }

    _hasParents(p) {
      return !!(p.father_id && this.persons.has(Number(p.father_id))) ||
             !!(p.mother_id && this.persons.has(Number(p.mother_id)));
    }

    /**
     * Bangun blok layout rekursif untuk `person` (+ pasangan yang menempel
     * + seluruh keturunannya). Mengembalikan {width, height, draw(x,y)}.
     */
    _buildBlock(person, placed) {
      const pid = Number(person.id);
      placed.add(pid);

      const marriages = this._marriagesOf(pid);
      // pasangan yang "menempel" pada blok ini: belum ditempatkan dan tidak
      // punya orang tua di pohon (kalau punya, ia dirender di bawah orang tuanya
      // dan pernikahannya digambar sebagai penghubung antar cabang).
      const rowUnits = []; // {marriage, spouse|null(remote)}
      for (const m of marriages) {
        const spouseId = m.husband_id === pid ? m.wife_id : m.husband_id;
        const spouse = this.persons.get(spouseId);
        if (!spouse) continue;
        if (!placed.has(spouseId) && !this._hasParents(spouse)) {
          placed.add(spouseId);
          rowUnits.push({ marriage: m, spouse });
        } else {
          rowUnits.push({ marriage: m, spouse: null, remoteSpouseId: spouseId });
        }
      }

      // kelompok anak: per pernikahan, lalu anak orang-tua-tunggal
      const childGroups = []; // {unitIndex|null, blocks:[]}
      for (let i = 0; i < marriages.length; i++) {
        const m = marriages[i];
        const kids = this._childrenOfPair(m.husband_id, m.wife_id)
          .filter(k => !placed.has(Number(k.id)));
        const blocks = kids.map(k => this._buildBlock(k, placed));
        // anak yang sudah ditempatkan di cabang lain → digambar lewat pass-2
        childGroups.push({ unitIndex: i, blocks });
      }
      const soloKids = this._childrenOfSingle(pid, person.gender)
        .filter(k => !placed.has(Number(k.id)))
        .map(k => this._buildBlock(k, placed));
      if (soloKids.length) childGroups.push({ unitIndex: null, blocks: soloKids });

      // ukuran baris kartu: [person, spouse1, spouse2, ...]
      const rowCards = 1 + rowUnits.filter(u => u.spouse).length;
      const rowW = rowCards * CARD_W + (rowCards - 1) * SPOUSE_GAP;

      // ukuran total anak
      const groupWidths = childGroups.map(g =>
        g.blocks.reduce((s, b) => s + b.width, 0) + Math.max(0, g.blocks.length - 1) * SIB_GAP);
      const nonEmpty = groupWidths.filter((w, i) => childGroups[i].blocks.length > 0);
      const childW = nonEmpty.reduce((s, w) => s + w, 0) + Math.max(0, nonEmpty.length - 1) * GROUP_GAP;

      const width = Math.max(rowW, childW, CARD_W);
      // ruang bus pernikahan di bawah baris kartu
      const busLevels = marriages.length + (soloKids.length ? 1 : 0);
      const busZone = busLevels > 0 ? 14 + busLevels * 14 : 0;
      const vGap = childGroups.some(g => g.blocks.length) ? busZone + 36 : 0;

      const childHeights = childGroups.flatMap(g => g.blocks.map(b => b.height));
      const height = CARD_H + (childHeights.length ? vGap + Math.max(...childHeights) : 0);

      const self = this;
      return {
        width, height,
        draw(x, y) {
          // 1. baris kartu
          const rowX = x + (width - rowW) / 2;
          const cardPos = new Map(); // personId -> centerX
          let cx = rowX;
          self._drawCard(person, cx, y);
          cardPos.set(pid, cx + CARD_W / 2);
          for (const u of rowUnits) {
            if (!u.spouse) continue;
            cx += CARD_W + SPOUSE_GAP;
            self._drawCard(u.spouse, cx, y);
            cardPos.set(Number(u.spouse.id), cx + CARD_W / 2);
          }

          // 2. gambar bus pernikahan + kelompok anak
          const rowBottom = y + CARD_H;
          let gx = x + (width - childW) / 2;
          let level = 0;
          const groupAnchor = []; // per childGroups index → x jangkar untuk drop anak

          childGroups.forEach((g, gi) => {
            if (!g.blocks.length) { groupAnchor[gi] = null; return; }
            const gw = groupWidths[gi];
            groupAnchor[gi] = { x: gx, w: gw };
            gx += gw + GROUP_GAP;
          });

          marriages.forEach((m, i) => {
            const u = rowUnits[i];
            const busY = rowBottom + 12 + level * 14;
            level++;
            const pX = cardPos.get(pid);
            let sX = u.spouse ? cardPos.get(Number(u.spouse.id)) : null;

            if (sX !== null && sX !== undefined) {
              // garis pernikahan: turun dari kedua kartu ke bus, lalu horizontal
              const x1 = Math.min(pX, sX), x2 = Math.max(pX, sX);
              const cls = 'edge edge-marriage' + (m.status === 'divorced' ? ' divorced' : '');
              self.root.appendChild(el('path', {
                d: `M ${pX} ${rowBottom} V ${busY} M ${sX} ${rowBottom} V ${busY} M ${x1} ${busY} H ${x2}`,
                class: cls,
              }));
              if (m.marriage_order > 1 || marriages.length > 1) {
                const t = el('text', { x: (x1 + x2) / 2, y: busY - 3, 'text-anchor': 'middle', class: 'marriage-label' });
                t.textContent = 'pernikahan ke-' + m.marriage_order + (m.status === 'divorced' ? ' (cerai)' : '');
                self.root.appendChild(t);
              } else if (m.status === 'divorced') {
                const t = el('text', { x: (x1 + x2) / 2, y: busY - 3, 'text-anchor': 'middle', class: 'marriage-label' });
                t.textContent = 'cerai';
                self.root.appendChild(t);
              }
              // simpan titik gantung anak untuk pernikahan ini
              m._dropX = (x1 + x2) / 2;
              m._dropY = busY;
            } else {
              // pasangan berada di cabang lain — garis penghubung digambar pada pass-2
              self.root.appendChild(el('path', {
                d: `M ${pX} ${rowBottom} V ${busY}`,
                class: 'edge edge-marriage' + (m.status === 'divorced' ? ' divorced' : ''),
              }));
              m._dropX = pX;
              m._dropY = busY;
              m._remoteFrom = { x: pX, y: busY, spouseId: u.remoteSpouseId };
              self._remoteMarriages.push(m);
            }
          });

          // bus untuk anak orang-tua-tunggal
          let soloDrop = null;
          if (soloKids.length) {
            const busY = rowBottom + 12 + level * 14;
            const pX = cardPos.get(pid);
            self.root.appendChild(el('path', { d: `M ${pX} ${rowBottom} V ${busY}`, class: 'edge' }));
            soloDrop = { x: pX, y: busY };
          }

          // 3. anak-anak
          const childY = y + CARD_H + vGap;
          childGroups.forEach((g, gi) => {
            if (!g.blocks.length) return;
            const anchor = groupAnchor[gi];
            const drop = g.unitIndex === null
              ? soloDrop
              : { x: marriages[g.unitIndex]._dropX, y: marriages[g.unitIndex]._dropY };

            // gambar tiap blok anak & kumpulkan titik atasnya
            let bx = anchor.x;
            const tops = [];
            for (const b of g.blocks) {
              const info = b.draw(bx, childY);
              tops.push(info.topCenterX);
              bx += b.width + SIB_GAP;
            }
            // bus horizontal di atas anak-anak
            const busY2 = childY - 16;
            const minX = Math.min(drop.x, ...tops);
            const maxX = Math.max(drop.x, ...tops);
            self.root.appendChild(el('path', { d: `M ${drop.x} ${drop.y} V ${busY2}`, class: 'edge' }));
            if (tops.length > 1 || minX !== maxX) {
              self.root.appendChild(el('path', { d: `M ${minX} ${busY2} H ${maxX}`, class: 'edge' }));
            }
            tops.forEach(txp => {
              self.root.appendChild(el('path', { d: `M ${txp} ${busY2} V ${childY}`, class: 'edge' }));
            });
          });

          return { topCenterX: cardPos.get(pid) };
        },
      };
    }

    render() {
      this.root.innerHTML = '';
      this.positions.clear();
      this._remoteMarriages = [];

      if (this.persons.size === 0) return;

      const placed = new Set();

      // akar: tidak punya orang tua di pohon, dan bukan "pasangan yang menempel"
      // pada orang lain — orang seperti itu akan ditarik saat pasangannya dirender.
      const all = [];
      this.persons.forEach(p => all.push(p));
      const roots = this._sortByBirth(
        all.filter(p => !this._hasParents(p))
      );
      // dahulukan yang punya keturunan/pernikahan agar pasangan menempel dengan benar
      roots.sort((a, b) => this._marriagesOf(Number(b.id)).length - this._marriagesOf(Number(a.id)).length);

      let x = 0;
      for (const r of roots) {
        if (placed.has(Number(r.id))) continue;
        const block = this._buildBlock(r, placed);
        block.draw(x, 0);
        x += block.width + ROOT_GAP;
      }
      // pengaman: orang yang belum tergambar (data tak lazim) → baris terpisah
      const leftovers = all.filter(p => !placed.has(Number(p.id)));
      if (leftovers.length) {
        let lx = 0;
        const ly = 40 + (this.root.getBBox ? 0 : 0);
        const bbox = this.root.getBBox();
        const yBottom = (bbox.height ? bbox.y + bbox.height : 0) + 90;
        for (const p of leftovers) {
          placed.add(Number(p.id));
          this._drawCard(p, lx, yBottom);
          lx += CARD_W + SIB_GAP;
        }
      }

      // pass-2: pernikahan antar cabang (pasangan dirender di blok berbeda)
      for (const m of this._remoteMarriages) {
        const from = m._remoteFrom;
        const pos = this.positions.get(Number(from.spouseId));
        if (!pos) continue;
        const sx = pos.x + CARD_W / 2;
        const sy = pos.y + CARD_H;
        this.root.appendChild(el('path', {
          d: `M ${from.x} ${from.y} H ${(from.x + sx) / 2} V ${sy + 10} H ${sx} V ${sy}`,
          class: 'edge edge-marriage' + (m.status === 'divorced' ? ' divorced' : ''),
          'stroke-dasharray': '5 4',
        }));
      }

      // pass-3: anak yang orang tuanya ada tetapi dirender di blok lain
      // (misal keduanya pasangan "remote") — garis putus-putus orang tua→anak.
      this.persons.forEach(p => {
        const pidNum = Number(p.id);
        const pos = this.positions.get(pidNum);
        if (!pos) return;
        // sudah tergambar normal bila drop bus menyentuh; deteksi sulit — cukup
        // pastikan: bila punya orang tua di pohon tapi tidak digambar sebagai anak
        // (ditandai flag _drawnAsChild), hubungkan putus-putus.
        if (this._hasParents(p) && !p._drawnAsChild) {
          const par = this.persons.get(Number(p.father_id)) || this.persons.get(Number(p.mother_id));
          const ppos = par ? this.positions.get(Number(par.id)) : null;
          if (ppos) {
            this.root.appendChild(el('path', {
              d: `M ${ppos.x + CARD_W / 2} ${ppos.y + CARD_H} V ${pos.y - 12} H ${pos.x + CARD_W / 2} V ${pos.y}`,
              class: 'edge',
              'stroke-dasharray': '4 4',
            }));
          }
        }
      });

      this._applyTransform();
    }

    /* ================= kartu ================= */

    _drawCard(p, x, y) {
      const pid = Number(p.id);
      this.positions.set(pid, { x, y });
      // tandai bahwa orang ini digambar sebagai anak di bawah orang tuanya
      // (dipakai pass-3). Ia dianggap "anak tergambar" bila punya orang tua
      // dan penempatannya terjadi lewat rekursi blok anak — pendekatan praktis:
      // saat kartu digambar, cek apakah orang tuanya SUDAH digambar lebih dulu.
      if (this._hasParents(p)) {
        const f = this.positions.get(Number(p.father_id));
        const mo = this.positions.get(Number(p.mother_id));
        p._drawnAsChild = !!(f || mo);
      } else {
        p._drawnAsChild = false;
      }

      const g = el('g', {
        class: 'node-card ' + (p.gender === 'L' ? 'male' : 'female') +
               (Number(p.is_deceased) ? ' deceased' : '') +
               (Number(this.selectedId) === pid ? ' selected' : ''),
        transform: `translate(${x},${y})`,
      });
      g.dataset.id = pid;

      g.appendChild(el('rect', { class: 'card-bg', width: CARD_W, height: CARD_H, rx: 9 }));
      // aksen gender di sisi kiri
      g.appendChild(el('rect', {
        width: 4, height: CARD_H, rx: 2,
        fill: p.gender === 'L' ? 'var(--male)' : 'var(--female)',
      }));

      // foto / inisial
      const cxp = 30, cyp = CARD_H / 2, r = 21;
      if (p.photo) {
        const clipId = 'clip-p' + pid;
        const clip = el('clipPath', { id: clipId });
        clip.appendChild(el('circle', { cx: cxp, cy: cyp, r }));
        g.appendChild(clip);
        const img = el('image', {
          x: cxp - r, y: cyp - r, width: r * 2, height: r * 2,
          'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMid slice',
        });
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', 'uploads/' + p.photo);
        img.setAttribute('href', 'uploads/' + p.photo);
        g.appendChild(img);
        g.appendChild(el('circle', { cx: cxp, cy: cyp, r, fill: 'none', stroke: 'var(--border-strong)', 'stroke-width': 1 }));
      } else {
        g.appendChild(el('circle', {
          cx: cxp, cy: cyp, r,
          fill: p.gender === 'L' ? 'var(--male-soft)' : 'var(--female-soft)',
          stroke: 'var(--border-strong)', 'stroke-width': 1,
        }));
        const init = el('text', {
          x: cxp, y: cyp + 5, 'text-anchor': 'middle',
          'font-size': 15, 'font-weight': 700,
          fill: p.gender === 'L' ? 'var(--male)' : 'var(--female)',
        });
        init.textContent = (p.full_name || '?').trim().charAt(0).toUpperCase();
        g.appendChild(init);
      }

      // nama (maks 2 baris) + tahun
      const lines = wrapName(p.full_name || '', 15);
      const textX = 58;
      const by = yearOf(p.birth_date);
      const dy = yearOf(p.death_date);
      let years = by ? by : '';
      if (Number(p.is_deceased) || dy) years += ' – ' + (dy || '†');
      else if (by) years = 'l. ' + by;

      const nameYs = lines.length === 2 ? [22, 37] : [26];
      lines.forEach((line, i) => {
        const t = el('text', { x: textX, y: nameYs[i], class: 'name' });
        t.textContent = line;
        g.appendChild(t);
      });
      const yt = el('text', { x: textX, y: lines.length === 2 ? 52 : 45, class: 'years' });
      yt.textContent = years + (Number(p.is_deceased) && !dy ? ' (alm.)' : '');
      g.appendChild(yt);

      g.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.opts.onSelect) this.opts.onSelect(pid);
      });

      this.root.appendChild(g);
    }

    /* ================= pan & zoom ================= */

    _applyTransform() {
      this.root.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.scale})`);
    }

    fit() {
      const bbox = this.root.getBBox();
      if (!bbox.width || !bbox.height) return;
      const vw = this.svg.clientWidth, vh = this.svg.clientHeight;
      const pad = 50;
      const s = Math.min((vw - pad * 2) / bbox.width, (vh - pad * 2) / bbox.height, 1.15);
      this.scale = Math.max(s, 0.08);
      this.tx = (vw - bbox.width * this.scale) / 2 - bbox.x * this.scale;
      this.ty = (vh - bbox.height * this.scale) / 2 - bbox.y * this.scale;
      this._applyTransform();
    }

    focusPerson(id) {
      const pos = this.positions.get(Number(id));
      if (!pos) return;
      const vw = this.svg.clientWidth, vh = this.svg.clientHeight;
      this.scale = Math.max(this.scale, 0.8);
      this.tx = vw / 2 - (pos.x + CARD_W / 2) * this.scale;
      this.ty = vh / 2 - (pos.y + CARD_H / 2) * this.scale;
      this._applyTransform();
    }

    zoomBy(factor) {
      const vw = this.svg.clientWidth, vh = this.svg.clientHeight;
      this._zoomAt(vw / 2, vh / 2, factor);
    }

    _zoomAt(px, py, factor) {
      const ns = Math.min(2.5, Math.max(0.08, this.scale * factor));
      const k = ns / this.scale;
      this.tx = px - (px - this.tx) * k;
      this.ty = py - (py - this.ty) * k;
      this.scale = ns;
      this._applyTransform();
    }

    _bindPanZoom() {
      const svg = this.svg;
      let dragging = false, lx = 0, ly = 0, moved = false;

      svg.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return; // touch ditangani terpisah
        dragging = true; moved = false;
        lx = e.clientX; ly = e.clientY;
        svg.classList.add('dragging');
        svg.setPointerCapture(e.pointerId);
      });
      svg.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lx, dy = e.clientY - ly;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        this.tx += dx; this.ty += dy;
        lx = e.clientX; ly = e.clientY;
        this._applyTransform();
      });
      svg.addEventListener('pointerup', (e) => {
        dragging = false;
        svg.classList.remove('dragging');
        if (!moved && e.target === svg && this.opts.onDeselect) this.opts.onDeselect();
      });

      svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        this._zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 0.89);
      }, { passive: false });

      // sentuh: 1 jari = geser, 2 jari = cubit
      let touches = new Map();
      let pinchDist = 0;
      svg.addEventListener('touchstart', (e) => {
        for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        }
      }, { passive: true });
      svg.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (touches.size === 1 && e.touches.length === 1) {
          const t = e.touches[0];
          const prev = touches.get(t.identifier);
          if (prev) {
            this.tx += t.clientX - prev.x;
            this.ty += t.clientY - prev.y;
            touches.set(t.identifier, { x: t.clientX, y: t.clientY });
            this._applyTransform();
          }
        } else if (e.touches.length === 2) {
          const a = e.touches[0], b = e.touches[1];
          const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          if (pinchDist > 0) {
            const rect = svg.getBoundingClientRect();
            const cx = (a.clientX + b.clientX) / 2 - rect.left;
            const cy = (a.clientY + b.clientY) / 2 - rect.top;
            this._zoomAt(cx, cy, d / pinchDist);
          }
          pinchDist = d;
          touches.set(a.identifier, { x: a.clientX, y: a.clientY });
          touches.set(b.identifier, { x: b.clientX, y: b.clientY });
        }
      }, { passive: false });
      svg.addEventListener('touchend', (e) => {
        for (const t of e.changedTouches) touches.delete(t.identifier);
        if (touches.size < 2) pinchDist = 0;
      });
    }
  }

  global.TreeRenderer = TreeRenderer;
})(window);
