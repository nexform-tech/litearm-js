/** 浏览器专用入口——内联 protobufjs，零外部依赖。 */
export { Arm } from "./arm-browser";
export type { RobotState, Pose, MoveJOps, MoveLOps, MoveCOps, MovePOps } from "./arm-browser";
export { WsTransport, Subscriber } from "./transport-browser";
export { PluginPanelRenderer } from "./plugin-panel";
export type { PluginManifest, MethodDef, MethodParam, UISection, StateField } from "./plugin-panel";
export { DeviceSelector } from "./device-selector";
export type { DeviceTypeInfo, ActiveDeviceInfo, DeviceArmApi } from "./device-selector";
