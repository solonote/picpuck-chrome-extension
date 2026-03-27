/**
 * core 侧 Service Worker 启动逻辑。
 *
 * 分层约定（R16、§12.1）：src/core 下源文件不得 import agents；站点注册由仓库根目录
 * background.js 先 import 各 src/agents/.../register.js，再 import 本文件。
 */
import { getRegisteredCommandCount } from './registry.js';
import { LOG_APPEND, PICPUCK_COMMAND, ROUND_PHASE } from './runtimeMessages.js';
import { installTabRemovedHandler } from './tabLifecycle.js';
import { installRuntimeMessageHandlers } from './swMessages.js';
import { installExtensionAccessTokenLifecycle } from './extensionAccessTokenLifecycle.js';
import {
  installWatchLoopAlarmHandling,
  setDispatchAsyncGenerationRecoverForWatchLoop,
} from './asyncWatchLoopRegistry.js';
import { dispatchAsyncGenerationRecover } from './asyncRecoverDispatch.js';
import { installPicpuckWorkspaceWindowRemovedListener } from './picpuckWorkspaceWindow.js';

/** 启动时打印三类消息名，便于与 src/content 对照验收 CP2-4 */
console.info('[PicPuck SW] message types:', PICPUCK_COMMAND, LOG_APPEND, ROUND_PHASE);

setDispatchAsyncGenerationRecoverForWatchLoop(dispatchAsyncGenerationRecover);
installPicpuckWorkspaceWindowRemovedListener();
installWatchLoopAlarmHandling();
installTabRemovedHandler();
installRuntimeMessageHandlers();
installExtensionAccessTokenLifecycle();

chrome.runtime.onInstalled.addListener((details) => {
  console.info('[PicPuck SW] onInstalled', details.reason, 'commands:', getRegisteredCommandCount());
});

console.info('[PicPuck SW] started, registered commands:', getRegisteredCommandCount());
