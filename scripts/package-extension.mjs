/**
 * 打 PicPuck 扩展 ZIP（供上架或分发；不含 node_modules / 开发文件）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const outPath = path.join(distDir, 'picpuck-extension.zip');

const entries = [
  { from: path.join(root, 'manifest.json'), name: 'manifest.json' },
  { from: path.join(root, 'background.js'), name: 'background.js' },
  { dir: path.join(root, 'icons'), name: 'icons' },
  { dir: path.join(root, 'src'), name: 'src' },
];

for (const e of entries) {
  if (e.from && !fs.existsSync(e.from)) {
    console.error('Missing required file:', e.from);
    process.exit(1);
  }
  if (e.dir && !fs.existsSync(e.dir)) {
    console.error('Missing required directory:', e.dir);
    process.exit(1);
  }
}

fs.mkdirSync(distDir, { recursive: true });
if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

const output = createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.on('warning', (err) => {
  if (err.code !== 'ENOENT') throw err;
});
archive.on('error', (err) => {
  throw err;
});

const closed = new Promise((resolve, reject) => {
  output.on('close', resolve);
  output.on('error', reject);
});
archive.pipe(output);
for (const e of entries) {
  if (e.from) archive.file(e.from, { name: e.name });
  if (e.dir) archive.directory(e.dir, e.name);
}
await archive.finalize();
await closed;

const bytes = archive.pointer();
console.log('Wrote %s (%s bytes)', outPath, bytes);
