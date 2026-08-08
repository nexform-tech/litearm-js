#!/usr/bin/env python3
"""
zenoh 桥接：把本地 WebSocket 请求转发到远程 TCP peer。

zenoh 1.x peer 模式支持同时监听 TCP 和 WS。本脚本启动一个本地 router/peer，
监听 WS 供 litearm-js 连接，同时连接到地瓜上的 litearm-server。
"""
import zenoh
import sys
import time


def main():
    ws_listen = sys.argv[1] if len(sys) > 1 else "ws/0.0.0.0:7449"
    tcp_connect = sys.argv[2] if len(sys) > 2 else "tcp/192.168.31.237:7447"

    cfg = zenoh.Config()
    cfg.insert_json5("mode", '"peer"')
    cfg.insert_json5("listen/endpoints", f'["{ws_listen}"]')
    cfg.insert_json5("connect/endpoints", f'["{tcp_connect}"]')
    cfg.insert_json5("scouting/multicast/enabled", "false")
    cfg.insert_json5("scouting/gossip/enabled", "false")
    # 长 query 超时
    cfg.insert_json5("queries_default_timeout", "300000")

    print(f"zenoh 桥接器启动")
    print(f"  WS 监听: {ws_listen}")
    print(f"  TCP 连接: {tcp_connect}")
    print(f"  供 litearm-js 连接: ws://{ws_listen.split('/')[-1]}")

    session = zenoh.open(cfg)
    try:
        print("已连接（Ctrl+C 退出）")
        while True:
            time.sleep(10)
    except KeyboardInterrupt:
        print("\n关闭...")
    finally:
        session.close()
        print("已关闭")


if __name__ == "__main__":
    main()
