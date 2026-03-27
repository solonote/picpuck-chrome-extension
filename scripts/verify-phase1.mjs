/**
 * CP1-1 ~ CP1-3：RoundContext 与 appendLog / clearLogs 行为（Node 下无 chrome）。
 */
import assert from 'node:assert/strict';
import {
  appendLog,
  clearLogs,
  getContext,
  getOrCreateRoundContext,
} from '../src/core/roundContext.js';

const tab1 = 101;
const tab2 = 202;

// CP1-1：单 tab 单实例
const a = getOrCreateRoundContext(tab1);
const b = getOrCreateRoundContext(tab1);
assert.equal(a, b);
assert.equal(getContext(tab1), a);

// CP1-2：追加与 lastInfoMessage
const ts = Date.now();
assert.equal(
  appendLog(tab1, {
    ts,
    roundId: 'r1',
    step: 'step03_foo',
    level: 'info',
    message: 'Step03.业务可见摘要示例',
  }).ok,
  true,
);
assert.equal(getContext(tab1).lastInfoMessage, 'Step03.业务可见摘要示例');
assert.equal(getContext(tab1).logs.length, 1);

appendLog(tab1, {
  ts: ts + 1,
  roundId: 'r1',
  step: 'step03_foo',
  level: 'debug',
  message: 'Step03.debug.err',
});
assert.equal(getContext(tab1).logs.length, 2);
assert.equal(getContext(tab1).lastInfoMessage, 'Step03.业务可见摘要示例');

// CP1-3
clearLogs(tab1);
assert.equal(getContext(tab1).logs.length, 0);
assert.equal(getContext(tab1).lastInfoMessage, '');
assert.equal(getContext(tab1).phase, 'clearing');

// 隔离
getOrCreateRoundContext(tab2);
appendLog(tab2, {
  ts,
  roundId: 'r2',
  step: 'system',
  level: 'info',
  message: 'Step00.ping',
});
assert.equal(getContext(tab1).logs.length, 0);
assert.equal(getContext(tab2).logs.length, 1);

console.log('[CP1-1..CP1-3 OK] roundContext');
