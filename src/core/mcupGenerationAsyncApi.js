/**
 * 熔炉扩展异步生成 HTTP 辅助：与 mcup-ai `POST /api/generation/event/generation-async/*` 及 Token 头对齐（**12** / **14**）。
 * `picpuckMcupExtensionAccessToken` / `picpuckMcupApiBase` 由 {@link ./extensionAccessTokenLifecycle.js} 签发与刷新；熔炉页 `PICPUCK_MCUP_ASYNC` 仅过渡兼容（将删）。
 */

const TOKEN_HEADER = 'X-Extension-Access-Token';

function normalizeApiBase(base) {
  if (!base || typeof base !== 'string') return '';
  return base.replace(/\/$/, '');
}

/**
 * @returns {Promise<{ extension_access_token: string }>}
 */
export async function mcupRefreshExtensionAccessToken() {
  const session = await chrome.storage.session.get([
    'picpuckMcupExtensionAccessToken',
    'picpuckMcupApiBase',
  ]);
  const current = typeof session.picpuckMcupExtensionAccessToken === 'string'
    ? session.picpuckMcupExtensionAccessToken.trim()
    : '';
  const apiBase = normalizeApiBase(session.picpuckMcupApiBase);
  if (!current || !apiBase) {
    throw new Error('MCUP_ASYNC_NO_TOKEN');
  }
  const res = await fetch(`${apiBase}/api/generation/event/extension-access-token/refresh`, {
    method: 'POST',
    headers: { [TOKEN_HEADER]: current },
    credentials: 'omit',
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 429) {
    throw new Error('MCUP_ASYNC_REFRESH_THROTTLED');
  }
  if (!res.ok) {
    throw new Error(json?.detail || json?.message || `MCUP_REFRESH_${res.status}`);
  }
  const token = json?.data?.extension_access_token;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('MCUP_ASYNC_REFRESH_BAD_BODY');
  }
  const next = token.trim();
  await chrome.storage.session.set({ picpuckMcupExtensionAccessToken: next });
  return { extension_access_token: next };
}

/**
 * @param {FormData} formData multipart：非文件 part 在前、文件在后（**14**）
 */
export async function mcupPostGenerationAsyncComplete(formData) {
  const session = await chrome.storage.session.get([
    'picpuckMcupExtensionAccessToken',
    'picpuckMcupApiBase',
  ]);
  const token = typeof session.picpuckMcupExtensionAccessToken === 'string'
    ? session.picpuckMcupExtensionAccessToken.trim()
    : '';
  const apiBase = normalizeApiBase(session.picpuckMcupApiBase);
  if (!token || !apiBase) {
    throw new Error('MCUP_ASYNC_NO_TOKEN');
  }
  const res = await fetch(`${apiBase}/api/generation/event/generation-async/complete`, {
    method: 'POST',
    headers: { [TOKEN_HEADER]: token },
    credentials: 'omit',
    body: formData,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.detail || json?.message || `MCUP_COMPLETE_${res.status}`);
  }
}
