(() => {
  'use strict';

  const PALETTE_SIZE = 5;
  const SAMPLE_MAX = 700;
  const MAX_FILE_MB = 10;
  const OK_IMAGE_TYPES = [
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
    'image/bmp', 'image/avif', 'image/tiff', 'image/x-ms-bmp', 'image/x-icon',
  ];
  const OK_IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|tiff?)$/i;

  const COPY_SVG =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const els = {
    fileInput: $('#file-input'),
    emptyState: $('#empty-state'),
    imageWrap: $('#image-wrap'),
    preview: $('#preview'),
    markers: $('#markers'),
    paletteList: $('#palette-list'),
    status: $('#status'),
    statusText: $('#status-text'),
    toast: $('#toast'),
    tooltip: $('#tooltip'),
    overlay: $('#drop-overlay'),
    sidebarToggle: $('#sidebar-toggle'),
    btnReset: $('#btn-reset'),
    exportBtns: $$('[data-export]'),
  };

  const state = {
    palette: [],      // [{ r, g, b, hex, x, y }]  x/y = fraction of image
    sample: null,     // { w, h, data } downscaled pixel buffer
    img: null,
    fileName: '',
    lastGoodSrc: '',
    tipAnchor: null,
    tipHex: '',
    dragDepth: 0,
  };

  /* ===================== HELPERS ===================== */

  const toHex = (r, g, b) =>
    '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('').toUpperCase();

  const relLuminance = (r, g, b) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const textOn = (r, g, b) => (relLuminance(r, g, b) > 0.36 ? '#0d0d0d' : '#ffffff');

  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2000);
  }

  /* Status pill di header (kanan atas). State "ready" sengaja tanpa teks — cukup titik hijau. */
  function setStatus(kind, text) {
    els.status.dataset.state = kind;
    const t = els.statusText;
    t.textContent = text || '';
    t.hidden = !text;
    els.status.classList.toggle('dot-only', !text);
    els.status.title = text || '';
    els.status.setAttribute('aria-label', text || 'Status');
  }

  function copyHex(hex) {
    const done = () => toast('Tersalin: ' + hex);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(hex).then(done, fallback);
    } else {
      fallback();
    }
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = hex;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      ok ? done() : toast('Gagal menyalin');
    }
  }

  /* ===================== TOOLTIP (hex + copy) ===================== */

  function showTip(anchor, hex) {
    state.tipAnchor = anchor;
    state.tipHex = hex;
    els.tooltip.innerHTML =
      '<span class="tip-dot"></span><span class="tip-hex"></span>' +
      '<button class="tip-copy" title="Copy hex" aria-label="Copy hex">' + COPY_SVG + '</button>';
    els.tooltip.querySelector('.tip-copy').addEventListener('click', (e) => {
      e.stopPropagation();
      copyHex(state.tipHex);
    });
    els.tooltip.classList.add('show');
    paintTip(hex);
    positionTip();
  }

  function paintTip(hex) {
    if (!els.tooltip.classList.contains('show')) return;
    els.tooltip.querySelector('.tip-hex').textContent = hex;
    els.tooltip.querySelector('.tip-dot').style.background = hex;
  }

  function positionTip() {
    const a = state.tipAnchor;
    if (!a || !els.tooltip.classList.contains('show')) return;
    const r = a.getBoundingClientRect();
    const t = els.tooltip.getBoundingClientRect();
    let left = r.left + r.width / 2 - t.width / 2;
    let top = r.top - t.height - 10;
    if (top < 8) top = r.bottom + 10;
    left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - t.height - 8));
    els.tooltip.style.left = left + 'px';
    els.tooltip.style.top = top + 'px';
  }

  function hideTip() {
    state.tipAnchor = null;
    els.tooltip.classList.remove('show');
  }

  /* ===================== IMAGE LOADING ===================== */

  function openPicker() {
    els.fileInput.click();
  }

  function failLoad(msg) {
    toast(msg);
    setStatus('error', msg);
  }

  function fileProblem(file) {
    if (!file) return 'Tidak ada file terpilih.';
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return 'File terlalu besar (' + (file.size / (1024 * 1024)).toFixed(1) + ' MB). Maksimal ' + MAX_FILE_MB + ' MB.';
    }
    const type = (file.type || '').toLowerCase();
    if (type === 'image/svg+xml' || /\.svg$/i.test(file.name || '')) {
      return 'Format SVG belum didukung.';
    }
    if (type) {
      if (!OK_IMAGE_TYPES.includes(type)) return 'Format tidak kompatibel: ' + file.type;
    } else if (!OK_IMAGE_EXT.test(file.name || '')) {
      return 'File bukan gambar yang didukung.';
    }
    return null;
  }

  function showBroken(recoverSrc) {
    if (recoverSrc) {
      els.preview.onload = null;
      els.preview.onerror = null;
      els.preview.src = recoverSrc;
    } else {
      state.fileName = '';
      els.imageWrap.hidden = true;
      els.emptyState.hidden = false;
    }
  }

  function loadImage(file) {
    const problem = fileProblem(file);
    if (problem) {
      failLoad(problem);
      return;
    }
    state.fileName = file.name;

    const reader = new FileReader();
    reader.onload = () => {
      const prevSrc = els.preview.getAttribute('src') || state.lastGoodSrc || '';
      els.preview.onload = () => {
        state.lastGoodSrc = reader.result;
        els.emptyState.hidden = true;
        els.imageWrap.hidden = false;
        els.btnReset.disabled = false;
        extractPalette();
      };
      els.preview.onerror = () => {
        showBroken(prevSrc);
        failLoad('Gambar tidak kompatibel atau file rusak.');
      };
      els.preview.src = reader.result;
    };
    reader.onerror = () => failLoad('Gagal membaca file.');
    reader.readAsDataURL(file);
  }

  /* Kosongkan slot: kembali ke empty state + palet placeholder */
  function resetImage() {
    hideTip();
    els.preview.onload = null;
    els.preview.onerror = null;
    els.preview.removeAttribute('src');
    els.markers.innerHTML = '';
    els.imageWrap.hidden = true;
    els.emptyState.hidden = false;
    els.btnReset.disabled = true;
    els.exportBtns.forEach((b) => (b.disabled = true));
    state.palette = [];
    state.sample = null;
    state.fileName = '';
    state.lastGoodSrc = '';
    renderChips();
    setStatus('idle', 'Siap memuat gambar');
    toast('Gambar direset');
  }

  function buildSample(img) {
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    const s = Math.min(1, SAMPLE_MAX / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * s));
    const h = Math.max(1, Math.round(h0 * s));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return { w, h, data: ctx.getImageData(0, 0, w, h).data };
  }

  function sampleAt(fx, fy) {
    const s = state.sample;
    if (!s) return { r: 128, g: 128, b: 128 };
    const x = Math.max(0, Math.min(s.w - 1, Math.round(fx * s.w)));
    const y = Math.max(0, Math.min(s.h - 1, Math.round(fy * s.h)));
    const i = (y * s.w + x) * 4;
    return { r: s.data[i], g: s.data[i + 1], b: s.data[i + 2] };
  }

  function assignColor(entry, r, g, b) {
    entry.r = r;
    entry.g = g;
    entry.b = b;
    entry.hex = toHex(r, g, b);
  }

  function spreadMarkers(palette) {
    // Posisi awal penanda = centroid piksel yang paling mirip dengan tiap warna
    const s = state.sample;
    if (!s || !palette.length) return;
    const acc = palette.map(() => ({ x: 0, y: 0, n: 0 }));
    const step = 2;
    for (let y = 0; y < s.h; y += step) {
      for (let x = 0; x < s.w; x += step) {
        const i = (y * s.w + x) * 4;
        if (s.data[i + 3] < 125) continue;
        const r = s.data[i], g = s.data[i + 1], b = s.data[i + 2];
        let best = 0, bd = Infinity;
        for (let k = 0; k < palette.length; k++) {
          const p = palette[k];
          const d = (p.r - r) ** 2 + (p.g - g) ** 2 + (p.b - b) ** 2;
          if (d < bd) { bd = d; best = k; }
        }
        acc[best].x += x;
        acc[best].y += y;
        acc[best].n++;
      }
    }
    palette.forEach((p, k) => {
      const a = acc[k];
      if (a.n) {
        p.x = Math.min(0.97, Math.max(0.03, (a.x / a.n) / s.w));
        p.y = Math.min(0.97, Math.max(0.03, (a.y / a.n) / s.h));
      } else {
        p.x = (k + 0.5) / palette.length;
        p.y = 0.5;
      }
    });
  }

  async function extractPalette() {
    document.body.classList.add('busy');
    setStatus('busy', 'Menganalisis palet warna…');
    try {
      state.sample = buildSample(els.preview);

      let colors = [];
      try {
        colors = (await ColorThief.getPalette(els.preview, {
          colorCount: PALETTE_SIZE,
          quality: 10,
        })) || [];
      } catch (e) {
        console.error(e);
        colors = [];
      }

      state.palette = [];
      for (let i = 0; i < PALETTE_SIZE; i++) {
        const src = colors[i % Math.max(1, colors.length)];
        const entry = { r: 128, g: 128, b: 128, hex: '#808080', x: (i + 0.5) / PALETTE_SIZE, y: 0.5 };
        if (src) {
          const rgb = typeof src.array === 'function' ? src.array() : [src[0], src[1], src[2]];
          assignColor(entry, rgb[0], rgb[1], rgb[2]);
        }
        state.palette.push(entry);
      }
      if (!colors.length) toast('Palet tidak bisa diekstrak, warna default dipakai');

      spreadMarkers(state.palette);
      renderMarkers();
      renderChips();

      // titik hijau + nama file (tanpa jumlah warna / dimensi)
      const w = els.preview.naturalWidth, h = els.preview.naturalHeight;
      setStatus('ready', state.fileName);
      els.status.title = state.fileName + ' · ' + w + '×' + h + ' px';
      els.status.setAttribute('aria-label', els.status.title);
      els.exportBtns.forEach((b) => (b.disabled = false));
    } catch (e) {
      console.error(e);
      state.palette = [];
      renderChips();
      els.markers.innerHTML = '';
      setStatus('error', 'Gambar gagal dianalisis.');
      toast('Gambar gagal dianalisis');
    } finally {
      document.body.classList.remove('busy');
    }
  }

  /* ===================== MARKERS (draggable di atas gambar) ===================== */

  function renderMarkers() {
    els.markers.innerHTML = '';
    state.palette.forEach((p, i) => {
      const m = document.createElement('div');
      m.className = 'marker';
      m.dataset.i = i;
      m.textContent = String(i + 1);
      paintMarker(m, p);
      positionMarker(m, p);
      attachMarkerBehavior(m, i);
      els.markers.appendChild(m);
    });
  }

  function paintMarker(m, p) {
    m.style.background = p.hex;
    m.style.color = textOn(p.r, p.g, p.b);
    m.title = p.hex;
  }

  function positionMarker(m, p) {
    m.style.left = p.x * 100 + '%';
    m.style.top = p.y * 100 + '%';
  }

  function attachMarkerBehavior(marker, index) {
    marker.addEventListener('pointerenter', () => showTip(marker, state.palette[index].hex));
    marker.addEventListener('pointerleave', () => {
      if (state.draggingIndex == null) hideTip();
    });

    marker.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.draggingIndex = index;
      marker.classList.add('dragging');
      marker.setPointerCapture(e.pointerId);
      showTip(marker, state.palette[index].hex);

      const move = (ev) => {
        const rect = els.imageWrap.getBoundingClientRect();
        const fx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const fy = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
        const p = state.palette[index];
        p.x = fx;
        p.y = fy;
        positionMarker(marker, p);

        const c = sampleAt(fx, fy);
        assignColor(p, c.r, c.g, c.b);
        paintMarker(marker, p);
        updateChip(index);
        paintTip(p.hex); // hex + warna tooltip berubah real-time saat digeser
        positionTip();
      };

      const up = (ev) => {
        marker.releasePointerCapture(ev.pointerId);
        marker.removeEventListener('pointermove', move);
        marker.removeEventListener('pointerup', up);
        marker.removeEventListener('pointercancel', up);
        marker.classList.remove('dragging');
        state.draggingIndex = null;
        hideTip();
      };

      marker.addEventListener('pointermove', move);
      marker.addEventListener('pointerup', up);
      marker.addEventListener('pointercancel', up);
    });
  }

  /* ===================== PALETTE CHIPS (sidebar) ===================== */

  function renderChips() {
    els.paletteList.innerHTML = '';
    const n = state.palette.length || PALETTE_SIZE;
    for (let i = 0; i < n; i++) {
      const p = state.palette[i];
      const chip = document.createElement('div');
      chip.className = p ? 'chip' : 'chip chip-empty';
      chip.dataset.i = i;

      const swatch = document.createElement('span');
      swatch.className = 'chip-swatch';
      const hex = document.createElement('span');
      hex.className = 'chip-hex';
      const copy = document.createElement('button');
      copy.className = 'chip-copy';
      copy.innerHTML = COPY_SVG;

      if (p) {
        chip.addEventListener('mouseenter', () => showTip(chip, state.palette[i].hex));
        chip.addEventListener('mouseleave', () => hideTip());
        copy.title = 'Copy hex';
        copy.setAttribute('aria-label', 'Copy hex');
        copy.addEventListener('click', (e) => {
          e.stopPropagation();
          copyHex(state.palette[i].hex);
        });
      } else {
        hex.textContent = '#------';
        swatch.setAttribute('aria-hidden', 'true');
        copy.disabled = true;
        copy.title = 'Belum ada warna';
        copy.setAttribute('aria-label', 'Belum ada warna');
      }

      chip.append(swatch, hex, copy);
      if (p) paintChip(chip, p);
      els.paletteList.appendChild(chip);
    }
  }

  function paintChip(chip, p) {
    chip.querySelector('.chip-swatch').style.background = p.hex;
    chip.querySelector('.chip-hex').textContent = p.hex;
  }

  function updateChip(index) {
    const chip = els.paletteList.querySelector('.chip[data-i="' + index + '"]');
    if (chip) paintChip(chip, state.palette[index]);
  }

  /* ===================== EXPORT (PNG / JPG / JPEG / PDF) ===================== */

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function buildExportCanvas() {
    const img = els.preview;
    const pad = 40, headH = 56, gap = 14, stripH = 140;
    const maxContentW = 1200, maxImgH = 740;

    const availW = maxContentW - pad * 2;
    const s = Math.min(availW / img.naturalWidth, maxImgH / img.naturalHeight);
    const iw = Math.max(1, Math.round(img.naturalWidth * s));
    const ih = Math.max(1, Math.round(img.naturalHeight * s));
    const contentW = Math.max(iw, 480);

    const W = contentW + pad * 2;
    const H = pad + headH + ih + gap + stripH + pad;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // background
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, W, H);

    // header
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '600 15px "Segoe UI", Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('PALETTE THIEF · PP48', pad, pad + headH / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '400 13px "Segoe UI", Inter, sans-serif';
    ctx.textAlign = 'right';
    const title = state.fileName || 'image';
    ctx.fillText(title.length > 44 ? title.slice(0, 41) + '…' : title, W - pad, pad + headH / 2);

    // image
    const ix = pad + (contentW - iw) / 2;
    const iy = pad + headH;
    ctx.save();
    roundRectPath(ctx, ix, iy, iw, ih, 11);
    ctx.clip();
    ctx.drawImage(img, ix, iy, iw, ih);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, ix + 0.5, iy + 0.5, iw - 1, ih - 1, 11);
    ctx.stroke();

    // palette strip: swatch + hex
    const n = state.palette.length;
    const cellW = (contentW - gap * (n - 1)) / n;
    const sy = iy + ih + gap;
    state.palette.forEach((p, i) => {
      const cx = pad + i * (cellW + gap);
      ctx.fillStyle = p.hex;
      roundRectPath(ctx, cx, sy, cellW, stripH, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      roundRectPath(ctx, cx + 0.5, sy + 0.5, cellW - 1, stripH - 1, 10);
      ctx.stroke();

      ctx.fillStyle = textOn(p.r, p.g, p.b);
      ctx.font = '600 20px "Segoe UI", Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.hex, cx + cellW / 2, sy + stripH / 2);
    });

    return canvas;
  }

  function download(href, name) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function exportRaster(kind) {
    if (!state.palette.length) return;
    try {
      const canvas = buildExportCanvas();
      const isPng = kind === 'png';
      const dataUrl = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.92);
      const ext = kind === 'png' ? 'png' : kind === 'jpg' ? 'jpg' : 'jpeg';
      download(dataUrl, 'palette.' + ext);
      toast('Terexport: palette.' + ext);
    } catch (e) {
      console.error(e);
      toast('Export gagal');
    }
  }

  function exportPDF() {
    if (!state.palette.length) return;
    try {
      const canvas = buildExportCanvas();
      const dataUrl = canvas.toDataURL('image/png');
      const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      if (!jsPDFCtor) {
        toast('Library PDF belum termuat');
        return;
      }
      const pw = canvas.width * 0.75; // px -> pt
      const ph = canvas.height * 0.75;
      const pdf = new jsPDFCtor({
        orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
        unit: 'pt',
        format: [pw, ph],
        compress: true,
      });
      pdf.addImage(dataUrl, 'PNG', 0, 0, pw, ph);
      pdf.save('palette.pdf');
      toast('Terexport: palette.pdf');
    } catch (e) {
      console.error(e);
      toast('Export PDF gagal');
    }
  }

  /* ===================== EVENTS ===================== */

  els.emptyState.addEventListener('click', openPicker);
  els.btnReset.addEventListener('click', resetImage);
  els.fileInput.addEventListener('change', () => {
    loadImage(els.fileInput.files && els.fileInput.files[0]);
    els.fileInput.value = '';
  });

  els.sidebarToggle.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    els.sidebarToggle.classList.toggle('active');
    hideTip();
  });

  els.exportBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.export;
      if (kind === 'pdf') exportPDF();
      else exportRaster(kind);
    });
  });

  // Drag & drop: seluruh jendela + empty state
  function isFileDrag(e) {
    return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  }

  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    state.dragDepth++;
    els.overlay.classList.add('show');
    els.emptyState.classList.add('over');
  });
  window.addEventListener('dragover', (e) => {
    if (isFileDrag(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) {
      els.overlay.classList.remove('show');
      els.emptyState.classList.remove('over');
    }
  });
  window.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    state.dragDepth = 0;
    els.overlay.classList.remove('show');
    els.emptyState.classList.remove('over');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadImage(file);
  });

  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', () => { hideTip(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });

  renderChips();
})();
