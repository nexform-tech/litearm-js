# LiteArm Web — 全功能前端设计规格

**日期**: 2026-08-08
**状态**: Draft
**作者**: luochun + Claude

## 1. 概述

将旧版 LiteArm Web 应用（`/home/llx/old`，Vue + Python FastAPI 后端）改造为基于 **litearm-js SDK** 的纯前端应用，去掉 Python 后端中间层，浏览器通过 WebSocket 直连 litearm-server。

### 设计决策汇总

| 决策项 | 选择 |
|--------|------|
| 功能范围 | 全功能迁移（20+ 模块，约 30 组件） |
| 技术栈 | Vue 3 + PrimeVue 4 + TailwindCSS + Three.js + ECharts |
| 项目位置 | 独立仓库 `/home/llx/litearm-web/` |
| Server 扩展 | litearm-server 独立分支 `feature/web-rpc-extensions`，只增不改 |
| 认证 | 保留完整 JWT（登录页 + token + 密码修改） |
| 主题 | 暗色/亮色双主题 |
| 迁移策略 | Server + Frontend 并行开发（方案 C），mock 层占位 |

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                   litearm-web (新仓库)                    │
│  Vue 3 + PrimeVue 4 + TailwindCSS                       │
│  Three.js (3D URDF) + ECharts (遥测)                     │
│  Pinia (状态) + Vue Router                               │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ 组件层    │→│ Service层 │→│ litearm-js│               │
│  │ (Vue)    │  │ (统一API) │  │ SDK      │               │
│  └──────────┘  └──────────┘  └────┬─────┘               │
│                                     │                    │
└─────────────────────────────────────┼────────────────────┘
                                      │ WebSocket (port 7449)
                                      │ ws-token 认证
