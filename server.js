#!/usr/bin/env node
/**
 * litearm-js Web 测试服务器
 *
 * 架构:
 *   浏览器 ──WS──→ Node.js server ──JSON-lines──→ Python zenoh bridge ──TCP──→ 地瓜
 *
 * 启动: node server.js
 * 打开: http://localhost:8080
 */
import { createServer } from "http";
import { readFileSync } from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { WebSocketServer } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHONPATH =
  process.env.PYTHONPATH || join(__dirname, "..", "litearm-python", "src");
const BRIDGE_SCRIPT = join(__dirname, "zenoh_stdio_bridge.py");

// ── 启动 Python zenoh 桥接 ─────────────────────────────────────────────────
console.log("启动 Python zenoh 桥接...");
const bridge = spawn("python3", [BRIDGE_SCRIPT], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, PYTHONPATH },
});

let bridgeBuf = "";
let bridgeWaiters = [];
let bridgeQueue = [];

bridge.stdout.on("data", (chunk) => {
  bridgeBuf += chunk.toString();
  let nl;
  while ((nl = bridgeBuf.indexOf("\n")) !== -1) {
    const line = bridgeBuf.slice(0, nl).trim();
    bridgeBuf = bridgeBuf.slice(nl + 1);
    if (!line) continue;
    if (bridgeWaiters.length) {
      bridgeWaiters.shift()(line);
    } else {
      bridgeQueue.push(line);
    }
  }
});

bridge.stderr.on("data", (d) => process.stderr.write("[bridge] " + d));

function bridgeSend(obj) {
  bridge.stdin.write(JSON.stringify(obj) + "\n");
}

function bridgeReadLine(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (bridgeQueue.length) {
      try { resolve(JSON.parse(bridgeQueue.shift())); } catch { reject(new Error("bad JSON")); }
      return;
    }
    const timer = setTimeout(() => reject(new Error("bridge timeout")), timeoutMs);
    bridgeWaiters.push((line) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(line)); } catch { reject(new Error("bad JSON: " + line)); }
    });
  });
}

// 等待桥接就绪
const init = await bridgeReadLine(10000);
if (init.type !== "ready") throw new Error("bridge not ready");
console.log("✓ zenoh 桥接已连接地瓜");

// 初始化订阅
bridgeSend({ cmd: "sub", topic: "litearm/v4/armA/state" });
await bridgeReadLine();

// 状态广播推送（定时 drain）
let stateInterval;
function startStateBroadcast(ws) {
  if (stateInterval) return;
  stateInterval = setInterval(async () => {
    bridgeSend({ cmd: "drain" });
    try {
      const drain = await bridgeReadLine(500);
      if (drain.type === "drain_all" && drain.messages.length) {
        const msg = JSON.stringify({ type: "state", data: drain.messages[0] });
        wss.clients.forEach((c) => {
          if (c.readyState === 1) c.send(msg);
        });
      }
    } catch {}
  }, 50); // ~20Hz
}

// ── HTTP 服务器 ────────────────────────────────────────────────────────────
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".mjs": "text/javascript",
};

const server = createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(join(__dirname, "examples", "index.html")));
  } else if (req.method === "GET" && req.url) {
    try {
      const path = join(__dirname, req.url);
      const ext = req.url.match(/\.[^.]+$/)?.[0] || "";
      res.writeHead(200, { "Content-Type": mime[ext] || "text/plain" });
      res.end(readFileSync(path));
    } catch {
      res.writeHead(404);
      res.end("404");
    }
  } else {
    res.writeHead(404);
    res.end("404");
  }
});

// ── WebSocket 服务器 ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("浏览器已连接");
  startStateBroadcast(ws);

  ws.on("message", async (raw) => {
    let req;
    try { req = JSON.parse(raw.toString()); } catch { return; }

    try {
      if (req.cmd === "query") {
        bridgeSend({
          cmd: "query",
          topic: req.topic || "litearm/v4/armA/rpc",
          payload: req.payload || "",
          timeout: req.timeout || 120,
        });
        const reply = await bridgeReadLine(130000);
        ws.send(JSON.stringify({ type: "reply", id: req.id, data: reply }));
      } else if (req.cmd === "pub") {
        bridgeSend({ cmd: "pub", topic: req.topic, payload: req.payload });
      } else if (req.cmd === "sub") {
        bridgeSend({ cmd: "sub", topic: req.topic });
        await bridgeReadLine();
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", id: req.id, error: e.message }));
    }
  });

  ws.on("close", () => {
    console.log("浏览器已断开");
    if (wss.clients.size === 0 && stateInterval) {
      clearInterval(stateInterval);
      stateInterval = null;
    }
  });
});

const PORT = 8080;
server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║  🤖 LiteArm Web 测试页面            ║`);
  console.log(`  ║  打开浏览器: http://localhost:${PORT}  ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});

// 优雅退出
process.on("SIGINT", () => {
  bridge.kill();
  server.close();
  process.exit();
});
