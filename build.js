'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
// Minimum: Chrome 89 (2021), Firefox 78 ESR (2020), Safari 14.1 (2021)
const TARGET = ['chrome89', 'firefox78', 'safari14'];

const VENDOR = [
  ['node_modules/colorthief/dist/umd/color-thief.global.js', 'vendor/color-thief.global.js'],
  ['node_modules/jspdf/dist/jspdf.umd.min.js', 'vendor/jspdf.umd.min.js'],
];

const HTML_REWRITES = [
  ['node_modules/colorthief/dist/umd/color-thief.global.js', 'vendor/color-thief.global.js'],
  ['node_modules/jspdf/dist/jspdf.umd.min.js', 'vendor/jspdf.umd.min.js'],
];

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

async function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'vendor'), { recursive: true });

  const css = await esbuild.build({
    entryPoints: [path.join(ROOT, 'style.css')],
    bundle: true,
    minify: true,
    write: false,
    target: TARGET,
    legalComments: 'none',
  });
  fs.writeFileSync(path.join(DIST, 'style.css'), css.outputFiles[0].contents);

  const js = await esbuild.build({
    entryPoints: [path.join(ROOT, 'app.js')],
    bundle: true,
    minify: true,
    write: false,
    format: 'iife',
    target: TARGET,
    legalComments: 'none',
  });
  fs.writeFileSync(path.join(DIST, 'app.js'), js.outputFiles[0].contents);

  for (const [from, to] of VENDOR) {
    const src = path.join(ROOT, from);
    if (!fs.existsSync(src)) throw new Error('vendor missing: ' + from);
    fs.copyFileSync(src, path.join(DIST, to));
  }

  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const [from, to] of HTML_REWRITES) html = html.split(from).join(to);
  fs.writeFileSync(path.join(DIST, 'index.html'), html);

  const files = [];
  (function walk(dir, prefix) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) walk(p, rel);
      else files.push([rel, fs.statSync(p).size]);
    }
  })(DIST, '');

  console.log('build OK -> dist/');
  for (const [f, s] of files) console.log('  ' + f.padEnd(32) + kb(s));
}

build().catch((e) => {
  console.error('BUILD FAILED:', e.message || e);
  process.exit(1);
});