┌─────────────────────────────────────┼────────────────────┐
│              litearm-server (分支: feature/web-rpc-extensions)
│                                     │                    │
│  ┌──────────┐  ┌──────────┐  ┌─────┴─────┐              │
│  │pylitearm │←│ RPC分发   │←│ WsBridge  │              │
│  │Arm (硬件)│  │ (方法路由)│  │ (protobuf) │              │
│  └──────────┘  └──────────┘  └───────────┘              │
│                    │                                      │
│  ┌─────────────────┴──────────────────────┐              │
│  │ 新增 RPC 方法 (扩展)                     │              │
│  │ • system_stats / system_logs           │              │
│  │ • drag_teach (录制/回放)                │              │
│  │ • payload_identify / collision_*       │              │
│  │ • settings_* (limits/zero/ee/install)  │              │
│  │ • ota_* / network_*                    │              │
│  └────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────┘
```

### 关键设计原则

1. **Service 层隔离**：前端所有 SDK 调用经过 `src/services/` 统一层。mock 和真实 SDK 切换只改此层，组件层无感。
2. **认证流**：前端向 litearm-server HTTP 端点 `/api/auth/login` 获取 JWT token，token 作为 `?token=xxx` 传给 litearm-js WebSocket 连接。
3. **Server 分支策略**：`feature/web-rpc-extensions` 从 master 切出，只增不改。新增文件 + 在 ws_bridge.py 注册新路由，现有 37 个 RPC 方法零改动。不满意直接删分支。
4. **状态广播**：复用现有 `RobotState` 50Hz 广播，新增 `SystemStats` 1Hz 广播和 `RecordingState`/`PlaybackState` 事件驱动广播。

## 3. 布局设计

三栏布局，参考图定稿：

```
┌──────────────────────────────────────────────────────────────────┐
│ ☰ LiteArm    [Zero Gravity] [Hold] [Clear Faults]    ● Connected│
│                       顶部工具栏 (暗色)                            │
├──────────────┬───────────────────────────┬───────────────────────┤
│              │                           │                       │
│  3D 实时预览  │   关节拖动控制 (J1-J7)     │    🔴 STOP 急停       │
│              │   J1 ═══●══ 0.0          │                       │
│  RobotViewport│   J2 ═══●══ 0.5          │    (大红色按钮)        │
│  (Three.js)  │   J3 ═══●══ 0.0          │                       │
│              │   J4 ═══●══-1.0          ├───────────────────────┤
│              │   J5 ═══●══ 0.0          │                       │
│              │   J6 ═══●══ 0.6          │   轨迹录制回放         │
│              │   J7 ═══●══ 0.0          │                       │
│              │                           │   [开始录制] [停止]    │
│              │   [Enable All]            │   [回放] [暂停]        │
│              │   [Disable All]           │                       │
│              │                           │   轨迹列表:            │
│              │                           │   ├ traj_001.json     │
├──────────────┤                           │   ├ traj_002.json     │
│              │ ────────────────────────  │                       │
│  关节状态     │   笛卡尔运动              │   [导入] [导出]        │
│              │                           ├───────────────────────┤
│  温度: 42°C  │   X [___]  Y [___]       │                       │
│  状态: ready │   Z [___]                │   末端工具             │
│  故障: 无    │                           │                       │
│  力矩: ...   │   [RX+][RX-][RY+][RY-]   │   夹爪 [开] [关]      │
│  速度: ...   │   [RZ+][RZ-]             │   力: [═══●══] 0.5    │
│              │                           │   宽度: [___] mm      │
│  (遥测卡片)  │   [movel] [movec] [movep] │                       │
│              │                           │                       │
├──────────────┴───────────────────────────┴───────────────────────┤
│ [📋 Logs]  Status: ready | Temp: 42°C | Faults: none             │
└──────────────────────────────────────────────────────────────────┘
```

### 区域说明

| 区域 | 位置 | 核心组件 |
|------|------|---------|
| ① 3D 实时预览 | 左上 | RobotViewport.vue, ViewportCard.vue |
| ② 关节状态 | 左下 | JointStatusPanel.vue |
| ③ 关节拖动控制 | 中上 | JointControlPanel.vue, JointSlider.vue ×7 |
| ④ 笛卡尔运动 | 中下 | CartesianMotionPanel.vue |
| ⑤ 急停 | 右上 | EstopButton.vue |
| ⑥ 轨迹录制回放 | 右中 | TrajectoryPanel.vue, RecordControls.vue, TrajectoryList.vue |
| ⑦ 末端工具 | 右下 | EndEffectorPanel.vue |
| ⑧ 顶部工具栏 | 顶部 | AppTopbar.vue |
| ⑨ 底部状态栏 | 底部 | AppFooter.vue |

## 4. 前端项目结构

```
litearm-web/
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── public/
│   └── urdf/                    # 机器人 URDF 模型文件
├── src/
│   ├── main.ts
│   ├── App.vue
│   ├── router/
│   │   └── index.ts             # 路由: login / workspace / upgrade
│   ├── stores/
│   │   ├── arm.ts               # 机器人状态 (SDK 广播同步)
│   │   ├── connection.ts        # 连接状态 + JWT token
│   │   ├── system.ts            # 系统状态 (CPU/内存/温度)
│   │   ├── motion.ts            # 运动/录制/回放状态
│   │   └── ui.ts                # UI 状态 (主题/侧栏/对话框)
│   ├── services/                # Service 层 (核心隔离点)
│   │   ├── arm.ts               # Arm SDK 封装
│   │   ├── auth.ts              # JWT 认证
│   │   ├── system.ts            # 系统 API (stats/logs/OTA)
│   │   ├── settings.ts          # 配置 API (limits/zero/ee/install)
│   │   ├── trajectory.ts        # 轨迹管理 API
│   │   ├── factory.ts           # Mock/真实切换工厂
│   │   └── mock/
│   │       ├── arm-mock.ts      # Mock Arm 实现
│   │       └── system-mock.ts   # Mock 系统实现
│   ├── views/
│   │   ├── LoginView.vue        # 登录页
│   │   ├── WorkspaceView.vue    # 主工作区 (三栏布局)
│   │   └── UpgradeView.vue      # OTA 升级页
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppTopbar.vue    # 顶部栏
│   │   │   └── AppFooter.vue    # 底部状态栏
│   │   ├── viewport/            # ① 3D 预览
│   │   │   ├── ViewportCard.vue
│   │   │   └── RobotViewport.vue
│   │   ├── status/              # ② 关节状态
│   │   │   └── JointStatusPanel.vue
│   │   ├── control/             # ③ 关节拖动控制
│   │   │   ├── JointControlPanel.vue
│   │   │   └── JointSlider.vue
│   │   ├── motion/              # ④ 笛卡尔运动
│   │   │   ├── CartesianMotionPanel.vue
│   │   │   └── SpeedControl.vue
│   │   ├── estop/               # ⑤ 急停
│   │   │   └── EstopButton.vue
│   │   ├── trajectory/          # ⑥ 轨迹
│   │   │   ├── TrajectoryPanel.vue
│   │   │   ├── RecordControls.vue
│   │   │   └── TrajectoryList.vue
│   │   ├── device/              # ⑦ 末端工具
│   │   │   └── EndEffectorPanel.vue
│   │   ├── settings/            # 系统配置对话框
│   │   │   ├── SettingsDialog.vue
│   │   │   ├── InstallModePanel.vue
│   │   │   ├── ZeroPointPanel.vue
│   │   │   ├── JointLimitPanel.vue
│   │   │   ├── CollisionPanel.vue
│   │   │   ├── EndEffectorConfigPanel.vue
│   │   │   ├── PayloadPanel.vue
│   │   │   ├── GainsPanel.vue
│   │   │   ├── NetworkPanel.vue
│   │   │   └── CartesianLimitPanel.vue
│   │   ├── system/              # 系统功能
│   │   │   ├── SystemStats.vue
│   │   │   └── LogPanel.vue
│   │   └── common/
│   │       ├── StatusBadge.vue
│   │       └── FaultDisplay.vue
│   ├── composables/
│   │   ├── useArmState.ts       # 订阅 SDK 状态广播
│   │   ├── useMotion.ts         # 运动控制逻辑
│   │   └── useTheme.ts          # 暗/亮主题
│   └── assets/
│       └── styles/
```

## 5. 数据流与 Service 层

### Pinia Stores

```
armStore          ← SDK state 广播 (50Hz)
├─ q[7], dq[7], tau[7]    关节角/速度/力矩
├─ state: "ready"|"moving"|...   状态机
├─ faults[]                    故障列表
├─ temps[]                     温度数组
└─ watchdog, feedback          看门狗/反馈

