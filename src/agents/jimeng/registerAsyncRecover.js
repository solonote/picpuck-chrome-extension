/**
 * 异步「找回」占位：PATCH → 可取消等待 → complete（FAILED 占位）（设计 **02** 第二阶段）。
 */
import { registerAgentCommands } from '../../core/registry.js';
import { JIMENG_AI_TOOL_HOME } from './jimengUrls.js';
import {
  step04_recover_patch_remote_ready_placeholder,
  step05_recover_poll_placeholder,
  step06_recover_complete_placeholder_failed,
} from '../../core/asyncRecoverSteps.js';

registerAgentCommands([
  {
    command: 'JIMENG_ASYNC_RECOVER',
    picpuckAction: '__internal_jimeng_async_recover',
    homeUrl: 'https://jimeng.jianying.com',
    taskBaseUrl: JIMENG_AI_TOOL_HOME,
    steps: [
      step04_recover_patch_remote_ready_placeholder,
      step05_recover_poll_placeholder,
      step06_recover_complete_placeholder_failed,
    ],
  },
]);
