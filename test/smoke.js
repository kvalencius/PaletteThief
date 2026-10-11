'use strict';

/* Smoke test PP48 — Palette Thief
   pemakaian:
     node test/smoke.js         -> uji index.html (root)
     node test/smoke.js dist    -> uji dist/index.html (hasil build)
*/

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SUB = process.argv[2] || '';
const APP = 'file:///' + path.join(ROOT, SUB, 'index.html').split(path.sep).join('/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TMP = 'C:\\Users\\sopen\\AppData\\Local\\Temp\\opencode';
const DL = path.join(TMP, 'dl-' + (SUB || 'root'));
const IMG = path.join(TMP, 'test-image.png');
const TAG = SUB || 'root';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function magicOf(file) {
  const b = fs.readFileSync(file);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.slice(0, 4).toString('latin1') === '%PDF') return 'pdf';
  return 'unknown';
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const results = [];
function check(name, ok, extra) {
  results.push([name, ok]);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  (' + extra + ')' : ''));
}

(async () => {
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });

  // gambar uji berwarna
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('about:blank');
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 600;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 900, 600);
    g.addColorStop(0, '#e63946'); g.addColorStop(0.5, '#f1c453'); g.addColorStop(1, '#2a9d8f');
    x.fillStyle = g; x.fillRect(0, 0, 900, 600);
    x.fillStyle = '#264653'; x.fillRect(60, 60, 260, 200);
    x.fillStyle = '#e76f51'; x.beginPath(); x.arc(650, 380, 140, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ffffff'; x.fillRect(380, 420, 200, 120);
    x.fillStyle = '#1d3557'; x.fillRect(700, 40, 150, 120);
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(IMG, Buffer.from(dataUrl.split(',')[1], 'base64'));

  console.log('target: ' + APP);
  await page.goto(APP, { waitUntil: 'load' });
  await page.setViewport({ width: 1400, height: 900 });
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

  // 0. semua referensi resource harus bisa di-serve apa adanya (bug deploy Pages)
  const libs = await page.evaluate(() => ({
    nodeModules: [...document.querySelectorAll('script[src], link[href]')].filter((el) =>
      /node_modules/.test(el.getAttribute('src') || el.getAttribute('href') || '')
    ).length,
    colorThief: typeof window.ColorThief !== 'undefined' && typeof window.ColorThief.getPalette === 'function',
    jsPdf: typeof (window.jspdf && window.jspdf.jsPDF) === 'function' || typeof window.jsPDF === 'function',
  }));
  check('tanpa rujukan node_modules', libs.nodeModules === 0, 'jumlah: ' + libs.nodeModules);
  check('ColorThief + jsPDF termuat', libs.colorThief && libs.jsPdf, JSON.stringify(libs));

  // 0b. palet placeholder tampil sebelum ada gambar
  const placeholders = await page.$$eval('.palette-list .chip-empty .chip-hex', (n) => n.map((e) => e.textContent.trim()));
  check('palet placeholder #------ sebelum upload', placeholders.length === 5 && placeholders.every((t) => t === '#------'), placeholders.join(' '));

  const idleStatus = await page.evaluate(() => ({
    state: document.getElementById('status').dataset.state,
    text: document.getElementById('status-text').textContent,
  }));
  check('status idle menampilkan teks', idleStatus.state === 'idle' && /siap memuat gambar/i.test(idleStatus.text), idleStatus.text);

  const noStatusbar = await page.evaluate(() => !document.querySelector('.statusbar'));
  check('statusbar dipindah dari bawah gambar', noStatusbar);

  // 1. ekspor button harus disabled sebelum ada gambar
  const disabledFirst = await page.$$eval('[data-export]', (n) => n.every((b) => b.disabled));
  check('export disabled saat kosong', disabledFirst);

  const resetDisabledFirst = await page.$eval('#btn-reset', (b) => b.disabled);
  check('tombol reset disabled saat kosong', resetDisabledFirst);

  // 1b. file terlalu besar / tidak kompatibel harus ditolak
  const rejectUpload = async (bytes, name, type) => {
    await page.evaluate(({ bytes, name, type }) => {
      const file = new File([new Uint8Array(bytes)], name, { type });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { bytes, name, type });
    await sleep(200);
    return page.evaluate(() => ({
      state: document.getElementById('status').dataset.state,
      text: document.getElementById('status-text').textContent,
      empty: document.getElementById('empty-state').hidden === false,
    }));
  };

  const big = await rejectUpload(11 * 1024 * 1024, 'huge.png', 'image/png');
  check('file > 10MB ditolak', big.state === 'error' && /besar/i.test(big.text), big.text);

  const pdf = await rejectUpload(64, 'doc.pdf', 'application/pdf');
  check('file bukan gambar ditolak', pdf.state === 'error' && /tidak kompatibel|bukan gambar/i.test(pdf.text), pdf.text);

  const stillEmpty = await page.evaluate(() => !document.getElementById('empty-state').hidden && document.querySelectorAll('.marker').length === 0);
  check('upload gagal tidak merusak state', stillEmpty);

  // 2. load via file input -> 5 chip + 5 marker
  const input = await page.$('#file-input');
  await input.uploadFile(IMG);
  await page.waitForFunction(() => document.querySelectorAll('.palette-list .chip').length === 5 && !document.querySelector('.chip-empty'), { timeout: 15000 });

  const hexes1 = await page.$$eval('.chip-hex', (n) => n.map((e) => e.textContent.trim()));
  const markerCount = await page.$$eval('.marker', (n) => n.length);
  const bad = hexes1.filter((h) => !/^#[0-9A-F]{6}$/.test(h));
  check('5 chip hex valid', hexes1.length === 5 && bad.length === 0, hexes1.join(' '));
  check('5 marker di gambar', markerCount === 5);

  const readyStatus = await page.evaluate(() => ({
    state: document.getElementById('status').dataset.state,
    text: document.getElementById('status-text').textContent,
    dotOnly: document.getElementById('status').classList.contains('dot-only'),
  }));
  check(
    'status header: titik hijau + nama file',
    readyStatus.state === 'ready' &&
      readyStatus.text === 'test-image.png' &&
      !readyStatus.dotOnly &&
      !/warna terdeteksi|×/.test(readyStatus.text),
    JSON.stringify(readyStatus)
  );

  const resetEnabled = await page.$eval('#btn-reset', (b) => !b.disabled);
  check('tombol reset aktif setelah load', resetEnabled);

  const grad = await page.evaluate(() => ({
    css: document.getElementById('grad-css').textContent,
    empty: document.getElementById('grad-preview').classList.contains('is-empty'),
    bg: getComputedStyle(document.getElementById('grad-preview')).backgroundImage,
    copyOn: !document.getElementById('grad-copy').disabled,
  }));
  check(
    'gradient terbentuk dari palet',
    /^linear-gradient\(/.test(grad.css) && !grad.empty && /linear-gradient/.test(grad.bg) && grad.copyOn,
    grad.css
  );

  const enabledAfter = await page.$$eval('[data-export]', (n) => n.every((b) => !b.disabled));
  check('export aktif setelah load', enabledAfter);

  // 3. hover chip -> tooltip + tombol copy
  await page.hover('.chip');
  await sleep(250);
  const tip = await page.evaluate(() => {
    const t = document.getElementById('tooltip');
    return { shown: t.classList.contains('show'), hex: t.querySelector('.tip-hex')?.textContent, copy: !!t.querySelector('.tip-copy') };
  });
  check('tooltip hex + copy button', tip.shown && tip.copy && tip.hex === hexes1[0], JSON.stringify(tip));

  // 4. klik copy -> hex masuk clipboard
  const copied = await page.evaluate(async () => {
    window.__copied = null;
    try { Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true }); } catch (e) {}
    navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); };
    document.querySelector('.chip-copy').click();
    await new Promise((r) => setTimeout(r, 150));
    return window.__copied;
  });
  check('tombol copy menyalin hex', copied === hexes1[0], String(copied));

  // 5. drag marker -> hex berubah live
  const box = await (await page.$('.marker')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 120, { steps: 8 });
  const hexDuringDrag = await page.$eval('.chip-hex', (e) => e.textContent.trim());
  await page.mouse.up();
  await sleep(150);
  const hexes2 = await page.$$eval('.chip-hex', (n) => n.map((e) => e.textContent.trim()));
  check('drag marker mengubah hex live', hexes1[0] !== hexes2[0], hexes1[0] + ' -> ' + hexes2[0]);

  const gradAfterDrag = await page.$eval('#grad-css', (e) => e.textContent);
  check('gradient ikut live saat marker digeser', gradAfterDrag !== grad.css && gradAfterDrag.indexOf(hexes2[0]) >= 0, gradAfterDrag);

  await page.evaluate(() => {
    const s = document.getElementById('grad-angle');
    s.value = '45';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const grad45 = await page.evaluate(() => ({
    css: document.getElementById('grad-css').textContent,
    val: document.getElementById('grad-angle-val').textContent,
  }));
  check('slider sudut mengubah gradient', /linear-gradient\(45deg/.test(grad45.css) && grad45.val === '45°', JSON.stringify(grad45));

  await page.evaluate(() => document.getElementById('grad-copy').click());
  await sleep(250);
  const gradToast = await page.$eval('#toast', (e) => e.textContent);
  check('copy CSS gradient', /tersalin|gagal/i.test(gradToast), gradToast);

  // 5b. reset image -> slot kosong lagi (palet placeholder kembali)
  await page.click('#btn-reset');
  await sleep(300);
  const resetState = await page.evaluate(() => ({
    empty: !document.getElementById('empty-state').hidden,
    markers: document.querySelectorAll('.marker').length,
    placeholders: document.querySelectorAll('.chip-empty').length,
    status: document.getElementById('status').dataset.state,
    statusText: document.getElementById('status-text').textContent,
    exportOff: [...document.querySelectorAll('[data-export]')].every((b) => b.disabled),
    resetOff: document.getElementById('btn-reset').disabled,
    previewSrc: document.getElementById('preview').getAttribute('src'),
    gradEmpty: document.getElementById('grad-preview').classList.contains('is-empty'),
    gradText: document.getElementById('grad-css').textContent,
  }));
  check(
    'reset mengosongkan slot gambar',
    resetState.empty &&
      resetState.markers === 0 &&
      resetState.placeholders === 5 &&
      resetState.status === 'idle' &&
      resetState.exportOff &&
      resetState.resetOff &&
      !resetState.previewSrc &&
      resetState.gradEmpty &&
      /Belum ada warna/.test(resetState.gradText),
    JSON.stringify(resetState)
  );

  // 6. drag & drop file ke jendela
  const b64 = dataUrl.split(',')[1];
  await page.evaluate(() => {
    window.__states = [];
    const el = document.getElementById('status');
    const push = () => {
      const s = el.dataset.state;
      if (window.__states[window.__states.length - 1] !== s) window.__states.push(s);
    };
    push();
    new MutationObserver(push).observe(el, { attributes: true, attributeFilter: ['data-state'] });
  });
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'dropped.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, b64);
  await page.waitForFunction(
    () => document.getElementById('status').dataset.state === 'ready' && !document.querySelector('.chip-empty'),
    { timeout: 15000 }
  );
  const states = await page.evaluate(() => window.__states);
  check(
    'drag & drop memuat ulang gambar',
    states.includes('busy') && states[states.length - 1] === 'ready',
    states.join(' -> ')
  );

  // 7. toggle sidebar
  await page.click('#sidebar-toggle');
  await sleep(350);
  const collapsed = await page.evaluate(() => document.body.classList.contains('sidebar-collapsed'));
  await page.click('#sidebar-toggle');
  await sleep(350);
  check('toggle sidebar', collapsed);

  // 8. export png / jpg / jpeg / pdf
  for (const kind of ['png', 'jpg', 'jpeg', 'pdf']) {
    await page.click(`[data-export="${kind}"]`);
    await sleep(900);
  }
  await sleep(1500);

  const expect = { 'palette.png': 'png', 'palette.jpg': 'jpg', 'palette.jpeg': 'jpg', 'palette.pdf': 'pdf' };
  const files = fs.existsSync(DL) ? fs.readdirSync(DL) : [];
  check('4 file terdownload', files.length >= 4, files.join(', '));
  for (const [name, kind] of Object.entries(expect)) {
    const p = path.join(DL, name);
    const ok = fs.existsSync(p) && magicOf(p) === kind && fs.statSync(p).size > 1500;
    check('magic bytes ' + name, ok, ok ? (fs.statSync(p).size / 1024).toFixed(0) + ' KB' : 'missing/corrupt');
  }

  const pngPath = path.join(DL, 'palette.png');
  if (fs.existsSync(pngPath)) {
    const dim = pngSize(pngPath);
    check('dimensi export wajar', dim.w > 480 && dim.h > 200, dim.w + 'x' + dim.h);
  }

  // 9. screenshot UI + hasil export (untuk verifikasi visual)
  await page.screenshot({ path: path.join(TMP, 'app-' + TAG + '.png') });
  if (fs.existsSync(pngPath)) {
    const v = await browser.newPage();
    await v.setViewport({ width: 1300, height: 950 });
    await v.goto('file:///' + pngPath.split(path.sep).join('/'), { waitUntil: 'load' });
    await sleep(400);
    await v.screenshot({ path: path.join(TMP, 'export-' + TAG + '.png') });
    await v.close();
  }

  check('tanpa error console/page', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log('----');
  console.log('SUKSES ' + (results.length - failed.length) + '/' + results.length + (SUB ? '  [' + SUB + ']' : ''));
  console.log(failed.length ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
