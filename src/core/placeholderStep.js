/**
 * 占位步骤：MAIN 空跑一轮 + 标准进入 / 说明 / 完成日志。
 */
import { logStepInfo } from './stepLog.js';

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
  logStepInfo(tabId, roundId, stepKey, nn, '开始执行占位 MAIN 注入');
  logStepInfo(tabId, roundId, stepKey, nn, bodyRest);
  logStepInfo(tabId, roundId, stepKey, nn, '占位步骤已结束');
}
