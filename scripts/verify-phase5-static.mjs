/**
 * CP5-6：core + agents 中 executeScript 使用 world: 'MAIN'。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [path.join(root, 'src', 'core'), path.join(root, 'src', 'agents')];

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (n.endsWith('.js')) acc.push(p);
  }
  return acc;
}

const reMain = /world\s*:\s*['"]MAIN['"]/;

for (const dir of dirs) {
  for (const file of walk(dir)) {
    const t = fs.readFileSync(file, 'utf8');
    if (!t.includes('chrome.scripting.executeScript')) continue;
    assert.ok(
      reMain.test(t),
      `${path.relative(root, file)}: executeScript without world MAIN`,
    );
  }
}

console.log('[CP5-6 OK] executeScript uses MAIN');
