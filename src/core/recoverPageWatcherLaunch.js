/**
 * 异步找回：在工作 Tab 的 MAIN 挂「结果就绪」观测；按 `recoverPayload.core_engine` 注入对应站点 bundle（须放 core 因 SW 禁止 import()）。
 */
const JIMENG_IMAGE_MAIN_WORLD_FILE = 'src/agents/jimeng/jimengImageMainWorld.js';
const GEMINI_IMAGE_MAIN_WORLD_FILE = 'src/agents/gemini/geminiImageMainWorld.js';

/**
 * @param {Record<string, unknown>|undefined} recoverPayload
 */
function isGeminiRecoverEngine(recoverPayload) {
  const core = recoverPayload && typeof recoverPayload.core_engine === 'string' ? recoverPayload.core_engine.trim() : '';
  return core.startsWith('gemini_agent');
}

/**
 * @param {{
 *   workTabId: number,
 *   roundId: string,
 *   async_job_id: string,
 *   forgeCallerTabId?: number,
 *   recoverPayload: Record<string, unknown>,
 * }} args
 */
export async function startRecoverPageWatcherFromLaunch(args) {
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
  const gemini = isGeminiRecoverEngine(packed.recoverPayload);
  const file = gemini ? GEMINI_IMAGE_MAIN_WORLD_FILE : JIMENG_IMAGE_MAIN_WORLD_FILE;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: workTabId },
      world: 'MAIN',
      files: [file],
    });
  } catch (e) {
    console.warn('[PicPuck] recover page watcher: inject MAIN failed', e);
    return;
  }
  try {
    const [startRes] = await chrome.scripting.executeScript({
      target: { tabId: workTabId },
      world: 'MAIN',
      func: (p, useGemini) => {
        const gl = typeof globalThis !== 'undefined' ? globalThis : window;
        if (useGemini) {
          const inj = gl.__picpuckGeminiImage;
          if (inj && typeof inj.startGeminiRecoverPageWatcher === 'function') {
            inj.startGeminiRecoverPageWatcher(p);
            return { ok: true };
          }
          try {
            console.warn(
              '[PicPuck] recover page watcher: MAIN 缺少 startGeminiRecoverPageWatcher（注入被跳过或扩展未更新）',
            );
          } catch {
            /* ignore */
          }
          return { ok: false, code: 'RECOVER_PAGE_WATCHER_GEMINI_MISSING' };
        }
        const inj = gl.__picpuckJimengImage;
        if (inj && typeof inj.startJimengRecoverPageWatcher === 'function') {
          inj.startJimengRecoverPageWatcher(p);
          return { ok: true };
        }
        try {
          console.warn(
            '[PicPuck] recover page watcher: MAIN 缺少 startJimengRecoverPageWatcher（注入被跳过或扩展未更新）',
          );
        } catch {
          /* ignore */
        }
        return { ok: false, code: 'RECOVER_PAGE_WATCHER_JIMENG_MISSING' };
      },
      args: [packed, gemini],
    });
    const sr = startRes && startRes.result;
    if (!sr || sr.ok !== true) {
      console.warn('[PicPuck] recover page watcher: MAIN 未启动', sr);
    }
  } catch (e2) {
    console.warn('[PicPuck] recover page watcher: start failed', e2);
  }
}
