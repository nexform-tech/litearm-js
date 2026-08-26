# litearm-js

JavaScript/TypeScript SDK for the LiteArm robotic arm, supporting both the
browser (WebSocket) and Node.js.

API-compatible with [litearm-python](../litearm-python) /
[litearm-cpp](../litearm-cpp): the same method names, the same parameter
contracts, the same peripheral-device interface.

> 📖 Full developer guide & API reference: [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md).

## Features

- 🌐 **Two runtimes**: Node.js and browser (WebSocket)
- 🤖 **Complete API**: motion / planning / state / parameters / settings / trajectories / devices / teleop
- 📦 **TypeScript**: full type definitions (`litearm-js/dist`)
- 🎮 **Peripherals**: `arm.device("hand_0" / "gripper_0" / "teach_0")` unified device interface
- 🚦 **Emergency stop**: `requestStop()` high-priority e-stop (independent channel)

## Installation

```bash
npm install litearm-js
```

## Quick Start

```typescript
import { Arm } from 'litearm-js';

// Node.js uses tcp:// addresses; the browser uses ws:// addresses
const arm = new Arm({ endpoint: 'ws://192.168.1.100:7447' });
await arm.connect();

// Move to a joint target
await arm.movej([0, 0, 0, 0, 0, 0, 0], { speed: 0.5 });

// Home all joints to zero (bypasses joint-limit & self-collision checks)
await arm.home({ speed: 0.3 });

// Read state (from the broadcast cache)
const state = arm.getState();
console.log('Joint angles:', state?.q);

// End-effector peripheral: dexterous hand
const hand = arm.device('hand_0');
await hand.open();
await hand.setGesture('pinch');

// Emergency stop
arm.requestStop();

// Disconnect
await arm.close();
```

## API Reference

### Connection Management

```typescript
const arm = new Arm({ endpoint: 'ws://...', armId: 'armA' });
await arm.connect();
await arm.close();
```

### Motion Control

```typescript
// Joint-space move (speed=1.0, settle_s=1.0; optional max_cycles / allow_start_collision_recovery)
await arm.movej([0, 0, 0, 0, 0, 0, 0], { speed: 0.5 });

// Home all joints to zero — bypasses joint-limit & self-collision path checks
await arm.home({ speed: 0.3, settle_s: 0.5 });

// Recover out-of-limit joints (slowly return them to the safe boundary)
await arm.recoverJointLimits({ speed: 0.05, settle_s: 0.5, inset_rad: 0.0 });

// Cartesian motion
await arm.movel(poseGoal, { speed: 0.3 });
await arm.movec(poseVia, poseGoal);
await arm.movep([pose1, pose2, pose3]);

// Trajectory replay
await arm.replayJointPath(qPath);
await arm.replayTrajectory(trajQ, { check_singularity: true });
await arm.replayTimedTrajectory(trajQ, trajT);
await arm.playTrajectory(trajectoryOrPath);
const traj = await arm.recordTrajectory({ output: 'trajectories' });

// Zero-gravity / hold / impedance / joint following
await arm.zeroGravity({ duration_s: 10 });
await arm.hold({ kp_scale: 3.0 });
await arm.jointImpedance(qDes, K, B);
await arm.cartesianImpedance(qDes, K_cart, B_cart);
await arm.jointFollow({ K, B, speed_limit, accel_limit });
```

### Pure Computation (no motors driven)

```typescript
const [pos, rot] = await arm.fk(q);
const [q_sol, ok] = await arm.ik(pos, rot, { q_seed: q });
const path = await arm.planMovel(q_start, pose_goal);
await arm.planMovec(q_start, pose_via, pose_goal);
await arm.planMovep(q_start, poses);
```

### State Reading

```typescript
const state = arm.getState();  // broadcast cache
// state.q, state.dq, state.tau, state.fault, state.state, ...
const [position, rotation] = await arm.getTcpPose();
```

### Emergency Stop / Enable

