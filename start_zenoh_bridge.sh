#!/bin/bash
# 启动 zenohd 桥接器
# WebSocket 7448 ←→ TCP peer 连接地瓜 192.168.31.237:7447
#
# 用法: ./start_zenoh_bridge.sh

ZENOHD="${ZENOHD:-zenohd}"

# 检查 zenohd 是否在 PATH 中
if ! command -v "$ZENOHD" &>/dev/null; then
    # 尝试 cargo 安装目录
    if [ -f "$HOME/.cargo/bin/zenohd" ]; then
        ZENOHD="$HOME/.cargo/bin/zenohd"
    else
        echo "zenohd not found. Install with: cargo install zenohd"
        exit 1
    fi
fi

echo "启动 zenohd 桥接..."
echo "  WS 监听: 0.0.0.0:7448 (供 litearm-js 连接)"
echo "  TCP 连接: 192.168.31.237:7447 (地瓜 litearm-server)"
echo ""

exec "$ZENOHD" \
    --listen "ws/0.0.0.0:7448" \
    --connect "tcp/192.168.31.237:7447" \
    --no-multicast-scouting \
    "$@"
