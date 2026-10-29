// Lógica pura do jogo (sem Socket.io) — fácil de testar.
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2','JOKER'];
const SEVEN = 4, JACK = 8, JOKER = 13;
const SUITS = ['♠', '♥', '♦', '♣'];
const MIN_PLAYERS = 4, MAX_PLAYERS = 8;
const EXCHANGE_FREE_CHOICE = true;

const decksFor = n => (n <= 5 ? 1 : 2); 

function buildDeck(decks) {
  const d = [];
  for (let k = 0; k < decks; k++) {
    for (let r = 0; r < 13; r++) for (const s of SUITS) d.push({ id: `${k}-${r}${s}`, r, s });
    d.push({ id: `${k}-JK1`, r: JOKER, s: '*' }, { id: `${k}-JK2`, r: JOKER, s: '*' });
  }
  return d;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function titles(n) {
  return Array.from({ length: n }, (_, i) =>
    i === 0 ? 'Presidente' : i === 1 ? 'Vice-Presidente' :
    i === n - 1 ? 'Olho do Cu' : i === n - 2 ? 'Vice-Olho do Cu' : 'Neutro');
}

const nextActive = (room, from) => {
  const n = room.players.length;
  for (let j = 1; j <= n; j++) {
    const k = (from + j) % n;
    if (room.players[k].hand.length > 0) return k;
  }
  return from;
};

function startRound(room) {
  const n = room.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) return `São precisos ${MIN_PLAYERS} a ${MAX_PLAYERS} jogadores`;
  const deck = shuffle(buildDeck(decksFor(n)));
  room.players.forEach(p => { p.hand = []; p.finished = false; });
  deck.forEach((c, i) => room.players[i % n].hand.push(c));
  room.players.forEach(p => p.hand.sort((a, b) => a.r - b.r || a.s.localeCompare(b.s)));
  room.round++;
  room.status = 'playing';
  room.table = null; room.lock = false; room.matchLock = null; room.matchLockFrom = null;
  room.mustOpen = false; room.firstPlay = true; 
  room.passes = 0; room.lastIdx = -1; room.ranking = [];
  
  if (room.round === 1 || !room.loserPid) {
    room.turn = room.players.findIndex(p => p.hand.some(c => c.r === 0 && c.s === '♠'));
    room.mustOpen = true;
    room.log = `${room.players[room.turn].name} tem o 3 de Espadas e começa (apenas 1 carta).`;
  } else beginExchange(room);
  
  return null;
}

const sortHand = h => h.sort((a, b) => a.r - b.r || a.s.localeCompare(b.s));
const byTitle = (room, t) => room.players.find(p => p.title === t);
const byPid = (room, pid) => room.players.find(p => p.pid === pid);

function beginExchange(room) {
  const jobs = [];
  for (const [hi, lo, count] of [['Presidente', 'Olho do Cu', 2], ['Vice-Presidente', 'Vice-Olho do Cu', 1]]) {
    const high = byTitle(room, hi), low = byTitle(room, lo);
    if (!high || !low) continue;
    const receive = sortHand(low.hand).splice(-count);
    jobs.push({ high: high.pid, low: low.pid, count, receive, give: null });
  }
  room.exchange = { jobs };
  room.status = 'exchange';
  room.log = 'Troca de cartas: o Presidente e o Vice-Presidente escolhem o que dar.';
  if (!EXCHANGE_FREE_CHOICE) jobs.forEach(j => giveCards(room, j, byPid(room, j.high).hand.slice(0, j.count)));
  checkExchangeDone(room);
}

function giveCards(room, job, cards) {
  const high = byPid(room, job.high);
  high.hand = high.hand.filter(c => !cards.includes(c));
  job.give = cards;
}

function checkExchangeDone(room) {
  if (room.exchange.jobs.some(j => !j.give)) return;
  for (const j of room.exchange.jobs) { 
    byPid(room, j.high).hand.push(...j.receive);
    byPid(room, j.low).hand.push(...j.give);
  }
  room.players.forEach(p => sortHand(p.hand));
  room.exchange = null;
  room.status = 'playing';
  room.firstPlay = true; 
  room.turn = Math.max(0, room.players.findIndex(p => p.pid === room.loserPid));
  room.log = `Troca concluída. ${room.players[room.turn].name} (Olho do Cu) começa (apenas 1 carta).`;
}

