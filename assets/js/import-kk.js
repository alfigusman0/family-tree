/**
 * Import Kartu Keluarga → pohon keluarga.
 *
 * Alur:
 *  1. Pengguna mengunggah gambar (JPG/PNG) atau PDF Kartu Keluarga.
 *  2. PDF: coba baca teks tertanam via pdf.js (beserta POSISI setiap teks —
 *     penting untuk memisahkan kolom "Ayah" dan "Ibu"); jika PDF hasil scan,
 *     halaman dirender ke kanvas lalu di-OCR (Tesseract.js bahasa Indonesia,
 *     juga dengan posisi kata).
 *  3. Parser membaca dua tabel KK:
 *     - tabel biodata (jangkar: NIK 16 digit) → nama, JK, tempat/tgl lahir;
 *     - tabel status (jangkar: nomor baris + status kawin/hubungan) →
 *       hubungan keluarga, tanggal menikah, NAMA AYAH, dan NAMA IBU.
 *  4. Hasil tampil di tabel review yang bisa diedit penuh sebelum diimpor.
 *     Di server, nama ayah/ibu dicocokkan dengan anggota yang sudah ada
 *     (tanpa membuat duplikat) — lihat api/import.php.
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
      let positioned; // [{items:[{x,str}]}] urut atas→bawah
      const name = file.name || '';
      const isImage = /^image\//.test(file.type);
      if (/\.pdf$/i.test(name) || file.type === 'application/pdf') {
        positioned = await extractFromPdf(file);
      } else if (isImage) {
        setProgress('Membaca gambar dengan OCR (bisa 1–2 menit)…', 0);
        positioned = await ocrImage(file, true);
      } else {
        alert('Format tidak didukung. Gunakan JPG, PNG, atau PDF.');
        return;
      }
      window.KKImport._lastLines = positioned; // untuk diagnosis hasil pembacaan
      let rows = parseKK(positioned);
      const hasData = rs => rs.some(r => (r.full_name || '').length >= 3);

      // foto dengan pencahayaan tidak merata kadang justru rusak oleh
      // binarisasi — coba sekali lagi tanpa binarisasi sebelum menyerah
      if (!hasData(rows) && isImage) {
        setProgress('Hasil belum terbaca — mencoba mode pembacaan kedua…', 0.1);
        positioned = await ocrImage(file, false);
        window.KKImport._lastLines = positioned;
        const rows2 = parseKK(positioned);
        if (hasData(rows2) || rows2.length > rows.length) rows = rows2;
      }

      if (!hasData(rows)) {
        alert('Data pada foto tidak dapat terbaca otomatis.\n\n' +
          'Tips: gunakan PDF asli dari Disdukcapil (paling akurat), atau foto ulang ' +
          'dengan lebih dekat, terang, dan lurus (teks tabel harus terbaca jelas oleh mata). ' +
          'Anda juga tetap bisa mengisi tabel di layar berikut secara manual.');
      }
      showReview(rows);
    } catch (err) {
      alert(err.message || 'Gagal memproses file.');
      showUploadStep();
    }
  }

  /* ---------- ekstraksi PDF (dengan posisi) ---------- */

  function groupLines(rawItems, tol) {
    // rawItems: [{x, y, str}] — kelompokkan per baris berdasarkan Y
    const lines = [];
    const sorted = rawItems.filter(i => i.str.trim() !== '')
      .sort((a, b) => b.y - a.y || a.x - b.x);
    for (const it of sorted) {
      let line = lines.find(l => Math.abs(l.y - it.y) <= tol);
      if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
      line.items.push({ x: it.x, str: it.str.trim() });
    }
    lines.sort((a, b) => b.y - a.y);
    lines.forEach(l => l.items.sort((a, b) => a.x - b.x));
    return lines;
  }

  async function extractFromPdf(file) {
    setProgress('Membuka PDF…', 0.05);
    await loadScript(PDFJS_URL);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);

    // 1) teks tertanam (PDF asli, bukan hasil scan) — paling akurat
    const tc = await page.getTextContent();
    if (tc.items.length > 20) {
      setProgress('Membaca teks PDF…', 0.6);
      return groupLines(tc.items.map(it => ({
        x: it.transform[4], y: it.transform[5], str: it.str,
      })), 4);
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

  /* ---------- OCR (dengan posisi kata) ---------- */

  /**
   * Pra-proses gambar agar OCR jauh lebih akurat: perbesar (min lebar 2200 px),
   * ubah ke skala abu-abu, lalu binarisasi dengan ambang Otsu.
   */
  async function preprocessForOcr(fileOrBlob, binarize) {
    const img = await createImageBitmap(fileOrBlob);
    const scale = Math.max(1, 2600 / img.width);
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * scale);
    cv.height = Math.round(img.height * scale);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cv.width, cv.height);

    const d = ctx.getImageData(0, 0, cv.width, cv.height);
    const px = d.data;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < px.length; i += 4) {
      const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
      px[i] = g;
      hist[g]++;
    }
    if (!binarize) {
      // grayscale saja — untuk foto dengan pencahayaan tidak merata,
      // thresholding diserahkan ke Tesseract (adaptif per area)
      for (let i = 0; i < px.length; i += 4) {
        px[i + 1] = px[i + 2] = px[i];
        px[i + 3] = 255;
      }
      ctx.putImageData(d, 0, 0);
      return new Promise(r => cv.toBlob(r, 'image/png'));
    }
    // ambang Otsu
    const total = px.length / 4;
    let sumAll = 0;
    for (let t = 0; t < 256; t++) sumAll += t * hist[t];
    let sumB = 0, wB = 0, maxVar = 0, thr = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sumAll - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > maxVar) { maxVar = v; thr = t; }
    }
    for (let i = 0; i < px.length; i += 4) {
      const v = px[i] > thr ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
    ctx.putImageData(d, 0, 0);
    return new Promise(r => cv.toBlob(r, 'image/png'));
  }

  async function ocrImage(fileOrBlob, binarize) {
    await loadScript(TESSERACT_URL);
    const worker = await window.Tesseract.createWorker('ind', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          setProgress('Membaca teks (OCR)… ' + Math.round(m.progress * 100) + '%', 0.2 + m.progress * 0.8);
        }
      },
    });
    try {
      const prepared = await preprocessForOcr(fileOrBlob, binarize !== false).catch(() => fileOrBlob);
      // Tesseract.js v5 tidak lagi mengembalikan data.lines secara default —
      // struktur baris/kata harus diminta lewat parameter output `blocks`.
      const { data } = await worker.recognize(prepared, {}, { text: true, blocks: true });

      const ocrLines = [];
      if (Array.isArray(data.lines) && data.lines.length) {
        ocrLines.push(...data.lines); // kompatibilitas v2–v4
      } else if (Array.isArray(data.blocks)) {
        data.blocks.forEach(b => (b.paragraphs || []).forEach(pg =>
          (pg.lines || []).forEach(l => ocrLines.push(l))));
      }

      // susun baris dari kata + posisinya; Y dibalik agar konsisten dengan PDF (atas = besar)
      const words = [];
      ocrLines.forEach(line => {
        (line.words || []).forEach(w => {
          if (w.bbox) words.push({ x: w.bbox.x0, y: -((w.bbox.y0 + w.bbox.y1) / 2), str: w.text });
        });
      });
      if (words.length) {
        const heights = ocrLines.filter(l => l.bbox).map(l => l.bbox.y1 - l.bbox.y0).sort((a, b) => a - b);
        const tol = Math.max(8, (heights[Math.floor(heights.length / 2)] || 20) * 0.6);
        return groupLines(words, tol);
      }
      // fallback: teks polos tanpa posisi
      return (data.text || '').split(/\r?\n/).map(t => ({
        items: [{ x: 0, str: t }],
      }));
    } finally {
      await worker.terminate();
    }
  }

  /* ---------- parser Kartu Keluarga ---------- */

  const REL_PATTERNS = [
    { re: /KEPALA/i, rel: 'kepala' }, // cukup "KEPALA" — footer dinas sudah difilter
    { re: /\bISTERI\b|\bISTRI\b/i, rel: 'istri' },
    { re: /\bSUAMI\b/i, rel: 'suami' },
    { re: /\bANAK\b/i, rel: 'anak' },
    { re: /CUCU|MENANTU|ORANG\s*TUA|MERTUA|FAMILI|LAINNYA/i, rel: 'lainnya' },
  ];

  function cleanName(s) {
    const t = String(s || '').replace(/\s{2,}/g, ' ').trim();
    return (t === '-' || t === '' || /^[-.\s]+$/.test(t)) ? '' : t;
  }

  function parseKK(positioned) {
    const textLines = positioned.map(l => l.items.map(i => i.str).join(' ').trim());
    const rows = [];      // hasil per anggota
    const byNum = new Map(); // nomor baris KK → row
    const seenNik = new Set();

    // OCR sering salah membaca digit NIK (O↔0, l/I↔1, dst.) — perbaiki hanya
    // pada deretan panjang yang jelas dimaksudkan sebagai angka.
    const fixDigitRun = s => s.replace(/[0-9OoQDlI|Ss]{15,20}/g, run => {
      const mapped = run.replace(/[OoQD]/g, '0').replace(/[lI|]/g, '1').replace(/[Ss]/g, '5');
      return /^\d+$/.test(mapped) ? mapped : run;
    });

    /* --- tabel 1: biodata (jangkar NIK 15–17 digit, toleran salah baca) --- */
    textLines.forEach(line => {
      const compact = fixDigitRun(line.replace(/(\d)\s+(?=\d)/g, '$1'));
      const nikMatch = compact.match(/\b(\d{15,17})\b/);
      if (!nikMatch) return;
      const nik = nikMatch[1].slice(0, 16);
      if (seenNik.has(nik)) return;

      const beforeNik = compact.slice(0, compact.indexOf(nik));
      const numMatch = beforeNik.match(/^\s*(\d{1,2})\s+/);
      const hasRowNum = numMatch !== null;
      const rowNum = numMatch ? Number(numMatch[1]) : rows.length + 1;

      let name = (beforeNik.match(/[A-Za-z][A-Za-z'.,\s]{2,}/g) || []).join(' ')
        .replace(/^\s*\d+\s*/, '').replace(/\s{2,}/g, ' ').trim();

      let gender = '';
      if (/PEREMPUAN|WANITA/i.test(line)) gender = 'P';
      else if (/LAKI/i.test(line)) gender = 'L';

      let birth = '';
      const dm = compact.match(/\b(\d{2})[-\/](\d{2})[-\/](\d{4})\b/);
      if (dm) birth = `${dm[3]}-${dm[2]}-${dm[1]}`;

      let birthPlace = '';
      const afterNik = compact.slice(compact.indexOf(nik) + 16);
      const placeMatch = afterNik.replace(/LAKI[- ]*LAKI|PEREMPUAN|WANITA/ig, '|')
        .split('|').map(s => s.trim()).filter(Boolean)[0] || '';
      const pm = placeMatch.match(/^[A-Za-z][A-Za-z\s.]{2,30}/);
      if (pm) birthPlace = pm[0].replace(/\b\d.*$/, '').trim();

      if (name.length < 3 || /^NO[.:]?$/i.test(name)) name = '';
      // nomor Kartu Keluarga di header juga 16 digit — bedanya: baris anggota
      // selalu punya isi kolom lain SETELAH NIK (JK, tempat/tgl lahir, dst.),
      // sedangkan baris "No. xxxx" berhenti di angkanya.
      const tail = compact.slice(compact.indexOf(nik) + nik.length).replace(/[^A-Za-z0-9]/g, '');
      if (!gender && !birth && tail.length < 4 && !(hasRowNum && name !== '')) return;
      if (!name && !gender && !birth) return;
      seenNik.add(nik);
      const row = {
        full_name: name, nik, gender, birth_place: birthPlace, birth_date: birth,
        relation: '', father_name: '', mother_name: '', marriage_date: '',
      };
      rows.push(row);
      byNum.set(rowNum, row);
    });

    /* --- cadangan: NIK tak terbaca sama sekali (foto kurang jelas) —
           deteksi baris anggota dari kata LAKI-LAKI / PEREMPUAN --- */
    if (rows.length === 0) {
      textLines.forEach(line => {
        const gm = line.match(/LAKI[- ]?LAKI|PEREMPUAN|WANITA/i);
        if (!gm) return;
        const before = line.slice(0, gm.index);
        let name = (before.match(/[A-Za-z][A-Za-z'.,\s]{2,}/g) || []).join(' ')
          .replace(/^\s*\d+\s*/, '').replace(/\s{2,}/g, ' ').trim();
        name = name.replace(/\b[0-9OolI|]{6,}\b/g, '').replace(/\s{2,}/g, ' ').trim();
        if (name.length < 3) return;
        const gender = /PEREMPUAN|WANITA/i.test(gm[0]) ? 'P' : 'L';
        let birth = '';
        const dm = line.replace(/(\d)\s+(?=\d)/g, '$1').match(/\b(\d{2})[-\/](\d{2})[-\/](\d{4})\b/);
        if (dm) birth = `${dm[3]}-${dm[2]}-${dm[1]}`;
        const row = {
          full_name: name, nik: '', gender, birth_place: '', birth_date: birth,
          relation: '', father_name: '', mother_name: '', marriage_date: '',
        };
        rows.push(row);
        byNum.set(rows.length, row);
      });
    }

    /* --- tabel 2: status hubungan + nama orang tua --- */
    // posisi kolom Ayah/Ibu dari baris header ("Ayah"/"Ibu" atau "(16)"/"(17)")
    let ayahX = null, ibuX = null;
    for (const line of positioned) {
      const p16 = line.items.find(i => i.str.trim() === '(16)');
      const p17 = line.items.find(i => i.str.trim() === '(17)');
      if (p16 && p17) { ayahX = p16.x; ibuX = p17.x; break; }
    }
    if (ayahX === null) {
      for (const line of positioned) {
        const a = line.items.find(i => /^Ayah$/i.test(i.str.trim()));
        const b = line.items.find(i => /^Ibu$/i.test(i.str.trim()));
        if (a && b) { ayahX = a.x; ibuX = b.x; break; }
      }
    }

    const STATUS_RE = /KAWIN|CERAI|BELUM|TERCA/i;
    // kumpulkan baris tabel status dulu; pemetaan ke anggota memakai nomor
    // baris bila terbaca, atau urutan kemunculan bila tidak (umum pada OCR).
    const statusLines = [];
    positioned.forEach(line => {
      const text = line.items.map(i => i.str).join(' ');
      let rel = '';
      for (const rp of REL_PATTERNS) {
        if (rp.re.test(text)) { rel = rp.rel; break; }
      }
      if (!rel && !STATUS_RE.test(text)) return; // bukan baris tabel status
      // jangan tertukar dengan baris tabel 1 (yang ber-NIK)
      if (/\d{15,17}/.test(text.replace(/\s+/g, ''))) return;
      // buang header/footer dokumen yang kebetulan memuat kata kunci
      if (/[:]|DINAS|KEPENDUDUKAN|PENCATATAN|SIPIL|STATUS|HUBUNGAN/i.test(text)) return;
      const numMatch = text.match(/^\s*(\d{1,2})\b/);
      statusLines.push({ line, text, rel, rowNum: numMatch ? Number(numMatch[1]) : null });
    });

    let seq = 0; // fallback pemetaan berurutan
    statusLines.forEach(sl => {
      const { line, text, rel } = sl;
      let row = sl.rowNum !== null ? byNum.get(sl.rowNum) : null;
      if (!row) row = rows[seq];
      seq++;
      if (!row) return;

      if (rel) row.relation = rel;
      const dm = text.match(/\b(\d{2})[-\/](\d{2})[-\/](\d{4})\b/);
      if (dm) row.marriage_date = `${dm[3]}-${dm[2]}-${dm[1]}`;

      // nama ayah & ibu: buang item yang merupakan isi kolom lain (status kawin,
      // hubungan, kewarganegaraan, tanggal), sisanya diklasifikasikan ke kolom
      // terdekat (header Ayah vs Ibu); tanpa posisi → tebak kata terakhir.
      const knownPhrase = new RegExp(
        '^(\\d{1,2}|-|WNI|WNA' +
        '|(BELUM\\s+)?KAWIN(\\s+(BELUM\\s+)?TERCATAT)?|TERCATAT|CERAI(\\s+(HIDUP|MATI))?|HIDUP|MATI' +
        '|KEPALA(\\s+KELUARGA)?|KELUARGA|ISTRI|ISTERI|SUAMI|ANAK|CUCU|MENANTU' +
        '|ORANG(\\s+TUA)?|TUA|MERTUA|FAMILI(\\s+LAIN)?|LAINNYA' +
        '|\\d{2}[-\\/]\\d{2}[-\\/]\\d{4})$', 'i');
      const knownToken = /^(\d{1,2}|-|WNI|WNA|KAWIN|TERCATAT|BELUM|CERAI|HIDUP|MATI|KEPALA|KELUARGA|ISTRI|ISTERI|SUAMI|ANAK|CUCU|MENANTU|ORANG|TUA|MERTUA|FAMILI|LAIN(NYA)?|\d{2}[-\/]\d{2}[-\/]\d{4})$/i;

      // nama pada KK selalu huruf kapital — item bercampur huruf kecil adalah
      // sisa kolom lain yang salah baca OCR, jangan dijadikan nama orang tua.
      const nameItems = line.items.filter(i => {
        const t = i.str.replace(/\s{2,}/g, ' ').trim();
        return t && !knownPhrase.test(t) && /^[A-Z][A-Z'.\s-]{2,}$/.test(t);
      });
      if (!nameItems.length) return;

      if (ayahX !== null && ibuX !== null && line.items.length > 2) {
        const ayahParts = [], ibuParts = [];
        nameItems.forEach(i => {
          (Math.abs(i.x - ayahX) <= Math.abs(i.x - ibuX) ? ayahParts : ibuParts).push(i.str);
        });
        row.father_name = cleanName(ayahParts.join(' ')) || row.father_name;
        row.mother_name = cleanName(ibuParts.join(' ')) || row.mother_name;
      } else {
        // fallback tanpa posisi: buang token kolom lain, kata terakhir = ibu
        const wordsAll = nameItems.map(i => i.str).join(' ').split(/\s+/)
          .filter(w => !knownToken.test(w));
        if (wordsAll.length >= 2) {
          row.mother_name = cleanName(wordsAll.pop());
          row.father_name = cleanName(wordsAll.join(' '));
        } else {
          row.father_name = cleanName(wordsAll.join(' '));
        }
      }
    });

    /* --- default --- */
    rows.forEach((r, i) => {
      if (!r.relation) r.relation = i === 0 ? 'kepala' : 'anak';
      if (!r.gender) {
        if (r.relation === 'istri') r.gender = 'P';
        else r.gender = 'L';
      }
    });
    // urutan anak mengikuti urutan baris pada KK (anak ke-1, ke-2, ...)
    let anakKe = 0;
    rows.forEach(r => {
      if (r.relation === 'anak') r.birth_order = ++anakKe;
    });

    return rows;
  }

  /* ---------- tabel review ---------- */

  const tbody = document.getElementById('review-rows');

  function rowTemplate(r) {
    r = r || {
      full_name: '', nik: '', gender: 'L', birth_place: '', birth_date: '',
      relation: 'anak', father_name: '', mother_name: '', marriage_date: '',
      birth_order: '', is_deceased: 0, death_date: '',
    };
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
      <td><input type="number" data-f="birth_order" value="${esc(r.birth_order)}" min="1" max="99" placeholder="-" style="width:58px"></td>
      <td class="col-name"><input type="text" data-f="father_name" value="${esc(r.father_name)}" placeholder="Nama ayah"></td>
      <td class="col-name"><input type="text" data-f="mother_name" value="${esc(r.mother_name)}" placeholder="Nama ibu"></td>
      <td class="col-dead">
        <label class="checkbox-line" style="margin:0 0 4px"><input type="checkbox" data-f="is_deceased"${Number(r.is_deceased) ? ' checked' : ''}> Ya</label>
        <input type="date" data-f="death_date" value="${esc(r.death_date)}" title="Tanggal meninggal (opsional)">
      </td>
      <td><input type="hidden" data-f="marriage_date" value="${esc(r.marriage_date)}"><button class="row-remove" title="Hapus baris">&times;</button></td>`;
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
      const deadCb = tr.querySelector('[data-f="is_deceased"]');
      const row = {
        full_name: get('full_name'),
        nik: get('nik'),
        gender: get('gender'),
        birth_place: get('birth_place'),
        birth_date: get('birth_date'),
        relation: get('relation'),
        birth_order: Number(get('birth_order')) || null,
        father_name: get('father_name'),
        mother_name: get('mother_name'),
        marriage_date: get('marriage_date'),
        is_deceased: deadCb && deadCb.checked ? 1 : 0,
        death_date: get('death_date'),
      };
      if (row.full_name) rows.push(row);
    }
    if (!rows.length) { alert('Isi minimal satu baris dengan nama.'); return; }

    const btn = document.getElementById('review-import');
    btn.disabled = true;
    try {
      const r = await api.post('api/import.php', { tree_id: window.TREE_ID, rows });
      modal.classList.remove('open');
      let msg = 'Import selesai: ' + r.created + ' anggota baru';
      if (r.matched > 0) msg += ', ' + r.matched + ' dicocokkan dengan anggota yang sudah ada';
      if (r.parents_created > 0) msg += ', ' + r.parents_created + ' orang tua baru dibuat';
      if (r.parents_matched > 0) msg += ', ' + r.parents_matched + ' orang tua terhubung otomatis';
      alert(msg + '.');
      await window.SilsilahApp.loadData(false);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // untuk pengujian otomatis
  window.KKImport = { handleFile, parseKK };
})();
