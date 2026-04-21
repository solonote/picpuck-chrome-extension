/**
 * 设计 §6：站点专有错误码常量（throw / masterDispatch 映射用）。
 */
export const JIMENG_PAGE_HELPERS_MISSING = 'JIMENG_PAGE_HELPERS_MISSING';
export const JIMENG_WORKBENCH_NOT_READY = 'JIMENG_WORKBENCH_NOT_READY';
/** 小云雀 xyq 工作台：与即梦 DOM 探测分离 */
export const XIAOYUNQUE_WORKBENCH_NOT_READY = 'XIAOYUNQUE_WORKBENCH_NOT_READY';
export const JIMENG_PROMPT_FIELD_NOT_FOUND = 'JIMENG_PROMPT_FIELD_NOT_FOUND';
export const JIMENG_MODE_OR_PARAM_FAILED = 'JIMENG_MODE_OR_PARAM_FAILED';
export const JIMENG_PROMPT_PLACEHOLDER_MISMATCH = 'JIMENG_PROMPT_PLACEHOLDER_MISMATCH';
/** step15：输入 @ 后下拉在时限内未出现或未出现可选「图片N」项 */
export const JIMENG_AT_POPUP_TIMEOUT = 'JIMENG_AT_POPUP_TIMEOUT';
/** step15：下拉已出现但列表中无对应「图片N」 */
export const JIMENG_AT_OPTION_NOT_FOUND = 'JIMENG_AT_OPTION_NOT_FOUND';
/** step15：无法选中 (参考图片N) 文本 */
export const JIMENG_AT_PLACEHOLDER_SELECT_FAILED = 'JIMENG_AT_PLACEHOLDER_SELECT_FAILED';
/** step15：execCommand 无法插入 @ */
export const JIMENG_AT_INSERT_FAILED = 'JIMENG_AT_INSERT_FAILED';
/** step15：占位符轮次超过上限（异常循环） */
export const JIMENG_AT_EXPAND_EXHAUSTED = 'JIMENG_AT_EXPAND_EXHAUSTED';
export const JIMENG_IMAGE_MAIN_INJECT_FAILED = 'JIMENG_IMAGE_MAIN_INJECT_FAILED';
/** 载荷缺少或非法的 `jimengSubmitMode`（须为 toolbar | enter | none） */
export const JIMENG_SUBMIT_MODE_INVALID = 'JIMENG_SUBMIT_MODE_INVALID';

/** step19：120s 内未出现生成中 UI */
export const JIMENG_GENERATE_START_TIMEOUT = 'JIMENG_GENERATE_START_TIMEOUT';
/** step20：自 Enter 起 600s 内未完成 */
export const JIMENG_GENERATE_WAIT_TIMEOUT = 'JIMENG_GENERATE_WAIT_TIMEOUT';
/** step20：无有效结果图 */
export const JIMENG_GENERATE_NO_OUTPUT = 'JIMENG_GENERATE_NO_OUTPUT';
/** step20：槽位已出现但 loading=lazy 未全部 decode（与 valid 张数不一致） */
export const JIMENG_RESULT_LAZY_TIMEOUT = 'JIMENG_RESULT_LAZY_TIMEOUT';
/** step21：等待扩展将工作 Tab 置前超时（后台 Tab 无法稳定右键/剪贴板） */
export const JIMENG_COLLECT_TAB_ACTIVATE_TIMEOUT = 'JIMENG_COLLECT_TAB_ACTIVATE_TIMEOUT';
/** step21：右键菜单或「复制图片」不可用 */
export const JIMENG_CONTEXT_MENU_FAILED = 'JIMENG_CONTEXT_MENU_FAILED';
/** step21：页面提示「复制失败，请重试」等且重试次数用尽 */
export const JIMENG_COPY_TOAST_FAILED = 'JIMENG_COPY_TOAST_FAILED';
/** step21：单张 15s 内未从剪贴板读到新图 */
export const JIMENG_CLIPBOARD_IMAGE_TIMEOUT = 'JIMENG_CLIPBOARD_IMAGE_TIMEOUT';
export {
  JIMENG_RELAY_CALLER_TAB_UNBOUND,
  JIMENG_RELAY_INVALID_PAYLOAD,
  JIMENG_RELAY_SEND_FAILED,
} from '../../core/jimengRelayErrorCodes.js';
/** 历史/分片 relay 错误码（即梦产出现走扩展 Token complete）；Gemini 等仍用 core/relayImagePayloadChunked.js */
export const JIMENG_RELAY_CALLER_GONE = 'JIMENG_RELAY_CALLER_GONE';
