/**
 * 异步「找回」拆分为 **探查（PROBE）** 与 **回收（RELAY）** 两轮：探查结束释放执行槽后由 SW PATCH
 * `EXT_REMOTE_AWAITING_RELAY` 并自动派发 RELAY（设计：发起 / 探查 / 回收三阶段独立）。
 */
import { registerAgentCommands } from '../../core/registry.js';
import { registerAsyncRecoverPayloadValidator } from '../../core/asyncRecoverValidators.js';
import { validateJimengRecoverMergedPayload } from './recoverValidator.js';
import { JIMENG_AI_TOOL_HOME } from './jimengUrls.js';
import {
  step04_jimeng_recover_probe_only,
  step04_jimeng_recover_collect,
  step05_jimeng_recover_relay_to_caller,
} from './steps.js';

registerAgentCommands([
  {
    command: 'JIMENG_ASYNC_PROBE',
    picpuckAction: '__internal_jimeng_async_probe',
    homeUrl: 'https://jimeng.jianying.com',
    taskBaseUrl: JIMENG_AI_TOOL_HOME,
    recoverAllocateSilentDefault: true,
    steps: [step04_jimeng_recover_probe_only],
  },
  {
    command: 'JIMENG_ASYNC_RELAY',
    picpuckAction: '__internal_jimeng_async_relay',
    homeUrl: 'https://jimeng.jianying.com',
    taskBaseUrl: JIMENG_AI_TOOL_HOME,
    recoverAllocateSilentDefault: true,
    steps: [step04_jimeng_recover_collect, step05_jimeng_recover_relay_to_caller],
  },
]);

registerAsyncRecoverPayloadValidator('jimeng_agent', validateJimengRecoverMergedPayload);
