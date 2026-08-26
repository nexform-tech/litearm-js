# litearm-js Developer Guide & API Reference

`litearm-js` is the JavaScript/TypeScript SDK for the LiteArm robotic arm. It
supports two runtimes:

- **Node.js** (`arm.ts`): connect to the arm control service directly from
  server-side scripts
- **Browser** (`arm-browser.ts`): connect to the arm control service over
  WebSocket — ideal for web applications

The interface methods and parameter contracts match litearm-python /
litearm-cpp.

```text
Node.js ──tcp──→ Arm control service ──→ Arm / CAN
Browser ──ws──→ Arm control service
```

---

## Table of Contents

- [1. Requirements & Installation](#1-requirements--installation)
- [2. Quick Start](#2-quick-start)
- [3. Connection Management](#3-connection-management)
- [4. API Reference](#4-api-reference)
  - [4.1 Computation (no motors driven)](#41-computation-no-motors-driven)
  - [4.2 Motion Control](#42-motion-control-optional-args-in-the-options-object)
  - [4.3 State Reading](#43-state-reading)
  - [4.4 Emergency Stop / Enable](#44-emergency-stop--enable)
  - [4.5 DIRECT Mode — Per-frame MIT Direct Control](#45-direct-mode--per-frame-mit-direct-control)
  - [4.6 Parameters](#46-parameters)
  - [4.7 Peripheral Devices](#47-peripheral-devices)
  - [4.8 Dexterous-hand convenience methods](#48-dexterous-hand-convenience-methods-node-only-hand-prefix)
  - [4.9 System / Settings](#49-system--settings)
  - [4.10 Trajectory Management](#410-trajectory-management-server-side-recording--management)
  - [4.11 End-Effector Device Management](#411-end-effector-device-management)
  - [4.12 Teleop (master / slave arms)](#412-teleop-master--slave-arms)
- [5. Exceptions](#5-exceptions)
- [6. Safety Notes](#6-safety-notes)
- [7. Server Configuration](#7-server-configuration)
- [8. FAQ](#8-faq)
- [9. Development](#9-development)

## 1. Requirements & Installation

| Item | Requirement |
|---|---|
| Node.js | 18+ (Node runtime) |
| Browser | Chrome/Edge 90+, Firefox 90+, Safari 15+, WebSocket supported |

```bash
npm install litearm-js
```

## 2. Quick Start

```typescript
import { Arm } from 'litearm-js';

// Node.js uses tcp:// addresses; the browser uses ws:// addresses
const arm = new Arm({ endpoint: 'ws://192.168.1.100:7447' });
await arm.connect();

await arm.movej([0, 0, 0, 0, 0, 0, 0], { speed: 0.5 });
const state = arm.getState();            // state cache (sync)
console.log('Joint angles:', state?.q);

const hand = arm.device('hand_0');       // end-effector peripheral
await hand.open();
await hand.setGesture('pinch');

arm.requestStop();                       // high-priority emergency stop (independent channel)
await arm.close();
```

## 3. Connection Management

```typescript
// Node: object arguments
const arm = new Arm({ endpoint: 'tcp/192.168.1.100:7447', armId: 'armA' });
await arm.connect();

// Browser: positional arguments, endpoint + optional token (appended to the URL as ?token=...)
const armBrowser = new Arm('ws://192.168.1.100:7447', token);
armBrowser.connected;                    // browser: connection-state getter
```

- `connect()` establishes the connection and subscribes to the state broadcast;
  `close()` disconnects.
- `getState()` synchronously reads the state cache; returns `null` before the
  first update.

## 4. API Reference

> Motion methods return `Promise<boolean>`; pure-computation methods return data;
> other interfaces return `Promise<Record<string, unknown>>`.
> Except where noted, both runtimes share the same signatures.

### 4.1 Computation (no motors driven)

| Method | Description |
|---|---|
| `fk(q)` | Forward kinematics → `[position, rotation matrix]` |
| `ik(pos_d, R_d, q_seed?)` | Inverse kinematics → `[joint angles, success]` |
| `planMovel(q_start, pose_goal)` | Cartesian line path planning |
| `planMovec(q_start, pose_via, pose_goal)` | Circular-arc path planning (via a waypoint) |
| `planMovep(q_start, poses_goal)` | Multi-waypoint path planning |

### 4.2 Motion Control (optional args in the options object)

| Method | Description |
|---|---|
| `movej(q_target, { speed=1.0, settle_s=1.0, max_cycles, allow_start_collision_recovery })` | Joint-space point-to-point |
| `home({ speed=0.3, settle_s=0.5, max_cycles })` | Home all joints to zero — bypasses joint-limit and self-collision path checks |
| `recoverJointLimits({ speed=0.05, settle_s=0.5, inset_rad=0.0, max_cycles })` | Slowly return out-of-limit joints to the safe boundary (requires server `allow_limit_recovery=True`) |
| `movel(pose_goal, { speed=1.0, settle_s=0.8, max_cycles })` | Cartesian line move |
| `movec(pose_via, pose_goal, { speed=1.0, settle_s=0.8, max_cycles })` | Circular arc move |
| `movep(poses_goal, { speed=1.0, settle_s=0.8, max_cycles })` | Multi-waypoint move with corner blending |
| `replayJointPath(q_path, { speed=1.0, settle_s=0.5, goto_start=true, goto_speed=0.3, max_cycles })` | Replay a joint sequence |
| `replayTrajectory(traj_q, { speed=1.0, goto_start=true, goto_speed=0.3, max_cycles, check_singularity=true })` | Replay a recorded trajectory |
| `replayTimedTrajectory(traj_q, traj_t, { speed=1.0, goto_start=true, goto_speed=0.3, simplify_tolerance_rad=0.01, max_cycles })` | Replay on the original time axis (auto-stretch for safety) |
| `playTrajectory(trajectoryOrPath, { speed=1.0, goto_start=true, goto_speed=0.3, verify_robot=true, simplify_tolerance_rad=0.01, max_cycles })` | Replay a saved trajectory (object or server-side path) |
| `recordTrajectory({ output='trajectories', duration_s, sample_rate_hz=100, filter_alpha=0.15, name })` | Record by drag → `JointTrajectory` |
| `hold({ kp_scale=3.0, max_cycles })` | Hold with higher stiffness |
| `zeroGravity({ max_cycles, duration_s, measured_overspeed_factor, vel_max })` | Zero-gravity (free-drag) mode |
| `jointImpedance(q_des, K, B, { tau_max, engage_sec=0.3, max_cycles })` | Joint-space impedance control |
| `cartesianImpedance(q_des, K_cart, B_cart, { v_des, tau_max, engage_sec=0.3, max_cycles, sigma_min_thresh, max_ori_err, measured_overspeed_factor, vel_max })` | Cartesian impedance control |
| `jointFollow({ K, B, speed_limit, accel_limit, engage_sec=0.3, max_cycles, duration_s })` | Follow an external target |

### 4.3 State Reading

| Method | Description |
|---|---|
| `getState()` | Latest cached state (sync) → `RobotState \| null` |
| `getTcpPose()` | Current TCP pose → `[position, rotation matrix]` |

### 4.4 Emergency Stop / Enable

| Method | Description |
|---|---|
| `requestStop()` | High-priority emergency stop (independent channel) |
| `clearStop()` | Clear the stop condition and return to ready |
| `enable()` | Enable all motors and lock the current pose |
| `disable()` | ⚠️ Disables all motors (the arm drops under gravity!), CAN stays connected |
| `clearFaults()` | Clear motor faults → `[motor_id, fault_code][]` |

### 4.5 DIRECT Mode — Per-frame MIT Direct Control

> DIRECT mode is LiteArm's per-frame MIT direct control channel. Send five-parameter
> (kp/kd/qRef/dqRef/tauFf) commands at a typical 250Hz to control joint motors in real-time,
> with 4 never-disableable core safety guardrails built in.

**Comparison with ordinary motion control:**

| Feature | Ordinary motion control (`movej` etc.) | DIRECT mode (`sendMit`) |
| --- | --- | --- |
| Control method | Target position + velocity, auto-planned | Per-frame 5-parameter MIT command |
| Frame rate | One call, auto-execution | User loop control (typical 250Hz) |
| Blocking | Blocking, waits for completion | Non-blocking, returns immediately |
| Trajectory | Auto-planned + interpolated | User-generated |
| Guardrails | Built-in limits | 4 core + 3 optional guards |

**Entry and exit:**

- **Entry**: Automatically enters DIRECT mode on the first `sendMit` call
- **Exit**: `requestStop()` proactive / watchdog timeout auto-hold / motor fault auto-exit

#### sendMit — Send MIT Control Frame

**Description:** Async publish a five-parameter MIT control frame to the arm command channel.
Async, returns immediately. First call auto-enters DIRECT mode.

**Function Definition:**

```ts
async sendMit(
  kp: number[],      // length 7, position stiffness
  kd: number[],      // length 7, velocity damping
  qRef: number[],    // length 7, target joint angles (rad)
  dqRef: number[],   // length 7, target angular velocity (rad/s)
  tauFf: number[],   // length 7, feedforward torque (N·m)
): Promise<void>
```

**Parameters:**

| Name | Type | Description |
| --- | --- | --- |
| `kp` | `number[]` | Position stiffness, length 7, range `[0, 500]`. Typical: 15–200 |
| `kd` | `number[]` | Velocity damping, length 7, range `[0, 5]`. Typical: 0.5–3.0 |
| `qRef` | `number[]` | Target joint angles (rad), length 7. Inter-frame jumps are slew-limited |
| `dqRef` | `number[]` | Target angular velocity (rad/s), length 7. Clamped to `±DQ_MAX` |
| `tauFf` | `number[]` | Feedforward torque (N·m), length 7. Clamped to `±min(guards_tau_max, TAU_MAX)` |

**Return Value:** `Promise<void>` — async send, no acknowledgment.

**Usage Example:**

```ts
// Single frame (auto-enters DIRECT mode)
await arm.sendMit(
  [50, 50, 50, 50, 50, 50, 50],
  [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5],
  [0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0],
);
```

#### setGuards — Configure Global Guardrails

**Description:** One-time global guardrail configuration (RPC). All fields optional — omit to leave
unchanged. **Globally persistent**: not reset on DIRECT exit.

**Function Definition:**

```ts
async setGuards(opts?: {
  slewLimit?: number | null;
  tauMax?: number | null;
  watchdogTimeout?: number | null;
  positionBounds?: boolean | null;
  velocityBounds?: boolean | null;
  jerkLimit?: boolean | null;
}): Promise<unknown>
```

**Parameters:**

| Name | Type | Description |
| --- | --- | --- |
| `slewLimit` | `number` or `null` | Global slew rate limit (rad/s). `null`/`undefined` = no change |
| `tauMax` | `number` or `null` | Global torque limit (N·m). `null`/`undefined` = no change |
| `watchdogTimeout` | `number` or `null` | Watchdog timeout (s), range `[0.05, 2.0]` |
| `positionBounds` | `boolean` or `null` | Enable position soft-limits. Default `false` |
| `velocityBounds` | `boolean` or `null` | Enable velocity soft-limits. Default `false` |
| `jerkLimit` | `boolean` or `null` | Enable jerk limiting. Default `false` |

**Usage Example:**

```ts
// Combined configuration
await arm.setGuards({
  slewLimit: 1.0,
  tauMax: 10.0,
  watchdogTimeout: 0.10,
  positionBounds: true,
});
```

#### getGuards — Read Current Guardrail Configuration

**Description:** Read the currently active guardrail configuration (RPC, synchronous).

**Function Definition:**

```ts
async getGuards(): Promise<unknown>
```

**Return Value:**

```json
{
  "slew_limit": 1.0,
  "tau_max": 10.0,
  "watchdog_timeout": 0.10,
  "position_bounds": true,
  "velocity_bounds": false,
  "jerk_limit": false
}
```

**Usage Example:**

```ts
const guards = await arm.getGuards() as Record<string, unknown>;
console.log('slew_limit:', guards.slew_limit);
```

#### Full Control Loop Example

```ts
/** DIRECT mode 250Hz control loop — sine wave on joint 1. */
import { Arm } from 'litearm-js';

const DT = 0.004;  // 4ms → 250Hz
const FREQ = 0.5;
const AMP = 0.5;
const N = 7;

async function main() {
  const arm = new Arm({ endpoint: 'tcp/192.168.1.100:7447', armId: 'armA' });
  await arm.connect();

  await arm.setGuards({
    slewLimit: 2.0, tauMax: 20.0, watchdogTimeout: 0.10, positionBounds: true,
  });

  let t = 0.0;
  const interval = setInterval(async () => {
    const qRef = Array.from({ length: N }, (_, i) =>
      i === 0 ? AMP * Math.sin(2 * Math.PI * FREQ * t) : 0.0
    );
    await arm.sendMit(
      Array(N).fill(50.0), Array(N).fill(1.5), qRef,
      Array(N).fill(0.0), Array(N).fill(0.0),
    );
    t += DT;
  }, DT * 1000);

  setTimeout(async () => {
    clearInterval(interval);
    await arm.requestStop();
    console.log('DIRECT mode exited');
    process.exit(0);
  }, 30000);
}

main().catch(console.error);
```

#### Safety Guardrails

| Guardrail | Description | Disableable? |
| --- | --- | --- |
| **Guard 1: Protocol param clamp** | kp≤500, kd≤5, dq_ref≤DQ_MAX, tau_ff≤TAU_MAX | Never |
| **Guard 2: Command slew limit** | Inter-frame q_ref jump ≤ slew_limit × dt, dt capped at 0.10s | Never; `slewLimit` can be tightened |
| **Guard 3: Watchdog fail-soft** | Command interruption → auto-hold (low-stiffness PD, kp=35, kd=1.2) | Never; `watchdogTimeout` adjustable |
| **Guard 4: Single ownership** | Rejects motion commands and teleop while DIRECT active | Never |
| **Position bounds (optional)** | q_ref clamped to joint soft-limits per frame | Off by default; `positionBounds: true` |
| **Velocity bounds (optional)** | dq_ref clamped to `±DQ_MAX` per frame | Off by default; `velocityBounds: true` |
| **Jerk limit (optional)** | dq_ref change rate limited per frame | Off by default; `jerkLimit: true` |

> **Safety bottom line: The arm must never fly away.**
> Command slew limit + single ownership + watchdog fail-soft + firmware fallback.

### 4.6 Parameters

| Method | Description |
|---|---|
| `setGains(kp?, kd?)` / `getGains()` | Get/set PD gains |
| `setPayload(mass, com=[0,0,0])` / `getPayload()` | End-effector payload (mass + center of mass) |
| `setInstallation({ base_rpy?, gravity? })` / `getInstallation()` | Mounting orientation (base RPY or gravity vector) |

### 4.7 Peripheral Devices

Unified entry `arm.device(deviceId)`; methods route to the device's
`device.{deviceId}.{method}` interface.

```typescript
const hand = arm.device('hand_0');
await hand.open(); await hand.close();          // open / close
await hand.setForce(0.5);                       // grip force
await hand.getState(); await hand.listGestures();
await hand.setGesture('pinch');                 // gesture
await hand.fingerMove(pose);                    // per-finger
await hand.setSpeed(speed); await hand.setTorque(torque);

const gripper = arm.device('gripper_0');
await gripper.setWidth(0.5); const w = await gripper.getWidth();

const teach = arm.device('teach_0');
await teach.getJoints(); await teach.getButtons();

// Common: getStatus / getInfo / connect / disconnect / clearFaults
```

> Device handles are lazily created and cached (DeviceManager). In the browser,
> `device()` returns a `DeviceProxy` (same method set, plus the gripper-teleop
> methods `gripperTeleopEnter/Exit/Status`).

### 4.8 Dexterous-hand convenience methods (Node only, `hand*` prefix)

`handConnect(handType="right", handJoint="L10", canIface="can0")`, `handOpen()`,
`handClose()`, `handSetGesture(gesture)`, `handFingerMove(pose)`,
`handSetSpeed(speed)`, `handSetTorque(torque)`, `handGetState()`,
`handClearFaults()`, `handListGestures()`, `handDisconnect()`.

### 4.9 System / Settings

| Method | Description |
|---|---|
| `getSystemStats()` | CPU / memory / board temperature / uptime |
| `getLogs(page=1, size=50, search='')` | Paginated logs (positional arguments) |
| `restartService()` | Restart the arm service |
| `reconnect()` | Hardware reconnect — re-initialize motors from any state after arm hot-restart |

Settings: `getJointLimits/setJointLimits(limits)`,
`getZeroOffsets/setZeroOffsets(offsets)`, `getEndEffector/setEndEffector(config)`,
`getCartesianLimits/setCartesianLimits(limits)`,
`getCollisionConfig/setCollisionConfig(config)`.

### 4.10 Trajectory Management (server-side recording & management)

```typescript
await arm.startRecording(); await arm.getRecordingState();
await arm.stopRecording();  await arm.discardRecording();
await arm.listTrajectories();
await arm.saveTrajectory('t1', 'demo', points, duration?);
await arm.deleteTrajectory('t1');
await arm.getPlaybackState();
```

### 4.11 End-Effector Device Management

```typescript
await arm.listDeviceTypes();
await arm.connectDevice('hand', 'lite6_hand', { deviceId: 'end_0', canIface: 'can0', config });
await arm.getActiveDevice('end_0');
await arm.disconnectDevice('end_0');
```

> In the browser, `connectDevice` packs deviceId/canIface/config into one `opts`
> object.

### 4.12 Teleop (master / slave arms)

```typescript
await arm.enterTeleop('master');                                // this arm samples & publishes
await arm.enterTeleop('slave', { peer: 'tcp/10.0.0.2:7447' });  // follow a master
await arm.getTeleopStatus();
await arm.exitTeleop();
```

> In teleop mode the service rejects all manual-control commands; only read-only,
> emergency-stop, and `exitTeleop` calls are allowed.

## 5. Exceptions

Failed calls throw `LiteArmError` (an `Error` subclass):

```typescript
import { LiteArmError } from 'litearm-js';

try {
  await arm.movej([0, 0, 0, 0, 0, 0, 0]);
} catch (e) {
  if (e instanceof LiteArmError) {
    console.log(e.errorType, e.message, e.details);   // server exception type passthrough
  }
}
```

Server exception types pass through the `errorType` field (e.g.
`NotConnectedError`, `MotionTimeoutError`, `MotorFaultError`, `TeleopBusyError`,
with the same names as litearm-python).

Common connection error: `'Arm not connected. Call connect() first.'` (calling
before connecting).

## 6. Safety Notes

- ⚠️ `disable()` drops the arm under gravity — make sure the area is clear.
- `requestStop()` is a high-priority emergency stop; bind it to an independent
  physical e-stop channel.
- Manual-control commands are rejected during teleop.
- `recoverJointLimits` is only available when the server runs with
  `allow_limit_recovery=True`.

## 7. Server Configuration

```bash
python -m litearm_server --endpoint tcp/0.0.0.0:7447 --iface can0
```

- **Node.js**: connect address `tcp/<server>:7447`
- **Browser**: connect address `ws://<server>:7447`

## 8. FAQ

| Problem | Resolution |
|---|---|
| `getState()` returns `null` | No state broadcast yet: confirm the server is up and endpoint/armId are correct |
| Browser cannot connect | Confirm the server WebSocket port is open; same-origin or CORS allowed |
| Call hangs | Check the network / server state; restart the service if needed |
| Method not found | Confirm the server version matches this SDK (based on the arm control service interface set) |

## 9. Development

```bash
npm install
npm run typecheck
npm run build
npm test
```

## License

Proprietary
