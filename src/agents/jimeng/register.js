/**
 * 即梦站点 Agent：仅本文件注册 `homeUrl`（站点前缀）/`taskBaseUrl`（本 Task 起始页）/步骤（R18）；core 不得硬编码即梦 URL（§9.1）。
 */
import { registerAgentCommands } from '../../core/registry.js';
import { JIMENG_AI_TOOL_HOME } from './jimengUrls.js';
import {
  step04_jimeng_require_logged_in,
  step05_jimeng_ensure_ai_tool_home,
  step06_jimeng_fill_placeholder,
  step07_jimeng_ensure_workbench_ready,
  step08_jimeng_close_open_popovers,
  step09_jimeng_ensure_mode_image_generation,
  step10_jimeng_ensure_model,
  step11_jimeng_ensure_ratio_resolution,
} from './steps.js';

registerAgentCommands([
  {
    command: 'JIMENG_IMAGE_FILL',
    picpuckAction: 'jimengGenerateImage',
    homeUrl: 'https://jimeng.jianying.com',
    taskBaseUrl: JIMENG_AI_TOOL_HOME,
    steps: [
      step04_jimeng_require_logged_in,
      step05_jimeng_ensure_ai_tool_home,
      step06_jimeng_fill_placeholder,
      step07_jimeng_ensure_workbench_ready,
      step08_jimeng_close_open_popovers,
      step09_jimeng_ensure_mode_image_generation,
      step10_jimeng_ensure_model,
      step11_jimeng_ensure_ratio_resolution,
    ],
  },
]);
