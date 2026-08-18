# litearm-js 开发指南与接口说明

`litearm-js` 是 LiteArm 机械臂的 JavaScript/TypeScript SDK，支持两种运行环境：

- **Node.js**（`arm.ts`）：在服务端脚本中直接连接机械臂控制服务
- **浏览器**（`arm-browser.ts`）：经 WebSocket 连接机械臂控制服务，适合网页应用

两端的接口方法与参数契约与 litearm-python / litearm-cpp 对齐。

```text
Node.js ──tcp──→ 机械臂控制服务 ──→ 机械臂 / CAN
浏览器 ──ws──→ 机械臂控制服务
```

---

## 1. 环境要求与安装

| 项目 | 要求 |
|---|---|
| Node.js | 18+（Node 端） |
| 浏览器 | Chrome/Edge 90+、Firefox 90+、Safari 15+，支持 WebSocket |

```bash
npm install litearm-js
```

## 2. 快速开始

```typescript
import { Arm } from 'litearm-js';

// Node.js 用 tcp:// 地址；浏览器用 ws:// 地址
const arm = new Arm({ endpoint: 'ws://192.168.1.100:7447' });
await arm.connect();

await arm.movej([0, 0, 0, 0, 0, 0, 0], { speed: 0.5 });
const state = arm.getState();            // 状态缓存（同步）
console.log('Joint angles:', state?.q);

const hand = arm.device('hand_0');       // 末端外设
await hand.open();
await hand.setGesture('pinch');

arm.requestStop();                       // 高优先级急停（独立通道）
await arm.close();
```

## 3. 连接管理

```typescript
// Node 版：对象参数
const arm = new Arm({ endpoint: 'tcp/192.168.1.100:7447', armId: 'armA' });
await arm.connect();

// 浏览器版：位置参数，endpoint + 可选 token（自动拼到 URL ?token=...）
const armBrowser = new Arm('ws://192.168.1.100:7447', token);
armBrowser.connected;                    // 浏览器版：连接状态 getter
```

- `connect()` 建立连接并订阅状态广播；`close()` 断开。
- `getState()` 同步读取状态缓存，无状态返回 `null`。

## 4. 接口说明

> 运动类方法返回 `Promise<boolean>`；纯计算返回数据；其他接口返回 `Promise<Record<string, unknown>>`。
> 除特殊说明外，两端签名一致。

### 4.1 计算（不驱动电机）

| 方法 | 说明 |
|---|---|
| `fk(q)` | 正运动学 → `[位置, 旋转矩阵]` |
| `ik(pos_d, R_d, q_seed?)` | 逆运动学 → `[关节角, 是否成功]` |
| `planMovel(q_start, pose_goal)` | 直线笛卡尔路径规划 |
| `planMovec(q_start, pose_via, pose_goal)` | 圆弧路径规划（过中间点） |
| `planMovep(q_start, poses_goal)` | 多航点路径规划 |

### 4.2 运动控制（可选参数放 options 对象）