connectionStore   ← WebSocket 连接状态
├─ connected: bool
├─ endpoint: string
├─ token: string (JWT)
└─ connect() / disconnect()

systemStore       ← system_stats 广播 (1Hz)
├─ cpu%, mem%, disk%, temp, uptime
└─ logs[] (分页加载)

motionStore       ← 运动相关状态
├─ recording: bool
├─ playback: "idle"|"playing"|"paused"
├─ trajectories[] (列表)
└─ speedScale: 1-100%

uiStore           ← UI 状态
├─ theme: "dark"|"light"
├─ settingsDialog: bool
└─ logsExpanded: bool
```

### Service 层架构

```
组件层 (Vue)
    │
    ▼
Service 层 (src/services/)
    ├─ arm.ts          → 封装 litearm-js Arm 所有方法
    ├─ auth.ts         → JWT 登录/改密
    ├─ system.ts       → 系统 stats/logs/OTA
    ├─ settings.ts     → 配置 CRUD
    ├─ trajectory.ts   → 录制/回放/管理
    └─ factory.ts      → createArmService(): 真实 or Mock
    │
    ▼
litearm-js SDK (npm 包)
    ├─ Arm(endpoint, token)
    ├─ connect() → WebSocket ws://host:7449?token=xxx
    ├─ RPC 方法 (opcode 0x01 → server → opcode 0x02)
    ├─ State 广播 (opcode 0x03, 50Hz 本地缓存)
    └─ Estop (opcode 0x04, fire-and-forget)
