#!/usr/bin/env node
/**
 * Puente local para imprimir ESC/POS cuando Next.js está en la nube (Vercel, etc.)
 * y la térmica está en la LAN. En la máquina de la caja:
 *
 *   node scripts/thermal-print-bridge.mjs
 *
 * Front: NEXT_PUBLIC_THERMAL_BRIDGE_URL=http://127.0.0.1:3040
 *
 * POST /print  JSON: { "host": "192.168.1.50", "port": 9100, "dataBase64": "..." }
 * El buffer puede incluir QR ESC/POS (GS ( k); compatible térmicas tipo Epson / Daruma DIG-E200I.
 */

import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.THERMAL_BRIDGE_PORT || 3040);
const BIND = process.env.THERMAL_BRIDGE_BIND || "127.0.0.1";

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

  if (req.method !== "POST" || req.url !== "/print") {
    sendJson(res, 404, { ok: false, message: "Use POST /print" });
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

    const host = typeof body.host === "string" ? body.host.trim() : "";
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
  console.error(`thermal-print-bridge http://${BIND}:${PORT}`);
});
