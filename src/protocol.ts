/**
 * @file protocol.ts
 * @brief Zenoh topic naming conventions for litearm v4 protocol.
 */

export const PROTOCOL_VERSION = 1;

/**
 * RPC request/reply topic for the given arm.
 */
export function rpcTopic(armId: string): string {
  return `litearm/v4/${armId}/rpc`;
}

/**
 * State broadcast topic for the given arm.
 */
export function stateTopic(armId: string): string {
  return `litearm/v4/${armId}/state`;
}

/**
 * Command channel topic for the given arm (e.g. servo targets).
 */
export function commandTopic(armId: string): string {
  return `litearm/v4/${armId}/command`;
}

/**
 * High-priority emergency stop topic for the given arm.
 */
export function estopTopic(armId: string): string {
  return `litearm/v4/${armId}/estop`;
}
