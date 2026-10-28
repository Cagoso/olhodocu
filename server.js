const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const G = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => {
  let c;
  do { c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join(''); }
  while (rooms.has(c));
  return c;
};

const broadcast = room => room.players.forEach(p => p.sid && io.to(p.sid).emit('state', G.viewFor(room, p.pid)));
const clean = s => String(s || '').trim().slice(0, 16);

io.on('connection', socket => {
  let room = null, pid = null;
  const fail = (cb, msg) => cb && cb({ error: msg });

  socket.on('create', ({ name, pid: id }, cb) => {
    name = clean(name); if (!name || !id) return fail(cb, 'Indica o teu nome');
    room = { code: newCode(), hostPid: id, players: [], status: 'lobby', round: 0, turn: 0, table: null,
             lock: false, passes: 0, lastIdx: -1, ranking: [], loserPid: null, log: 'À espera de jogadores…' };
    rooms.set(room.code, room);
    pid = id;
    room.players.push({ pid, sid: socket.id, name, hand: [], connected: true });
    cb && cb({ ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('join', ({ code, name, pid: id }, cb) => {
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return fail(cb, 'Sala não encontrada');
    const existing = r.players.find(p => p.pid === id);
    if (existing) { existing.sid = socket.id; existing.connected = true; } // reconexão
    else {
      name = clean(name);
      if (!name) return fail(cb, 'Indica o teu nome');
      if (r.status !== 'lobby') return fail(cb, 'O jogo já começou');
      if (r.players.length >= G.MAX_PLAYERS) return fail(cb, 'Sala cheia (máx. 8)');
      if (r.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return fail(cb, 'Nome já usado nesta sala');
      r.players.push({ pid: id, sid: socket.id, name, hand: [], connected: true });
    }
    room = r; pid = id;
    cb && cb({ ok: true, code: r.code });
    broadcast(r);
  });

  const act = (fn, hostOnly) => (arg, cb) => {
    if (!room) return fail(cb, 'Não estás numa sala');
    if (hostOnly && room.hostPid !== pid) return fail(cb, 'Só o anfitrião pode fazer isto');
    const err = fn(arg);
    if (err) return fail(cb, err);
    cb && cb({ ok: true });
    broadcast(room);
  };

  socket.on('start', act(() => (['playing', 'exchange'].includes(room.status) ? 'Jogo já a decorrer' : G.startRound(room)), true));
  socket.on('exchange', act(ids => G.exchange(room, pid, ids)));
  socket.on('play', act(ids => G.play(room, pid, ids)));
  socket.on('pass', act(() => G.pass(room, pid)));

  // NOVO: Evento para sair da sala voluntariamente
  socket.on('leave', cb => {
    if (!room) return fail(cb, 'Não estás numa sala');
    const i = room.players.findIndex(p => p.pid === pid);
    if (i >= 0) {
      if (room.status === 'lobby') {
        // Se ainda estiverem no lobby, removemos o jogador da sala
        room.players.splice(i, 1);
        if (!room.players.length) rooms.delete(room.code); // Apaga a sala se ficar vazia
        else if (room.hostPid === pid) room.hostPid = room.players[0].pid; // Passa o anfitrião a outro
      } else { 
        // Se o jogo já começou, apenas marcamos como offline para não partir a mesa
        room.players[i].connected = false; 
        room.players[i].sid = null; 
      }
      broadcast(room);
    }
    room = null; // O jogador já não pertence à sala no servidor
    cb && cb({ ok: true });
  });

  // Lógica do Chat
  socket.on('chat', text => {
    if (!room) return;
    text = clean(text).slice(0, 100); // Limpa o texto e limita a 100 caracteres
    if (!text) return;
    
    const p = room.players.find(x => x.pid === pid);
    if (p) {
      // Envia apenas a mensagem de chat para todos na sala (não atualiza o jogo todo)
      room.players.forEach(op => {
        if (op.sid) io.to(op.sid).emit('chatMessage', { name: p.name, text });
      });
    }
  });

  socket.on('disconnect', () => {
    if (!room) return;
    const i = room.players.findIndex(p => p.pid === pid);
    if (i < 0 || room.players[i].sid !== socket.id) return;
    if (room.status === 'lobby') {
      room.players.splice(i, 1);
      if (!room.players.length) return void rooms.delete(room.code);
      if (room.hostPid === pid) room.hostPid = room.players[0].pid;
    } else { room.players[i].connected = false; room.players[i].sid = null; }
    broadcast(room);
  });
});

server.listen(process.env.PORT || 3000, () => console.log('Olho do Cu em http://localhost:' + (process.env.PORT || 3000)));
