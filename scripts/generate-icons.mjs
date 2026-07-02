import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, '../assets/icons');
const master = join(dir, 'icon-master.png');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];

// Rasterize all PNG sizes — SVG for small sizes (crisper), master PNG for large
for (const size of sizes) {
  const out = join(dir, `icon_${size}.png`);
  const source = size <= 64 ? join(dir, 'icon.svg') : master;
  let pipeline = sharp(source, size <= 64 ? { density: 300 } : undefined)
    .resize(size, size, { fit: 'cover', kernel: size <= 24 ? 'cubic' : 'lanczos3' });
  if (size <= 48) pipeline = pipeline.sharpen({ sigma: 0.8 });
  await pipeline.png({ compressionLevel: 9 }).toFile(out);
  console.log(`  icon_${size}.png`);
}

// icon.png = 512 for general use
await sharp(master).resize(512, 512).png().toFile(join(dir, 'icon.png'));

// Windows ICO (NSIS-compatible BMP entries)
const buf = await pngToIco(join(dir, 'icon_256.png'));
writeFileSync(join(dir, 'icon.ico'), buf);
console.log(`icon.ico (${buf.length} bytes, ${buf.readUInt16LE(4)} sizes)`);
