// server.js — Servidor de señalización y relay + hosting estático de la página
// Los navegadores no pueden abrir sockets UDP crudos, así que usamos:
//   - WebSocket (señalización WebRTC + eventos)
//   - DataChannel WebRTC (UDP-like) para las poses a 20 Hz
// HTTP y WebSocket comparten el mismo puerto (8080):
//   http://<ip>:8080  → página del juego (index.html, css/, js/)
//   ws://<ip>:8080    → lobby y señalización
// Uso: node server.js  (o: npm start)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const os = require('os');

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 4;
const COLORS = [0x3366ff, 0xff3333, 0x33cc66, 0xff9900];
const ROOT = __dirname;

// ─── Servicio de archivos estáticos ───
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end('Solicitud inválida');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Acceso denegado');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('No encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ─── WebSocket (lobby + señalización) ───
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

let players = [];
let nextId = 1;

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(msg, except) {
  for (const p of players) if (p.ws !== except) send(p.ws, msg);
}

function rosterMsg() {
  return { t: 'roster', players: players.map(p => ({ id: p.id, name: p.name, color: p.color, host: p.host })) };
}

wss.on('connection', (ws) => {
  if (players.length >= MAX_PLAYERS) {
    send(ws, { t: 'error', msg: 'Sala llena (máximo 4 jugadores).' });
    ws.close();
    return;
  }

  const player = {
    id: nextId++,
    ws,
    name: '',
    color: COLORS[players.length],
    host: players.length === 0,
  };
  players.push(player);

  send(ws, { t: 'welcome', id: player.id, color: player.color, host: player.host });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    switch (m.t) {
      case 'hello':
        player.name = String(m.name || ('Jugador ' + player.id)).substring(0, 12);
        broadcast(rosterMsg());
        break;

      case 'relay': {
        const target = players.find(p => p.id === m.target && p !== player);
        if (!target) return;
        send(target.ws, { t: 'relay', from: player.id, msg: m.msg || {} });
        break;
      }

      case 'start':
        // Solo el host puede arrancar, y con al menos 2 jugadores presentes
        if (player.host && players.length >= 2) {
          broadcast({ t: 'start', ts: Date.now() });
        }
        break;

      case 'ping':
        send(ws, { t: 'pong', ts: m.ts });
        break;
    }
  });

  ws.on('close', () => {
    const wasHost = player.host;
    players = players.filter(p => p !== player);
    broadcast({ t: 'leave', id: player.id });
    // Si el host se desconectó, el primer jugador restante pasa a ser host
    if (wasHost && players.length > 0 && !players[0].host) {
      players[0].host = true;
      send(players[0].ws, { t: 'role', host: true });
    }
  });

  ws.on('error', () => {});
});

function lanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

server.listen(PORT, () => {
  console.log('=== Servidor: Circuito Urbano Online ===');
  console.log('Escuchando en el puerto ' + PORT);
  for (const ip of lanIPs()) {
    console.log('   http://' + ip + ':' + PORT + '   (página del juego)');
    console.log('   ws://' + ip + ':' + PORT + '   (lobby / señalización)');
  }
  console.log('Abre la URL http://<ip>:<puerto> en los navegadores de todos los PCs.');
});