/**
 * CP2-1、CP2-2：在内存 DOM 上执行 §9.3 注入函数（无真实 Chrome）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectableAcquireExecSlot } from '../src/core/execSlot/injectableAcquireExecSlot.js';
import * as RT from '../src/core/runtimeMessages.js';

function makeMockWindow() {
  const nodes = new Map();
  class EL {
    constructor(tag) {
      this.tag = tag;
      this.id = '';
      this.parent = null;
      /** @type {EL[]} */
      this.children = [];
      /** @type {Map<string, string>} */
      this.attributes = new Map();
    }
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : '';
    }
    setAttribute(name, v) {
      this.attributes.set(name, String(v));
    }
    appendChild(ch) {
      ch.parent = this;
      this.children.push(ch);
      return ch;
    }
    querySelector(sel) {
      if (sel.includes('data-picpuck-topbar-left')) return this.children.find((c) => c.attributes.has('data-picpuck-topbar-left'));
      if (sel.includes('data-picpuck-topbar-right')) return this.children.find((c) => c.attributes.has('data-picpuck-topbar-right'));
      return null;
    }
  }
  const body = new EL('body');
  const document = {
    body,
    documentElement: body,
    getElementById(id) {
      return nodes.get(id) ?? null;
    },
    createElement(tag) {
      return new EL(tag);
    },
  };
  const origAppend = body.appendChild.bind(body);
  body.appendChild = function (ch) {
    if (ch.id) nodes.set(ch.id, ch);
    return origAppend(ch);
  };
  return { document, nodes, body };
}

function runAcquire(mock) {
  const g = globalThis;
  const prev = g.document;
  g.document = mock.document;
  try {
    return injectableAcquireExecSlot();
  } finally {
    g.document = prev;
  }
}

const m = makeMockWindow();
const r1 = runAcquire(m);
assert.equal(r1.acquired, true);
const topbarEl = m.nodes.get('picpuck-agent-topbar');
assert.ok(topbarEl);
assert.equal(topbarEl.getAttribute('data-picpuck-exec-state'), 'running');

const r2 = runAcquire(m);
assert.equal(r2.acquired, false);
assert.equal(topbarEl.getAttribute('data-picpuck-exec-state'), 'running');

const m2 = makeMockWindow();
runAcquire(m2);
const root2 = m2.nodes.get('picpuck-agent-topbar');
root2.setAttribute('data-picpuck-exec-state', 'weird');
const r3 = runAcquire(m2);
assert.equal(r3.acquired, false);
assert.equal(r3.invalid, true);

console.log('[CP2-1 CP2-2 OK] injectableAcquireExecSlot');

// CP2-4：core 与 content 使用相同字面量
assert.equal(RT.PICPUCK_COMMAND, 'PICPUCK_COMMAND');
assert.equal(RT.LOG_APPEND, 'LOG_APPEND');
assert.equal(RT.ROUND_PHASE, 'ROUND_PHASE');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const contentPath = path.join(repoRoot, 'src', 'content', 'picpuckAgentContent.js');
const contentSrc = fs.readFileSync(contentPath, 'utf8');
for (const s of ['PICPUCK_COMMAND', 'LOG_APPEND', 'ROUND_PHASE']) {
  assert.ok(
    contentSrc.includes(`const ${s} = '${s}'`) || contentSrc.includes(`'${s}'`),
    `content script must reference ${s}`,
  );
}

// CP2-3 CP2-5：core 源码不出现 Tab 池结构名与 exec 态镜像变量名
const coreDir = path.join(repoRoot, 'src', 'core');
function walkCore(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walkCore(p, acc);
    else if (name.endsWith('.js')) acc.push(p);
  }
  return acc;
}
const banned = [/TabRegistry/, /TabSlot/, /workState/];
for (const file of walkCore(coreDir)) {
  const t = fs.readFileSync(file, 'utf8');
  for (const re of banned) {
    assert.ok(!re.test(t), `[CP2-3] banned ${re} in ${path.relative(repoRoot, file)}`);
  }
}
const mirrorBanned = /\b(execState|exec_state)\s*[:=]/;
for (const file of walkCore(coreDir)) {
  const t = fs.readFileSync(file, 'utf8');
  assert.ok(!mirrorBanned.test(t), `[CP2-5] suspected exec-state mirror in ${path.relative(repoRoot, file)}`);
}

console.log('[CP2-3 CP2-4 CP2-5 OK] static checks');
