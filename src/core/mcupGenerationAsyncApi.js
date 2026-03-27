/**
 * 熔炉扩展异步生成 HTTP 辅助：与 mcup-ai `POST /api/generation/event/generation-async/*` 及 Token 头对齐（**12** / **14**）。
 * `picpuckMcupExtensionAccessToken` / `picpuckMcupApiBase` 由 {@link ./extensionAccessTokenLifecycle.js} 签发与刷新。
 * `generation-async/complete` 仅应由 {@link ./frameworkAsyncJobOutcome.js} 在 dispatchRound 成功末尾调用；agent 步骤禁止直连。
 */

const TOKEN_HEADER = 'X-Extension-Access-Token';

/** 并发下两次 refresh 若共用同一旧 token：第一次 200 会轮换并删旧键，第二次 401；随后误 clear 会抹掉新 token → PATCH 401。单飞合并为一次 refresh。 */
let refreshInFlight = null;

function normalizeApiBase(base) {
  if (!base || typeof base !== 'string') return '';
  return base.replace(/\/$/, '');
}

/**
 * @returns {Promise<{ extension_access_token: string }>}
 */
export async function mcupRefreshExtensionAccessToken() {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = (async () => {
    try {
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
        return { extension_access_token: current };
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
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
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

/**
 * 与熔炉页 `completeGenerationAsyncWithImages` 字段顺序一致（非文件 part 在前）。
 * @param {Record<string, unknown>} ge 与 `buildJimengRelayGenerationEvent` 相同形状的 generationEvent
 * @param {Array<{ imageBase64: string, contentType?: string }>} images
 */
export async function mcupPostGenerationAsyncCompleteFromJimengRelay(ge, images) {
  if (!ge || typeof ge !== 'object') throw new Error('MCUP_ASYNC_COMPLETE_BAD_GE');
  const aj = typeof ge.async_job_id === 'string' ? ge.async_job_id.trim().toLowerCase() : '';
  if (!/^[a-z0-9]{12}$/.test(aj)) throw new Error('MCUP_ASYNC_COMPLETE_BAD_JOB_ID');
  const form = new FormData();
  form.append('async_job_id', aj);
  form.append('outcome', 'SUCCEEDED');
  form.append('error_message', '');
  form.append('projectId', String(ge.projectId || '').trim());
  form.append('subjectType', String(ge.subjectType || '').trim());
  form.append('subjectId', String(ge.subjectId || '').trim());
  const ip = typeof ge.inputPrompt === 'string' ? ge.inputPrompt : '';
  if (ip) form.append('input_prompt', ip);
  const ce = typeof ge.coreEngine === 'string' ? ge.coreEngine.trim() : '';
  if (ce) form.append('core_engine', ce);
  const arr = Array.isArray(images) ? images : [];
  for (let i = 0; i < arr.length; i += 1) {
    const it = arr[i];
    const b64 = it && typeof it.imageBase64 === 'string' ? it.imageBase64 : '';
    if (!b64) throw new Error('MCUP_ASYNC_COMPLETE_BAD_IMAGE');
    const ctRaw = typeof it?.contentType === 'string' && it.contentType ? it.contentType : 'image/png';
    const mainCt = ctRaw.split(';')[0].trim() || 'image/png';
    const blob = await fetch(`data:${mainCt};base64,${b64}`).then((r) => r.blob());
    const ext = mainCt.includes('jpeg') ? 'jpg' : mainCt.includes('webp') ? 'webp' : 'png';
    const file = new File([blob], `jimeng-${i + 1}.${ext}`, { type: mainCt });
    form.append('file', file);
  }
  await mcupPostGenerationAsyncComplete(form);
}

/**
 * PATCH extension-state（**13** / **14** 找回）。
 * @param {{ projectId: string, async_job_id: string, extension_run_phase?: string, extension_remote_context?: string }} body
 */
export async function mcupPatchExtensionState(body) {
  const bodyJson = JSON.stringify(body || {});
  for (let attempt = 0; attempt < 2; attempt++) {
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
    const res = await fetch(`${apiBase}/api/generation/event/generation-async/extension-state`, {
      method: 'PATCH',
      headers: { [TOKEN_HEADER]: token, 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: bodyJson,
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      return;
    }
    if (res.status === 401 && attempt === 0) {
      continue;
    }
    throw new Error(json?.detail || json?.message || `MCUP_PATCH_STATE_${res.status}`);
  }
}
