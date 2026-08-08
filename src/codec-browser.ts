/**
 * @file codec-browser.ts — 浏览器专用最小入口。
 * 不依赖 zenoh-ts，只导出 codec 函数，由 tsup 内联 protobufjs。
 */
export { initCodecSync, encodeRequest, decodeReply, decodeState } from './codec';
