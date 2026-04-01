/**
 * core 侧 Service Worker 启动逻辑。
 *
 * 分层约定（R16、§12.1）：src/core 下源文件不得 import agents；站点注册由仓库根目录
 * background.js 先 import 各 src/agents/.../register.js，再 import 本文件。
 */
import { installTabRemovedHandler } from './tabLifecycle.js';
import { installRuntimeMessageHandlers } from './swMessages.js';
import { installExtensionAccessTokenLifecycle } from './extensionAccessTokenLifecycle.js';
import {
  installWatchLoopAlarmHandling,
  setDispatchAsyncGenerationRecoverForWatchLoop,
} from './asyncWatchLoopRegistry.js';
import { dispatchAsyncGenerationRecover } from './asyncRecoverDispatch.js';
import { installPicpuckWorkspaceWindowRemovedListener } from './picpuckWorkspaceWindow.js';

setDispatchAsyncGenerationRecoverForWatchLoop(dispatchAsyncGenerationRecover);
installPicpuckWorkspaceWindowRemovedListener();
installWatchLoopAlarmHandling();
installTabRemovedHandler();
installRuntimeMessageHandlers();
installExtensionAccessTokenLifecycle();
