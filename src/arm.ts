/**
 * @file arm.ts
 * @brief Remote Arm client - API compatible with pylitearm.Arm.
 *
 * Connects to litearm-server via Zenoh and forwards all calls as RPC.
 */

import type { Transport } from './transport';
import { createTransport } from './transport';
import { encodeRequest, decodeReply, encodeEstop, decodeState, initCodecSync } from './codec';
import { rpcTopic, stateTopic, estopTopic } from './protocol';
import { DeviceManager, RemoteDevice } from './device';
import type {
  ArmOptions,
  RobotState,
  Pose,
  Gains,
  Payload,
  Installation,
  JointTrajectory,
  MoveJOptions,
  MoveLOptions,
  MoveCOptions,
  MovePOptions,
  ZeroGravityOptions,
  HoldOptions,
} from './types';

/**
 * LiteArm remote client.
 *
 * @example
 * ```typescript
 * const arm = new Arm({ endpoint: 'ws://192.168.1.100:7447' });
 * await arm.connect();
 *
 * // Move to joint target
 * await arm.movej([0, 0, 0, 0, 0, 0, 0], { speed: 0.5 });
 *
 * // Get state
 * const state = arm.getState();
 * console.log('Joint angles:', state?.q);
 *
 * // Emergency stop
 * arm.requestStop();
 *
 * await arm.close();
 * ```
 */
export class Arm {
  private transport: Transport | null = null;
  private rpcTopic: string;
  private stateTopic: string;
  private estopTopic: string;
  private lastState: RobotState | null = null;
  private stateSubscriber: { drainLatest(): Uint8Array | null } | null = null;
  private devices: DeviceManager | null = null;

  /**
   * Create an Arm client.
   * @param options Arm options (endpoint, armId)
   */
  constructor(private options: ArmOptions) {
    const armId = options.armId || 'armA';
    this.rpcTopic = rpcTopic(armId);
    this.stateTopic = stateTopic(armId);
    this.estopTopic = estopTopic(armId);

    // Initialize codec synchronously
    initCodecSync();
  }

  /**
   * Connect to litearm-server.
   */
  async connect(): Promise<void> {
    this.transport = await createTransport(this.options.endpoint);

    // Subscribe to state broadcasts
    this.stateSubscriber = await this.transport.sub(this.stateTopic);
  }

