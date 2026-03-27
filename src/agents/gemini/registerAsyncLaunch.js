/**
 * 异步生成「启动阶段」：Gemini 仅跑到提交/Enter（设计 **11**、**14**），不含等待出图与剪贴板整图。
 */
import { registerAgentCommands } from '../../core/registry.js';
import { GEMINI_APP_HOME } from './geminiUrls.js';
import {
  step04_gemini_require_logged_in,
  step05_gemini_ensure_app_home,
  step06_gemini_ensure_make_image_entry,
  step07_gemini_apply_effective_prompt_on_context,
  step08_gemini_ensure_bard_mode,
  step09_gemini_fill_input_and_paste_images,
  step10_gemini_confirm_prompt_applied,
  step11_gemini_submit_enter_if_needed,
  step12_gemini_async_capture_anchor_and_patch,
} from './steps.js';

registerAgentCommands([
  {
    command: 'GEMINI_ASYNC_LAUNCH',
    picpuckAction: '__internal_gemini_async_launch',
    homeUrl: 'https://gemini.google.com',
    taskBaseUrl: GEMINI_APP_HOME,
    steps: [
      step04_gemini_require_logged_in,
      step05_gemini_ensure_app_home,
      step06_gemini_ensure_make_image_entry,
      step07_gemini_apply_effective_prompt_on_context,
      step08_gemini_ensure_bard_mode,
      step09_gemini_fill_input_and_paste_images,
      step10_gemini_confirm_prompt_applied,
      step11_gemini_submit_enter_if_needed,
      step12_gemini_async_capture_anchor_and_patch,
    ],
  },
]);
