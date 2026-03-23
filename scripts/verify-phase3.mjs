/**
 * CP3 部分：纯函数候选 Tab 排序与上限常量（无 Chrome API）。
 */
import assert from 'node:assert/strict';
import { filterAndSortCandidates, MAX_SAME_BASE_TABS } from '../src/core/tabCandidates.js';

assert.equal(MAX_SAME_BASE_TABS, 16);

const base = 'https://jimeng.jianying.com';
const tabs = [
  { id: 30, url: 'https://gemini.google.com/app' },
  { id: 10, url: base + '/a' },
  { id: 20, url: base + '/b' },
];
const c = filterAndSortCandidates(tabs, base);
assert.deepEqual(c.map((t) => t.id), [10, 20]);

console.log('[CP3 partial OK] tabCandidates');