  /**
   * Close the connection.
   */
  async close(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  /**
   * Send an RPC call.
   */
  private async rpc<T>(method: string, kwargs: Record<string, unknown> = {}): Promise<T> {
    if (!this.transport) {
      throw new Error('Arm not connected. Call connect() first.');
    }
    const payload = encodeRequest(method, kwargs);
    const reply = await this.transport.query(this.rpcTopic, payload);
    return decodeReply(reply) as T;
  }

  // ── Pure computation API ────────────────────────────────────────────────

  /**
   * Forward kinematics: joint angles → (position, rotation_matrix).
   */
  async fk(q: number[]): Promise<[number[], number[][]]> {
    return this.rpc('fk', { q });
  }

  /**
   * Inverse kinematics: (position, rotation) → (q, success).
   */
  async ik(
    pos_d: number[],
    R_d: number[][],
    q_seed?: number[]
  ): Promise<[number[], boolean]> {
    return this.rpc('ik', { pos_d, R_d, q_seed });
  }

  /**
   * Plan a straight-line Cartesian path.
   */
  async planMovel(q_start: number[], pose_goal: unknown): Promise<number[][]> {
    return this.rpc('plan_movel', { q_start, pose_goal });
  }

  /**
   * Plan a circular-arc Cartesian path through via-point.
   */
  async planMovec(
    q_start: number[],
    pose_via: unknown,
    pose_goal: unknown
  ): Promise<number[][]> {
    return this.rpc('plan_movec', { q_start, pose_via, pose_goal });
  }

  /**
   * Plan a multi-waypoint Cartesian path.
   */
  async planMovep(q_start: number[], poses_goal: unknown[]): Promise<number[][]> {
    return this.rpc('plan_movep', { q_start, poses_goal });
  }

  // ── Motion execution ────────────────────────────────────────────────────

  /**
   * Move to joint target.
   */
  async movej(q_target: number[], options: MoveJOptions = {}): Promise<boolean> {
    return this.rpc('movej', {
      q_target,
      speed: options.speed ?? 1.0,
      settle_s: options.settle_s ?? 1.0,
      max_cycles: options.max_cycles,
      allow_start_collision_recovery: options.allow_start_collision_recovery,
    });
  }

  /**
   * Recover from joint limit violations.
   * Requires connect(allow_limit_recovery=True) on the server side.
   */
  async recoverJointLimits(
    options: { speed?: number; settle_s?: number; inset_rad?: number; max_cycles?: number } = {}
  ): Promise<boolean> {
    return this.rpc('recover_joint_limits', {
      speed: options.speed ?? 0.05,
      settle_s: options.settle_s ?? 0.5,
      inset_rad: options.inset_rad ?? 0.0,
      max_cycles: options.max_cycles,
    });
  }

  /**
   * Move in a straight Cartesian line.
   */
  async movel(pose_goal: unknown, options: MoveLOptions = {}): Promise<boolean> {
    return this.rpc('movel', {
      pose_goal,
      speed: options.speed ?? 1.0,
      settle_s: options.settle_s ?? 0.8,
      max_cycles: options.max_cycles,
    });
  }

  /**
   * Move in a circular arc through via-point.
   */
  async movec(
    pose_via: unknown,
    pose_goal: unknown,
    options: MoveCOptions = {}
  ): Promise<boolean> {
    return this.rpc('movec', {
      pose_via,
      pose_goal,
      speed: options.speed ?? 1.0,
      settle_s: options.settle_s ?? 0.8,
      max_cycles: options.max_cycles,
    });
  }

  /**
   * Move through a sequence of Cartesian waypoints.
   */
  async movep(poses_goal: unknown[], options: MovePOptions = {}): Promise<boolean> {
    return this.rpc('movep', {
      poses_goal,
      speed: options.speed ?? 1.0,
      settle_s: options.settle_s ?? 0.8,
      max_cycles: options.max_cycles,
    });
  }

  /**
   * Replay a sequence of joint configurations.
   */
  async replayJointPath(
    q_path: number[][],
    options: {
      speed?: number;
      settle_s?: number;
      goto_start?: boolean;
      goto_speed?: number;
      max_cycles?: number;
    } = {}
  ): Promise<boolean> {
    return this.rpc('replay_joint_path', {
      q_path,
      speed: options.speed ?? 1.0,
      settle_s: options.settle_s ?? 0.5,
      goto_start: options.goto_start ?? true,
      goto_speed: options.goto_speed ?? 0.3,
      max_cycles: options.max_cycles,
    });
  }

  /**
   * Replay a joint trajectory (arc-length parameterized, global S-curve).
   */
  async replayTrajectory(
    traj_q: number[][],
    options: {
      speed?: number;
      goto_start?: boolean;
      goto_speed?: number;
      max_cycles?: number;
      check_singularity?: boolean;
    } = {}
  ): Promise<boolean> {
    return this.rpc('replay_trajectory', {
      traj_q,
      speed: options.speed ?? 1.0,
      goto_start: options.goto_start ?? true,
      goto_speed: options.goto_speed ?? 0.3,
      max_cycles: options.max_cycles,
      check_singularity: options.check_singularity ?? true,
    });
  }

  /**
   * Replay a measured trajectory on its recorded time axis.
   * Safety-enforced: automatically stretches time to respect vel/acc/jerk limits.
   */
  async replayTimedTrajectory(
    traj_q: number[][],
    traj_t: number[],
    options: {
      speed?: number;
      goto_start?: boolean;
      goto_speed?: number;
      simplify_tolerance_rad?: number;
      max_cycles?: number;
    } = {}
  ): Promise<boolean> {
    return this.rpc('replay_timed_trajectory', {
      traj_q,
      traj_t,
      speed: options.speed ?? 1.0,
      goto_start: options.goto_start ?? true,
      goto_speed: options.goto_speed ?? 0.3,
      simplify_tolerance_rad: options.simplify_tolerance_rad ?? 0.01,
      max_cycles: options.max_cycles,
    });
  }

  /**
   * Load and replay a saved JointTrajectory.
   */
  async playTrajectory(
    trajectory: JointTrajectory | string,
    options: {
      speed?: number;
      goto_start?: boolean;
      goto_speed?: number;
      verify_robot?: boolean;
      simplify_tolerance_rad?: number;
      max_cycles?: number;
    } = {}
  ): Promise<boolean> {
    return this.rpc('play_trajectory', {
      trajectory,
      speed: options.speed ?? 1.0,
      goto_start: options.goto_start ?? true,
      goto_speed: options.goto_speed ?? 0.3,
      verify_robot: options.verify_robot ?? true,
      simplify_tolerance_rad: options.simplify_tolerance_rad ?? 0.01,
      max_cycles: options.max_cycles,
    });
  }

  /**
   * Record a trajectory in zero-gravity mode.
   */
  async recordTrajectory(
    options: {
      output?: string;
      duration_s?: number;
      sample_rate_hz?: number;
      filter_alpha?: number;
      name?: string;
    } = {}
  ): Promise<JointTrajectory> {
    return this.rpc('record_trajectory', {
      output: options.output ?? 'trajectories',
      duration_s: options.duration_s,
      sample_rate_hz: options.sample_rate_hz ?? 100,
      filter_alpha: options.filter_alpha ?? 0.15,
      name: options.name,
    });
  }

  /**
   * Hold current position with increased stiffness.
   */
  async hold(options: HoldOptions = {}): Promise<boolean> {
    return this.rpc('hold', {
      kp_scale: options.kp_scale ?? 3.0,
      max_cycles: options.max_cycles,
    });
  }

  /**
   * Enable zero-gravity (free-drag) mode.
   */
  async zeroGravity(options: ZeroGravityOptions = {}): Promise<boolean> {
    return this.rpc('zero_gravity', {
      max_cycles: options.max_cycles,
      duration_s: options.duration_s,
      measured_overspeed_factor: options.measured_overspeed_factor,
      vel_max: options.vel_max,
    });
  }

  /**
   * Joint-space impedance control.
   */
  async jointImpedance(
    q_des: number[],
    K: number[],
    B: number[],
    options: {
      tau_max?: number[];
      engage_sec?: number;
      max_cycles?: number;
    } = {}
  ): Promise<boolean> {
    return this.rpc('joint_impedance', {
      q_des,
      K,
      B,
      tau_max: options.tau_max,
      engage_sec: options.engage_sec ?? 0.3,
      max_cycles: options.max_cycles,
    });
  }

  /**
   * Cartesian-space impedance control.
   */
  async cartesianImpedance(
    q_des: number[],
    K_cart: number[],
    B_cart: number[],
    options: {
      v_des?: number[];
      tau_max?: number[];
      engage_sec?: number;
      max_cycles?: number;
      sigma_min_thresh?: number;
      max_ori_err?: number;
      measured_overspeed_factor?: number;
      vel_max?: number[];
    } = {}
  ): Promise<boolean> {
    return this.rpc('cartesian_impedance', {
      q_des,
      K_cart,
      B_cart,
      v_des: options.v_des,
      tau_max: options.tau_max,
      engage_sec: options.engage_sec ?? 0.3,
      max_cycles: options.max_cycles,
      sigma_min_thresh: options.sigma_min_thresh,
      max_ori_err: options.max_ori_err,
      measured_overspeed_factor: options.measured_overspeed_factor,
      vel_max: options.vel_max,
    });
  }

  // ── Hand control (灵巧手) ─────────────────────────────────────────────

  /** Connect to the dexterous hand. */
  async handConnect(handType = "right", handJoint = "L10", canIface = "can0"): Promise<Record<string, unknown>> {
    return this.rpc('hand_connect', { hand_type: handType, hand_joint: handJoint, can_iface: canIface });
  }

  /** Disconnect the hand. */
  async handDisconnect(): Promise<Record<string, unknown>> { return this.rpc('hand_disconnect'); }

  /** Open the hand. */
  async handOpen(speed?: number[]): Promise<Record<string, unknown>> { return this.rpc('hand_open', { speed }); }

  /** Close the hand. */
  async handClose(speed?: number[]): Promise<Record<string, unknown>> { return this.rpc('hand_close', { speed }); }

  /** Set a named gesture. */
  async handSetGesture(gesture: string, speed?: number[]): Promise<Record<string, unknown>> {
    return this.rpc('hand_set_gesture', { gesture, speed });
  }

  /** Move fingers to specific positions. */
  async handFingerMove(pose: number[], speed?: number[]): Promise<Record<string, unknown>> {
    return this.rpc('hand_finger_move', { pose, speed });
  }

  /** Set finger speed. */
  async handSetSpeed(speed: number[]): Promise<Record<string, unknown>> { return this.rpc('hand_set_speed', { speed }); }

  /** Set finger torque. */
  async handSetTorque(torque: number[]): Promise<Record<string, unknown>> { return this.rpc('hand_set_torque', { torque }); }

  /** Get hand state. */
  async handGetState(): Promise<Record<string, unknown>> { return this.rpc('hand_get_state'); }

  /** Clear hand faults. */
  async handClearFaults(): Promise<Record<string, unknown>> { return this.rpc('hand_clear_faults'); }

  /** List available gestures. */
  async handListGestures(): Promise<Record<string, unknown>> { return this.rpc('hand_list_gestures'); }

  // ── State reading ───────────────────────────────────────────────────────

  /**
   * Get latest robot state from broadcast cache.
   */
  getState(): RobotState | null {
    if (!this.stateSubscriber) return this.lastState;

    const raw = this.stateSubscriber.drainLatest();
    if (raw) {
      this.lastState = decodeState(raw);
    }
    return this.lastState;
  }

  /**
   * Get current TCP pose.
   */
  async getTcpPose(): Promise<[number[], number[][]]> {
    return this.rpc('get_tcp_pose');
  }

  // ── Emergency stop ──────────────────────────────────────────────────────

  /**
   * Send high-priority emergency stop signal.
   */
  requestStop(): void {
    if (!this.transport) {
      throw new Error('Arm not connected');
    }
    // Fire-and-forget: estop doesn't wait for pub completion
    void this.transport.pub(this.estopTopic, encodeEstop(true));
  }

  /**
   * Clear the stop condition.
   */
  async clearStop(): Promise<void> {
    await this.rpc('clear_stop');
  }

  // ── Parameter tuning ────────────────────────────────────────────────────

  /**
   * Set PD controller gains.
   */
  async setGains(kp?: number[], kd?: number[]): Promise<Gains> {
    return this.rpc('set_gains', { kp, kd });
  }

  /**
   * Get current PD controller gains.
   */
  async getGains(): Promise<Gains> {
    return this.rpc('get_gains');
  }

  /**
   * Clear motor faults.
   */
  async clearFaults(): Promise<[number, number][]> {
    return this.rpc('clear_faults');
  }

  /**
   * Set end-effector payload.
   */
  async setPayload(mass: number, com: [number, number, number] = [0, 0, 0]): Promise<Payload> {
    return this.rpc('set_payload', { mass, com });
  }

  /**
   * Get current payload configuration.
   */
  async getPayload(): Promise<Payload> {
    return this.rpc('get_payload');
  }

  /**
   * Set installation orientation.
   */
  async setInstallation(options: {
    base_rpy?: number[];
    gravity?: number[];
  }): Promise<Installation> {
    return this.rpc('set_installation', options);
  }

  /**
   * Get current installation configuration.
   */
  async getInstallation(): Promise<Installation> {
    return this.rpc('get_installation');
  }

  // ── Custom handlers ─────────────────────────────────────────────────────

  /** Get system stats (CPU, memory, board temperature, uptime). */
  async getSystemStats(): Promise<Record<string, unknown>> { return this.rpc('get_system_stats'); }

  /** Get server logs (paginated). */
  async getLogs(page = 1, size = 50, search = ''): Promise<Record<string, unknown>> {
    return this.rpc('get_logs', { page, size, search });
  }

  /** Request restart of the arm service. */
  async restartService(): Promise<Record<string, unknown>> { return this.rpc('restart_service'); }

  // ── Settings ────────────────────────────────────────────────────────────

  async getJointLimits(): Promise<Record<string, unknown>> { return this.rpc('get_joint_limits'); }
  async setJointLimits(limits: Record<string, unknown>): Promise<Record<string, unknown>> { return this.rpc('set_joint_limits', { limits }); }
  async getZeroOffsets(): Promise<Record<string, unknown>> { return this.rpc('get_zero_offsets'); }
  async setZeroOffsets(offsets: Record<string, unknown>): Promise<Record<string, unknown>> { return this.rpc('set_zero_offsets', { offsets }); }
  async getEndEffector(): Promise<Record<string, unknown>> { return this.rpc('get_end_effector'); }
  async setEndEffector(config: Record<string, unknown>): Promise<Record<string, unknown>> { return this.rpc('set_end_effector', { config }); }
  async getCartesianLimits(): Promise<Record<string, unknown>> { return this.rpc('get_cartesian_limits'); }
  async setCartesianLimits(limits: Record<string, unknown>): Promise<Record<string, unknown>> { return this.rpc('set_cartesian_limits', { limits }); }
  async getCollisionConfig(): Promise<Record<string, unknown>> { return this.rpc('get_collision_config'); }
  async setCollisionConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> { return this.rpc('set_collision_config', { config }); }

  // ── Trajectory management ───────────────────────────────────────────────

  async startRecording(): Promise<Record<string, unknown>> { return this.rpc('start_recording'); }
  async stopRecording(): Promise<Record<string, unknown>> { return this.rpc('stop_recording'); }
  async discardRecording(): Promise<Record<string, unknown>> { return this.rpc('discard_recording'); }
  async getRecordingState(): Promise<Record<string, unknown>> { return this.rpc('get_recording_state'); }
  async getPlaybackState(): Promise<Record<string, unknown>> { return this.rpc('get_playback_state'); }
  async listTrajectories(): Promise<Record<string, unknown>> { return this.rpc('list_trajectories'); }
  async saveTrajectory(
    id: string, name: string, points: number[][], duration?: number
  ): Promise<Record<string, unknown>> {
    return this.rpc('save_trajectory', { id, name, points, duration });
  }
  async deleteTrajectory(id: string): Promise<Record<string, unknown>> { return this.rpc('delete_trajectory', { id }); }

  // ── Device access ───────────────────────────────────────────────────────

  /**
   * Get a remote device (end-effector, teach pendant, etc.).
   *
   * @example
   * ```typescript
   * const hand = arm.device('hand_0');
   * await hand.open();
   * await hand.setGesture('pinch');
   *
   * const gripper = arm.device('gripper_0');
   * await gripper.setWidth(0.5);
   * ```
   */
  device(deviceId: string): RemoteDevice {
    if (!this.transport) {
      throw new Error('Arm not connected');
    }
    if (!this.devices) {
      const armId = this.options.armId || 'armA';
      this.devices = new DeviceManager(this.transport, armId);
    }
    return this.devices.get(deviceId);
  }
}