function exchange(room, pid, ids) {
  if (room.status !== 'exchange') return 'Não estás na fase de troca';
  const job = room.exchange.jobs.find(j => j.high === pid);
  if (!job) return 'Não tens cartas para dar nesta troca';
  if (job.give) return 'Já escolheste as tuas cartas';
  if (!Array.isArray(ids) || ids.length !== job.count || new Set(ids).size !== ids.length)
    return `Escolhe exatamente ${job.count} carta(s)`;
  const p = byPid(room, pid);
  const cards = ids.map(id => p.hand.find(c => c.id === id));
  if (cards.some(c => !c)) return 'Cartas inválidas';
  giveCards(room, job, cards);
  room.log = `${p.name} escolheu as cartas a dar.`;
  checkExchangeDone(room);
  return null;
}

function exchangeView(room, pid) {
  const j = room.exchange.jobs.find(x => x.high === pid || x.low === pid);
  if (!j) return { role: 'wait' };
  if (j.high === pid) return { role: 'give', count: j.count, partner: byPid(room, j.low).name, cards: j.receive, done: !!j.give };
  return { role: 'take', count: j.count, partner: byPid(room, j.high).name, cards: j.receive };
}

function finishRound(room) {
  const rest = room.players.find(p => p.hand.length > 0);
  if (rest) room.ranking.push(rest.pid);
  const t = titles(room.players.length);
  room.ranking.forEach((pid, i) => { room.players.find(p => p.pid === pid).title = t[i]; });
  room.loserPid = room.ranking[room.ranking.length - 1];
  room.status = 'finished';
  room.table = null;
  room.log = `Ronda terminada! ${room.players.find(p => p.pid === room.ranking[0]).name} é o Presidente.`;
}

function play(room, pid, ids) {
  if (room.status !== 'playing') return 'O jogo não está a decorrer';
  const i = room.players.findIndex(p => p.pid === pid);
  if (i !== room.turn) return 'Não é a tua vez';
  const p = room.players[i];
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) return 'Seleção inválida';
  const cards = ids.map(id => p.hand.find(c => c.id === id));
  if (cards.some(c => !c)) return 'Cartas inválidas';
  const r = cards[0].r;
  if (cards.some(c => c.r !== r)) return 'Só podes jogar cartas do mesmo valor';
  const t = room.table;
  
  if (!t && room.firstPlay && cards.length > 1) {
    return 'A primeira jogada da ronda tem de ser apenas 1 carta';
  }
  
  if (!t && room.mustOpen && !cards.some(c => c.r === 0 && c.s === '♠'))
    return 'Na primeira jogada tens de incluir o 3 de Espadas';
  
  // SE A VEZ VOLTOU AO JOGADOR QUE ORIGINOU O BLOQUEIO, O BLOQUEIO É LIBERTADO AUTOMATICAMENTE!
  if (room.matchLock != null && room.matchLockFrom === i) {
    room.matchLock = null;
    room.matchLockFrom = null;
  }

  const isJokerPlay = r === JOKER;

  if (t) {
    if (!isJokerPlay) {
      if (cards.length !== t.cards.length) return `Tens de jogar ${t.cards.length} carta(s)`;
      if (room.matchLock != null) { 
        if (r !== room.matchLock) 
          return `Bloqueio de empate: só podes jogar ${RANKS[room.matchLock]} ou passar`;
      } else if (room.lock) { 
        if (r > SEVEN) return 'Regra do 7: só podes jogar 7 ou inferior'; 
      } else if (r < t.rank) return 'Tens de jogar uma carta igual ou superior';
    }
  }
  
  // Verifica se a carta é igual, mas o BLOQUEIO só ativa se não houver passes pelo meio (passes === 0)
  const isSameRank = !!t && r === t.rank;
  const causesLock = isSameRank && room.passes === 0;

  p.hand = p.hand.filter(c => !ids.includes(c.id));
  
  // A carta acumula na mesma para os 4 iguais, mesmo que não cause bloqueio
  const acc = (isSameRank ? t.accumulatedCount : 0) + cards.length; 
  
  room.mustOpen = false;
  room.firstPlay = false; 
  room.table = { cards, rank: r, by: p.name, accumulatedCount: acc };
  room.lastIdx = i; 
  
  // Se for um empate direto (sem passes), ativamos o matchLock
  if (causesLock) {
      if (room.matchLock == null) {
          // Se ainda não havia bloqueio, quem jogou a carta anterior é a origem
          room.matchLockFrom = room.lastIdx; 
      }
      room.matchLock = r;
  }
  
  // Só depois de verificarmos o bloqueio é que reiniciamos os passes a zero
  room.passes = 0; 
  
  room.lock = r === SEVEN;
  
  room.log = `${p.name} jogou ${cards.length}× ${RANKS[r]}.`;
  if (p.hand.length === 0) { p.finished = true; room.ranking.push(pid); }
  if (room.players.filter(x => x.hand.length > 0).length <= 1) { finishRound(room); return null; }
  
  const cutByJoker = !!t && isJokerPlay;
  
  if (cutByJoker || (!!t && acc >= 4)) { 
    room.table = null; room.lock = false; room.matchLock = null; room.matchLockFrom = null;
    room.turn = p.hand.length ? i : nextActive(room, i);
    room.log += cutByJoker ? ' Joker! Mesa limpa.' : ' Quatro iguais! Mesa limpa.';
  } else {
    room.turn = nextActive(room, i);
    if (causesLock) {
      room.log += ` Bloqueio de empate! ${room.players[room.turn].name} tem de jogar ${cards.length}× ${RANKS[r]} ou passar (${acc} de 4 iguais).`;
    } else if (room.lock) {
      room.log += ` Regra do 7! ${room.players[room.turn].name} tem de jogar 7 ou inferior.`;
    }
  }
  return null;
}

