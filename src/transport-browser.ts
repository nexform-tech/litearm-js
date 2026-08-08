/**
 * @file transport-browser.ts
 * @brief 浏览器 WebSocket 直连传输层（纯原生 WS，无 zenoh 依赖）。
 *
 * 协议：二进制帧 = [1字节 opcode][1字节 seq][protobuf payload]
 *   opcode 0x01: client→server RPC request
 *   opcode 0x02: server→client RPC reply
 *   opcode 0x03: server→client state broadcast
 *   opcode 0x04: client→server estop
 */

export const OP = {
  RPC_REQUEST: 0x01,
  RPC_REPLY:   0x02,
  STATE:       0x03,
  ESTOP:       0x04,
} as const;

export type SubCallback = (payload: Uint8Array) => void;

/** Subscriber handle — stores latest state, supports callbacks. */
export class Subscriber {
  private _latest: Uint8Array | null = null;

  /** Drain to latest, discard older. */
  drainLatest(): Uint8Array | null {
    const v = this._latest;
    this._latest = null;
    return v;
  }

  /** Check if data available. */
  pop(): Uint8Array | null { return this.drainLatest(); }

  /** Internal: called by transport when state frame arrives. */
  _onData(payload: Uint8Array) { this._latest = payload; }

  /** Close — no-op for browser WS (connection is shared). */
  async close() {}
}

/** Raw WebSocket transport with RPC seq-tracking and state broadcast. */
export class WsTransport {
  private _ws: WebSocket | null = null;
  private _rpcId = 0;
  private _pending = new Map<number, { resolve: Function; reject: Function }>();
  private _stateSubs: Set<Subscriber> = new Set();
  private _onClose: (() => void) | null = null;

  get connected(): boolean { return this._ws?.readyState === WebSocket.OPEN; }

  /** Connect to litearm-server WS endpoint. */
  connect(url: string, onClose?: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this._onClose = onClose ?? null;
      this._ws = new WebSocket(url);
      this._ws.binaryType = "arraybuffer";

      this._ws.onopen = () => resolve();
      this._ws.onerror = () => reject(new Error("WebSocket connection failed"));
      this._ws.onclose = () => { this._onClose?.(); };

      this._ws.onmessage = (e: MessageEvent) => {
        const b = new Uint8Array(e.data as ArrayBuffer);
        if (b.length < 2) return;
        const op = b[0], seq = b[1], payload = b.slice(2);

        if (op === OP.STATE) {
          for (const sub of this._stateSubs) sub._onData(payload);
        } else if (op === OP.RPC_REPLY) {
          const cb = this._pending.get(seq);
          if (cb) { this._pending.delete(seq); cb.resolve(payload); }
        }
      };
    });
  }

  /** Subscribe to state broadcast. */
  subState(): Subscriber {
    const sub = new Subscriber();
    this._stateSubs.add(sub);
    return sub;
  }

  /** Send RPC request, return reply payload bytes. */
  rpc(payload: Uint8Array, timeoutS = 120): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      if (!this.connected) return reject(new Error("not connected"));
      const seq = ++this._rpcId & 0xff;
      this._pending.set(seq, { resolve, reject });
      const frame = new Uint8Array(2 + payload.length);
      frame[0] = OP.RPC_REQUEST;
      frame[1] = seq;
      frame.set(payload, 2);
      this._ws!.send(frame);
      if (timeoutS > 0) {
        setTimeout(() => {
          if (this._pending.has(seq)) {
            this._pending.delete(seq);
            reject(new Error("RPC timeout"));
          }
        }, timeoutS * 1000);
      }
    });
  }

  /** Send estop signal (fire-and-forget). */
  sendEstop(): void {
    if (this.connected) this._ws!.send(new Uint8Array([OP.ESTOP, 0]));
  }

  /** Close connection. */
  close(): void {
    this._ws?.close();
    this._ws = null;
    this._pending.clear();
    this._stateSubs.clear();
  }
}