| 方法 | 说明 |
|---|---|
| `movej(q_target, { speed=1.0, settle_s=1.0, max_cycles, allow_start_collision_recovery })` | 关节空间点到点 |
| `recoverJointLimits({ speed=0.05, settle_s=0.5, inset_rad=0.0, max_cycles })` | 越限关节缓慢回安全边界（需 server `allow_limit_recovery=True`） |
| `movel(pose_goal, { speed=1.0, settle_s=0.8, max_cycles })` | 笛卡尔直线 |
| `movec(pose_via, pose_goal, { speed=1.0, settle_s=0.8, max_cycles })` | 笛卡尔圆弧 |
| `movep(poses_goal, { speed=1.0, settle_s=0.8, max_cycles })` | 多航点带拐角平滑 |
| `replayJointPath(q_path, { speed=1.0, settle_s=0.5, goto_start=true, goto_speed=0.3, max_cycles })` | 回放关节序列 |
| `replayTrajectory(traj_q, { speed=1.0, goto_start=true, goto_speed=0.3, max_cycles, check_singularity=true })` | 回放已录轨迹 |
| `replayTimedTrajectory(traj_q, traj_t, { speed=1.0, goto_start=true, goto_speed=0.3, simplify_tolerance_rad=0.01, max_cycles })` | 按原始时间轴回放（自动拉伸保安全） |
| `playTrajectory(trajectoryOrPath, { speed=1.0, goto_start=true, goto_speed=0.3, verify_robot=true, simplify_tolerance_rad=0.01, max_cycles })` | 回放已保存轨迹（对象或 server 侧路径） |
| `recordTrajectory({ output='trajectories', duration_s, sample_rate_hz=100, filter_alpha=0.15, name })` | 拖动录轨迹 → `JointTrajectory` |
| `hold({ kp_scale=3.0, max_cycles })` | 提高刚度持位 |
| `zeroGravity({ max_cycles, duration_s, measured_overspeed_factor, vel_max })` | 零重力（自由拖动）模式 |
| `jointImpedance(q_des, K, B, { tau_max, engage_sec=0.3, max_cycles })` | 关节空间阻抗控制 |
| `cartesianImpedance(q_des, K_cart, B_cart, { v_des, tau_max, engage_sec=0.3, max_cycles, sigma_min_thresh, max_ori_err, measured_overspeed_factor, vel_max })` | 笛卡尔空间阻抗控制 |
| `jointFollow({ K, B, speed_limit, accel_limit, engage_sec=0.3, max_cycles, duration_s })` | 跟随外部目标 |

### 4.3 状态读取

| 方法 | 说明 |
|---|---|
| `getState()` | 状态缓存最近状态（同步）→ `RobotState \| null` |
| `getTcpPose()` | 当前 TCP 位姿 → `[位置, 旋转矩阵]` |

### 4.4 急停 / 使能

| 方法 | 说明 |
|---|---|
| `requestStop()` | 高优先级急停（独立急停通道） |
| `clearStop()` | 清除停止状态回到就绪 |
| `enable()` | 使能全部电机并锁住当前姿态 |
| `disable()` | ⚠️ 失能全部电机（机械臂会掉臂！），CAN 保持连接 |
| `clearFaults()` | 清除电机故障 → `[motor_id, fault_code][]` |

### 4.5 参数调节

| 方法 | 说明 |
|---|---|
| `setGains(kp?, kd?)` / `getGains()` | PD 增益设置/读取 |
| `setPayload(mass, com=[0,0,0])` / `getPayload()` | 末端负载（质量 + 质心） |
| `setInstallation({ base_rpy?, gravity? })` / `getInstallation()` | 安装姿态（基座 RPY 或重力向量） |

### 4.6 外设设备

统一入口 `arm.device(deviceId)`，方法路由到对应设备接口 `device.{deviceId}.{method}`。

```typescript
const hand = arm.device('hand_0');
await hand.open(); await hand.close();          // 开/合
await hand.setForce(0.5);                       // 抓取力
await hand.getState(); await hand.listGestures();
await hand.setGesture('pinch');                 // 手势
await hand.fingerMove(pose);                    // 逐指
await hand.setSpeed(speed); await hand.setTorque(torque);

const gripper = arm.device('gripper_0');
await gripper.setWidth(0.5); const w = await gripper.getWidth();

const teach = arm.device('teach_0');
await teach.getJoints(); await teach.getButtons();

// 通用：getStatus / getInfo / connect / disconnect / clearFaults
```

> 设备句柄统一懒创建并缓存（DeviceManager）。浏览器端 `device()` 返回 `DeviceProxy`
> （同方法集，另含 `gripperTeleopEnter/Exit/Status` 夹爪遥操专用方法）。

### 4.7 灵巧手便捷方法（Node 版专有，`hand*` 前缀）

