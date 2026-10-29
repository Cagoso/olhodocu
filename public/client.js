const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2','JOKER'];
const $ = id => document.getElementById(id);
const socket = io();
let pid = localStorage.getItem('pid');
if (!pid) { pid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem('pid', pid); }
$('name').value = localStorage.getItem('name') || '';
let state = null, selected = new Set();

const badges = { 'Presidente': '👑 Presidente', 'Vice-Presidente': '🥈 Vice-Presidente', 'Neutro': '😐 Neutro', 'Vice-Olho do Cu': '🧻 Vice-Olho do Cu', 'Olho do Cu': '💩 Olho do Cu' };

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
const handle = res => { if (res && res.error) { $('err').textContent = res.error; toast(res.error); } };

function enter(ev, extra) {
  const name = $('name').value.trim();
  if (!name) return ($('err').textContent = 'Indica o teu nome');
  localStorage.setItem('name', name);
  socket.emit(ev, { name, pid, ...extra }, res => {
    handle(res);
    if (res && res.ok) localStorage.setItem('room', res.code);
  });
}

$('create').onclick = () => enter('create', { password: $('create-pwd').value, isPrivate: $('create-priv').checked });
$('join').onclick = () => enter('join', { code: $('code').value, password: $('join-pwd').value });

$('copy').onclick = () => navigator.clipboard && navigator.clipboard.writeText(state.code).then(() => toast('Código copiado'));

$('leave').onclick = () => {
  socket.emit('leave', res => {
    if (res && res.ok) {
      localStorage.removeItem('room'); 
      state = null;
      $('game').classList.add('hidden'); 
      $('lobby').classList.remove('hidden'); 
    } else handle(res);
  });
};

// Evento que escuta as salas públicas
socket.on('roomList', rooms => {
  const list = $('room-list');
  list.innerHTML = '';
  if (!rooms.length) return list.innerHTML = '<div class="room-item empty">Nenhuma sala pública aberta.</div>';
  
  rooms.forEach(r => {
    const d = document.createElement('div');
    d.className = 'room-item';
    d.innerHTML = `
      <div class="info">
        <strong>${r.host}</strong> <span>${r.count}/${r.max} jogadores</span>
        ${r.hasPassword ? ' 🔒' : ''}
      </div>
      <button class="small">Entrar</button>
    `;
    d.querySelector('button').onclick = () => {
      let pwd = '';
      if (r.hasPassword) {
        pwd = prompt('Esta sala tem senha:');
        if (pwd === null) return;
      }
      const name = $('name').value.trim();
      if (!name) return ($('err').textContent = 'Preenche o teu nome primeiro');
      localStorage.setItem('name', name);
      socket.emit('join', { code: r.code, name, pid, password: pwd }, res => {
        handle(res);
        if (res && res.ok) localStorage.setItem('room', res.code);
      });
    };
    list.appendChild(d);
  });
});

socket.on('connect', () => {
  const code = localStorage.getItem('room'), name = localStorage.getItem('name');
  if (code && name) {
    socket.emit('join', { code, name, pid }, res => {
      if (res && res.error) { localStorage.removeItem('room'); handle(res); }
    });
  }
});

// Fui expulso :(
socket.on('kicked', () => {
  localStorage.removeItem('room');
  state = null;
  $('game').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  toast('Foste expulso da sala pelo Anfitrião.');
});

$('start').onclick = () => socket.emit('start', null, handle);
$('play').onclick = () => { socket.emit('play', [...selected], res => { handle(res); if (res && res.ok) selected.clear(); }); };
$('pass').onclick = () => socket.emit('pass', null, handle);
$('exlow').onclick = () => { selected = new Set(state.hand.slice(0, state.exchange.count).map(c => c.id)); renderHand(); updateControls(); };
$('exok').onclick = () => socket.emit('exchange', [...selected], res => { handle(res); if (res && res.ok) selected.clear(); });

function cardEl(c, clickable) {
  const d = document.createElement('div');
  const joker = c.r === 13;
  d.className = 'card' + (joker ? ' joker' : '') + ((c.s === '♥' || c.s === '♦') ? ' red' : '');
  d.innerHTML = joker ? 'JOKER' : `${RANKS[c.r]}<span>${c.s}</span>`;
  if (clickable) {
    d.onclick = () => {
      if (selected.has(c.id)) selected.delete(c.id);
      else if (state.status === 'exchange' && selected.size >= state.exchange.count) return;
      else selected.add(c.id);
      d.classList.toggle('sel');
      updateControls();
    };
    if (selected.has(c.id)) d.classList.add('sel');
  }
  return d;
}

