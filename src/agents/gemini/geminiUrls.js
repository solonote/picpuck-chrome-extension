/**
 * Gemini 任务起始页（与 register taskBaseUrl 一致；core 不得硬编码 §9.1）。
 */
export const GEMINI_APP_HOME = 'https://gemini.google.com/app';

/**
 * @param {string} url
 */
export function isGeminiAppUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.indexOf('gemini.google.com') === -1) return false;
  try {
    const u = new URL(url);
    return u.pathname === '/app' || u.pathname.startsWith('/app/');
  } catch {
    return url.indexOf('gemini.google.com/app') !== -1;
  }
}
