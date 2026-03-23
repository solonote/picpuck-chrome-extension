/**
 * 即梦站点 Agent：仅本文件注册 `taskBaseUrl`/`homeUrl`/步骤（R18）；core 不得硬编码即梦 URL（§9.1）。
 */
import { registerAgentCommands } from '../../core/registry.js';
import {
  step01_clear_round_logs,
  step02_attach_log_sink,
  step03_jimeng_fill_placeholder,
} from './steps.js';

registerAgentCommands([
  {
    command: 'JIMENG_IMAGE_FILL',
    picpuckAction: 'jimengGenerateImage',
    taskBaseUrl: 'https://jimeng.jianying.com',
    homeUrl: 'https://jimeng.jianying.com/',
    steps: [step01_clear_round_logs, step02_attach_log_sink, step03_jimeng_fill_placeholder],
  },
]);
