/**
 * Minimal WebSocket relay for card-player multiplayer.
 * Run: npm install && npm run multiplayer
 * Then open card-player from http://YOUR_IP:8765 (this server serves static files too) or any static host,
 * and set WebSocket URL to ws://YOUR_IP:8765 (or wss if you terminate TLS in front).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const PORT = parseInt(process.env.PORT || '8765', 10);
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0] || '/');
  const rel = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(root, rel === path.sep ? '' : rel);
  if (!full.startsWith(root)) return null;
  return full;
}

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function genClientId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/** @type {Map<string, { host: import('ws'), peers: Set<import('ws')>, state: { deckIds: string[], field: { instId: string, cardId: string, left: number, top: number }[] } }>} */
const rooms = new Map();

function getRoomForSocket(ws) {
  const code = ws.cmRoom;
  if (!code) return null;
  return rooms.get(code) || null;
}

function broadcast(roomCode, message, except) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const raw = JSON.stringify(message);
  for (const peer of room.peers) {
    if (peer !== except && peer.readyState === WebSocket.OPEN) {
      peer.send(raw);
    }
  }
}

function removePeer(ws) {
  const code = ws.cmRoom;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  room.peers.delete(ws);
  if (room.host === ws) {
    for (const peer of room.peers) {
      if (peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify({ type: 'host_left' }));
      }
    }
    rooms.delete(code);
  }
  ws.cmRoom = undefined;
  ws.cmClientId = undefined;
  ws.cmIsHost = undefined;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }
  let urlPath = req.url || '/';
  if (urlPath === '/') urlPath = '/card-player.html';
  const filePath = safeJoin(ROOT, urlPath);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.cmRoom = undefined;
  ws.cmClientId = undefined;
  ws.cmIsHost = undefined;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'create') {
      let code = genRoomCode();
      while (rooms.has(code)) code = genRoomCode();
      const clientId = genClientId();
      rooms.set(code, {
        host: ws,
        peers: new Set([ws]),
        state: { deckIds: [], field: [] }
      });
      ws.cmRoom = code;
      ws.cmClientId = clientId;
      ws.cmIsHost = true;
      ws.send(JSON.stringify({
        type: 'created',
        room: code,
        clientId,
        state: { deckIds: [], field: [] }
      }));
      return;
    }

    if (msg.type === 'join') {
      const room = typeof msg.room === 'string' ? rooms.get(msg.room.trim().toUpperCase()) : null;
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room not found.' }));
        return;
      }
      const clientId = genClientId();
      ws.cmRoom = msg.room.trim().toUpperCase();
      ws.cmClientId = clientId;
      ws.cmIsHost = false;
      room.peers.add(ws);
      ws.send(JSON.stringify({
        type: 'joined',
        room: ws.cmRoom,
        clientId,
        isHost: false,
        state: {
          deckIds: room.state.deckIds.slice(),
          field: room.state.field.map((f) => ({ ...f }))
        }
      }));
      broadcast(ws.cmRoom, { type: 'peer_joined', clientId }, ws);
      return;
    }

    if (msg.type === 'op') {
      const room = getRoomForSocket(ws);
      if (!room || !msg.room || msg.room !== ws.cmRoom || !msg.action) return;

      const isHost = room.host === ws;
      const a = msg.action;

      if (a === 'set_deck') {
        if (!isHost || !Array.isArray(msg.ids)) return;
        room.state.deckIds = msg.ids.map((id) => String(id));
        broadcast(ws.cmRoom, { type: 'op', action: 'set_deck', ids: room.state.deckIds.slice() }, ws);
        return;
      }

      if (a === 'shuffle_deck') {
        if (!isHost || !Array.isArray(msg.ids)) return;
        room.state.deckIds = msg.ids.map((id) => String(id));
        broadcast(ws.cmRoom, { type: 'op', action: 'shuffle_deck', ids: room.state.deckIds.slice() }, ws);
        return;
      }

      if (a === 'draw') {
        if (!isHost) return;
        const cardId = String(msg.cardId || '');
        const instId = String(msg.instId || '');
        const left = Number(msg.left);
        const top = Number(msg.top);
        if (!cardId || !instId || !Number.isFinite(left) || !Number.isFinite(top)) return;
        const deckIds = Array.isArray(msg.deckIds) ? msg.deckIds.map((id) => String(id)) : [];
        room.state.deckIds = deckIds;
        room.state.field.push({ instId, cardId, left, top });
        broadcast(ws.cmRoom, {
          type: 'op',
          action: 'draw',
          cardId,
          instId,
          left,
          top,
          deckIds: room.state.deckIds.slice()
        }, ws);
        return;
      }

      if (a === 'move_card') {
        const instId = String(msg.instId || '');
        const left = Number(msg.left);
        const top = Number(msg.top);
        if (!instId || !Number.isFinite(left) || !Number.isFinite(top)) return;
        const f = room.state.field.find((x) => x.instId === instId);
        if (f) {
          f.left = left;
          f.top = top;
        }
        broadcast(ws.cmRoom, { type: 'op', action: 'move_card', instId, left, top }, ws);
        return;
      }

      if (a === 'clear_field') {
        room.state.field = [];
        broadcast(ws.cmRoom, { type: 'op', action: 'clear_field' }, ws);
        return;
      }
    }
  });

  ws.on('close', () => removePeer(ws));
  ws.on('error', () => removePeer(ws));
});

server.listen(PORT, () => {
  console.log('Card player multiplayer + static files at http://0.0.0.0:' + PORT + '/card-player.html');
  console.log('WebSocket: ws://0.0.0.0:' + PORT);
});
