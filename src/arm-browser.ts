/**
 * @file arm-browser.ts
 * @brief 浏览器端 Arm 客户端 — 通过原生 WebSocket 直连 litearm-server。
 *
 * 用法:
 *   import { Arm } from "./arm-browser.mjs";
 *   const arm = new Arm("192.168.31.237:7449");
 *   await arm.connect();
 *   const state = arm.getState();
 *   await arm.movej([0,0.5,0,-1,0,0.6,0], {speed:0.3});
 *   arm.close();
 */

import { WsTransport, Subscriber } from "./transport-browser";
import {
  initCodecSync, encodeRequest, decodeReply, decodeState,
} from "./codec";

export type { WsTransport as WsTransport, Subscriber as Subscriber };

/** Auto-initialize codec on import. */
initCodecSync();

// ── Types ──────────────────────────────────────────────────────────────

export interface RobotState {
  q: number[]; dq: number[]; tau: number[];
  fault: { joint: number; errCode: number }[];
  errs: number[]; temps: { mosTemp: number; coilTemp: number }[];
  state: string; robotSerial: string;
  configChecksumSha256: string;
  feedback: { maxAgeS: number; staleJoints: number[]; joints: { joint: number; received: number; ageS: number; fresh: boolean }[] };
  watchdog: { enabled: boolean; timeoutS: number; mode: string; tripped: boolean; lastKickAgeS: number };
}

export type Pose = [number[], number[][]];  // [position, rotation_matrix]

export interface MoveJOps { speed?: number; settle_s?: number; max_cycles?: number; allow_start_collision_recovery?: boolean; }
export interface MoveLOps { speed?: number; settle_s?: number; max_cycles?: number; }
export interface MoveCOps { speed?: number; settle_s?: number; max_cycles?: number; }
export interface MovePOps { speed?: number; settle_s?: number; max_cycles?: number; }

/** 内置末端类型(list_device_types 返回项)。 */
export interface DeviceTypeInfo {
  category: string;   // "gripper" | "hand" | ...
  subtype: string;    // "litegrip" | "lingxin" | ...
  name: string;       // 显示名
  icon: string;
  model?: string;
  vendor?: string;
}

/** 当前末端状态(get_active_device 返回)。 */
export interface ActiveDeviceInfo {
  configured: boolean;   // 状态文件是否存在
  enabled: boolean;      // 用户意图:是否应加载
  online: boolean;       // daemon 是否在运行
  category: string;
  subtype: string;
  device_id: string;
  can_iface: string;
}

/** 遥操参数(enter_teleop 传给 server；对应 TeleopManager 构造参数)。 */
export interface TeleopParams {
  /** slave: master 网络端点，如 "tcp/192.168.1.100:7447"（slave 必填）。 */
  peer?: string;
  /** slave: master 的 arm_id，决定订阅哪个 teleop topic。 */
  master_arm_id?: string;
  /** 完整 teleop topic，优先级高于 master_arm_id（一般不用）。 */
  topic?: string;
  /** master: pub 频率 Hz（默认 200）。 */
  pub_hz?: number;
  /** master: zero_gravity 速度包络系数（默认 2.0）。 */
  overspeed_factor?: number;
  /** slave: 跟随刚度 [7]。 */
  K?: number[];
  /** slave: 跟随阻尼 [7]。 */
  B?: number[];
  /** slave: 目标速度限幅 [7] rad/s。 */
  speed_limit?: number[];
  /** slave: 目标加速度限幅 [7] rad/s^2。 */
  accel_limit?: number[];
  /** slave: 数据超时阈值 ms（默认 200）。 */
  watchdog_ms?: number;
  /** slave: 启动前低速对齐到 master 位置。 */
  align?: boolean;
  /** slave: 对齐 movej 速度 rad/s（默认 0.15）。 */
  align_speed?: number;
  /** 最大遥操时长 秒（默认不限）。 */
  duration_s?: number;
}

/** 遥操状态(get_teleop_status 返回)。 */
export interface TeleopStatus {
  active: boolean;                        // 是否处于遥操态（派生自控制环死活）
  mode: "master" | "slave" | null;       // 当前遥操角色
  stats: Record<string, unknown>;        // TeleopManager.stats（帧数/fps/watchdog 等）
}

// ── Arm ────────────────────────────────────────────────────────────────

export class Arm {
  private _tp: WsTransport;
  private _stateSub: Subscriber | null = null;
  private _lastState: RobotState | null = null;
  private _url: string;