const canSelect = () => state.status === 'playing' || (state.status === 'exchange' && state.exchange.role === 'give' && !state.exchange.done);

function renderHand() { $('hand').innerHTML = ''; state.hand.forEach(c => $('hand').appendChild(cardEl(c, canSelect()))); }

function renderExchange(ex) {
  $('excards').innerHTML = ''; (ex.cards || []).forEach(c => $('excards').appendChild(cardEl(c)));
  $('extext').textContent = { give: ex.done ? 'Cartas escolhidas.' : `Escolhe ${ex.count} carta(s) para dar:`, take: `Recebeste ${ex.count} carta(s):`, wait: 'À espera…' }[ex.role];
  const pick = ex.role === 'give' && !ex.done;
  $('exlow').classList.toggle('hidden', !pick); $('exok').classList.toggle('hidden', !pick); $('exok').disabled = selected.size !== ex.count;
}

function updateControls() {
  if (!state) return;
  const ex = state.status === 'exchange' ? state.exchange : null;
  $('exchange').classList.toggle('hidden', !ex); if (ex) renderExchange(ex);
  const me = state.players.find(p => p.me), playing = state.status === 'playing';
  $('play').disabled = !(playing && me.isTurn && selected.size); $('pass').disabled = !(playing && me.isTurn && state.table);
  $('play').classList.toggle('hidden', !playing); $('pass').classList.toggle('hidden', !playing);
  $('start').classList.toggle('hidden', !(state.isHost && !['playing', 'exchange'].includes(state.status)));
  $('start').textContent = state.status === 'finished' ? 'Nova ronda' : 'Começar'; $('start').disabled = state.players.length < 4;
}

socket.on('state', s => {
  state = s;
  $('lobby').classList.add('hidden'); $('game').classList.remove('hidden');
  $('roomcode').textContent = s.code;
  const ids = new Set(s.hand.map(c => c.id)); selected = new Set([...selected].filter(id => ids.has(id)));

  $('opps').innerHTML = '';
  s.players.forEach(p => {
    const d = document.createElement('div');
    d.className = 'p' + (p.isTurn ? ' turn' : '') + (p.connected ? '' : ' off') + (p.count === 1 ? ' danger' : '');
    d.innerHTML = `<span class="n"></span><small></small>`;
    d.querySelector('.n').textContent = p.name + (p.me ? ' (tu)' : '');
    
    // NOVO: Adiciona o botão de expulsar se fores o Host
    if (s.isHost && !p.me) {
      const kbtn = document.createElement('button');
      kbtn.className = 'kick-btn';
      kbtn.innerHTML = '✖';
      kbtn.title = 'Expulsar jogador';
      kbtn.onclick = () => confirm(`Queres mesmo expulsar o ${p.name}?`) && socket.emit('kick', p.pid);
      d.appendChild(kbtn);
    }
    
    const titleText = p.title ? (badges[p.title] || p.title) : '';
    d.querySelector('small').textContent = (s.status === 'lobby' ? '' : p.count + ' cartas') + (titleText ? ' · ' + titleText : '') + (p.pending ? ' · a escolher' : '') + (p.connected ? '' : ' · offline');
    $('opps').appendChild(d);
  });

  $('tablecards').innerHTML = '';
  if (s.table) { s.table.cards.forEach(c => { const n = cardEl(c); n.style.setProperty('--rot', (Math.random() * 30 - 15).toFixed(1)); $('tablecards').appendChild(n); }); }
  $('log').textContent = s.log + (s.lock && s.matchLock == null ? ' Regra do 7.' : '');
  $('table').classList.toggle('locked', s.matchLock != null);
  renderHand(); updateControls();
});

// Chat logic
socket.on('chatMessage', ({ name, text }) => {
  const div = document.createElement('div'); div.innerHTML = `<b></b><span></span>`;
  div.querySelector('b').textContent = name + ':'; div.querySelector('span').textContent = text;
  $('chat-messages').appendChild(div); $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
});
function sendChat() { const t = $('chat-input').value.trim(); if (t) { socket.emit('chat', t); $('chat-input').value = ''; } }
$('chat-send').onclick = sendChat; $('chat-input').onkeypress = e => { if (e.key === 'Enter') sendChat(); };