// Regenerate checked-in desktop icons with ImageMagick's `convert` installed.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const source = 'resources/antiphon-icon-source.png';
const square = size => [source, '-resize', `${size}x${size}`, '-background', 'none', '-gravity', 'center', '-extent', `${size}x${size}`];
execFileSync('convert', [...square(512), 'resources/icon.png']);
execFileSync('convert', [...square(256), '-define', 'icon:auto-resize=256,128,64,48,32,16', 'resources/icon.ico']);
// Modern ICNS entries contain PNG images at their native resolutions.
const entries = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(([type, size]) => {
  const png = execFileSync('convert', [...square(size), 'png:-']);
  const header = Buffer.alloc(8);
  header.write(type); header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
});
const header = Buffer.alloc(8);
header.write('icns'); header.writeUInt32BE(8 + entries.reduce((sum, entry) => sum + entry.length, 0), 4);
await writeFile('resources/icon.icns', Buffer.concat([header, ...entries]));
