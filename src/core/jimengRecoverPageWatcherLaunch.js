/**
 * 即梦：在工作 Tab 的 MAIN 世界挂「结果区就绪」观测。
 * 须放在 `src/core`：Service Worker 禁止 `import()`，只能静态 import（见 w3c/ServiceWorker#1356）。
 */
const JIMENG_IMAGE_MAIN_WORLD_FILE = 'src/agents/jimeng/jimengImageMainWorld.js';

/**
 * @param {{
 *   workTabId: number,
 *   roundId: string,
 *   async_job_id: string,
 *   forgeCallerTabId?: number,
 *   recoverPayload: Record<string, unknown>,
 * }} args
 */
export async function startJimengRecoverPageWatcherFromLaunch(args) {
  const workTabId = typeof args.workTabId === 'number' ? args.workTabId : 0;
  if (workTabId <= 0) return;
  const forgeRaw = args.forgeCallerTabId;
  const forgeCallerTabId =
    typeof forgeRaw === 'number' && Number.isFinite(forgeRaw) ? Math.floor(forgeRaw) : 0;
  const packed = {
    roundId: typeof args.roundId === 'string' ? args.roundId : '',
    async_job_id: typeof args.async_job_id === 'string' ? args.async_job_id : '',
    forgeCallerTabId,
    recoverPayload: args.recoverPayload && typeof args.recoverPayload === 'object' ? args.recoverPayload : {},
  };
  try {
    await chrome.scripting.executeScript({
      target: { tabId: workTabId },
      world: 'MAIN',
      files: [JIMENG_IMAGE_MAIN_WORLD_FILE],
    });
  } catch (e) {
    console.warn('[PicPuck] jimeng page watcher: inject main world failed', e);
    return;
  }
  try {
    const [startRes] = await chrome.scripting.executeScript({
      target: { tabId: workTabId },
      world: 'MAIN',
      func: (p) => {
        const g = typeof globalThis !== 'undefined' ? globalThis : window;
        const inj = g.__picpuckJimengImage;
        if (inj && typeof inj.startJimengRecoverPageWatcher === 'function') {
          inj.startJimengRecoverPageWatcher(p);
          return { ok: true };
        }
        try {
          console.warn(
            '[PicPuck] page watcher: MAIN 缺少 startJimengRecoverPageWatcher（同页二次注入被跳过或扩展未更新）',
          );
        } catch {
          /* ignore */
        }
        return { ok: false, code: 'JIMENG_PAGE_WATCHER_API_MISSING' };
      },
      args: [packed],
    });
    const sr = startRes && startRes.result;
    if (!sr || sr.ok !== true) {
      console.warn('[PicPuck] jimeng page watcher: MAIN 未启动', sr);
    }
  } catch (e2) {
    console.warn('[PicPuck] jimeng page watcher: start failed', e2);
  }
}
