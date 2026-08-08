/** 浏览器专用入口——内联 protobufjs，零外部依赖。 */
export { Arm } from "./arm-browser";
export type { RobotState, Pose, MoveJOps, MoveLOps, MoveCOps, MovePOps } from "./arm-browser";
export { WsTransport, Subscriber } from "./transport-browser";
