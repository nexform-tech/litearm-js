/**
 * @file types.ts
 * @brief Type definitions for litearm-js SDK.
 */

/**
 * Arm state enum values (matches pylitearm ArmState).
 */
export type ArmStateValue =
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'moving'
  | 'paused'
  | 'stopped'
  | 'error'
  | 'zero_gravity'
  | 'impedance'
  | 'recording'
  | 'unknown';

/**
 * Joint feedback state for a single joint.
 */
export interface JointFeedbackState {
  joint: number;
  received: number;
  ageS: number;
  fresh: boolean;
}

/**
 * Feedback state for all joints.
 */
export interface FeedbackState {
  maxAgeS: number;
  staleJoints: number[];
  joints: JointFeedbackState[];
}

/**
 * Watchdog state.
 */
export interface WatchdogState {
  enabled: boolean;
  timeoutS: number;
  mode: string;
  tripped: boolean;
  lastKickAgeS: number;
}

/**
 * Fault information.
 */
export interface Fault {
  joint: number;
  errCode: number;
}

/**
 * Temperature information.
 */
export interface Temperature {
  mosTemp: number;
  coilTemp: number;
}

/**
 * Robot state broadcast.
 */
export interface RobotState {
  q: number[];
  dq: number[];
  tau: number[];
  fault: Fault[];
  errs: number[];
  temps: Temperature[];
  state: string;
  feedback?: FeedbackState;
  watchdog?: WatchdogState;
  robotSerial?: string;
  configChecksumSha256?: string;
}

/**
 * Pose (position + rotation matrix).
 */
export interface Pose {
  position: [number, number, number];
  rotation: number[][]; // 3x3 matrix
}

/**
 * PD controller gains.
 */
export interface Gains {
  kp: number[];
  kd: number[];
}

/**
 * Payload configuration.
 */
export interface Payload {
  mass: number;
  com: [number, number, number];
}

/**
 * Installation configuration.
 */
export interface Installation {
  base_rpy?: number[];
  gravity?: number[];
}

/**
 * Joint trajectory frame.
 */
export interface TrajectoryFrame {
  t: number;
  q: number[];
  dq: number[];
  tau?: number[];
}

/**
 * Joint trajectory (matches pylitearm JointTrajectory).
 */
export interface JointTrajectory {
  frames: TrajectoryFrame[];
  name?: string;
  sampleRateHz?: number;
  filterAlpha?: number;
  robotSerial?: string;
  configChecksumSha256?: string;
}

/**
 * Trajectory metadata (for list_trajectories).
 */
export interface TrajectoryMeta {
  id: string;
  name?: string;
  point_count?: number;
  duration?: number;
  created_at?: string;
}

/**
 * Arm constructor options.
 */
export interface ArmOptions {
  /** Zenoh endpoint (e.g., "ws://192.168.1.100:7447") */
  endpoint: string;
  /** Arm identifier (default: "armA") */
  armId?: string;
}

/**
 * MoveJ options.
 */
export interface MoveJOptions {
  speed?: number;
  settle_s?: number;
  max_cycles?: number;
  allow_start_collision_recovery?: boolean;
}

/**
 * Recover joint limits options.
 */
export interface RecoverJointLimitsOptions {
  speed?: number;
  settle_s?: number;
  inset_rad?: number;
  max_cycles?: number;
}

/**
 * MoveL options.
 */
export interface MoveLOptions {
  speed?: number;
  settle_s?: number;
  max_cycles?: number;
}

/**
 * MoveC options.
 */
export interface MoveCOptions {
  speed?: number;
  settle_s?: number;
  max_cycles?: number;
}

/**
 * MoveP options.
 */
export interface MovePOptions {
  speed?: number;
  settle_s?: number;
  max_cycles?: number;
}

/**
 * Zero gravity options.
 */
export interface ZeroGravityOptions {
  max_cycles?: number;
  duration_s?: number;
  measured_overspeed_factor?: number;
  vel_max?: number[];
}

/**
 * Hold options.
 */
export interface HoldOptions {
  kp_scale?: number;
  max_cycles?: number;
}

/**
 * Joint impedance options.
 */
export interface JointImpedanceOptions {
  tau_max?: number[];
  engage_sec?: number;
  max_cycles?: number;
}

/**
 * Cartesian impedance options.
 */
export interface CartesianImpedanceOptions {
  v_des?: number[];
  tau_max?: number[];
  engage_sec?: number;
  max_cycles?: number;
  sigma_min_thresh?: number;
  max_ori_err?: number;
  measured_overspeed_factor?: number;
  vel_max?: number[];
}

/**
 * Replay joint path options.
 */
export interface ReplayJointPathOptions {
  speed?: number;
  settle_s?: number;
  goto_start?: boolean;
  goto_speed?: number;
  max_cycles?: number;
}

/**
 * Replay trajectory options.
 */
export interface ReplayTrajectoryOptions {
  speed?: number;
  goto_start?: boolean;
  goto_speed?: number;
  max_cycles?: number;
  check_singularity?: boolean;
}

/**
 * Replay timed trajectory options.
 */
export interface ReplayTimedTrajectoryOptions {
  speed?: number;
  goto_start?: boolean;
  goto_speed?: number;
  simplify_tolerance_rad?: number;
  max_cycles?: number;
}

/**
 * Play trajectory options.
 */
export interface PlayTrajectoryOptions {
  speed?: number;
  goto_start?: boolean;
  goto_speed?: number;
  verify_robot?: boolean;
  simplify_tolerance_rad?: number;
  max_cycles?: number;
}

/**
 * Record trajectory options.
 */
export interface RecordTrajectoryOptions {
  duration_s?: number;
  sample_rate_hz?: number;
  filter_alpha?: number;
  name?: string;
}

/**
 * System stats.
 */
export interface SystemStats {
  cpu_percent: number;
  mem_percent: number;
  disk_percent: number;
  board_temp: number;
  uptime_seconds: number;
}

/**
 * Recording state.
 */
export interface RecordingState {
  recording: boolean;
  duration: number;
  point_count: number;
}

/**
 * Playback state.
 */
export interface PlaybackState {
  state: 'idle' | 'playing' | 'paused' | 'stopped';
}
