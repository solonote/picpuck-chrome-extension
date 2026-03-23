/**
 * Gemini 站点 Agent（R18）。`homeUrl` 须与实际上线入口一致，否则新建 Tab 后 §9.4 url 复验会失败。
 */
import { registerAgentCommands } from '../../core/registry.js';
import {
  step01_clear_round_logs,
  step02_attach_log_sink,
  step03_gemini_fill_placeholder,
} from './steps.js';

registerAgentCommands([
  {
    command: 'GEMINI_IMAGE_FILL',
    picpuckAction: 'geminiGenerateImage',
    taskBaseUrl: 'https://gemini.google.com',
    homeUrl: 'https://gemini.google.com/app',
    steps: [step01_clear_round_logs, step02_attach_log_sink, step03_gemini_fill_placeholder],
  },
]);
