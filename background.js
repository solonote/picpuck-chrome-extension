/**
 * MV3 Service Worker 入口（manifest `background.service_worker`）。
 * 须先 import 各 agents 目录下的 register.js 填充 CommandRecord，再 import swMain（§12.4）。
 */
import './src/agents/jimeng/register.js';
import './src/agents/gemini/register.js';
import './src/core/swMain.js';
