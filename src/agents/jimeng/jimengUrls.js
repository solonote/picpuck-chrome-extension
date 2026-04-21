/**
 * 即梦站点 URL 常量（仅 agents/jimeng 使用，core 不引用）。
 * 任务起始页：生成流（进入后滚到底部以露出工作台表单区）。
 */
export const JIMENG_AI_TOOL_HOME = 'https://jimeng.jianying.com/ai-tool/generate';
export const XIAOYUNQUE_HOME = 'https://xyq.jianying.com/home?tab_name=home';

/**
 * 是否已处于任务起始路径（/ai-tool/generate）。
 * @param {string | undefined} url
 */
export function isJimengAiToolHomeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.indexOf('jimeng.jianying.com') === -1) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== 'jimeng.jianying.com') return false;
    const p = u.pathname.replace(/\/+$/, '') || '/';
    return p === '/ai-tool/generate' || p === '/ai-tool/video/generate' || p === '/ai-tool/image/generate';
  } catch {
    return false;
  }
}

/**
 * 小云雀主页（视频 2.0 输入工作台）。
 * @param {string | undefined} url
 */
export function isXiaoyunqueHomeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.indexOf('xyq.jianying.com') === -1) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== 'xyq.jianying.com') return false;
    const p = u.pathname.replace(/\/+$/, '') || '/';
    return p === '/home';
  } catch {
    return false;
  }
}
