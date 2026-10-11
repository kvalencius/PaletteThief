'use strict';

/* Compat test lintas browser (Chromium & Firefox)
   pemakaian:
     node test/compat.js <label> <exePath> [root|dist]

   contoh:
     node test/compat.js chrome "C:\Program Files\Google\Chrome\Application\chrome.exe"
     node test/compat.js firefox "C:\...\firefox.exe" dist
*/

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LABEL = process.argv[2] || 'chrome';
const EXE = process.argv[3] || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SUB = process.argv[4] || '';
const APP = 'file:///' + path.join(ROOT, SUB, 'index.html').split(path.sep).join('/');
const TMP = 'C:\\Users\\sopen\\AppData\\Local\\Temp\\opencode';
const DL = path.join(TMP, 'dl-compat-' + LABEL.replace(/[^\w-]/g, ''));
const IMG = path.join(TMP, 'compat-image.png');

const isFirefox = /firefox/i.test(LABEL) || /firefox/i.test(EXE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, extra) {
  results.push([name, ok]);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  (' + extra + ')' : ''));
}

(async () => {
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: EXE,
    headless: true,
    ...(isFirefox ? { browser: 'firefox' } : { args: ['--no-sandbox'] }),
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // gambar uji
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
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(IMG, Buffer.from(dataUrl.split(',')[1], 'base64'));

  console.log('target: ' + APP + '  [' + LABEL + (isFirefox ? ' · firefox' : ' · chromium') + ']');
  await page.goto(APP, { waitUntil: 'load' });
  await page.setViewport({ width: 1400, height: 900 });
  if (!isFirefox) {
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  }

  // 1. palet placeholder + status idle
  const placeholders = await page.$$eval('.palette-list .chip-empty .chip-hex', (n) => n.map((e) => e.textContent.trim()));
  check('placeholder #------ sebelum upload', placeholders.length === 5 && placeholders.every((t) => t === '#------'), placeholders.join(' '));
  const idle = await page.$eval('#status', (e) => e.dataset.state + '|' + e.textContent.trim());
  check('status idle', /^idle\|Siap memuat gambar/.test(idle), idle);
  const resetOff = await page.$eval('#btn-reset', (b) => b.disabled);
  check('reset disabled saat kosong', resetOff);

  // 2. upload valid
  const input = await page.$('#file-input');
  await input.uploadFile(IMG);
  await page.waitForFunction(
    () => document.querySelectorAll('.palette-list .chip').length === 5 && !document.querySelector('.chip-empty'),
    { timeout: 20000 }
  );
  const hexes = await page.$$eval('.chip-hex', (n) => n.map((e) => e.textContent.trim()));
  const markers = await page.$$eval('.marker', (n) => n.length);
  const badHex = hexes.filter((h) => !/^#[0-9A-F]{6}$/.test(h));
  check('5 hex valid', hexes.length === 5 && badHex.length === 0, hexes.join(' '));
  check('5 marker', markers === 5);
  const ready = await page.evaluate(() => ({
    state: document.getElementById('status').dataset.state,
    text: document.getElementById('status-text').textContent,
    exportOn: [...document.querySelectorAll('[data-export]')].every((b) => !b.disabled),
    resetOn: !document.getElementById('btn-reset').disabled,
  }));
  check('status ready + nama file', ready.state === 'ready' && /compat-image\.png/.test(ready.text), ready.text);
  check('export & reset aktif', ready.exportOn && ready.resetOn);

  const grad = await page.evaluate(() => ({
    css: document.getElementById('grad-css').textContent,
    empty: document.getElementById('grad-preview').classList.contains('is-empty'),
  }));
  check('gradient dari palet', /^linear-gradient\(/.test(grad.css) && !grad.empty, grad.css);

  // 3. tooltip saat hover chip
  await page.hover('.chip');
  await sleep(300);
  const tip = await page.evaluate(() => {
    const t = document.getElementById('tooltip');
    return { shown: t.classList.contains('show'), hex: (t.querySelector('.tip-hex') || {}).textContent, copy: !!t.querySelector('.tip-copy') };
  });
  check('tooltip hex + copy', tip.shown && tip.copy && tip.hex === hexes[0], JSON.stringify(tip));

  // 4. klik copy -> toast muncul (clipboard / fallback execCommand)
  await page.evaluate(() => document.querySelector('.chip-copy').click());
  await sleep(300);
  const toastText = await page.$eval('#toast', (e) => e.textContent);
  check('toast setelah copy', /Tersalin|Gagal/.test(toastText), toastText);

  // 5. drag marker -> hex berubah
  const box = await (await page.$('.marker')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 120, { steps: 8 });
  await page.mouse.up();
  await sleep(200);
  const hexes2 = await page.$$eval('.chip-hex', (n) => n.map((e) => e.textContent.trim()));
  check('drag marker mengubah hex', hexes[0] !== hexes2[0], hexes[0] + ' -> ' + hexes2[0]);

  const gradAfter = await page.$eval('#grad-css', (e) => e.textContent);
  check('gradient ikut live saat marker digeser', gradAfter !== grad.css && gradAfter.indexOf(hexes2[0]) >= 0, gradAfter);

  // 6. drag & drop ke jendela
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'dropped.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, dataUrl.split(',')[1]);
  await page.waitForFunction(() => document.getElementById('status-text').textContent.indexOf('dropped.png') >= 0, { timeout: 20000 });
  check('drag & drop memuat ulang', true, 'dropped.png');

  // 7. file tidak valid ditolak
  await page.evaluate(() => {
    const file = new File([new Uint8Array(11 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const inp = document.getElementById('file-input');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(300);
  const err = await page.evaluate(() => ({
    state: document.getElementById('status').dataset.state,
    text: document.getElementById('status-text').textContent,
  }));
  check('file > 10MB ditolak', err.state === 'error' && /besar/i.test(err.text), err.text);

  // 8. reset -> placeholder kembali
  await page.click('#btn-reset');
  await sleep(300);
  const afterReset = await page.evaluate(() => ({
    empty: !document.getElementById('empty-state').hidden,
    ph: document.querySelectorAll('.chip-empty').length,
    status: document.getElementById('status').dataset.state,
    exportOff: [...document.querySelectorAll('[data-export]')].every((b) => b.disabled),
  }));
  check('reset mengosongkan slot', afterReset.empty && afterReset.ph === 5 && afterReset.status === 'idle' && afterReset.exportOff, JSON.stringify(afterReset));

  // 9. export PNG: Chromium verifikasi file, Firefox verifikasi tanpa error
  const input2 = await page.$('#file-input');
  await input2.uploadFile(IMG);
  await page.waitForFunction(() => !document.getElementById('btn-reset').disabled, { timeout: 20000 });
  const exportErr = [];
  const onErr = (e) => exportErr.push(e.message);
  page.on('pageerror', onErr);
  await page.click('[data-export="png"]');
  await sleep(2000);
  page.off('pageerror', onErr);
  if (isFirefox) {
    check('export png tanpa error', exportErr.length === 0, exportErr.join(' | '));
  } else {
    const files = fs.existsSync(DL) ? fs.readdirSync(DL) : [];
    check('export png menghasilkan file', files.some((f) => /^palette\.png/.test(f)), files.join(', '));
  }

  check('tanpa error console/page', errors.length === 0, errors.join(' | '));

  await page.screenshot({ path: path.join(TMP, 'compat-' + LABEL.replace(/[^\w-]/g, '') + '.png') });
  await browser.close();

  const failed = results.filter(([, ok]) => !ok);
  console.log('----');
  console.log('SUKSES ' + (results.length - failed.length) + '/' + results.length + '  [' + LABEL + ']');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e && e.message ? e.message : e);
  process.exit(1);
});
