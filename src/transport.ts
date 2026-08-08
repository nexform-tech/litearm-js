/**
 * @file transport.ts
 * @brief Transport layer for litearm-js using Zenoh.
 *
 * Supports both browser (WebSocket) and Node.js environments.
 *
 * 本实现适配 @eclipse-zenoh/zenoh-ts 1.x（WebSocket-only 客户端模式）。
 * 需 zenoh router（zenohd）桥接到 litearm-server peer。
 */

import * as zenoh from '@eclipse-zenoh/zenoh-ts';
import { Duration } from 'typed-duration';

// state 广播 50Hz × 最长 query timeout 300s = 15000 条消息。设 20000 留余量。
// 栈容量不足以容纳长 query 期间的全部广播时，旧消息会被丢弃。
const SUBSCRIBER_QUEUE_CAPACITY = 20000;

// RPC 默认超时（秒）= 5 分钟。zenoh 默认仅约 10s，运动方法（movej/movel/...）
// 可能跑几十秒甚至更久，会导致运动没走完客户端就误报 No reply received。
// 设成 5min 上限：单次运动调用不可超过 5 分钟，超了即报错。
const DEFAULT_QUERY_TIMEOUT_S = 300;

/**
 * Subscriber handle.
 */
export interface Subscriber {
  /** Try to receive a message (non-blocking). */
  tryRecv(): Uint8Array | null;
  /** Drain to the latest message. */
  drainLatest(): Uint8Array | null;
  /** Unsubscribe. */
  undeclare(): Promise<void>;
}

/**
 * Transport abstraction for pub/sub and query/reply.
 */
export interface Transport {
  /** Publish payload to topic. */
  pub(topic: string, payload: Uint8Array): Promise<void>;
  /** Subscribe to topic. */
  sub(topic: string, callback?: (payload: Uint8Array) => void): Promise<Subscriber>;
  /** Send a query and wait for reply. */
  query(topic: string, payload: Uint8Array): Promise<Uint8Array>;
  /** Close the transport. */
  close(): Promise<void>;
}

/**
 * Internal subscriber implementation using Zenoh callback mode.
 *
 * 使用 declareSubscriber 的 callback 模式而非轮询模式：
 * zenoh-ts 1.x 的 receiver() 需显式 receive() 调用，callback 模式更简单。
 */
class ZenohSubscriber implements Subscriber {
  private queue: Uint8Array[] = [];
  private latest: Uint8Array | null = null;

  constructor(
    private subscriber: zenoh.Subscriber,
    private callback?: (payload: Uint8Array) => void,
  ) {}

  /** Called from the zenoh callback when a sample arrives. */
  onSample(payload: Uint8Array): void {
    this.latest = payload;
    this.queue.push(payload);
    while (this.queue.length > SUBSCRIBER_QUEUE_CAPACITY) {
      this.queue.shift();
    }
    if (this.callback) {
      this.callback(payload);
    }
  }

  tryRecv(): Uint8Array | null {
    return this.queue.shift() ?? null;
  }

  drainLatest(): Uint8Array | null {
    let result: Uint8Array | null = null;
    while (this.queue.length > 0) {
      result = this.queue.shift()!;
    }
    return result ?? this.latest;
  }

  async undeclare(): Promise<void> {
    await this.subscriber.undeclare();
  }
}

/**
 * Zenoh transport implementation.
 *
 * zenoh-ts 1.x 仅支持通过 WebSocket 连接到 zenoh router。
 * 地瓜上的 litearm-server 以 peer 模式运行在 TCP，需要 zenoh router 桥接。
 */
export class ZenohTransport implements Transport {
  private session: zenoh.Session | null = null;
  private subscribers: ZenohSubscriber[] = [];
  private queryTimeoutMS: number;

  /**
   * Create a Zenoh transport.
   * @param endpoint WebSocket endpoint (e.g. "ws://192.168.31.237:7447").
   * @param queryTimeoutS RPC 超时（秒）。默认 300s（5 分钟）。
   */
  constructor(
    private endpoint: string,
    queryTimeoutS: number = DEFAULT_QUERY_TIMEOUT_S,
  ) {
    this.queryTimeoutMS = queryTimeoutS * 1000;
  }

  /**
   * Connect to the Zenoh router.
   */
  async connect(): Promise<void> {
    const config = new zenoh.Config(this.endpoint, this.queryTimeoutMS);
    this.session = await zenoh.Session.open(config);
  }

  /**
   * Publish payload to topic (async — fire-and-forget when no await needed).
   */
  async pub(topic: string, payload: Uint8Array): Promise<void> {
    if (!this.session) {
      throw new Error('Transport not connected');
    }
    await this.session.put(topic, new zenoh.ZBytes(payload));
  }

  /**
   * Subscribe to topic via callback.
   */
  async sub(
    topic: string,
    callback?: (payload: Uint8Array) => void,
  ): Promise<Subscriber> {
    if (!this.session) {
      throw new Error('Transport not connected');
    }

    // ZenohSubscriber to wrap callback
    const sub = new ZenohSubscriber(
      undefined as unknown as zenoh.Subscriber,
      callback,
    );

    const subscriber = await this.session.declareSubscriber(topic, {
      handler: (sample: zenoh.Sample) => {
        sub.onSample(new Uint8Array(sample.payload().toBytes()));
      },
    });

    // Patch the subscriber reference for undeclare
    const self = sub as unknown as { subscriber: zenoh.Subscriber };
    self.subscriber = subscriber;

    this.subscribers.push(sub);
    return sub;
  }

  /**
   * Send a query and wait for reply.
   *
   * 显式传 consolidation=NONE（立即返回首个 reply）和
   * allowedDestination=REMOTE（确保发到远端）。
   */
  async query(topic: string, payload: Uint8Array): Promise<Uint8Array> {
    if (!this.session) {
      throw new Error('Transport not connected');
    }

    const receiver = await this.session.get(topic, {
      payload: new zenoh.ZBytes(payload),
      timeout: Duration.seconds.of(DEFAULT_QUERY_TIMEOUT_S),
      consolidation: zenoh.ConsolidationMode.NONE,
      allowedDestination: zenoh.Locality.REMOTE,
    });

    if (!receiver) {
      throw new Error('No reply received');
    }

    for await (const reply of receiver) {
      const result = reply.result();
      if (result instanceof zenoh.Sample) {
        return new Uint8Array(result.payload().toBytes());
      }
    }

    throw new Error('No reply received');
  }

  /**
   * Close the transport.
   */
  async close(): Promise<void> {
    for (const sub of this.subscribers) {
      try {
        await sub.undeclare();
      } catch {
        // Ignore
      }
    }
    this.subscribers = [];

    if (this.session) {
      await this.session.close();
      this.session = null;
    }
  }
}

/**
 * Create a transport and connect.
 */
export async function createTransport(
  endpoint: string,
  queryTimeoutS?: number,
): Promise<ZenohTransport> {
  const transport = new ZenohTransport(endpoint, queryTimeoutS);
  await transport.connect();
  return transport;
}
