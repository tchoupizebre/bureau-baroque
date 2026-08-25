#!/usr/bin/env node
// Compresse les images >1MB dans assets/motion avant push
// PNG/JPG → qualité réduite, max 2000px de large
// MP4 >100MB → bloque avec un avertissement

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, 'assets', 'motion');
const IMG_MAX_BYTES = 1 * 1024 * 1024; // 1MB
const VID_MAX_BYTES = 95 * 1024 * 1024; // 95MB (limite GitHub = 100MB)
const MAX_DIM = 2000;

async function run() {
  const files = fs.readdirSync(ASSETS_DIR);
  let blocked = [];
  let compressed = [];

  for (const file of files) {
    const fp = path.join(ASSETS_DIR, file);
    const stat = fs.statSync(fp);
    const ext = path.extname(file).toLowerCase();

    if (['.mp4', '.webm', '.mov'].includes(ext)) {
      if (stat.size > VID_MAX_BYTES) {
        blocked.push({ file, size: (stat.size / 1024 / 1024).toFixed(1) + 'MB' });
      }
      continue;
    }

    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) continue;
    if (stat.size <= IMG_MAX_BYTES) continue;

    const sizeBefore = (stat.size / 1024 / 1024).toFixed(1);
    try {
      const img = sharp(fp);
      const meta = await img.metadata();
      const needsResize = meta.width > MAX_DIM || meta.height > MAX_DIM;

      let pipeline = needsResize ? img.resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true }) : img;

      if (ext === '.png') pipeline = pipeline.png({ compressionLevel: 9, quality: 80 });
      else if (['.jpg', '.jpeg'].includes(ext)) pipeline = pipeline.jpeg({ quality: 80 });
      else if (ext === '.webp') pipeline = pipeline.webp({ quality: 80 });

      const buf = await pipeline.toBuffer();
      fs.writeFileSync(fp, buf);

      const sizeAfter = (buf.length / 1024 / 1024).toFixed(1);
      compressed.push({ file, sizeBefore: sizeBefore + 'MB', sizeAfter: sizeAfter + 'MB' });
    } catch (e) {
      console.error('Erreur sur ' + file + ':', e.message);
    }
  }

  if (compressed.length) {
    console.log('\n✓ Images compressées :');
    compressed.forEach(c => console.log('  ' + c.file + ' : ' + c.sizeBefore + ' → ' + c.sizeAfter));
    console.log('\n  Ajoute les fichiers modifiés au commit :');
    console.log('  git add assets/motion/ && git commit -m "compress: images optimisées"\n');
  }

  if (blocked.length) {
    console.error('\n✗ Vidéos trop lourdes pour GitHub (>95MB) :');
    blocked.forEach(b => console.error('  ' + b.file + ' : ' + b.size));
    console.error('\n  → Compresse avec ffmpeg ou héberge sur YouTube/Vimeo\n');
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
