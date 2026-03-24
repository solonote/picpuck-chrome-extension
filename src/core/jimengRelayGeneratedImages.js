/**
 * 即梦多图收集完成后，由 SW 侧步骤调用：投递至发起 `jimengGenerateImage` 的熔炉标签页。
 */
import { jimengRelayCallerTabByRoundId } from './taskBindings.js';

/**
 * @param {{ roundId: string, generationEvent: object, images: Array<{ imageBase64: string, contentType?: string }> }} p
 */
export async function relayJimengGeneratedImagesToCaller(p) {
  const roundId = typeof p.roundId === 'string' ? p.roundId : '';
  const images = Array.isArray(p.images) ? p.images : [];
  const generationEvent =
    p.generationEvent && typeof p.generationEvent === 'object' ? p.generationEvent : null;
  if (!roundId || images.length === 0 || !generationEvent) {
    throw new Error('JIMENG_RELAY_CALLER_GONE');
  }
  for (let i = 0; i < images.length; i += 1) {
    const it = images[i];
    if (!it || typeof it.imageBase64 !== 'string' || !it.imageBase64) {
      throw new Error('JIMENG_RELAY_CALLER_GONE');
    }
  }
  const callerTabId = jimengRelayCallerTabByRoundId.get(roundId);
  if (callerTabId == null) {
    throw new Error('JIMENG_RELAY_CALLER_GONE');
  }
  try {
    await chrome.tabs.sendMessage(callerTabId, {
      type: 'PICPUCK_JIMENG_GENERATED_IMAGES',
      images,
      generationEvent,
    });
  } catch {
    throw new Error('JIMENG_RELAY_CALLER_GONE');
  }
  jimengRelayCallerTabByRoundId.delete(roundId);
}
