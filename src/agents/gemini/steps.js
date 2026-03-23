/**
 * Gemini 站点业务步骤（step01～step03 由 core/dispatchRound 框架固定执行）。
 */
import { runPlaceholderMainStep } from '../../core/placeholderStep.js';

/** 占位：待接 Gemini 页面 */
export async function step04_gemini_fill_placeholder(ctx) {
  await runPlaceholderMainStep(ctx, {
    stepKey: 'step04_gemini_fill_placeholder',
    nn: 4,
    bodyRest: '占位步骤+尚未对接Gemini页面表单',
  });
}
