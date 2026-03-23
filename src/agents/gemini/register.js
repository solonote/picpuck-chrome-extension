/**
 * Gemini 站点 Agent（R18）。`taskBaseUrl` 为新建 Tab 打开的制作入口，须以 `homeUrl` 站点前缀开头；否则 §9.4 url 复验会失败。
 */
import { registerAgentCommands } from '../../core/registry.js';
import { step04_gemini_fill_placeholder } from './steps.js';

registerAgentCommands([
  {
    command: 'GEMINI_IMAGE_FILL',
    picpuckAction: 'geminiGenerateImage',
    homeUrl: 'https://gemini.google.com',
    taskBaseUrl: 'https://gemini.google.com/app',
    steps: [step04_gemini_fill_placeholder],
  },
]);
