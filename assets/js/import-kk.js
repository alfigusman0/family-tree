/**
 * Import Kartu Keluarga → pohon keluarga.
 *
 * Alur:
 *  1. Pengguna mengunggah gambar (JPG/PNG) atau PDF Kartu Keluarga.
 *  2. PDF: coba baca teks tertanam via pdf.js; jika tidak ada (hasil scan),
 *     halaman dirender ke kanvas lalu di-OCR. Gambar: langsung OCR (Tesseract.js,
 *     bahasa Indonesia).
 *  3. Teks diurai secara heuristik: NIK 16 digit dipakai sebagai jangkar baris,
 *     nama, jenis kelamin, tempat/tanggal lahir, dan status hubungan ditebak.
 *  4. Hasil ditampilkan di tabel review yang SEPENUHNYA bisa diedit — pengguna
 *     memperbaiki lalu menekan "Import ke pohon".
 *
 * Library dimuat on-demand dari CDN saat pertama kali dipakai.
 */
(function () {
  'use strict';

  if (!window.CAN_EDIT) return;
  const btnOpen = document.getElementById('btn-import-kk');
  if (!btnOpen) return;

  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  const PDFJS_URL     = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER  = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Gagal memuat library dari internet. Periksa koneksi Anda.'));
      document.head.appendChild(s);
    });
  }

  const modal      = document.getElementById('modal-import');
  const stepUpload = document.getElementById('import-step-upload');
  const stepReview = document.getElementById('import-step-review');
  const drop       = document.getElementById('kk-drop');
  const fileInput  = document.getElementById('kk-file');
  const progWrap   = document.getElementById('ocr-progress');
  const progText   = document.getElementById('ocr-status');
  const progBar    = document.getElementById('ocr-bar-fill');

  btnOpen.addEventListener('click', () => {
    showUploadStep();
    modal.classList.add('open');
  });

  function showUploadStep() {
    stepUpload.style.display = '';
    stepReview.style.display = 'none';
    progWrap.style.display = 'none';
    progBar.style.width = '0';
    fileInput.value = '';
  }

  function setProgress(text, ratio) {
    progWrap.style.display = '';
    progText.textContent = text;
    if (ratio != null) progBar.style.width = Math.round(ratio * 100) + '%';
  }

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  async function handleFile(file) {
    if (file.size > 15 * 1024 * 1024) { alert('Ukuran file maksimal 15 MB.'); return; }
    try {
      let text = '';
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        text = await extractFromPdf(file);
      } else if (/^image\//.test(file.type)) {
        setProgress('Membaca gambar dengan OCR (bisa 1–2 menit)…', 0);
        text = await ocrImage(file);
      } else {
        alert('Format tidak didukung. Gunakan JPG, PNG, atau PDF.');
        return;
      }
      const rows = parseKK(text);
      if (!rows.length) {
        alert('Tidak ada data anggota keluarga yang terbaca. Anda tetap bisa mengisi tabel secara manual.');
      }
      showReview(rows);
    } catch (err) {
      alert(err.message || 'Gagal memproses file.');
      showUploadStep();
    }
  }

  /* ---------- ekstraksi PDF ---------- */

  async function extractFromPdf(file) {
    setProgress('Membuka PDF…', 0.05);
    await loadScript(PDFJS_URL);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);

    // 1) coba teks tertanam (PDF asli, bukan hasil scan) — jauh lebih akurat
    const tc = await page.getTextContent();
    if (tc.items.length > 20) {
      setProgress('Membaca teks PDF…', 0.6);
      // susun ulang item per baris berdasarkan posisi Y
      const lines = new Map();
      for (const it of tc.items) {
        const y = Math.round(it.transform[5] / 4) * 4; // toleransi 4pt
        if (!lines.has(y)) lines.set(y, []);
        lines.get(y).push({ x: it.transform[4], str: it.str });
      }
      const sorted = [...lines.entries()].sort((a, b) => b[0] - a[0]);
      return sorted.map(([, items]) =>
        items.sort((a, b) => a.x - b.x).map(i => i.str).join(' ')).join('\n');
    }

    // 2) PDF hasil scan → render ke kanvas lalu OCR
    setProgress('PDF berupa hasil scan — merender halaman…', 0.15);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    return ocrImage(blob);
  }

  /* ---------- OCR ---------- */

  async function ocrImage(fileOrBlob) {
    await loadScript(TESSERACT_URL);
    const worker = await window.Tesseract.createWorker('ind', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          setProgress('Membaca teks (OCR)… ' + Math.round(m.progress * 100) + '%', 0.2 + m.progress * 0.8);
        }
      },
    });
    try {
      const { data } = await worker.recognize(fileOrBlob);
      return data.text || '';
    } finally {
      await worker.terminate();
    }
  }

  /* ---------- parser Kartu Keluarga ---------- */

  function parseKK(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const rows = [];
    const seenNik = new Set();

    // pola relasi pada KK
    const relPatterns = [
      { re: /KEPALA\s*KELUARGA/i, rel: 'kepala' },
      { re: /\bISTERI\b|\bISTRI\b/i, rel: 'istri' },
      { re: /\bSUAMI\b/i, rel: 'suami' },
      { re: /\bANAK\b/i, rel: 'anak' },
      { re: /CUCU|MENANTU|ORANG\s*TUA|MERTUA|FAMILI|LAINNYA/i, rel: 'lainnya' },
    ];

    // 1) baris dengan NIK 16 digit sebagai jangkar
    for (const line of lines) {
      // OCR kadang menyisipkan spasi dalam NIK
      const nikMatch = line.replace(/(\d)\s+(?=\d)/g, '$1').match(/\b(\d{16})\b/);
      if (!nikMatch) continue;
      const nik = nikMatch[1];
      if (seenNik.has(nik)) continue;

      const compact = line.replace(/(\d)\s+(?=\d)/g, '$1');
      const beforeNik = compact.slice(0, compact.indexOf(nik));

      // nama: teks huruf (≥ 3 huruf) sebelum NIK, buang nomor urut di depan
      let name = (beforeNik.match(/[A-Za-z][A-Za-z'.\s]{2,}/g) || []).join(' ')
        .replace(/^\s*\d+\s*/, '').replace(/\s{2,}/g, ' ').trim();

      // jenis kelamin
      let gender = '';
      if (/PEREMPUAN|WANITA/i.test(line)) gender = 'P';
      else if (/LAKI/i.test(line)) gender = 'L';

      // tanggal lahir: DD-MM-YYYY / DD/MM/YYYY
      let birth = '';
      const dm = compact.match(/\b(\d{2})[-\/](\d{2})[-\/](\d{4})\b/);
      if (dm) birth = `${dm[3]}-${dm[2]}-${dm[1]}`;

      // tempat lahir: kata kapital di antara gender dan tanggal (heuristik longgar)
      let birthPlace = '';
      const afterNik = compact.slice(compact.indexOf(nik) + 16);
      const placeMatch = afterNik.replace(/LAKI[- ]*LAKI|PEREMPUAN|WANITA/ig, '|')
        .split('|').map(s => s.trim()).filter(Boolean)[0] || '';
      const pm = placeMatch.match(/^[A-Za-z][A-Za-z\s.]{2,30}/);
      if (pm) birthPlace = pm[0].replace(/\b\d.*$/, '').trim();

      // relasi (jika satu baris memuat status hubungan)
      let rel = '';
      for (const rp of relPatterns) {
        if (rp.re.test(line)) { rel = rp.rel; break; }
      }

      if (name.length < 3) name = '';
      seenNik.add(nik);
      rows.push({ full_name: name, nik, gender, birth_place: birthPlace, birth_date: birth, relation: rel });
    }

    // 2) jika kolom relasi ada di tabel kedua (baris terpisah), petakan berurutan
    const relSeq = [];
    for (const line of lines) {
      for (const rp of relPatterns) {
        if (rp.re.test(line) && !/\d{16}/.test(line.replace(/\s+/g, ''))) {
          relSeq.push(rp.rel);
          break;
        }
      }
    }
    if (relSeq.length >= rows.length && rows.length > 0) {
      rows.forEach((r, i) => { if (!r.relation) r.relation = relSeq[i] || ''; });
    }

    // default relasi: baris pertama kepala, sisanya anak
    rows.forEach((r, i) => {
      if (!r.relation) r.relation = i === 0 ? 'kepala' : 'anak';
    });
    // default gender dari relasi bila kosong
    rows.forEach(r => {
      if (!r.gender) {
        if (r.relation === 'istri') r.gender = 'P';
        else if (r.relation === 'suami' || r.relation === 'kepala') r.gender = 'L';
        else r.gender = 'L';
      }
    });

    return rows;
  }

  /* ---------- tabel review ---------- */

  const tbody = document.getElementById('review-rows');

  function rowTemplate(r) {
    r = r || { full_name: '', nik: '', gender: 'L', birth_place: '', birth_date: '', relation: 'anak' };
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-name"><input type="text" data-f="full_name" value="${esc(r.full_name)}" placeholder="Nama lengkap"></td>
      <td class="col-nik"><input type="text" data-f="nik" value="${esc(r.nik)}" placeholder="16 digit" inputmode="numeric"></td>
      <td>
        <select data-f="gender">
          <option value="L"${r.gender !== 'P' ? ' selected' : ''}>L</option>
          <option value="P"${r.gender === 'P' ? ' selected' : ''}>P</option>
        </select>
      </td>
      <td><input type="text" data-f="birth_place" value="${esc(r.birth_place)}" placeholder="Kota/Kab."></td>
      <td class="col-date"><input type="date" data-f="birth_date" value="${esc(r.birth_date)}"></td>
      <td>
        <select data-f="relation">
          <option value="kepala"${r.relation === 'kepala' ? ' selected' : ''}>Kepala keluarga</option>
          <option value="istri"${r.relation === 'istri' ? ' selected' : ''}>Istri</option>
          <option value="suami"${r.relation === 'suami' ? ' selected' : ''}>Suami</option>
          <option value="anak"${r.relation === 'anak' ? ' selected' : ''}>Anak</option>
          <option value="lainnya"${r.relation === 'lainnya' ? ' selected' : ''}>Lainnya</option>
        </select>
      </td>
      <td><button class="row-remove" title="Hapus baris">&times;</button></td>`;
    tr.querySelector('.row-remove').addEventListener('click', () => tr.remove());
    return tr;
  }

  function showReview(rows) {
    tbody.innerHTML = '';
    (rows.length ? rows : [null]).forEach(r => tbody.appendChild(rowTemplate(r)));
    stepUpload.style.display = 'none';
    stepReview.style.display = '';
  }

  document.getElementById('review-add-row').addEventListener('click', () =>
    tbody.appendChild(rowTemplate(null)));
  document.getElementById('review-back').addEventListener('click', showUploadStep);

  document.getElementById('review-import').addEventListener('click', async () => {
    const rows = [];
    for (const tr of tbody.querySelectorAll('tr')) {
      const get = f => {
        const inp = tr.querySelector(`[data-f="${f}"]`);
        return inp ? inp.value.trim() : '';
      };
      const row = {
        full_name: get('full_name'),
        nik: get('nik'),
        gender: get('gender'),
        birth_place: get('birth_place'),
        birth_date: get('birth_date'),
        relation: get('relation'),
      };
      if (row.full_name) rows.push(row);
    }
    if (!rows.length) { alert('Isi minimal satu baris dengan nama.'); return; }
    if (!rows.some(r => r.relation === 'kepala')) {
      if (!confirm('Tidak ada baris "Kepala keluarga". Tanpa itu, relasi pernikahan & anak tidak dibentuk otomatis. Lanjutkan?')) return;
    }

    const btn = document.getElementById('review-import');
    btn.disabled = true;
    try {
      const r = await api.post('api/import.php', { tree_id: window.TREE_ID, rows });
      modal.classList.remove('open');
      alert('Berhasil mengimpor ' + r.imported + ' anggota keluarga.');
      await window.SilsilahApp.loadData(false);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });
})();
