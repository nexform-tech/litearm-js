#!/usr/bin/env node
/**
 * litearm-js 真机测试 — 通过 Python zenoh 桥接连接地瓜 litearm-server。
 * 用法: node test_live.mjs
 */
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT = join(__dirname, "zenoh_stdio_bridge.py");
const PYTHONPATH =
  process.env.PYTHONPATH || join(__dirname, "..", "litearm-python", "src");

const litearm = await import("./dist/index.mjs");
const { encodeRequest, decodeReply, decodeState, initCodecSync } = litearm;
initCodecSync();

function startBridge() {
  const proc = spawn("python3", [BRIDGE_SCRIPT], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONPATH },
  });
  proc.stderr.on("data", (d) => process.stderr.write("[bridge] " + d));

  let buf = "";
  let waiters = [];
  let lineQueue = [];
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      if (waiters.length) waiters.shift()(line);
      else lineQueue.push(line);
    }
  });

  return {
    proc,
    sendLine(obj) { proc.stdin.write(JSON.stringify(obj) + "\n"); },
    readLine(timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        if (lineQueue.length) {
          try { resolve(JSON.parse(lineQueue.shift())); }
          catch { reject(new Error("bad JSON")); }
          return;
        }
        const timer = setTimeout(() => reject(new Error("bridge timeout")), timeoutMs);
        waiters.push((line) => {
          clearTimeout(timer);
          try { resolve(JSON.parse(line)); }
          catch { reject(new Error("bad JSON: " + line)); }
        });
      });
    },
    close() {
      this.sendLine({ cmd: "close" });
      proc.kill();
    },
  };
}

async function main() {
  console.log("启动 zenoh 桥接...");
  const bridge = startBridge();

  try {
    const init = await bridge.readLine(8000);
    if (init.type !== "ready") throw new Error("not ready");
    console.log("✓ 已连接地瓜 litearm-server\n");

    // Subscribe to state
    bridge.sendLine({ cmd: "sub", topic: "litearm/v4/armA/state" });
    await bridge.readLine();
    await new Promise((r) => setTimeout(r, 800));
    bridge.sendLine({ cmd: "drain" });
    const drain = await bridge.readLine();

    if (drain.type === "drain_all" && drain.messages.length) {
      const raw = Buffer.from(drain.messages[0].payload, "base64");
      const state = decodeState(raw);
      console.log("状态:", state.state);
      console.log("q type:", typeof state.q, Array.isArray(state.q));
      console.log("q[0] type:", typeof state.q[0], "val:", state.q[0]);
      const q = state.q.map(Number);
      console.log("q[0] after Number:", typeof q[0], "val:", q[0]);
      console.log("关节角:", q.map((v) => v.toFixed(3)));
      console.log("故障:", state.fault || "无");

      // get_tcp_pose
      bridge.sendLine({
        cmd: "query",
        topic: "litearm/v4/armA/rpc",
        payload: Buffer.from(encodeRequest("get_tcp_pose", {})).toString("base64"),
        timeout: 10,
      });
      const poseReply = await bridge.readLine(15000);
      if (poseReply.type === "query_reply") {
        const result = decodeReply(Buffer.from(poseReply.payload, "base64"));
        if (Array.isArray(result) && result.length >= 1) {
          const pos = Array.isArray(result[0]) ? result[0] : result;
          console.log("TCP:", typeof pos, JSON.stringify(pos).slice(0, 100));
        } else {
          console.log("TCP result:", JSON.stringify(result).slice(0, 100));
        }
      } else {
        console.log("get_tcp_pose err:", poseReply.error);
      }

      // Small movej
      console.log("\n[movej] J1 += 0.1 (speed=0.5)...");
      const target = [...q];
      target[0] += 0.1;
      console.log("target:", target.map(v => v + ""));
      console.log("target finite:", target.every(v => Number.isFinite(v)));
      bridge.sendLine({
        cmd: "query",
        topic: "litearm/v4/armA/rpc",
        payload: Buffer.from(encodeRequest("movej", {
          q_target: target,
          speed: 0.5,
          settle_s: 0.2,
        })).toString("base64"),
        timeout: 120,
      });
      const mjReply = await bridge.readLine(130000);
      if (mjReply.type === "query_reply") {
        const ok = decodeReply(Buffer.from(mjReply.payload, "base64"));
        console.log("  ok =", ok);
      } else {
        console.log("  movej 失败:", mjReply.error);
      }

      console.log("\n✓ 测试完成");
    } else {
      console.log("✗ 未收到广播状态:", JSON.stringify(drain).slice(0, 200));
    }
  } catch (e) {
    console.error("✗", e.message);
    process.exitCode = 1;
  } finally {
    bridge.close();
    console.log("已断开");
  }
}

main();
