/**
 * Service Worker ↔ Content Script 的 `message.type` 字面量（§11 项 3）。
 * 内容脚本为经典 IIFE、无法 import 本模块，故在 `picpuckAgentContent.js` 内用同名 const 重复声明，修改须两边对齐。
 */
export const PICPUCK_COMMAND = 'PICPUCK_COMMAND';
export const LOG_APPEND = 'LOG_APPEND';
export const ROUND_PHASE = 'ROUND_PHASE';
/** SW → 熔炉 content：转 `window.postMessage`（设计 **12** B） */
export const PICPUCK_ASYNC_GEN_PAGE = 'PICPUCK_ASYNC_GEN_PAGE';
