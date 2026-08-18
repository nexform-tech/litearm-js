/**
 * @file index.ts
 * @brief litearm-js SDK - JavaScript/TypeScript SDK for LiteArm robot arm.
 *
 * @example
 * ```typescript
 * import { Arm } from 'litearm-js';
 *
 * const arm = new Arm({ endpoint: 'ws://192.168.1.100:7447' });
 * await arm.connect();
 *
 * // Move to joint target
 * await arm.movej([0, 0, 0, 0, 0, 0, 0], { speed: 0.5 });
 *
 * // Get state
 * const state = arm.getState();
 * console.log('Joint angles:', state?.q);
 *
 * // Access end-effector
 * const hand = arm.device('hand_0');
 * await hand.open();
 *
 * // Emergency stop
 * arm.requestStop();
 *
 * await arm.close();
 * ```
 */

// Core
export { Arm } from './arm';

// Device access
export { RemoteDevice, DeviceManager } from './device';

// Transport
export { Transport, ZenohTransport, createTransport } from './transport';

// Codec
export {
  initCodec,
  initCodecSync,
  encodeRequest,
  decodeRequest,
  encodeReply,
  decodeReply,
  encodeEstop,
  decodeEstop,
  decodeState,
  LiteArmError,
} from './codec';

// Protocol
export {
  PROTOCOL_VERSION,
  rpcTopic,
  stateTopic,
  commandTopic,
  estopTopic,
} from './protocol';

// Types
export type {
  ArmOptions,
  ArmStateValue,
  RobotState,
  Pose,
  Gains,
  Payload,
  Installation,
  JointTrajectory,
  TrajectoryFrame,
  FeedbackState,
  JointFeedbackState,
  WatchdogState,
  Fault,
  Temperature,
  MoveJOptions,
  MoveLOptions,
  MoveCOptions,
  MovePOptions,
  ZeroGravityOptions,
  HoldOptions,
  RecoverJointLimitsOptions,
  JointImpedanceOptions,
  CartesianImpedanceOptions,
  JointFollowOptions,
  ReplayJointPathOptions,
  ReplayTrajectoryOptions,
  ReplayTimedTrajectoryOptions,
  PlayTrajectoryOptions,
  RecordTrajectoryOptions,
  SystemStats,
  RecordingState,
  PlaybackState,
  TrajectoryMeta,
} from './types';