`handConnect(handType="right", handJoint="L10", canIface="can0")`、`handOpen()`、`handClose()`、
`handSetGesture(gesture)`、`handFingerMove(pose)`、`handSetSpeed(speed)`、`handSetTorque(torque)`、
`handGetState()`、`handClearFaults()`、`handListGestures()`、`handDisconnect()`。

### 4.8 系统 / 设置

| 方法 | 说明 |
|---|---|
| `getSystemStats()` | CPU / 内存 / 板温 / 运行时长 |
| `getLogs(page=1, size=50, search='')` | 分页日志（位置参数） |
| `restartService()` | 重启 arm 服务 |

设置：`getJointLimits/setJointLimits(limits)`、`getZeroOffsets/setZeroOffsets(offsets)`、
`getEndEffector/setEndEffector(config)`、`getCartesianLimits/setCartesianLimits(limits)`、
`getCollisionConfig/setCollisionConfig(config)`。

### 4.9 轨迹管理（服务端录制与管理）

```typescript
await arm.startRecording(); await arm.getRecordingState();
await arm.stopRecording();  await arm.discardRecording();
await arm.listTrajectories();
await arm.saveTrajectory('t1', 'demo', points, duration?);
await arm.deleteTrajectory('t1');
await arm.getPlaybackState();
```

### 4.10 末端设备管理

```typescript
await arm.listDeviceTypes();
await arm.connectDevice('hand', 'lite6_hand', { deviceId: 'end_0', canIface: 'can0', config });
await arm.getActiveDevice('end_0');
await arm.disconnectDevice('end_0');
```

> 浏览器版 `connectDevice` 的 deviceId/canIface/config 收进一个 `opts` 对象参数。

### 4.11 遥操（主从机械臂）

```typescript
await arm.enterTeleop('master');                                // 本臂采样发布
await arm.enterTeleop('slave', { peer: 'tcp/10.0.0.2:7447' });  // 跟随 master
await arm.getTeleopStatus();
await arm.exitTeleop();
```

> 遥操态下服务端拒绝一切手动控制指令，只放行只读 / 急停 / `exitTeleop`。

## 5. 异常处理

调用失败抛 `LiteArmError`（`Error` 子类）：

```typescript
import { LiteArmError } from 'litearm-js';

try {
  await arm.movej([0, 0, 0, 0, 0, 0, 0]);
} catch (e) {
  if (e instanceof LiteArmError) {
    console.log(e.errorType, e.message, e.details);   // 服务端异常类型原样透传
  }
}
```

服务端异常类型经 `errorType` 字段透传（如 `NotConnectedError`、`MotionTimeoutError`、
`MotorFaultError`、`TeleopBusyError` 等，与 litearm-python 同名）。

常见连接错误信息：`'Arm not connected. Call connect() first.'`（未连接时调用）。

## 6. 安全提示

- ⚠️ `disable()` 会使机械臂在重力作用下坠落，务必确认安全。
- `requestStop()` 为高优先级急停，应绑定到独立物理急停通道。
- 遥操态下不会执行手动控制指令。
- `recoverJointLimits` 仅在 server 以 `allow_limit_recovery=True` 启动时可用。

## 7. 服务端配置

```bash
python -m litearm_server --endpoint tcp/0.0.0.0:7447 --iface can0
```

- **Node.js**：连接地址 `tcp/<server>:7447`
- **浏览器**：连接地址 `ws://<server>:7447`

## 8. 常见问题

| 问题 | 处理 |
|---|---|
| `getState()` 返回 `null` | 未收到状态广播：确认 server 已启动、endpoint/armId 正确 |
| 浏览器连不上 | 确认服务端 WebSocket 端口已开放、同源或 CORS 放行 |
| 调用长时间无响应 | 检查网络 / server 状态，必要时重启服务 |
| 方法不存在报错 | 确认 server 版本与此 SDK 对齐（以机械臂控制服务提供的接口为准） |

## 9. 开发

```bash
npm install
npm run typecheck
npm run build
npm test
```

## License

Proprietary
