# litearm-js

LiteArm 机械臂的 JavaScript/TypeScript SDK，支持浏览器（WebSocket）和 Node.js 两种环境。

与 [litearm-python](../litearm-python) / [litearm-cpp](../litearm-cpp) API 对齐：同样的方法名、同样的参数契约、同样的外设接口。

> 📖 完整开发指南与接口说明见 [docs/DEVELOPER_GUIDE.zh-CN.md](docs/DEVELOPER_GUIDE.zh-CN.md)。

## 特性

- 🌐 **双环境**: Node.js 与浏览器（WebSocket）
- 🤖 **完整 API**: 运动 / 规划 / 状态 / 参数 / 设置 / 轨迹 / 设备 / 遥操
- 📦 **TypeScript**: 完整类型定义（`litearm-js/dist`）
- 🎮 **外设支持**: `arm.device("hand_0" / "gripper_0" / "teach_0")` 统一外设接口
- 🚦 **急停通道**: `requestStop()` 高优先级急停（独立通道）

## 安装

```bash
npm install litearm-js
```

## 快速开始

```typescript
import { Arm } from 'litearm-js';

// Node.js 用 tcp:// 地址；浏览器用 ws:// 地址
const arm = new Arm({ endpoint: 'ws://192.168.1.100:7447' });
await arm.connect();

// 移动到关节目标
await arm.movej([0, 0, 0, 0, 0, 0, 0], { speed: 0.5 });

// 读取状态（广播缓存）
const state = arm.getState();
console.log('Joint angles:', state?.q);

// 末端外设：灵巧手
const hand = arm.device('hand_0');
await hand.open();
await hand.setGesture('pinch');

// 急停
arm.requestStop();

// 断开连接
await arm.close();
```

## API 参考

### 连接管理

```typescript
const arm = new Arm({ endpoint: 'ws://...', armId: 'armA' });
await arm.connect();
await arm.close();
```

### 运动控制

```typescript
// 关节运动（speed=1.0, settle_s=1.0；可选 max_cycles / allow_start_collision_recovery）
await arm.movej([0, 0, 0, 0, 0, 0, 0], { speed: 0.5 });

// 越限恢复（缓慢回到安全边界）
await arm.recoverJointLimits({ speed: 0.05, settle_s: 0.5, inset_rad: 0.0 });

// 笛卡尔运动
await arm.movel(poseGoal, { speed: 0.3 });
await arm.movec(poseVia, poseGoal);
await arm.movep([pose1, pose2, pose3]);

// 轨迹回放
await arm.replayJointPath(qPath);
await arm.replayTrajectory(trajQ, { check_singularity: true });
await arm.replayTimedTrajectory(trajQ, trajT);
await arm.playTrajectory(trajectoryOrPath);
const traj = await arm.recordTrajectory({ output: 'trajectories' });

// 零重力 / 保持 / 阻抗 / 关节跟随
await arm.zeroGravity({ duration_s: 10 });
await arm.hold({ kp_scale: 3.0 });
await arm.jointImpedance(qDes, K, B);
await arm.cartesianImpedance(qDes, K_cart, B_cart);
await arm.jointFollow({ K, B, speed_limit, accel_limit });
```

### 纯计算（不驱动电机）

```typescript
const [pos, rot] = await arm.fk(q);
const [q_sol, ok] = await arm.ik(pos, rot, { q_seed: q });
const path = await arm.planMovel(q_start, pose_goal);
await arm.planMovec(q_start, pose_via, pose_goal);
await arm.planMovep(q_start, poses);
```

### 状态读取

```typescript
const state = arm.getState();  // 广播缓存
// state.q, state.dq, state.tau, state.fault, state.state, ...
const [position, rotation] = await arm.getTcpPose();
```

### 急停 / 使能

```typescript
arm.requestStop();     // 高优先级急停信号（独立通道）
await arm.clearStop();
await arm.enable();    // 使能全部电机并锁住当前姿态
await arm.disable();   // ⚠️ 失能后机械臂会在重力作用下坠落！
```

### 参数调节

```typescript
await arm.setGains({ kp: [100, 100, ...], kd: [5, 5, ...] });
const gains = await arm.getGains();
await arm.setPayload(1.5, [0.01, 0, 0.05]);  // mass, com
await arm.setInstallation({ base_rpy: [0, 0, 0] });
await arm.clearFaults();
```

### 外设设备

```typescript
const hand = arm.device('hand_0');
await hand.open(); await hand.close();
await hand.setGesture('pinch');
await hand.listGestures();
await hand.fingerMove(pose);      // 逐指运动
await hand.setSpeed(speed);       // 各指速度
await hand.setTorque(torque);     // 各指力矩
await hand.getState();

const gripper = arm.device('gripper_0');
await gripper.setWidth(0.5);
const width = await gripper.getWidth();

const teach = arm.device('teach_0');
await teach.getJoints();
await teach.getButtons();
```

通用方法：`getStatus / getInfo / connect / disconnect / clearFaults / setForce`。

### 系统 / 设置

```typescript
const stats = await arm.getSystemStats();       // cpu/mem/board_temp/uptime
await arm.getLogs(1, 50, 'movej');              // (page, size, search)
await arm.restartService();

// settings：关节限位 / 零位偏移 / 末端 / 笛卡尔限位 / 碰撞配置
await arm.getJointLimits();   await arm.setJointLimits(limits);
await arm.getZeroOffsets();   await arm.setZeroOffsets(offsets);
await arm.getEndEffector();   await arm.setEndEffector(config);
await arm.getCartesianLimits(); await arm.setCartesianLimits(limits);
await arm.getCollisionConfig(); await arm.setCollisionConfig(config);
```

### 轨迹管理（服务端录制与管理）

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

### 末端设备管理

```typescript
await arm.listDeviceTypes();                     // 内置末端类型
await arm.connectDevice('hand', 'lite6_hand', { deviceId: 'end_0', canIface: 'can0' });
await arm.getActiveDevice();
await arm.disconnectDevice();
```

### 遥操（主从机械臂）

```typescript
await arm.enterTeleop('master');                                   // 本臂采样发布
await arm.enterTeleop('slave', { peer: 'tcp/10.0.0.2:7447' });     // 跟随 master
await arm.getTeleopStatus();
await arm.exitTeleop();
```

> 遥操态下服务端拒绝一切手动控制指令，只放行只读 / 急停 / `exitTeleop`。

## 服务端配置

开启机械臂控制服务的对应连接端点：

```bash
python -m litearm_server --endpoint tcp/0.0.0.0:7447 --iface can0
```

- **Node.js**: 连接地址 `tcp/<server>:7447`
- **浏览器**: 连接地址 `ws://<server>:7447`

## 架构

```text
Node.js (litearm-js) ──tcp──→ 机械臂控制服务 ──→ 机械臂 / CAN
浏览器 (litearm-js) ──ws──→ 机械臂控制服务
```

## 示例

见 [examples/README.zh-CN.md](examples/README.zh-CN.md)：

- `index.html` — LiteArm Web Control 全功能调试面板（覆盖完整 API）
- `gripper-teleop.html` — 夹爪遥操调试面板

```bash
cd litearm-js
npx serve examples
# 浏览器打开 http://localhost:3000/index.html
```

## 浏览器兼容性

- Chrome/Edge 90+，Firefox 90+，Safari 15+
- 需要：WebSocket、ES2020+

## 开发

```bash
npm install
npm run build       # 构建
npm run typecheck   # 类型检查
npm test            # 测试
```

## License

Proprietary
