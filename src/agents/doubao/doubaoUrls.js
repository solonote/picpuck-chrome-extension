/** 豆包对话起始页（与 CommandRecord.taskBaseUrl 一致） */
export const DOUBAO_CHAT_HOME = 'https://www.doubao.com/chat/';

export function isDoubaoChatUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return (h === 'www.doubao.com' || h === 'doubao.com') && u.pathname.startsWith('/chat');
  } catch {
    return false;
  }
}

/**
 * 已在豆包主站但不在对话路径（首页、活动页等），需 `tabs.update` 到 {@link DOUBAO_CHAT_HOME} 后步骤才能找到会话区。
 */
export function needsNavigateToDoubaoChat(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h !== 'www.doubao.com' && h !== 'doubao.com') return false;
    return !u.pathname.startsWith('/chat');
  } catch {
    return false;
  }
}
