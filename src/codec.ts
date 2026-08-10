/**
 * @file codec.ts
 * @brief Protobuf serialization for litearm v4 wire protocol.
 *
 * Uses protobufjs for encoding/decoding messages compatible with Python SDK.
 */

import protobuf from 'protobufjs';
import type { RobotState } from './types';

// Proto schema — wire-compatible with litearm_pb2 (Python).
// 注意: 字段全部用 camelCase（protobufjs 7.6.5 编码 proto3 下划线字段名
//       有 bug 会丢数据）。二进制兼容靠 field number 保证，命名不影响格式。
const PROTO_SCHEMA = `
syntax = "proto3";
package litearm;

message Value {
  optional double doubleVal = 1;
  optional int64 intVal = 2;
  optional string stringVal = 3;
  optional bool boolVal = 4;
  optional bytes bytesVal = 5;
  optional ListValue listVal = 6;
  optional MapValue mapVal = 7;
  optional NoneValue noneVal = 8;
}

message NoneValue {}

message ListValue {
  repeated Value values = 1;
}

message MapValue {
  repeated MapValue.ValuesEntry values = 1;
  message ValuesEntry {
    string key = 1;
    Value value = 2;
  }
}

message RpcRequest {
  string method = 1;
  repeated RpcRequest.KwargsEntry kwargs = 2;
  message KwargsEntry {
    string key = 1;
    Value value = 2;
  }
}

message RpcReply {
  bool ok = 1;
  Value result = 2;
  Error error = 3;
}

message Error {
  string type = 1;
  string message = 2;
  repeated Error.DetailsEntry details = 3;
  message DetailsEntry {
    string key = 1;
    Value value = 2;
  }
}

message RobotState {
  repeated double q = 1;
  repeated double dq = 2;
  repeated double tau = 3;
  repeated Fault fault = 4;
  repeated int32 errs = 5;
  repeated Temperature temps = 6;
  string state = 7;
  FeedbackState feedback = 8;
  WatchdogState watchdog = 9;
  string robotSerial = 10;
  string configChecksumSha256 = 11;
}

message Fault {
  int32 joint = 1;
  int32 errCode = 2;
}

message Temperature {
  int32 mosTemp = 1;
  int32 coilTemp = 2;
}

message FeedbackState {
  double maxAgeS = 1;
  repeated JointFeedbackState joints = 2;
  repeated int32 staleJoints = 3;
}

message JointFeedbackState {
  int32 joint = 1;
  int32 received = 2;
  double ageS = 3;
  bool fresh = 4;
}

message WatchdogState {
  bool enabled = 1;
  double timeoutS = 2;
  string mode = 3;
  bool tripped = 4;
  double lastKickAgeS = 5;
}

message Estop {
  bool trigger = 1;
}
`;

// Parse the proto schema
let root: protobuf.Root | null = null;
let RpcRequest: protobuf.Type | null = null;
let RpcReply: protobuf.Type | null = null;
let RobotStateMsg: protobuf.Type | null = null;
let EstopMsg: protobuf.Type | null = null;
let ValueMsg: protobuf.Type | null = null;

/**
 * Initialize protobuf types (call once before using codec).
 */
export async function initCodec(): Promise<void> {
  root = protobuf.parse(PROTO_SCHEMA).root;
  RpcRequest = root.lookupType('litearm.RpcRequest');
  RpcReply = root.lookupType('litearm.RpcReply');
  RobotStateMsg = root.lookupType('litearm.RobotState');
  EstopMsg = root.lookupType('litearm.Estop');
  ValueMsg = root.lookupType('litearm.Value');
}

/**
 * Synchronous initialization (for environments where async is not needed).
 */
export function initCodecSync(): void {
  root = protobuf.parse(PROTO_SCHEMA).root;
  RpcRequest = root.lookupType('litearm.RpcRequest');
  RpcReply = root.lookupType('litearm.RpcReply');
  RobotStateMsg = root.lookupType('litearm.RobotState');
  EstopMsg = root.lookupType('litearm.Estop');
  ValueMsg = root.lookupType('litearm.Value');
}

/**
 * Convert a JavaScript value to a plain object matching the Value message shape.
 * Returns a plain object (NOT a Value Message instance) so it can be used
 * directly in protobuf .create() calls for map<string, Value> fields.
 */
function toProtoValue(obj: unknown): Record<string, unknown> {
  if (obj === null || obj === undefined) {
    return { noneVal: {} };
  } else if (typeof obj === 'boolean') {
    return { boolVal: obj };
  } else if (typeof obj === 'number') {
    // 始终使用 doubleVal，确保 Python 端 math.isfinite() 不报 TypeError
    // （Python math.isfinite 只接受 float，不接受 int）
    return { doubleVal: obj };
  } else if (typeof obj === 'string') {
    return { stringVal: obj };
  } else if (obj instanceof Uint8Array) {
    return { bytesVal: obj };
  } else if (Array.isArray(obj)) {
    return {
      listVal: {
        values: obj.map(item => toProtoValue(item)),
      },
    };
  } else if (typeof obj === 'object') {
    const entries: { key: string; value: unknown }[] = [];
    for (const [k, v] of Object.entries(obj)) {
      entries.push({ key: k, value: toProtoValue(v) });
    }
    return { mapVal: { values: entries } };
  } else {
    return { stringVal: String(obj) };
  }
}

