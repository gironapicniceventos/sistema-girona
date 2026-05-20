#!/usr/bin/env node
/**
 * Puente LAN para imprimir ESC/POS desde el POS en Vercel (HTTPS).
 *
 *   THERMAL_CUPS_QUEUE=GA-E200I node scripts/thermal-print-bridge.mjs
 *
 * HTTP  :3040  — solo mismo origen / pruebas locales
 * HTTPS :3041  — usar en Vercel: NEXT_PUBLIC_THERMAL_BRIDGE_URL=https://IP-LAN:3041
 * (Abra https://IP:3041/health una vez y acepte el certificado autofirmado.)
 *
 * POST /print  { "host": "cups" | "192.168.x.x", "port": 9100, "dataBase64": "..." }
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT_HTTP = Number(process.env.THERMAL_BRIDGE_PORT || 3040);
const PORT_HTTPS = Number(process.env.THERMAL_BRIDGE_HTTPS_PORT || 3041);
const BIND = process.env.THERMAL_BRIDGE_BIND || "0.0.0.0";
const CUPS_QUEUE = (process.env.THERMAL_CUPS_QUEUE || "GA-E200I").trim();
const TLS_ENABLED = process.env.THERMAL_BRIDGE_TLS !== "0";

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

function ensureTlsMaterial() {
  const dir = path.join(__dirname, ".thermal-bridge-certs");
  mkdirSync(dir, { recursive: true });
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    console.error("Generando certificado TLS autofirmado (válido ~10 años)...");
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes -subj "/CN=thermal-print-bridge"`,
      { stdio: "inherit" },
    );
  }
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
}

function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS, GET",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, {
      ok: true,
      httpPort: PORT_HTTP,
      httpsPort: TLS_ENABLED ? PORT_HTTPS : null,
      bind: BIND,
      cupsQueue: CUPS_QUEUE || null,
    });
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
}

function logUrls() {
  const ips = lanIpv4Addresses();
  console.error(`thermal-print-bridge escuchando en ${BIND}`);
  if (ips.length) {
    for (const ip of ips) {
      console.error(`  HTTP  → http://${ip}:${PORT_HTTP}/print`);
      if (TLS_ENABLED) {
        console.error(`  HTTPS → https://${ip}:${PORT_HTTPS}/print  ← Vercel (acepte certificado en /health)`);
      }
    }
  } else {
    console.error(`  HTTP  → http://127.0.0.1:${PORT_HTTP}/print`);
    if (TLS_ENABLED) console.error(`  HTTPS → https://127.0.0.1:${PORT_HTTPS}/print`);
  }
  if (CUPS_QUEUE) {
    console.error(`  Impresora USB: host "cups" (cola ${CUPS_QUEUE})`);
  }
}

http.createServer(handleRequest).listen(PORT_HTTP, BIND, logUrls);

if (TLS_ENABLED) {
  try {
    const tls = ensureTlsMaterial();
    https.createServer(tls, handleRequest).listen(PORT_HTTPS, BIND, () => {
      console.error(`  TLS activo en puerto ${PORT_HTTPS}`);
    });
  } catch (e) {
    console.error("No se pudo iniciar HTTPS (¿openssl instalado?):", e.message);
    console.error("Instale openssl o use THERMAL_BRIDGE_TLS=0 solo en desarrollo local.");
  }
}
