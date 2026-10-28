const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2','JOKER'];
const $ = id => document.getElementById(id);
const socket = io();
let pid = localStorage.getItem('pid');
if (!pid) { pid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem('pid', pid); }
$('name').value = localStorage.getItem('name') || '';
let state = null, selected = new Set();

// Emojis para os títulos do final da ronda
const badges = {
  'Presidente': '👑 Presidente',
  'Vice-Presidente': '🥈 Vice-Presidente',
  'Neutro': '😐 Neutro',
  'Vice-Olho do Cu': '🧻 Vice-Olho do Cu',
  'Olho do Cu': '💩 Olho do Cu'
};

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
$('create').onclick = () => enter('create');
$('join').onclick = () => enter('join', { code: $('code').value });
$('copy').onclick = () => navigator.clipboard && navigator.clipboard.writeText(state.code).then(() => toast('Código copiado'));
// NOVO: Ação do botão Sair
$('leave').onclick = () => {
  socket.emit('leave', res => {
    if (res && res.ok) {
      localStorage.removeItem('room'); // Limpa a memória para não forçar reconexão
      state = null;
      $('game').classList.add('hidden'); // Esconde a mesa
      $('lobby').classList.remove('hidden'); // Mostra o lobby
    } else {
      handle(res);
    }
  });
};
$('start').onclick = () => socket.emit('start', null, handle);
$('play').onclick = () => { socket.emit('play', [...selected], res => { handle(res); if (res && res.ok) selected.clear(); }); };
$('pass').onclick = () => socket.emit('pass', null, handle);
$('exlow').onclick = () => { 
  selected = new Set(state.hand.slice(0, state.exchange.count).map(c => c.id));
  renderHand(); updateControls();
};
$('exok').onclick = () => socket.emit('exchange', [...selected], res => { handle(res); if (res && res.ok) selected.clear(); });

// Reconexão automática à sala guardada
socket.on('connect', () => {
  const code = localStorage.getItem('room'), name = localStorage.getItem('name');
  if (code && name) {
    socket.emit('join', { code, name, pid }, res => {
      if (res && res.error) {
        // Se a sala já não existir ou der erro, limpa a memória para não ficar num loop
        localStorage.removeItem('room'); 
        handle(res);
      }
    });
  }
});

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

const canSelect = () => state.status === 'playing' ||
  (state.status === 'exchange' && state.exchange.role === 'give' && !state.exchange.done);

function renderHand() {
  $('hand').innerHTML = '';
  state.hand.forEach(c => $('hand').appendChild(cardEl(c, canSelect())));
}

function renderExchange(ex) {
  $('excards').innerHTML = '';
  (ex.cards || []).forEach(c => $('excards').appendChild(cardEl(c)));
  $('extext').textContent = {
    give: ex.done ? 'Cartas escolhidas. À espera da outra troca…'
                  : `Escolhe ${ex.count} carta(s) da tua mão para dar a ${ex.partner}. Vais receber:`,
    take: `Deste as tuas ${ex.count} melhor(es) carta(s) a ${ex.partner}:`,
    wait: 'Não participas na troca. À espera…',
  }[ex.role];
  const pick = ex.role === 'give' && !ex.done;
  $('exlow').classList.toggle('hidden', !pick);
  $('exok').classList.toggle('hidden', !pick);
  $('exok').disabled = selected.size !== ex.count;
}

function updateControls() {
  if (!state) return;
  const ex = state.status === 'exchange' ? state.exchange : null;
  $('exchange').classList.toggle('hidden', !ex);
  if (ex) renderExchange(ex);
  const me = state.players.find(p => p.me);
  const playing = state.status === 'playing';
  $('play').disabled = !(playing && me.isTurn && selected.size);
  $('pass').disabled = !(playing && me.isTurn && state.table);
  $('play').classList.toggle('hidden', !playing);
  $('pass').classList.toggle('hidden', !playing);
  const canStart = state.isHost && !['playing', 'exchange'].includes(state.status);
  $('start').classList.toggle('hidden', !canStart);
  $('start').textContent = state.status === 'finished' ? 'Nova ronda' : 'Começar';
  $('start').disabled = state.players.length < 4;
}

socket.on('state', s => {
  state = s;
  $('lobby').classList.add('hidden'); $('game').classList.remove('hidden');
  $('roomcode').textContent = s.code;
  const ids = new Set(s.hand.map(c => c.id));
  selected = new Set([...selected].filter(id => ids.has(id)));

  $('opps').innerHTML = '';
  s.players.forEach(p => {
    const d = document.createElement('div');
    // Adiciona a classe 'danger' se o jogador só tiver 1 carta
    d.className = 'p' + (p.isTurn ? ' turn' : '') + (p.connected ? '' : ' off') + (p.count === 1 ? ' danger' : '');
    d.innerHTML = `<span class="n"></span><small></small>`;
    d.querySelector('.n').textContent = p.name + (p.me ? ' (tu)' : '');
    
    // Substitui o título simples pelo título com emoji (se existir)
    const titleText = p.title ? (badges[p.title] || p.title) : '';
    
    d.querySelector('small').textContent =
      (s.status === 'lobby' ? '' : p.count + ' cartas') + (titleText ? ' · ' + titleText : '') + (p.pending ? ' · a escolher' : '') + (p.connected ? '' : ' · offline');
    $('opps').appendChild(d);
  });

  $('tablecards').innerHTML = '';
  if (s.table) {
    s.table.cards.forEach(c => {
      const cardNode = cardEl(c);
      // Rotação aleatória para parecer atirado à sorte na mesa
      const angle = (Math.random() * 30 - 15).toFixed(1);
      cardNode.style.setProperty('--rot', angle);
      $('tablecards').appendChild(cardNode);
    });
  }
  
  $('log').textContent = s.log + (s.lock && s.matchLock == null ? ' Regra do 7 ativa: 7 ou inferior.' : '');
  $('table').classList.toggle('locked', s.matchLock != null);

  renderHand();
  updateControls();
});

// --- LÓGICA DO CHAT ---
socket.on('chatMessage', ({ name, text }) => {
  const div = document.createElement('div');
  // Usar textContent em vez de innerHTML nas variáveis protege contra malta que tente injetar código
  div.innerHTML = `<b></b><span></span>`;
  div.querySelector('b').textContent = name + ':';
  div.querySelector('span').textContent = text;
  
  $('chat-messages').appendChild(div);
  
  // Faz scroll automático para a última mensagem
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
});

function sendChat() {
  const text = $('chat-input').value.trim();
  if (text) {
    socket.emit('chat', text);
    $('chat-input').value = '';
  }
}

$('chat-send').onclick = sendChat;
$('chat-input').onkeypress = e => { 
  if (e.key === 'Enter') sendChat(); 
};