# PaletteThief

Ekstraktor palet warna dari gambar, jalan sepenuhnya di browser. Seret & letakkan gambar (atau klik area tengah) → 5 warna dominan terdeteksi, masing-masing punya marker yang bisa digeser ke spot mana pun di gambar, lalu paletnya bisa di-copy atau di-export.

## Fitur

- Upload lewat area tengah atau drag & drop ke jendela
- 5 warna dominan + marker draggable (hex ikut berubah real-time saat digeser)
- Palet placeholder `#------` selalu tampil sebelum ada gambar
- Validasi file: maksimal 10 MB, format raster (PNG/JPG/GIF/WebP/BMP/AVIF/TIFF)
- Tombol **Reset Gambar** untuk mengosongkan slot dan ganti gambar
- Status ringkas di header (titik hijau + nama file)
- Export ke PNG / JPG / JPEG / PDF

## Menjalankan lokal

```bash
npm install
npm run build      # hasil build di dist/
npm test           # smoke test root (butuh Chrome di path default)
npm run test:dist  # smoke test hasil build
```

Buka `index.html` untuk versi dev, atau `dist/index.html` untuk hasil build.

## Deploy (GitHub Pages)

Workflow di `.github/workflows/deploy.yml` akan build dan deploy otomatis ke GitHub Pages setiap push ke `main`:

1. Buka repo → **Settings** → **Pages** → **Source** pilih **GitHub Actions**
2. Push perubahan ke `main`, pantau di tab **Actions**
3. Site live di `https://kvalencius.github.io/PaletteThief/`

## Stack

Vanilla JS + Canvas · [ColorThief](https://github.com/lokesh/color-thief) · [jsPDF](https://github.com/parallax/jsPDF) · esbuild · smoke test Puppeteer