```typescript
arm.requestStop();     // high-priority e-stop signal (independent channel)
await arm.clearStop();
await arm.enable();    // enable all motors and hold the current pose
await arm.disable();   // ⚠️ the arm drops under gravity once disabled!
```

### Parameters

```typescript
await arm.setGains({ kp: [100, 100, ...], kd: [5, 5, ...] });
const gains = await arm.getGains();
await arm.setPayload(1.5, [0.01, 0, 0.05]);  // mass, com
await arm.setInstallation({ base_rpy: [0, 0, 0] });
await arm.clearFaults();
```

### Peripheral Devices

```typescript
const hand = arm.device('hand_0');
await hand.open(); await hand.close();
await hand.setGesture('pinch');
await hand.listGestures();
await hand.fingerMove(pose);      // per-finger motion
await hand.setSpeed(speed);       // per-finger speed
await hand.setTorque(torque);     // per-finger torque
await hand.getState();

const gripper = arm.device('gripper_0');
await gripper.setWidth(0.5);
const width = await gripper.getWidth();

const teach = arm.device('teach_0');
await teach.getJoints();
await teach.getButtons();
```

Common methods: `getStatus / getInfo / connect / disconnect / clearFaults / setForce`.

### System / Settings

```typescript
const stats = await arm.getSystemStats();       // cpu/mem/board_temp/uptime
await arm.getLogs(1, 50, 'movej');              // (page, size, search)
await arm.restartService();

// settings: joint limits / zero offsets / end effector / Cartesian limits / collision config
await arm.getJointLimits();   await arm.setJointLimits(limits);
await arm.getZeroOffsets();   await arm.setZeroOffsets(offsets);
await arm.getEndEffector();   await arm.setEndEffector(config);
await arm.getCartesianLimits(); await arm.setCartesianLimits(limits);
await arm.getCollisionConfig(); await arm.setCollisionConfig(config);
```

### Trajectory Management (server-side recording & management)

```typescript
await arm.startRecording();
await arm.getRecordingState();
await arm.stopRecording();
await arm.discardRecording();
await arm.listTrajectories();
await arm.saveTrajectory('t1', 'demo', points, duration);
await arm.deleteTrajectory('t1');
await arm.getPlaybackState();
```

### End-Effector Device Management

```typescript
await arm.listDeviceTypes();                     // built-in end-effector types
await arm.connectDevice('hand', 'lite6_hand', { deviceId: 'end_0', canIface: 'can0' });
await arm.getActiveDevice();
await arm.disconnectDevice();
```

### Teleop (master / slave arms)

```typescript
await arm.enterTeleop('master');                                   // this arm samples & publishes
await arm.enterTeleop('slave', { peer: 'tcp/10.0.0.2:7447' });     // follow a master
await arm.getTeleopStatus();
await arm.exitTeleop();
```

> In teleop mode the service rejects all manual-control commands; only read-only,
> emergency-stop, and `exitTeleop` calls are allowed.

## Server Configuration

Start the arm control service with the corresponding endpoints enabled:

```bash
python -m litearm_server --endpoint tcp/0.0.0.0:7447 --iface can0
```

- **Node.js**: connect address `tcp/<server>:7447`
- **Browser**: connect address `ws://<server>:7447`

## Architecture

```text
Node.js (litearm-js) ──tcp──→ Arm control service ──→ Arm / CAN
Browser (litearm-js) ──ws──→ Arm control service
```

## Examples

See [examples/README.md](examples/README.md):

- `index.html` — LiteArm Web Control, a full-featured debugging panel (covers the complete API)
- `gripper-teleop.html` — gripper teleop debugging panel

```bash
cd litearm-js
npx serve examples
# open http://localhost:3000/index.html in a browser
```

## Browser Compatibility

- Chrome/Edge 90+, Firefox 90+, Safari 15+
- Requires: WebSocket, ES2020+

## Development

```bash
npm install
npm run build       # build
npm run typecheck   # type check
npm test            # tests
```

## License

Proprietary
