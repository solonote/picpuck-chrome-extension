/** 豆包对话起始页（与 CommandRecord.taskBaseUrl 一致） */
export const DOUBAO_CHAT_HOME = 'https://www.doubao.com/chat/';

export function isDoubaoChatUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.hostname === 'www.doubao.com' && u.pathname.startsWith('/chat');
  } catch {
    return false;
  }
}