function pass(room, pid) {
  if (room.status !== 'playing') return 'O jogo não está a decorrer';
  const i = room.players.findIndex(p => p.pid === pid);
  if (i !== room.turn) return 'Não é a tua vez';
  if (!room.table) return 'Tens de abrir a jogada';
  
  room.passes++;
  room.log = `${room.players[i].name} passou.`;
  
  const active = room.players.filter(p => p.hand.length > 0).length;
  const lastActive = room.players[room.lastIdx].hand.length > 0;
  
  if (room.passes >= active - (lastActive ? 1 : 0)) { 
    room.turn = lastActive ? room.lastIdx : nextActive(room, room.lastIdx);
    room.table = null; room.matchLock = null; room.matchLockFrom = null; room.passes = 0; room.lock = false;
    room.log += ` Mesa limpa — ${room.players[room.turn].name} abre.`;
  } else {
    room.turn = nextActive(room, i);
    
    // NOVA REGRA: Se alguém passa durante um bloqueio de empate, o bloqueio quebra!
    if (room.matchLock != null) {
      room.matchLock = null;
      room.matchLockFrom = null;
      if (room.lock) {
        room.log += ` Bloqueio quebrado! Mas a Regra do 7 mantém-se: ${room.players[room.turn].name} tem de jogar 7 ou inferior.`;
      } else {
        room.log += ` Bloqueio quebrado! ${room.players[room.turn].name} pode jogar livremente.`;
      }
    } else if (room.lock) {
      room.log += ` Regra do 7 mantém-se: ${room.players[room.turn].name} tem de jogar 7 ou inferior.`;
    }
  }
  return null;
}

function viewFor(room, pid) {
  const me = room.players.find(p => p.pid === pid);
  return {
    code: room.code, status: room.status, round: room.round, log: room.log,
    isHost: room.hostPid === pid, lock: room.lock, matchLock: room.matchLock ?? null, decks: decksFor(room.players.length),
    players: room.players.map((p, i) => ({
      pid: p.pid, // <--- O DETALHE QUE FALTAVA PARA O KICK FUNCIONAR!
      name: p.name, count: p.hand.length, title: p.title || null,
      connected: p.connected, isTurn: room.status === 'playing' && i === room.turn, me: p.pid === pid,
      pending: room.status === 'exchange' && room.exchange.jobs.some(j => j.high === p.pid && !j.give),
    })),
    exchange: room.status === 'exchange' ? exchangeView(room, pid) : null,
    table: room.table && { cards: room.table.cards, by: room.table.by },
    hand: me ? me.hand : [],
  };
}

module.exports = { exchange, EXCHANGE_FREE_CHOICE, RANKS, MIN_PLAYERS, MAX_PLAYERS, startRound, play, pass, viewFor, decksFor, buildDeck };