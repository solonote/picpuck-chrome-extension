/**
 * 异步生成「启动阶段」：即梦仅跑到提交/Enter（设计 **11**、**14**），不含等待出图与回传。
 */
import { registerAgentCommands } from '../../core/registry.js';
import { JIMENG_AI_TOOL_HOME } from './jimengUrls.js';
import {
  step04_jimeng_require_logged_in,
  step05_jimeng_ensure_ai_tool_home,
  step07_jimeng_ensure_workbench_ready,
  step08_jimeng_close_open_popovers,
  step09_jimeng_ensure_mode_image_generation,
  step10_jimeng_ensure_model,
  step11_jimeng_ensure_ratio_resolution,
  step12_jimeng_clear_form,
  step13_jimeng_paste_reference_clear_prompt,
  step14_jimeng_fill_prompt_text,
  step15_jimeng_expand_at_mentions,
  step16_jimeng_set_logged_in_marker,
  step17_jimeng_click_generate_if_needed,
  step18_jimeng_submit_prompt_enter_if_configured,
} from './steps.js';

registerAgentCommands([
  {
    command: 'JIMENG_ASYNC_LAUNCH',
    picpuckAction: '__internal_jimeng_async_launch',
    homeUrl: 'https://jimeng.jianying.com',
    taskBaseUrl: JIMENG_AI_TOOL_HOME,
    steps: [
      step04_jimeng_require_logged_in,
      step05_jimeng_ensure_ai_tool_home,
      step07_jimeng_ensure_workbench_ready,
      step08_jimeng_close_open_popovers,
      step09_jimeng_ensure_mode_image_generation,
      step10_jimeng_ensure_model,
      step11_jimeng_ensure_ratio_resolution,
      step12_jimeng_clear_form,
      step13_jimeng_paste_reference_clear_prompt,
      step14_jimeng_fill_prompt_text,
      step15_jimeng_expand_at_mentions,
      step16_jimeng_set_logged_in_marker,
      step17_jimeng_click_generate_if_needed,
      step18_jimeng_submit_prompt_enter_if_configured,
    ],
  },
]);
