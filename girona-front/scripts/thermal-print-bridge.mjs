#!/usr/bin/env node
/**
 * Puente local para imprimir ESC/POS cuando Next.js está en la nube (Vercel, etc.)
 * y la térmica está en la LAN. En la máquina de la caja:
 *
 *   node scripts/thermal-print-bridge.mjs
 *
 * Front (LAN): NEXT_PUBLIC_THERMAL_BRIDGE_URL=http://192.168.1.100:3040
 * Escuchar en toda la red: THERMAL_BRIDGE_BIND=0.0.0.0 (por defecto)
 *
 * POST /print  JSON: { "host": "192.168.1.50", "port": 9100, "dataBase64": "..." }
 * El buffer puede incluir QR ESC/POS (GS ( k); compatible térmicas tipo Epson / Daruma DIG-E200I.
 */

import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";

const PORT = Number(process.env.THERMAL_BRIDGE_PORT || 3040);
const BIND = process.env.THERMAL_BRIDGE_BIND || "0.0.0.0";
const CUPS_QUEUE = (process.env.THERMAL_CUPS_QUEUE || "GA-E200I").trim();

function lanIpv4Addresses() {
  const out = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

function sendJson(res, code, obj) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, port: PORT, bind: BIND, cupsQueue: CUPS_QUEUE || null });
    return;
  }

  if (req.method !== "POST" || req.url !== "/print") {
    sendJson(res, 404, { ok: false, message: "Use POST /print o GET /health" });
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      sendJson(res, 400, { ok: false, message: "JSON inválido" });
      return;
    }

    const host = typeof body.host === "string" ? body.host.trim().toLowerCase() : "";
    const port = Number(body.port) > 0 ? Number(body.port) : 9100;
    const b64 = typeof body.dataBase64 === "string" ? body.dataBase64 : "";

    if (!host || !b64) {
      sendJson(res, 400, { ok: false, message: "host y dataBase64 requeridos" });
      return;
    }

    let buf;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      sendJson(res, 400, { ok: false, message: "dataBase64 inválido" });
      return;
    }

    let done = false;
    const finish = (code, obj) => {
      if (done) return;
      done = true;
      sendJson(res, code, obj);
    };

    const useCups = host === "cups" || host === CUPS_QUEUE.toLowerCase();
    if (useCups) {
      if (!CUPS_QUEUE) {
        finish(400, { ok: false, message: "THERMAL_CUPS_QUEUE no configurada" });
        return;
      }
      const proc = spawn("lp", ["-d", CUPS_QUEUE, "-o", "raw"], {
        stdio: ["pipe", "ignore", "pipe"],
      });
      let err = "";
      proc.stderr.on("data", (c) => {
        err += c.toString();
      });
      proc.on("error", (e) => finish(502, { ok: false, message: e.message }));
      proc.on("close", (code) => {
        if (code === 0) finish(200, { ok: true, bytes: buf.length, via: "cups", queue: CUPS_QUEUE });
        else finish(502, { ok: false, message: err.trim() || `lp salió con código ${code}` });
      });
      proc.stdin.write(buf);
      proc.stdin.end();
      return;
    }

    const socket = net.createConnection({ host, port }, () => {
      socket.write(buf, (err) => {
        if (err) {
          socket.destroy();
          finish(502, { ok: false, message: err.message });
          return;
        }
        socket.end();
      });
    });

    socket.setTimeout(15_000);
    socket.on("timeout", () => {
      socket.destroy();
      finish(504, { ok: false, message: "Timeout impresora" });
    });
    socket.on("error", (err) => {
      socket.destroy();
      finish(502, { ok: false, message: err.message });
    });
    socket.on("close", () => {
      finish(200, { ok: true, bytes: buf.length });
    });
  });
});

server.listen(PORT, BIND, () => {
  console.error(`thermal-print-bridge escuchando en ${BIND}:${PORT}`);
  const ips = lanIpv4Addresses();
  if (ips.length) {
    for (const ip of ips) {
      console.error(`  → http://${ip}:${PORT}/print  (use esta URL en Vercel / POS)`);
    }
  } else {
    console.error(`  → http://127.0.0.1:${PORT}/print`);
  }
  if (CUPS_QUEUE) {
    console.error(`  USB/CUPS: en el POS use host "cups" (cola ${CUPS_QUEUE})`);
  }
});