/**
 * Convert a protobuf Value JSON representation to JavaScript value.
 * Uses `.toJSON()` instead of raw Message properties — protobufjs 7.x
 * nested message properties return 0 when the submessage is recursive.
 */
function fromProtoJSON(v: Record<string, unknown>): unknown {
  if (v.noneVal !== undefined) return null;
  if (v.boolVal !== undefined) return v.boolVal;
  if (v.intVal !== undefined) return Number(v.intVal);
  if (v.doubleVal !== undefined) return v.doubleVal;
  if (v.stringVal !== undefined) return v.stringVal;
  if (v.bytesVal !== undefined) return v.bytesVal;
  if (v.listVal !== undefined) {
    const listVal = v.listVal as { values: Record<string, unknown>[] };
    return (listVal.values || []).map(item => fromProtoJSON(item));
  }
  if (v.mapVal !== undefined) {
    const mapVal = v.mapVal as { values: { key: string; value: Record<string, unknown> }[] };
    const result: Record<string, unknown> = {};
    for (const entry of (mapVal.values || [])) {
      result[entry.key] = fromProtoJSON(entry.value);
    }
    return result;
  }
  return null;
}

/**
 * Deprecated alias — use fromProtoJSON.
 */
function fromProtoValue(val: protobuf.Message): unknown {
  return fromProtoJSON(val as unknown as Record<string, unknown>);
}

/**
 * Encode an RPC request to protobuf bytes.
 */
export function encodeRequest(method: string, kwargs: Record<string, unknown>): Uint8Array {
  if (!RpcRequest) throw new Error('Codec not initialized');

  const kwargsEntries: { key: string; value: unknown }[] = [];
  for (const [k, v] of Object.entries(kwargs)) {
    // 跳过 undefined 值，避免编码为 noneVal 导致服务端无法解析
    if (v === undefined) continue;
    kwargsEntries.push({ key: k, value: toProtoValue(v) });
  }

  const msg = RpcRequest.create({
    method,
    kwargs: kwargsEntries,
  });

  return RpcRequest.encode(msg).finish();
}

/**
 * Decode an RPC request from protobuf bytes.
 */
export function decodeRequest(payload: Uint8Array): { method: string; kwargs: Record<string, unknown> } {
  if (!RpcRequest) throw new Error('Codec not initialized');

  const msg = RpcRequest.decode(payload).toJSON() as Record<string, unknown>;
  const kwargs: Record<string, unknown> = {};
  const kwargsArray = msg.kwargs as { key: string; value: Record<string, unknown> }[] | undefined;

  if (kwargsArray) {
    for (const entry of kwargsArray) {
      kwargs[entry.key] = fromProtoJSON(entry.value);
    }
  }

  return {
    method: msg.method as string,
    kwargs,
  };
}

/**
 * LiteArm error class.
 */
export class LiteArmError extends Error {
  constructor(
    message: string,
    public readonly errorType: string = 'LiteArmError',
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = errorType;
  }
}

/**
 * Decode an RPC reply from protobuf bytes.
 * Returns the result on success, throws LiteArmError on error.
 */
export function decodeReply(payload: Uint8Array): unknown {
  if (!RpcReply) throw new Error('Codec not initialized');

  const msg = RpcReply.decode(payload).toJSON() as Record<string, unknown>;

  if (msg.ok) {
    return fromProtoJSON(msg.result as Record<string, unknown>);
  }

  // Error case
  const error = msg.error as Record<string, unknown> | undefined;
  const errorType = (error?.type as string) || 'LiteArmError';
  const errorMessage = (error?.message as string) || 'Unknown error';
  const errorDetails: Record<string, unknown> = {};

  if (error?.details) {
    const details = error.details as { key: string; value: Record<string, unknown> }[];
    for (const entry of details) {
      errorDetails[entry.key] = fromProtoJSON(entry.value);
    }
  }

  throw new LiteArmError(errorMessage, errorType, errorDetails);
}

/**
 * Encode an RPC reply (for server-side use).
 */
export function encodeReply(ok: boolean, result?: unknown, error?: Error): Uint8Array {
  if (!RpcReply) throw new Error('Codec not initialized');

  const msg: Record<string, unknown> = { ok };

  if (ok) {
    msg.result = toProtoValue(result);
  } else {
    msg.error = {
      type: error?.name || 'LiteArmError',
      message: error?.message || 'Unknown error',
      details: [],
    };
  }

  return RpcReply.encode(RpcReply.create(msg)).finish();
}

/**
 * Decode a RobotState from protobuf bytes.
 */
export function decodeState(payload: Uint8Array): RobotState {
  if (!RobotStateMsg) throw new Error('Codec not initialized');

  const msg = RobotStateMsg.decode(payload);
  return msg.toJSON() as RobotState;
}

/**
 * Encode an Estop signal.
 */
export function encodeEstop(trigger: boolean = true): Uint8Array {
  if (!EstopMsg) throw new Error('Codec not initialized');

  const msg = EstopMsg.create({ trigger });
  return EstopMsg.encode(msg).finish();
}

/**
 * Decode an Estop signal.
 */
export function decodeEstop(payload: Uint8Array): boolean {
  if (!EstopMsg) throw new Error('Codec not initialized');

  const msg = EstopMsg.decode(payload) as unknown as Record<string, unknown>;
  return msg.trigger as boolean;
}