  /**
   * @param endpoint  litearm-server 地址（如 "192.168.31.237:7449"）
   * @param token     可选认证令牌，自动拼接到 URL: ?token=xxx
   */
  constructor(endpoint: string, token?: string) {
    this._tp = new WsTransport();
    let url = endpoint.includes("://") ? endpoint : `ws://${endpoint}`;
    if (token) {
      url += (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
    }
    this._url = url;
  }

  /** Connect to litearm-server WS endpoint. */
  async connect(): Promise<void> {
    await this._tp.connect(this._url);
    this._stateSub = this._tp.subState();
  }

  /** Close connection. */
  close(): void { this._tp.close(); }

  /** Connection status. */
  get connected(): boolean { return this._tp.connected; }

  // ── State reading ────────────────────────────────────────────────────

  /** Get latest robot state from broadcast cache (no RPC). */
  getState(): RobotState | null {
    if (!this._stateSub) return this._lastState;
    const raw = this._stateSub.drainLatest();
    if (raw) this._lastState = decodeState(raw) as RobotState;
    return this._lastState;
  }

  /** Get current TCP pose via RPC. */
  async getTcpPose(): Promise<Pose> { return this._rpc("get_tcp_pose"); }

  // ── Pure computation ─────────────────────────────────────────────────

  /** Forward kinematics: joint angles → (position, rotation). */
  async fk(q: number[]): Promise<Pose> { return this._rpc("fk", { q }); }

  /** Inverse kinematics: (pos, R, q_seed?) → (q, success). */
  async ik(pos: number[], R: number[][], q_seed?: number[]): Promise<[number[], boolean]> {
    return this._rpc("ik", { pos_d: pos, R_d: R, q_seed });
  }

  /** Plan a straight-line Cartesian path (no motion). */
  async planMovel(q_start: number[], pose_goal: Pose): Promise<number[][]> {
    return this._rpc("plan_movel", { q_start, pose_goal });
  }

  /** Plan a circular-arc Cartesian path. */
  async planMovec(q_start: number[], pose_via: Pose, pose_goal: Pose): Promise<number[][]> {
    return this._rpc("plan_movec", { q_start, pose_via, pose_goal });
  }

  /** Plan a multi-waypoint Cartesian path. */
  async planMovep(q_start: number[], poses: Pose[]): Promise<number[][]> {
    return this._rpc("plan_movep", { q_start, poses_goal: poses });
  }

  // ── Motion execution ─────────────────────────────────────────────────

  /** Move to joint target. */
  async movej(q_target: number[], ops: MoveJOps = {}): Promise<boolean> {
    return this._rpc("movej", {
      q_target,
      speed: ops.speed ?? 1.0,
      settle_s: ops.settle_s ?? 0.5,
      ...(ops.max_cycles != null && { max_cycles: ops.max_cycles }),
      ...(ops.allow_start_collision_recovery != null && { allow_start_collision_recovery: ops.allow_start_collision_recovery }),
    });
  }

  /** Recover from joint limit violations (requires connect with allow_limit_recovery). */
  async recoverJointLimits(ops: { speed?: number; settle_s?: number; inset_rad?: number; max_cycles?: number } = {}): Promise<boolean> {
    return this._rpc("recover_joint_limits", {
      speed: ops.speed ?? 0.05,
      settle_s: ops.settle_s ?? 0.5,
      ...(ops.inset_rad != null && { inset_rad: ops.inset_rad }),
      ...(ops.max_cycles != null && { max_cycles: ops.max_cycles }),
    });
  }

  /** Move in a straight Cartesian line. */
  async movel(pose_goal: Pose, ops: MoveLOps = {}): Promise<boolean> {
    return this._rpc("movel", {
      pose_goal,
      speed: ops.speed ?? 1.0,
      settle_s: ops.settle_s ?? 0.5,
      max_cycles: ops.max_cycles,
    });
  }

  /** Move in a circular arc through via-point. */
  async movec(pose_via: Pose, pose_goal: Pose, ops: MoveCOps = {}): Promise<boolean> {
    return this._rpc("movec", {
      pose_via, pose_goal,
      speed: ops.speed ?? 1.0,
      settle_s: ops.settle_s ?? 0.8,
      max_cycles: ops.max_cycles,
    });
  }

  /** Move through a sequence of Cartesian waypoints. */
  async movep(poses: Pose[], ops: MovePOps = {}): Promise<boolean> {
    return this._rpc("movep", {
      poses_goal: poses,
      speed: ops.speed ?? 1.0,
      settle_s: ops.settle_s ?? 0.8,
      max_cycles: ops.max_cycles,
    });
  }

  /** Replay a joint path. */
  async replayJointPath(
    q_path: number[][],
    ops: { speed?: number; settle_s?: number; goto_start?: boolean; goto_speed?: number; max_cycles?: number } = {}
  ): Promise<boolean> {
    return this._rpc("replay_joint_path", {
      q_path,
      speed: ops.speed ?? 1.0,
      settle_s: ops.settle_s ?? 0.5,
      goto_start: ops.goto_start ?? true,
      goto_speed: ops.goto_speed ?? 0.3,
      max_cycles: ops.max_cycles,
    });
  }

  /** Replay a joint trajectory (arc-length parameterized, S-curve). */
  async replayTrajectory(
    traj_q: number[][],
    ops: { speed?: number; goto_start?: boolean; goto_speed?: number; max_cycles?: number; check_singularity?: boolean } = {}
  ): Promise<boolean> {
    return this._rpc("replay_trajectory", {
      traj_q,
      speed: ops.speed ?? 1.0,
      goto_start: ops.goto_start ?? true,
      goto_speed: ops.goto_speed ?? 0.3,
      max_cycles: ops.max_cycles,
      check_singularity: ops.check_singularity ?? true,
    });
  }

  /** Replay a measured trajectory on its recorded time axis with safety-enforced scaling. */
  async replayTimedTrajectory(
    traj_q: number[][],
    traj_t: number[],
    ops: { speed?: number; goto_start?: boolean; goto_speed?: number; simplify_tolerance_rad?: number; max_cycles?: number } = {}
  ): Promise<boolean> {
    return this._rpc("replay_timed_trajectory", {
      traj_q,
      traj_t,
      speed: ops.speed ?? 1.0,
      goto_start: ops.goto_start ?? true,
      goto_speed: ops.goto_speed ?? 0.3,
      simplify_tolerance_rad: ops.simplify_tolerance_rad ?? 0.01,
      max_cycles: ops.max_cycles,
    });
  }

  /** Load and safely replay a JointTrajectory. */
  async playTrajectory(
    trajectory: Record<string, unknown>,
    ops: { speed?: number; goto_start?: boolean; goto_speed?: number; verify_robot?: boolean; simplify_tolerance_rad?: number; max_cycles?: number } = {}
  ): Promise<boolean> {
    return this._rpc("play_trajectory", {
      trajectory,
      speed: ops.speed ?? 1.0,
      goto_start: ops.goto_start ?? true,
      goto_speed: ops.goto_speed ?? 0.3,
      verify_robot: ops.verify_robot ?? true,
      simplify_tolerance_rad: ops.simplify_tolerance_rad ?? 0.01,
      max_cycles: ops.max_cycles,
    });
  }

  /** Record a trajectory in zero-gravity mode. Note: on_sample callback is dropped remotely. */
  async recordTrajectory(
    ops: { duration_s?: number; sample_rate_hz?: number; filter_alpha?: number; name?: string; output?: string } = {}
  ): Promise<Record<string, unknown>> {
    return this._rpc("record_trajectory", {
      duration_s: ops.duration_s,
      sample_rate_hz: ops.sample_rate_hz ?? 100,
      filter_alpha: ops.filter_alpha ?? 0.15,
      name: ops.name,
    });
  }

  /** Hold position with increased stiffness. */
  async hold(kp_scale = 3.0, max_cycles?: number): Promise<boolean> {
    return this._rpc("hold", { kp_scale, max_cycles });
  }

  /** Enable zero-gravity (free-drag) mode. */
  async zeroGravity(
    ops: { duration_s?: number; max_cycles?: number; measured_overspeed_factor?: number; vel_max?: number[] } = {}
  ): Promise<boolean> {
    return this._rpc("zero_gravity", {
      duration_s: ops.duration_s,
      max_cycles: ops.max_cycles,
      measured_overspeed_factor: ops.measured_overspeed_factor,
      vel_max: ops.vel_max,
    });
  }

  /** Joint-space impedance control. */
  async jointImpedance(
    q_des: number[], K: number[], B: number[],
    ops: { tau_max?: number[]; engage_sec?: number; max_cycles?: number } = {}
  ): Promise<boolean> {
    return this._rpc("joint_impedance", {
      q_des, K, B,
      tau_max: ops.tau_max,
      engage_sec: ops.engage_sec ?? 0.3,
      max_cycles: ops.max_cycles,
    });
  }

  /** Cartesian-space impedance control. */
  async cartesianImpedance(
    q_des: number[], K_cart: number[], B_cart: number[],
    ops: {
      v_des?: number[]; tau_max?: number[]; engage_sec?: number; max_cycles?: number;
      sigma_min_thresh?: number; max_ori_err?: number;
      measured_overspeed_factor?: number; vel_max?: number[];
    } = {}
  ): Promise<boolean> {
    return this._rpc("cartesian_impedance", {
      q_des, K_cart, B_cart,
      v_des: ops.v_des,
      tau_max: ops.tau_max,
      engage_sec: ops.engage_sec ?? 0.3,
      max_cycles: ops.max_cycles,
      sigma_min_thresh: ops.sigma_min_thresh,
      max_ori_err: ops.max_ori_err,
      measured_overspeed_factor: ops.measured_overspeed_factor,
      vel_max: ops.vel_max,
    });
  }

  // ── Emergency stop ────────────────────────────────────────────────────

  /** Fire-and-forget emergency stop. */
  requestStop(): void { this._tp.sendEstop(); }

  /** Clear estop and return to ready. */
  async clearStop(): Promise<void> { return this._rpc("clear_stop"); }

  /** Enable all motors and hold current pose (re-enable after disable). */
  async enable(): Promise<void> { return this._rpc("enable"); }

  /** Disable all motors (arm will drop under gravity!). CAN stays connected. */
  async disable(): Promise<void> { return this._rpc("disable"); }

  // ── Device access ─────────────────────────────────────────────────────

  /**
   * Get a proxy for a remote device (hand, gripper, etc.).
   *
   * Routes calls through litearm-server → zenoh → device daemon.
   *
   * @example
   * ```typescript
   * const hand = arm.device('hand_0');
   * await hand.call('open');
   * await hand.call('set_gesture', { gesture: 'pinch' });
   * const state = await hand.call('get_state');
   *
   * const gripper = arm.device('gripper_0');
   * await gripper.call('set_width', { width: 0.5 });
   * ```
   */
  device(deviceId: string): DeviceProxy {
    return new DeviceProxy(deviceId, (method, kwargs) => this._rpc(`device.${deviceId}.${method}`, kwargs));
  }

  /** 获取当前已连接末端的 manifest(用于渲染控制面板)。未连接返回 null。 */
  async getDeviceManifest(deviceId = "end_0"): Promise<any | null> {
    try {
      const manifest = await this._rpc(`device.${deviceId}.get_plugin_manifest`, {});
      if (manifest && !(manifest as any).error) return manifest;
    } catch { /* not connected */ }
    return null;
  }

  // ── End-effector management (无插件机制:server 按需 fork device_daemon)──

  /** 列出源码内置的可用末端类型(下拉框数据源)。 */
  async listDeviceTypes(): Promise<DeviceTypeInfo[]> {
    return this._rpc("list_device_types");
  }

  /** 连接末端:server fork device_daemon 并等其就绪 + 持久化。 */
  async connectDevice(
    category: string, subtype: string,
    opts: { deviceId?: string; canIface?: string; config?: Record<string, unknown> } = {}
  ): Promise<{ ok: boolean; device_id?: string; error?: string }> {
    return this._rpc("connect_device", {
      category, subtype,
      device_id: opts.deviceId ?? "end_0",
      can_iface: opts.canIface ?? "",
      config: opts.config,
    });
  }

  /** 断开末端:停止 daemon + 更新持久化(enabled=false,保留类型)。 */
  async disconnectDevice(deviceId = "end_0"): Promise<{ ok: boolean }> {
    return this._rpc("disconnect_device", { device_id: deviceId });
  }

  /** 查询当前末端状态(配置/在线/类型)。 */
  async getActiveDevice(deviceId = "end_0"): Promise<ActiveDeviceInfo> {
    return this._rpc("get_active_device", { device_id: deviceId });
  }

  // ── Teleop (主从遥操) ─────────────────────────────────────────────────

  /**
   * 进入遥操（与命令行 --teleop-mode 共享同一遥操状态）。
   *
   * - master：本臂 zero_gravity 采样并 pub 关节流（被 slave 订阅）。
   * - slave：用 `params.peer` 运行时连 master，订阅其关节流 → joint_follow。
   *   slave 必须提供 `peer`；`master_arm_id` 决定订阅哪个 topic。
   *
   * 进入后 server 拒绝一切手动控制类 RPC（movej/movel/hold...），
   * 只放行只读 / 急停 / exit_teleop。已在遥操中再调会被拒（TeleopBusyError）。
   */
  async enterTeleop(mode: "master" | "slave", params: TeleopParams = {}): Promise<TeleopStatus> {
    return this._rpc("enter_teleop", { mode, ...params });
  }

  /** 退出遥操：停跟随 + 解锁 + 机械臂就地持位。幂等。 */
  async exitTeleop(): Promise<{ active: boolean }> {
    return this._rpc("exit_teleop");
  }

  /** 查询当前遥操状态（active / mode / stats）。 */
  async getTeleopStatus(): Promise<TeleopStatus> {
    return this._rpc("get_teleop_status");
  }

  // ── Parameter tuning ──────────────────────────────────────────────────

  /** Set PD gains. */
  async setGains(kp?: number[], kd?: number[]): Promise<{ kp: number[]; kd: number[] }> {
    return this._rpc("set_gains", { kp, kd });
  }

  /** Get current PD gains. */
  async getGains(): Promise<{ kp: number[]; kd: number[] }> { return this._rpc("get_gains"); }

  /** Clear motor faults. */
  async clearFaults(): Promise<[number, number][]> { return this._rpc("clear_faults"); }

  /** Set end-effector payload (mass in kg, com in m). */
  async setPayload(mass: number, com: [number, number, number] = [0, 0, 0]): Promise<{ mass: number; com: number[] }> {
    return this._rpc("set_payload", { mass, com });
  }

  /** Get current payload. */
  async getPayload(): Promise<{ mass: number; com: number[] }> { return this._rpc("get_payload"); }

  /** Set installation orientation. */
  async setInstallation(base_rpy?: number[], gravity?: number[]): Promise<{ base_rpy: number[]; gravity: number[] }> {
    return this._rpc("set_installation", { base_rpy, gravity });
  }

  /** Get installation. */
  async getInstallation(): Promise<{ base_rpy: number[]; gravity: number[] }> { return this._rpc("get_installation"); }

  // ── Custom handlers (system / settings / trajectory) ──────────────────

  /** Get system stats (CPU, memory, temperature, uptime). */
  async getSystemStats(): Promise<Record<string, unknown>> { return this._rpc("get_system_stats"); }

  /** Get server logs (page, size, search). */
  async getLogs(page = 1, size = 50, search = ""): Promise<Record<string, unknown>> {
    return this._rpc("get_logs", { page, size, search });
  }

  /** Request restart of the arm service. */
  async restartService(): Promise<Record<string, unknown>> { return this._rpc("restart_service"); }

  // ── Settings ──────────────────────────────────────────────────────────

  async getJointLimits(): Promise<Record<string, unknown>> { return this._rpc("get_joint_limits"); }
  async setJointLimits(limits: Record<string, unknown>): Promise<Record<string, unknown>> { return this._rpc("set_joint_limits", { limits }); }
  async getZeroOffsets(): Promise<Record<string, unknown>> { return this._rpc("get_zero_offsets"); }
  async setZeroOffsets(offsets: Record<string, unknown>): Promise<Record<string, unknown>> { return this._rpc("set_zero_offsets", { offsets }); }
  async getEndEffector(): Promise<Record<string, unknown>> { return this._rpc("get_end_effector"); }
  async setEndEffector(config: Record<string, unknown>): Promise<Record<string, unknown>> { return this._rpc("set_end_effector", { config }); }
  async getCartesianLimits(): Promise<Record<string, unknown>> { return this._rpc("get_cartesian_limits"); }
  async setCartesianLimits(limits: Record<string, unknown>): Promise<Record<string, unknown>> { return this._rpc("set_cartesian_limits", { limits }); }
  async getCollisionConfig(): Promise<Record<string, unknown>> { return this._rpc("get_collision_config"); }
  async setCollisionConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> { return this._rpc("set_collision_config", { config }); }

  // ── Trajectory management ─────────────────────────────────────────────

  async startRecording(): Promise<Record<string, unknown>> { return this._rpc("start_recording"); }
  async stopRecording(): Promise<Record<string, unknown>> { return this._rpc("stop_recording"); }
  async discardRecording(): Promise<Record<string, unknown>> { return this._rpc("discard_recording"); }
  async getRecordingState(): Promise<Record<string, unknown>> { return this._rpc("get_recording_state"); }
  async getPlaybackState(): Promise<Record<string, unknown>> { return this._rpc("get_playback_state"); }
  async listTrajectories(): Promise<Record<string, unknown>> { return this._rpc("list_trajectories"); }
  async saveTrajectory(id: string, name: string, points: number[][], duration?: number): Promise<Record<string, unknown>> {
    return this._rpc("save_trajectory", { id, name, points, duration });
  }
  async deleteTrajectory(id: string): Promise<Record<string, unknown>> { return this._rpc("delete_trajectory", { id }); }

  // ── Generic RPC (for debug panels / dynamic calls) ────────────────────

  /** Generic RPC call — useful for debug panels and custom handlers. */
  async call<T>(method: string, kwargs: Record<string, unknown> = {}): Promise<T> {
    return this._rpc(method, kwargs);
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private async _rpc<T>(method: string, kwargs: Record<string, unknown> = {}, timeoutS = 300): Promise<T> {
    const payload = encodeRequest(method, kwargs);
    const reply = await this._tp.rpc(payload, timeoutS);
    return decodeReply(reply) as T;
  }
}

// ── DeviceProxy ────────────────────────────────────────────────────────

type RpcFn = (method: string, kwargs: Record<string, unknown>) => Promise<unknown>;

/**
 * Proxy for a remote device (hand, gripper, etc.).
 *
 * Calls go through the litearm-server WebSocket → zenoh → device daemon.
 */
export class DeviceProxy {
  constructor(
    public readonly deviceId: string,
    private _rpc: RpcFn,
  ) {}

  /** Call any method on the remote device. */
  async call(method: string, kwargs: Record<string, unknown> = {}): Promise<unknown> {
    return this._rpc(method, kwargs);
  }

  // ── Convenience methods for hands ────────────────────────────────────

  async connect(kwargs: Record<string, unknown> = {}): Promise<unknown> {
    return this.call("connect", kwargs);
  }
  async disconnect(): Promise<unknown> { return this.call("disconnect"); }
  async open(): Promise<unknown> { return this.call("open"); }
  async close(): Promise<unknown> { return this.call("close"); }
  async setGesture(gesture: string): Promise<unknown> { return this.call("set_gesture", { gesture }); }
  async fingerMove(pose: number[]): Promise<unknown> { return this.call("finger_move", { pose }); }
  async getState(): Promise<unknown> { return this.call("get_state"); }
  async clearFaults(): Promise<unknown> { return this.call("clear_faults"); }

  // ── Convenience methods for grippers ─────────────────────────────────

  async setWidth(width: number): Promise<unknown> { return this.call("set_width", { width }); }
  async getWidth(): Promise<unknown> { return this.call("get_width"); }
  async setForce(force: number): Promise<unknown> { return this.call("set_force", { force }); }

  // ── Gripper teleop（独立夹爪遥操）────────────────────────────────────
  //
  // master: 进零重力 + pub 开合度; slave: 连 master IP 订阅并跟随。
  // 详见 litearm-device gripper_teleop.py。

  /** 进入夹爪遥操。master 无需 peer; slave 需 peer(tcp/ip:port) + masterId。 */
  async gripperTeleopEnter(opts: {
    mode: "master" | "slave";
    peer?: string;
    masterId?: string;
    rateHz?: number;
    kp?: number;
    kd?: number;
    align?: boolean;
    watchdogMs?: number;
  }): Promise<Record<string, unknown>> {
    const kwargs: Record<string, unknown> = { mode: opts.mode };
    if (opts.peer !== undefined) kwargs.peer = opts.peer;
    if (opts.masterId !== undefined) kwargs.master_id = opts.masterId;
    if (opts.rateHz !== undefined) kwargs.rate_hz = opts.rateHz;
    if (opts.kp !== undefined) kwargs.kp = opts.kp;
    if (opts.kd !== undefined) kwargs.kd = opts.kd;
    if (opts.align !== undefined) kwargs.align = opts.align;
    if (opts.watchdogMs !== undefined) kwargs.watchdog_ms = opts.watchdogMs;
    return this.call("gripper_teleop_enter", kwargs) as Promise<Record<string, unknown>>;
  }

  /** 退出夹爪遥操,回到手动态。 */
  async gripperTeleopExit(): Promise<Record<string, unknown>> {
    return this.call("gripper_teleop_exit") as Promise<Record<string, unknown>>;
  }

  /** 查询夹爪遥操状态(active/mode/frames/openness/loop_hz/stale)。 */
  async gripperTeleopStatus(): Promise<Record<string, unknown>> {
    return this.call("gripper_teleop_status") as Promise<Record<string, unknown>>;
  }
}