```

### 关键数据流

| 流 | 方向 | 机制 |
|----|------|------|
| 状态广播 (50Hz) | server → 前端 | WS opcode 0x03 → litearm-js → onState callback → armStore |
| 命令流 | 前端 → server | 用户操作 → Service → litearm-js RPC → WS opcode 0x01 → 回复 0x02 |
| 急停流 | 前端 → server | STOP 按钮 → arm.requestStop() → WS opcode 0x04 (不等回复) |
| 认证流 | 前端 → server HTTP | LoginView → POST /api/auth/login → JWT → WS ?token=xxx |

### Token 生命周期与断线重连

| 场景 | 行为 |
|------|------|
| **Token 存储** | `localStorage`（与旧版一致），key: `litearm_token` |
| **Token 过期（server 拒绝 WS）** | WS 连接返回 403 → connectionStore.connected = false → 自动跳转 LoginView，清除 localStorage token |
| **WS 意外断开** | connectionStore 检测 onclose → 进入 `reconnecting` 状态 → 指数退避重试（1s/2s/4s/8s，最大 30s）→ 用缓存 token 重连 → 成功则恢复，失败（403）则跳登录页 |
| **Token 过期（使用中）** | JWT 有效期 24h，正常使用中不太可能过期。若 RPC 返回 401 → 清除 token，跳登录页 |
| **手动登出** | 清除 localStorage token → disconnect WS → 跳转 LoginView |

### 全局速度控制

`speedScale`（1-100%）为**客户端乘数**，应用于发送命令前的 speed 参数：
- `movej` speed = 用户速度 × speedScale/100
- `movel` speed = 用户速度 × speedScale/100
- 不发送给 server 作为全局参数，仅前端缩放

### 错误处理约定

| 错误类型 | UI 行为 |
|----------|--------|
| **RPC 超时** | Toast 提示 "命令超时，请重试" (红色, 5s 自动消失) |
| **RPC 业务错误** | Toast 显示 server 返回的 error message |
| **IK 失败** | Toast "目标位姿不可达" + D-pad 按钮短暂禁用 (1s) |
| **硬件故障** | 自动弹出 FaultDisplay 详情 + 工具栏状态灯变红 |
| **WS 连接断开** | 顶部连接状态变黄 "Reconnecting..." → 成功变绿 / 失败变红 |

### 环境配置

```env
# .env.development
VITE_SERVER_ENDPOINT=192.168.31.237:7449
VITE_USE_MOCK=true
VITE_AUTH_URL=http://192.168.31.237:7449/api/auth

