# litearm-js

LiteArm 机械臂 JavaScript/TypeScript SDK，支持浏览器和 Node.js 环境。

## 特性

- 🌐 **浏览器支持**: 通过 WebSocket 连接 litearm-server
- 🤖 **完整 API**: 与 Python SDK (litearm-python) 功能一致
- 📦 **TypeScript**: 完整的类型定义
- 🎮 **外设支持**: 支持灵巧手、夹爪、示教板等外设

## 安装

```bash
npm install litearm-js
```

## 快速开始

```typescript
import { Arm } from 'litearm-js';

// 创建客户端
const arm = new Arm({ endpoint: 'ws://192.168.1.100:7447' });
await arm.connect();

// 移动到关节目标
await arm.movej([0, 0, 0, 0, 0, 0, 0], { speed: 0.5 });

// 获取状态
const state = arm.getState();
console.log('Joint angles:', state?.q);

// 急停
arm.requestStop();

// 断开连接
await arm.close();
```

## API

### Arm 类

#### 连接管理

```typescript
const arm = new Arm({ endpoint: 'ws://...', armId: 'armA' });
await arm.connect();
await arm.close();
```

#### 运动控制

```typescript
// 关节运动
await arm.movej([0, 0, 0, 0, 0, 0, 0], { speed: 0.5 });

// 直线运动
await arm.movel(poseGoal, { speed: 0.3 });

// 圆弧运动
await arm.movec(poseVia, poseGoal);

// 路径运动
await arm.movep([pose1, pose2, pose3]);

// 零重力模式
await arm.zeroGravity();

// 保持位置
await arm.hold({ kp_scale: 3.0 });
```

#### 状态读取

```typescript
// 获取最新状态（从广播缓存）
const state = arm.getState();
// state.q, state.dq, state.tau, state.state, ...

// 获取 TCP 位姿
const [position, rotation] = await arm.getTcpPose();
```

#### 急停

```typescript
// 发送急停信号
arm.requestStop();

// 清除停止状态
await arm.clearStop();
```

#### 使能 / 失能

```typescript
// 使能全部电机并锁住当前姿态（disable 之后重新使能）
await arm.enable();

// 失能全部电机 —— ⚠️ 机械臂会在重力作用下坠落！CAN 连接保持，可用 enable() 恢复
await arm.disable();
```

#### 参数调节

```typescript
// PD 增益
await arm.setGains({ kp: [100, 100, ...], kd: [5, 5, ...] });
const gains = await arm.getGains();

// 负载
await arm.setPayload(1.5, [0.01, 0, 0.05]);  // mass, com
const payload = await arm.getPayload();

// 清除故障
await arm.clearFaults();
```

#### 外设设备

```typescript
// 灵巧手
const hand = arm.device('hand_0');
await hand.open();
await hand.close();
await hand.setGesture('pinch');

// 夹爪
const gripper = arm.device('gripper_0');
await gripper.open();
await gripper.setWidth(0.5);
const width = await gripper.getWidth();

// 示教板
const teach = arm.device('teach_0');
const joints = await teach.getJoints();
const buttons = await teach.getButtons();
```

## 服务端配置

litearm-server 需要启用 WebSocket 端点：

```bash
# 启动 server（WebSocket 端口）
python -m litearm_server \
    --endpoint tcp/0.0.0.0:7447 \
    --iface can0
```

**注意**: 浏览器需要通过 Zenoh router 的 WebSocket 端口连接。

## 架构

```
浏览器 (litearm-js)
    ↓ WebSocket (zenoh-ts)
Zenoh Router
    ↓
litearm-server (Python)
    ↓
pylitearm.Arm → 机械臂
```

## 浏览器兼容性

- Chrome/Edge 90+
- Firefox 90+
- Safari 15+

需要浏览器支持:
- WebSocket
- ES2020+
- WebAssembly (zenoh-ts 依赖)

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 开发模式
npm run dev

# 测试
npm test

# 类型检查
npm run typecheck
```

## 示例

查看 `examples/` 目录：

- `index.html` - Web 控制面板

```bash
# 启动开发服务器
npx serve examples
```

## License

Proprietary
