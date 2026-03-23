/**
 * Gemini 站点 Agent（R18）。`taskBaseUrl` 为应用入口，须以 `homeUrl` 站点前缀开头（§9.4）。
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
  step11_gemini_click_send_if_needed,
} from './steps.js';

registerAgentCommands([
  {
    command: 'GEMINI_IMAGE_FILL',
    picpuckAction: 'geminiGenerateImage',
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
      step11_gemini_click_send_if_needed,
    ],
  },
]);
