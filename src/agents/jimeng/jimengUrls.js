/**
 * 即梦站点 URL 常量（仅 agents/jimeng 使用，core 不引用）。
 */
export const JIMENG_AI_TOOL_HOME = 'https://jimeng.jianying.com/ai-tool/home';

/**
 * @param {string | undefined} url
 */
export function isJimengAiToolHomeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.indexOf('jimeng.jianying.com') === -1) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== 'jimeng.jianying.com') return false;
    const p = u.pathname.replace(/\/+$/, '') || '/';
    return p === '/ai-tool/home';
  } catch {
    return false;
  }
}
