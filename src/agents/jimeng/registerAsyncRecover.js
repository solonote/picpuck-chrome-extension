/**
 * 异步「找回」：熔炉定时/轮询触发 `RECOVER`；allocateTab 复用空闲即梦 Tab 或新开；按锚点单次检查 → 未就绪则释放 → 就绪则取回并回传。
 */
import { registerAgentCommands } from '../../core/registry.js';
import { JIMENG_AI_TOOL_HOME } from './jimengUrls.js';
import { step04_jimeng_recover_fetch, step05_jimeng_recover_relay_to_caller } from './steps.js';

registerAgentCommands([
  {
    command: 'JIMENG_ASYNC_RECOVER',
    picpuckAction: '__internal_jimeng_async_recover',
    homeUrl: 'https://jimeng.jianying.com',
    taskBaseUrl: JIMENG_AI_TOOL_HOME,
    recoverAllocateSilentDefault: true,
    steps: [step04_jimeng_recover_fetch, step05_jimeng_recover_relay_to_caller],
  },
]);
