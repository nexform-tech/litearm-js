/**
 * @file device.ts
 * @brief Remote device interface for end-effectors and peripherals.
 */

import type { Transport } from './transport';
import { encodeRequest, decodeReply } from './codec';

/**
 * Remote device interface.
 *
 * Provides access to end-effectors (grippers, hands) and other peripherals.
 */
export class RemoteDevice {
  private rpcTopic: string;

  constructor(
    private transport: Transport,
    private armId: string,
    private deviceId: string
  ) {
    this.rpcTopic = `litearm/v4/${armId}/rpc`;
  }

  /**
   * Get the device ID.
   */
  get id(): string {
    return this.deviceId;
  }

  /**
   * Send an RPC call to the device.
   */
  private async rpc<T>(method: string, kwargs: Record<string, unknown> = {}): Promise<T> {
    const fullMethod = `device.${this.deviceId}.${method}`;
    const payload = encodeRequest(fullMethod, kwargs);
    const reply = await this.transport.query(this.rpcTopic, payload);
    return decodeReply(reply) as T;
  }

  // ── Generic device methods ──────────────────────────────────────────────

  /**
   * Get device status.
   */
  async getStatus(): Promise<Record<string, unknown>> {
    return this.rpc('get_status');
  }

  /**
   * Get device info.
   */
  async getInfo(): Promise<Record<string, unknown>> {
    return this.rpc('get_info');
  }

  /**
   * Connect the device.
   */
  async connect(): Promise<boolean> {
    return this.rpc('connect');
  }

  /**
   * Disconnect the device.
   */
  async disconnect(): Promise<void> {
    await this.rpc('disconnect');
  }

  /**
   * Clear device faults.
   */
  async clearFaults(): Promise<boolean> {
    return this.rpc('clear_faults');
  }

  // ── End-effector methods (gripper/hand) ─────────────────────────────────

  /**
   * Open the end-effector (gripper/hand).
   */
  async open(): Promise<boolean> {
    return this.rpc('open');
  }

  /**
   * Close the end-effector (gripper/hand).
   */
  async close(): Promise<boolean> {
    return this.rpc('close');
  }

  /**
   * Set grip force (0.0 - 1.0).
   */
  async setForce(force: number): Promise<boolean> {
    return this.rpc('set_force', { force });
  }

  // ── Gripper-specific methods ────────────────────────────────────────────

  /**
   * Set gripper width (gripper only).
   */
  async setWidth(width: number): Promise<boolean> {
    return this.rpc('set_width', { width });
  }

  /**
   * Get current gripper width (gripper only).
   */
  async getWidth(): Promise<number> {
    return this.rpc('get_width');
  }

  // ── Hand-specific methods ───────────────────────────────────────────────

  /**
   * Set hand gesture (hand only).
   */
  async setGesture(gesture: string): Promise<boolean> {
    return this.rpc('set_gesture', { gesture });
  }

  /**
   * List available gestures (hand only).
   */
  async listGestures(): Promise<string[]> {
    return this.rpc('list_gestures');
  }

  /**
   * Get device state (device.state_method, aligned with handGetState).
   */
  async getState(): Promise<Record<string, unknown>> {
    return this.rpc('get_state');
  }

  /**
   * Per-finger motion (pose = per-finger angles; hand only).
   */
  async fingerMove(pose: number[]): Promise<boolean> {
    return this.rpc('finger_move', { pose });
  }

  /**
   * Set per-finger speeds (hand only).
   */
  async setSpeed(speed: number[]): Promise<boolean> {
    return this.rpc('set_speed', { speed });
  }

  /**
   * Set per-finger torques (hand only).
   */
  async setTorque(torque: number[]): Promise<boolean> {
    return this.rpc('set_torque', { torque });
  }

  // ── Teach pendant methods ───────────────────────────────────────────────

  /**
   * Get joint angles from teach pendant.
   */
  async getJoints(): Promise<number[]> {
    return this.rpc('get_joints');
  }

  /**
   * Get button states from teach pendant.
   */
  async getButtons(): Promise<Record<string, boolean>> {
    return this.rpc('get_buttons');
  }
}

/**
 * Device manager for accessing multiple devices.
 */
export class DeviceManager {
  private devices: Map<string, RemoteDevice> = new Map();

  constructor(
    private transport: Transport,
    private armId: string
  ) {}

  /**
   * Get a device by ID.
   */
  get(deviceId: string): RemoteDevice {
    let device = this.devices.get(deviceId);
    if (!device) {
      device = new RemoteDevice(this.transport, this.armId, deviceId);
      this.devices.set(deviceId, device);
    }
    return device;
  }

  /**
   * Check if a device exists.
   */
  has(deviceId: string): boolean {
    return this.devices.has(deviceId);
  }

  /**
   * List all known device IDs.
   */
  list(): string[] {
    return Array.from(this.devices.keys());
  }
}