# .env.production
VITE_SERVER_ENDPOINT=
VITE_USE_MOCK=false
VITE_AUTH_URL=
```

## 6. litearm-server RPC 扩展

### 分支: `feature/web-rpc-extensions`

**原则**: 只增不改。新增文件 + 在 ws_bridge.py 注册新路由，现有 37 个方法零改动。

### 已有 RPC（不需改动）

| 分类 | 方法 |
|------|------|
| 运动 | movej, movel, movec, movep, replay_joint_path, replay_trajectory |
| 模式 | hold, zero_gravity, joint_impedance, cartesian_impedance |
| 运动学 | fk, ik, plan_movel, plan_movec, plan_movep |
| 参数 | get/set_gains, get/set_payload, get/set_installation |
| 状态 | get_state, get_tcp_pose, clear_faults, recover_joint_limits |
| 控制 | request_stop, clear_stop |
| 外设 | device.{id}.open/close/set_force/set_width/set_gesture |

### 新增 RPC 方法

| 分类 | 方法 | 说明 |
|------|------|------|
| 系统 | `get_system_stats` | CPU/内存/磁盘/温度/运行时间 |
| 系统 | `get_logs` | 分页查询 server 日志 |
| 系统 | `restart_service` | 重启 arm 服务 |
| 配置 | `get/set_joint_limits` | 关节角度/速度/加速度限位 |
| 配置 | `get/set_zero_offsets` | 零点偏移 |
| 配置 | `get/set_end_effector` | 末端执行器类型 + TCP 偏移 |
| 配置 | `get/set_cartesian_limits` | 笛卡尔速度/加速度限速 |
| 配置 | `get/set_collision_config` | 碰撞检测开关 + 灵敏度 |
| 配置 | `identify_payload` | 多姿态负载辨识 |
| 示教 | `start_recording` | 开始录制拖拽轨迹 |
| 示教 | `stop_recording` | 停止录制 |
| 示教 | `discard_recording` | 丢弃录制 |
| 示教 | `get_recording_state` | 录制状态 |
| 轨迹 | `list_trajectories` | 轨迹列表 |
| 轨迹 | `save_trajectory` | 保存轨迹 |
| 轨迹 | `delete_trajectory` | 删除轨迹 |
| 轨迹 | `play_trajectory` | 回放指定轨迹 |
| 轨迹 | `get_playback_state` | 回放状态 |
| 网络 | `get/set_wifi_ap` | WiFi AP 配置 |
| 网络 | `get/set_ethernet` | 以太网静态 IP |
| OTA | `get_ota_status` | OTA 状态 |
| OTA | `upload_bundle` | 上传 .raucb |
| OTA | `install_bundle` | 安装固件 |
| OTA | `reboot` | 重启 |
| 认证 | `login` (HTTP) | JWT 登录 |
| 认证 | `change_password` (HTTP) | 修改密码 |

### 新增状态广播

| 广播 | 频率 | 内容 |
|------|------|------|
| `SystemStats` | 1Hz | CPU%, mem%, disk%, temp, uptime |
| `RecordingState` | 事件驱动 | recording/stopped/saving + 时长 |
| `PlaybackState` | 事件驱动 | playing/paused/stopped + 进度 |

### 新增文件

```
litearm-server/
  feature/web-rpc-extensions/
    ├── rpc_handlers/
    │   ├── system_handler.py      # stats/logs/restart
    │   ├── settings_handler.py    # limits/zero/ee/collision
    │   ├── trajectory_handler.py  # 录制/回放/持久化
    │   ├── network_handler.py     # WiFi/Ethernet
    │   └── ota_handler.py         # OTA 升级
    ├── services/
    │   ├── system_service.py
    │   ├── settings_service.py
    │   ├── trajectory_service.py
    │   ├── network_service.py
    │   └── ota_service.py
    ├── auth/
    │   └── auth_middleware.py     # JWT HTTP 端点 (新增, 当前仅 shared-token)
    └── 修改:
        ├── ws_bridge.py           # 注册新 handler 路由 + 补 device.{id}.{method} 分发
        └── daemon.py              # (参考) device 路由已实现, WS 端需对齐
