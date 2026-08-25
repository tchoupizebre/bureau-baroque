#!/usr/bin/env node
// Compresse automatiquement images et vidéos dans assets/motion avant push
// PNG/JPG/WebP >1MB → qualité 80, max 2000px
// MP4 >50MB → re-encode H.264 CRF 28 via ffmpeg-static

const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

const ASSETS_DIR = path.join(__dirname, 'assets', 'motion');
const IMG_MAX_BYTES = 1 * 1024 * 1024;   // 1MB
const VID_MAX_BYTES = 50 * 1024 * 1024;  // 50MB
const MAX_DIM = 2000;

function compressVideo(fp) {
  return new Promise((resolve, reject) => {
    const tmp = fp + '.tmp.mp4';
    ffmpeg(fp)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-crf 28', '-preset fast', '-movflags +faststart', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2'])
      .save(tmp)
      .on('end', () => {
        try { fs.renameSync(tmp, fp); } catch(e) {}
        resolve(fp);
      })
      .on('error', (e) => {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        reject(e);
      });
  });
}

async function run() {
  const files = fs.readdirSync(ASSETS_DIR);
  const compressed = [];
  const errors = [];

  for (const file of files) {
    const fp = path.join(ASSETS_DIR, file);
    const stat = fs.statSync(fp);
    const ext = path.extname(file).toLowerCase();

    // Vidéos
    if (['.mp4', '.webm', '.mov'].includes(ext)) {
      if (stat.size <= VID_MAX_BYTES) continue;
      const sizeBefore = (stat.size / 1024 / 1024).toFixed(1);
      process.stdout.write('  Compression vidéo : ' + file + ' (' + sizeBefore + 'MB)... ');
      try {
        await compressVideo(fp);
        const sizeAfterStat = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
        const sizeAfter = (sizeAfterStat / 1024 / 1024).toFixed(1);
        process.stdout.write(sizeBefore + 'MB → ' + sizeAfter + 'MB ✓\n');
        compressed.push({ file, sizeBefore: sizeBefore + 'MB', sizeAfter: sizeAfter + 'MB' });
      } catch (e) {
        process.stdout.write('ERREUR\n');
        errors.push(file + ': ' + e.message);
      }
      continue;
    }

    // Images
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) continue;
    if (stat.size <= IMG_MAX_BYTES) continue;

    const sizeBefore = (stat.size / 1024 / 1024).toFixed(1);
    try {
      const img = sharp(fp, { failOn: 'none' });
      const meta = await img.metadata();
      const needsResize = meta.width > MAX_DIM || meta.height > MAX_DIM;
      let pipeline = needsResize ? img.resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true }) : img;
      pipeline = pipeline.toColorspace('srgb');

      if (ext === '.png') pipeline = pipeline.png({ compressionLevel: 9, quality: 80 });
      else if (['.jpg', '.jpeg'].includes(ext)) pipeline = pipeline.jpeg({ quality: 80 });
      else if (ext === '.webp') pipeline = pipeline.webp({ quality: 80 });

      const buf = await pipeline.toBuffer();
      fs.writeFileSync(fp, buf);
      const sizeAfter = (buf.length / 1024 / 1024).toFixed(1);
      compressed.push({ file, sizeBefore: sizeBefore + 'MB', sizeAfter: sizeAfter + 'MB' });
    } catch (e) {
      errors.push(file + ': ' + e.message);
    }
  }

  if (compressed.length) {
    console.log('\n✓ Fichiers compressés :');
    compressed.forEach(c => console.log('  ' + c.file + ' : ' + c.sizeBefore + ' → ' + c.sizeAfter));
    console.log('\n  Ajoute au commit : git add assets/motion/ && git commit -m "compress: assets optimisés"\n');
  }

  if (errors.length) {
    console.warn('\n⚠ Avertissements (non bloquants) :');
    errors.forEach(e => console.warn('  ' + e));
  }

  // Bloquer uniquement si une vidéo dépasse encore 95MB après compression
  const stillLarge = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    if (!['.mp4', '.webm', '.mov'].includes(ext)) return false;
    const fp = path.join(ASSETS_DIR, file);
    if (!fs.existsSync(fp)) return false;
    return fs.statSync(fp).size > 95 * 1024 * 1024;
  });
  if (stillLarge.length) {
    console.error('\n✗ Vidéos encore trop lourdes pour GitHub (>95MB) :');
    stillLarge.forEach(f => {
      const s = (fs.statSync(path.join(ASSETS_DIR, f)).size / 1024 / 1024).toFixed(1);
      console.error('  ' + f + ' : ' + s + 'MB — héberge sur YouTube/Vimeo');
    });
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
