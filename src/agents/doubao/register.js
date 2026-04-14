/**
 * 豆包站点 Agent：注册 homeUrl / taskBaseUrl / 步骤；core 不得硬编码豆包 URL。
 */
import { registerAgentCommands } from '../../core/registry.js';
import { DOUBAO_CHAT_HOME } from './doubaoUrls.js';
import {
  step04_doubao_ensure_chat_home,
  step05_doubao_require_logged_in,
  step06_doubao_click_image_generation,
  step06b_doubao_click_video_tab,
  step08_doubao_paste_images_and_prompt,
  step09_doubao_submit_enter,
  step10_doubao_noop_anchor,
} from './steps.js';

registerAgentCommands([
  {
    command: 'DOUBAO_IMAGE_FILL',
    picpuckAction: 'doubaoGenerateImage',
    homeUrl: 'https://www.doubao.com',
    taskBaseUrl: DOUBAO_CHAT_HOME,
    steps: [
      step04_doubao_ensure_chat_home,
      step05_doubao_require_logged_in,
      step06_doubao_click_image_generation,
      step08_doubao_paste_images_and_prompt,
      step09_doubao_submit_enter,
      step10_doubao_noop_anchor,
    ],
  },
  {
    command: 'DOUBAO_VIDEO_FILL',
    picpuckAction: 'doubaoGenerateVideo',
    homeUrl: 'https://www.doubao.com',
    taskBaseUrl: DOUBAO_CHAT_HOME,
    steps: [
      step04_doubao_ensure_chat_home,
      step05_doubao_require_logged_in,
      step06_doubao_click_image_generation,
      step06b_doubao_click_video_tab,
      step08_doubao_paste_images_and_prompt,
      step09_doubao_submit_enter,
      step10_doubao_noop_anchor,
    ],
  },
]);
