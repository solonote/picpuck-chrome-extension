/**
 * CP0-2：扫描 src/core 下 .js，禁止出现指向 agents 的静态 import。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const coreDir = path.join(root, 'src', 'core');

const AGENT_IMPORT_RE = /\bfrom\s+['"][^'"]*\/agents\/|import\s+['"][^'"]*\/agents\//;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

let failed = false;
for (const file of walk(coreDir)) {
  const text = fs.readFileSync(file, 'utf8');
  if (AGENT_IMPORT_RE.test(text)) {
    console.error('[CP0-2 FAIL]', path.relative(root, file), 'contains agents import');
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('[CP0-2 OK] no core -> agents static import');
