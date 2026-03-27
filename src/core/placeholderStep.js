/**
 * 占位步骤：MAIN 空跑一轮；仅中间 `bodyRest` 记为业务可见 info，首尾为 debug。
 */
import { logStepDebug, logStepInfo } from './stepLog.js';

/**
 * @param {{ tabId: number, roundId: string }} ctx
 * @param {{ stepKey: string, nn: number, bodyRest: string }} opts bodyRest 为 `StepNN.` 后文案，如 `占位步骤+尚未对接…`
 */
export async function runPlaceholderMainStep(ctx, opts) {
  const { tabId, roundId } = ctx;
  const { stepKey, nn, bodyRest } = opts;
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {},
  });
  logStepDebug(tabId, roundId, stepKey, nn, 'placeholderMainInjectStart');
  logStepInfo(tabId, roundId, stepKey, nn, bodyRest);
  logStepDebug(tabId, roundId, stepKey, nn, 'placeholderMainInjectEnd');
}
