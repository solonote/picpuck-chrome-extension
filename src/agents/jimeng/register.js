/**
 * 即梦站点 Agent：仅本文件注册 `homeUrl`（站点前缀）/`taskBaseUrl`（本 Task 起始页）/步骤（R18）；core 不得硬编码即梦 URL（§9.1）。
 */
import { registerAgentCommands } from '../../core/registry.js';
import { step04_jimeng_fill_placeholder } from './steps.js';

registerAgentCommands([
  {
    command: 'JIMENG_IMAGE_FILL',
    picpuckAction: 'jimengGenerateImage',
    homeUrl: 'https://jimeng.jianying.com',
    taskBaseUrl: 'https://jimeng.jianying.com/',
    steps: [step04_jimeng_fill_placeholder],
  },
]);
