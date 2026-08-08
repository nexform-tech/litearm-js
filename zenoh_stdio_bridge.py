#!/usr/bin/env python3
"""
zenoh stdio 桥接：让 litearm-js 通过 Python 子进程访问地瓜 litearm-server。

协议（每行 JSON）：
→ {"cmd":"pub","topic":"...","payload":"<base64>"}
→ {"cmd":"sub","topic":"..."}
→ {"cmd":"drain","topic":"..."}   # drain sub 缓冲，回最新一条
→ {"cmd":"query","topic":"...","payload":"<base64>[protobuf RPC payload]","timeout":300}
← {"type":"ready"}
← {"type":"ok","cmd":"..."}
← {"type":"sub_data","topic":"...","payload":"<base64>"}
← {"type":"query_reply","payload":"<base64>"}
← {"type":"query_error","error":"..."}
"""
import sys
import json
import base64
import select

import zenoh

ENDPOINT = "tcp/192.168.31.237:7447"


def poll_subs(subs, timeout=0.0):
    """非阻塞 poll 所有 subscriber，返回 [(topic, b64_payload), ...]"""
    results = []
    for topic, sub in subs.items():
        try:
            sample = sub.try_recv()
            while sample is not None:
                results.append((topic, base64.b64encode(bytes(sample.payload)).decode()))
                sample = sub.try_recv()
        except Exception:
            pass
    return results


def main():
    endpoint = sys.argv[1] if len(sys.argv) > 1 else ENDPOINT

    cfg = zenoh.Config()
    cfg.insert_json5("mode", '"peer"')
    cfg.insert_json5("connect/endpoints", f'["{endpoint}"]')
    cfg.insert_json5("scouting/multicast/enabled", "false")
    cfg.insert_json5("scouting/gossip/enabled", "false")

    session = zenoh.open(cfg)

    def send(obj):
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    subs = {}  # topic → Subscriber
    latest_by_topic = {}  # topic → latest payload b64

    send({"type": "ready"})

    # 用 select 让 stdin 可超时轮询（每次 drain sub 缓冲）
    while True:
        # Drain subscriber buffers
        for topic, b64 in poll_subs(subs):
            latest_by_topic[topic] = b64

        # Check stdin (non-blocking)
        ready, _, _ = select.select([sys.stdin], [], [], 0.02)
        if not ready:
            continue

        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
            cmd = req["cmd"]

            if cmd == "pub":
                session.put(req["topic"], base64.b64decode(req["payload"]))
                send({"type": "ok", "cmd": "pub"})

            elif cmd == "sub":
                topic = req["topic"]
                if topic not in subs:
                    handler = zenoh.handlers.FifoChannel(20000)
                    sub = session.declare_subscriber(topic, handler)
                    subs[topic] = sub
                    latest_by_topic[topic] = ""
                send({"type": "ok", "cmd": "sub", "topic": topic})

            elif cmd == "drain":
                topic = req.get("topic", "")
                if topic and topic in latest_by_topic:
                    send({"type": "sub_data", "topic": topic,
                          "payload": latest_by_topic[topic]})
                elif not topic:
                    # Return all
                    msgs = [{"topic": t, "payload": p}
                            for t, p in latest_by_topic.items() if p]
                    send({"type": "drain_all", "messages": msgs})
                else:
                    send({"type": "sub_data", "topic": topic, "payload": ""})

            elif cmd == "query":
                topic = req["topic"]
                payload = base64.b64decode(req.get("payload", ""))
                timeout = float(req.get("timeout", 300.0))
                try:
                    replies = session.get(topic, payload=payload, timeout=timeout)
                    for reply in replies:
                        ok = getattr(reply, "ok", None)
                        if ok is not None:
                            send({"type": "query_reply",
                                  "payload": base64.b64encode(bytes(ok.payload)).decode()})
                            break
                        err = getattr(reply, "err", None)
                        if err is not None:
                            send({"type": "query_error", "error": str(err)})
                            break
                    else:
                        send({"type": "query_error", "error": "No valid reply received"})
                except Exception as exc:
                    send({"type": "query_error", "error": str(exc)})

            elif cmd == "close":
                break

        except Exception as exc:
            send({"type": "error", "msg": str(exc)})

    for sub in subs.values():
        try:
            sub.undeclare()
        except Exception:
            pass
    session.close()


if __name__ == "__main__":
    main()