```

### 已知 Server 缺口

| 缺口 | 说明 | 修复位置 |
|------|------|---------|
| **WS bridge 无 device 路由** | 当前 ws_bridge.py 只做 `getattr(arm, method)`，不像 daemon.py 那样解析 `device.{id}.{method}` 分发到 DeviceServiceManager | ws_bridge.py 需对齐 daemon.py 的 device 路由逻辑 |
| **无 JWT 认证** | 当前 `--ws-token` 是简单字符串比较，无签名/过期/claims | auth_middleware.py 新增 JWT 生成+校验 |
| **pylitearm 版本** | 已安装 v5.0.0 仅 27 方法，源码树有 ~37 方法（含 impedance/recover 等） | 确保 server 分支基于最新 pylitearm 源码 |

## 7. 六大区域组件规格

### ① 左上: 3D 实时预览

- **组件**: RobotViewport.vue + ViewportCard.vue
- **技术**: Three.js + urdf-loader，WebGL canvas
- **数据源**: armStore.q[7] 实时驱动关节角
- **功能**: URDF 模型渲染；实时关节角同步；末端坐标轴标记；轨道控制（旋转/缩放/平移）；工具栏（坐标轴开关、聚焦、全屏）
- **帧率**: 随 state 广播 50Hz 刷新，requestAnimationFrame 插值平滑
- **参考**: 从旧版 `/home/llx/old/litearm_frontend/src/views/control-area/control/RobotViewport.vue` 移植渲染逻辑

### ② 左下: 关节状态

- **组件**: JointStatusPanel.vue
- **数据源**: armStore.temps[], faults[], state, tau[7], dq[7]
- **内容**: 7 轴状态灯（绿=使能/红=故障/灰=未使能）；温度（MOS°C/coil°C）；状态徽章；故障列表（可展开）；可选展开：力矩/速度条形图

### ③ 中上: 关节拖动控制

- **组件**: JointControlPanel.vue + JointSlider.vue × 7
- **数据源**: armStore.q[7]（当前值），关节限位（settings service）
- **每个滑块**: 关节名；range slider（限位范围）；±微调按钮（长按连续）；数值输入框；状态点；松手自动发送（可开关）
- **底部**: Enable All / Disable All；同步目标值；预设位置（Home/Zero）
- **命令**: 单轴拖动 → armService.movej(q_target, speed)

### ④ 中下: 笛卡尔运动

- **组件**: CartesianMotionPanel.vue
- **数据源**: armService.getTcpPose() 获取当前 EE 位姿
- **点动**: 6-DOF D-pad（平移 X/Y/Z + 旋转 RX/RY/RZ）；步长选择（1/5/10/50mm, 1/5/10°）；点击 → FK + 偏移 → IK → movel
- **IK 失败处理**: IK 返回 success=false 时 → Toast "目标位姿不可达"（红色, 3s）+ D-pad 按钮短暂禁用（1s）；不发送运动命令
- **目标模式**: XYZ 输入 + 旋转输入 + 同步按钮 + 发送
- **高级**: movec（via + goal）、movep（多路径点列表）
- **全局速度**: 1-100% 滑块（客户端乘数，同时缩放 movej 和 movel 的 speed 参数）

### ⑤ 右上: 急停

- **组件**: EstopButton.vue
- **功能**: 大红色圆形按钮；点击 → arm.requestStop()（opcode 0x04 fire-and-forget）；触发后变为 "Clear & Resume"；Clear → clearStop() + hold()；空格键全局快捷键

### ⑥ 右中: 轨迹录制回放 + 导入导出

- **组件**: TrajectoryPanel.vue + RecordControls.vue + TrajectoryList.vue
- **录制**: 开始 → startRecording() 进入零重力；计时器；停止 → stopRecording()；丢弃
- **回放**: 选中 → play → playTrajectory(id)；暂停/继续/停止；进度条
- **管理**: 列表（名称/时长/点数/日期）；重命名/删除；JSON 导入/导出
- **状态**: RecordingState/PlaybackState 广播同步

### ⑦ 右下: 末端工具

- **组件**: EndEffectorPanel.vue
- **数据源**: arm.device("gripper_0") 或 arm.device("hand_0")
- **SDK 缺口**: 浏览器 SDK (`arm-browser.ts`) 目前缺少 `device()` 方法（仅 Node.js SDK 有）。Phase 1 或 Phase 3 需先在 litearm-js 的 `arm-browser.ts` 中补齐 device 访问能力，或在 Phase 1 中通过 RPC 直接调用 `device.{id}.{method}` 绕过
- **夹爪**: 开/关；力度滑块 0.0-1.0；宽度输入 + 实时显示
- **灵巧手**: 手势选择下拉 + 力度滑块
- **无外设**: "未检测到末端工具" 提示

### ⑧ 顶部工具栏 + 底部状态栏

- **顶部**: ☰ 菜单；LiteArm logo；Zero Gravity / Hold / Clear Faults 按钮；连接状态 ●（绿/红/黄）；主题切换 🌙/☀️
- **底部**: 可展开日志区（默认收起）；状态文字；最高温度；故障数；运行时间；"重启服务"按钮（在 SettingsDialog 的 SystemStats 面板内，调用 `restart_service` RPC）

## 8. 实施分期

### Phase 1 — 地基搭建

**前端:**
- 初始化 litearm-web 仓库 (Vite + Vue3 + PrimeVue + TailwindCSS)
- 三栏布局骨架 (WorkspaceView.vue)
- Service 层框架 + Mock 实现
- Pinia stores 定义
- 连接管理 (connectionStore + LoginView)
- 暗/亮主题框架

**Server (feature/web-rpc-extensions):**
- 从 master 切分支
- 修复 ws_bridge.py: 补 device.{id}.{method} 路由（对齐 daemon.py）
- 注册新 handler 路由机制
- system_service (stats/logs)
- auth_middleware (JWT HTTP 端点，替代现有 shared-token)

**litearm-js SDK 修复:**
- 在 arm-browser.ts 中补齐 `device()` 方法（当前仅 arm.ts 有）

### Phase 2 — 核心控制

**前端:**
- ③ 关节拖动控制 (JointControlPanel + JointSlider ×7)
- ① 3D 实时预览 (RobotViewport — 从旧版移植)
- ② 关节状态面板
- ⑤ 急停按钮
- ⑧ 顶部工具栏
- 联调: 真机 WebSocket 连接验证

**Server:**
- settings_service (joint_limits/zero_offsets/end_effector/...)
- collision_config

### Phase 3 — 运动 + 遥测

**前端:**
- ④ 笛卡尔运动 (D-pad + movel/movec/movep)
- ② 遥测图表扩展 (ECharts — 从旧版移植)
- 全局速度控制
- ⑦ 末端工具控制

**Server:**
- trajectory_service (录制/回放/持久化)
- identify_payload

### Phase 4 — 轨迹 + 系统

**前端:**
- ⑥ 轨迹录制回放 + 导入导出
- 系统配置对话框 (Settings 10 面板 — 从旧版移植)
- 日志查看器
- 系统状态卡片
- Mock → 真实 SDK 全量切换测试

**Server:**
- network_service (WiFi AP / Ethernet)
- ota_service (upload/install/reboot)
- 完善错误处理

### Phase 5 — 收尾

- 全功能真机联调
- 暗/亮主题细节打磨
- 错误处理 + 断线重连 + 异常恢复
- litearm-server 分支 review → 决定是否合入 master
- 文档 + README

## 9. 复用策略

| 模块 | 策略 | 来源 |
|------|------|------|
| 3D 渲染 | 移植渲染逻辑 | `/home/llx/old/.../RobotViewport.vue` |
| 遥测图表 | 移植 ECharts 配置 | `/home/llx/old/.../TelemetryTab.vue` |
| Settings 面板 | 移植功能逻辑，改样式和 API | `/home/llx/old/.../SettingsDialog.vue` 等 |
| 通信层 | 全新编写 | 基于 litearm-js SDK |
| 认证 | 参考旧版逻辑 | `/home/llx/old/.../Login.vue` |
| 轨迹持久化 | server 端 JSON 文件存储 | 参考旧版后端；导入导出同格式，无序列化转换 |

## 10. 依赖关系

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
   │           │           │
   │           └── 需要真机验证
   └── 纯前端可用 mock 开发
```
