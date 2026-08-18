# litearm-js 浏览器样例

浏览器端样例，通过 WebSocket 直连机械臂控制服务，用 litearm-js SDK 控制机械臂与末端外设。

| 样例 | 说明 |
|---|---|
| [index.html](index.html) | LiteArm Web Control — 全功能调试面板 |
| [gripper-teleop.html](gripper-teleop.html) | 夹爪遥操调试面板（主从夹爪遥操） |

## 前提

1. 机械臂控制服务已启动并开启 WebSocket 端点（默认 `ws://<server>:7447`）：

   ```bash
   python -m litearm_server --endpoint tcp/0.0.0.0:7447 --iface can0
   ```

2. 浏览器与 server 网络互通。

## 运行

```bash
cd litearm-js
npx serve examples
# 浏览器打开 http://localhost:3000/index.html
```

页面左上角可填写 WebSocket 端点与 arm-id，点击「连接」后开始控制。

## LiteArm Web Control — 全功能调试面板

`index.html` 覆盖 litearm-js 的完整 API，是 SDK 功能对齐的直观演示：

- 🎯 关节运动：`movej` / `recover_joint_limits`
- 📐 笛卡尔运动：`movel` / `movec` / `movep`
- 🧮 运动规划（纯计算，不动臂）：`fk` / `ik` / `plan_movel` / `plan_movec` / `plan_movep`
- ⏯ 轨迹回放：`replay_trajectory` / `replay_joint_path` / `replay_timed_trajectory` / `play_trajectory`
- 🪶 零重力 / 保持 / 阻抗：`zero_gravity` / `hold` / `joint_impedance` / `cartesian_impedance` / `joint_follow`
- ⚖️ 末端负载：`set_payload` / `get_payload`
- 🏗️ 安装角度：`set_installation` / `get_installation`
- 📊 PD 增益 / 故障：`set_gains` / `get_gains` / `clear_faults`
- 🖥️ 系统信息：`get_system_stats` / `get_logs`
- ⚙️ 设置（settings）：关节限位 / 零位偏移 / 末端 / 笛卡尔限位 / 碰撞配置
- 📁 轨迹文件管理：录制 / 保存 / 列表 / 回放 / 删除
- 外设设备：灵巧手 `open` / `close` / `set_gesture`、夹爪 `set_width` / `get_width`

![LiteArm Web Control 全功能调试面板](screenshot-web-control.png)

## 夹爪遥操调试面板

`gripper-teleop.html` 演示主从夹爪遥操：

- 指定本机（master）与对端（slave）夹爪的 WebSocket 端点与设备 ID
- 打开 master 夹爪，移动滑杆或调用 `set_width`，远端夹爪实时跟随
- 日志面板显示两端收发的归一化开口度

![夹爪遥操调试面板](screenshot-gripper-teleop.png)

## License

Proprietary
