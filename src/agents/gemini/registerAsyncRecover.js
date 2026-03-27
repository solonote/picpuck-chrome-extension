/**
 * 异步「找回」占位：PATCH → 可取消等待 → 框架提交 FAILED complete（设计 **02** 第二阶段）。
 */
import { registerAgentCommands } from '../../core/registry.js';
import { registerAsyncRecoverPayloadValidator } from '../../core/asyncRecoverValidators.js';
import { validateGeminiRecoverMergedPayload } from './recoverValidator.js';
import { GEMINI_APP_HOME } from './geminiUrls.js';
import {
  step04_recover_patch_remote_ready_placeholder,
  step05_recover_poll_placeholder,
  step06_recover_complete_placeholder_failed,
} from '../../core/asyncRecoverSteps.js';

registerAgentCommands([
  {
    command: 'GEMINI_ASYNC_RECOVER',
    picpuckAction: '__internal_gemini_async_recover',
    homeUrl: 'https://gemini.google.com',
    taskBaseUrl: GEMINI_APP_HOME,
    recoverAllocateSilentDefault: true,
    steps: [
      step04_recover_patch_remote_ready_placeholder,
      step05_recover_poll_placeholder,
      step06_recover_complete_placeholder_failed,
    ],
  },
]);

registerAsyncRecoverPayloadValidator('gemini_agent', validateGeminiRecoverMergedPayload);
