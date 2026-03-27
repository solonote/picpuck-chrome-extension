/**
 * 异步「找回」拆为 **探查（PROBE）** 与 **回收（RELAY）**：打开会话 → 定位对话块 → PROBE 用 DOM 完成态；RELAY 等预览就绪后整图下载。
 */
import { registerAgentCommands } from '../../core/registry.js';
import { registerAsyncRecoverPayloadValidator } from '../../core/asyncRecoverValidators.js';
import { validateGeminiRecoverMergedPayload } from './recoverValidator.js';
import { GEMINI_APP_HOME } from './geminiUrls.js';
import {
  step04_gemini_recover_ensure_conversation,
  step05_gemini_recover_probe_turn,
  step05_gemini_recover_collect_image,
  step06_gemini_recover_relay_outcome,
} from './steps.js';

registerAgentCommands([
  {
    command: 'GEMINI_ASYNC_PROBE',
    picpuckAction: '__internal_gemini_async_probe',
    homeUrl: 'https://gemini.google.com',
    taskBaseUrl: GEMINI_APP_HOME,
    recoverAllocateSilentDefault: true,
    steps: [step04_gemini_recover_ensure_conversation, step05_gemini_recover_probe_turn],
  },
  {
    command: 'GEMINI_ASYNC_RELAY',
    picpuckAction: '__internal_gemini_async_relay',
    homeUrl: 'https://gemini.google.com',
    taskBaseUrl: GEMINI_APP_HOME,
    recoverAllocateSilentDefault: true,
    steps: [
      step04_gemini_recover_ensure_conversation,
      step05_gemini_recover_collect_image,
      step06_gemini_recover_relay_outcome,
    ],
  },
]);

registerAsyncRecoverPayloadValidator('gemini_agent', validateGeminiRecoverMergedPayload);
