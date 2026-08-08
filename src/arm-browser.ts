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
  fault: { joint: number; err_code: number }[];
  errs: number[]; temps: { mos_temp: number; coil_temp: number }[];
  state: string; robot_serial: string;
  config_checksum_sha256: string;
  feedback: { max_age_s: number; stale_joints: number[]; joints: { joint: number; received: number; age_s: number; fresh: boolean }[] };
  watchdog: { enabled: boolean; timeout_s: number; mode: string; tripped: boolean; last_kick_age_s: number };
}

export type Pose = [number[], number[][]];  // [position, rotation_matrix]

export interface MoveJOps { speed?: number; settle_s?: number; max_cycles?: number; allow_start_collision_recovery?: boolean; }
export interface MoveLOps { speed?: number; settle_s?: number; max_cycles?: number; }
export interface MoveCOps { speed?: number; settle_s?: number; max_cycles?: number; }
export interface MovePOps { speed?: number; settle_s?: number; max_cycles?: number; }

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
