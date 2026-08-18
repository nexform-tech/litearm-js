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

### 4.5 Parameters

| Method | Description |
|---|---|
| `setGains(kp?, kd?)` / `getGains()` | Get/set PD gains |
| `setPayload(mass, com=[0,0,0])` / `getPayload()` | End-effector payload (mass + center of mass) |
| `setInstallation({ base_rpy?, gravity? })` / `getInstallation()` | Mounting orientation (base RPY or gravity vector) |

### 4.6 Peripheral Devices

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

### 4.7 Dexterous-hand convenience methods (Node only, `hand*` prefix)

`handConnect(handType="right", handJoint="L10", canIface="can0")`, `handOpen()`,
`handClose()`, `handSetGesture(gesture)`, `handFingerMove(pose)`,
`handSetSpeed(speed)`, `handSetTorque(torque)`, `handGetState()`,
`handClearFaults()`, `handListGestures()`, `handDisconnect()`.

### 4.8 System / Settings

| Method | Description |
|---|---|
| `getSystemStats()` | CPU / memory / board temperature / uptime |
| `getLogs(page=1, size=50, search='')` | Paginated logs (positional arguments) |
| `restartService()` | Restart the arm service |

Settings: `getJointLimits/setJointLimits(limits)`,
`getZeroOffsets/setZeroOffsets(offsets)`, `getEndEffector/setEndEffector(config)`,
`getCartesianLimits/setCartesianLimits(limits)`,
`getCollisionConfig/setCollisionConfig(config)`.

### 4.9 Trajectory Management (server-side recording & management)

```typescript
await arm.startRecording(); await arm.getRecordingState();
await arm.stopRecording();  await arm.discardRecording();
await arm.listTrajectories();
await arm.saveTrajectory('t1', 'demo', points, duration?);
await arm.deleteTrajectory('t1');
await arm.getPlaybackState();
```

### 4.10 End-Effector Device Management

```typescript
await arm.listDeviceTypes();
await arm.connectDevice('hand', 'lite6_hand', { deviceId: 'end_0', canIface: 'can0', config });
await arm.getActiveDevice('end_0');
await arm.disconnectDevice('end_0');
```

> In the browser, `connectDevice` packs deviceId/canIface/config into one `opts`
> object.

### 4.11 Teleop (master / slave arms)

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
