const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===================== DICIONÁRIO PT-BR =====================
const fs = require('fs');

// Normaliza para comparação (lower + remove acentos) — também remove hífens/pontos extras
function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

let RAW_WORDS = [];
let DICTIONARY_SET;
let DICTIONARY_ORIGINAL;

// tenta carregar palavras.txt (320k palavras do pythonprobr/palavras — LibreOffice pt_BR)
try {
  const dictPath = path.join(__dirname, 'palavras.txt');
  if (fs.existsSync(dictPath)) {
    const content = fs.readFileSync(dictPath, 'utf8');
    // palavras.txt tem 1 palavra por linha, já em UTF-8
    const lines = content.split(/\r?\n/).map(w => w.trim()).filter(w => w.length >= 2);
    // normaliza e dedup
    const seen = new Set();
    const cleaned = [];
    for (const w of lines) {
      const n = normalize(w);
      if (n.length < 2) continue;
      if (n.includes('/') || n.includes('.') ) continue;
      if (!seen.has(n)) { seen.add(n); cleaned.push(n); }
    }
    // fallback mínimo se arquivo vazio
    if (cleaned.length > 10000) {
      RAW_WORDS = cleaned;
      console.log(`📖 Dicionário carregado: ${cleaned.length} palavras de palavras.txt`);
    } else throw new Error('dicionário pequeno');
  } else throw new Error('palavras.txt não encontrado');
} catch (e) {
  console.log('⚠️ Falha ao carregar palavras.txt, usando fallback curado:', e.message);
  RAW_WORDS = `
casa caderno macaco cachorro musica rato problema coração amor bola boca bolo faca facas
bebe bico barco beijo bicho bolo bule buraco cabide cafe caju cama caneta facada faculdade
dado dedo dia doce ducha fada faca fita fogo fuma lado leite limao lobo lua facas fada
mala medo milho morro mula pato pele pino povo pulo rato rede rio roca rua fala falta
sapo seco sino soco sul tatu teto tio toca tubo vaca verde vida viu farinha farol fase
`.trim().split(/\s+/).map(w=>normalize(w));
}

DICTIONARY_SET = new Set(RAW_WORDS);
DICTIONARY_ORIGINAL = new Map(RAW_WORDS.map(w => [w, w]));
// garante que palavras críticas existam mesmo se palavras.txt falhar parcialmente
for (const extra of ['faca','facas','faca','facada','faculdade','falar','falha','fama','familia','farinha','farol','fase','fato','fazer','faca']) {
  const n = normalize(extra);
  if (!DICTIONARY_SET.has(n)) { DICTIONARY_SET.add(n); RAW_WORDS.push(n); }
}

// ===================== SÍLABAS POR DIFICULDADE =====================
// FÁCIL: sílabas abertas CV mais produtivas (muitas palavras, fáceis de lembrar)
// MÉDIO: todas as CV simples + dígrafos comuns (CHA/LHA/NHA)
// DIFÍCIL: encontros consonantais (BRA/CLA/PRA/TRA...) + sílabas raras (ZA/VU...)
// INSANO: mistura total, todas as 130 sílabas
const SILABAS_FACIL = [
  "CA","CO","MA","MO","PA","PO","TA","TO","LA","LO","SA","SO","RA","RO",
  "BA","BO","DA","DO","FA","FO","GA","GO","JA","JO","NA","NO","VA","VO",
  "ME","PE","TE","LE","RE","SE","BE","DE","FE","CE","CA","MA"
].filter((v,i,a)=>a.indexOf(v)===i); // únicas (~32)

const SILABAS_MEDIA = [
  "BA","BE","BI","BO","BU","CA","CE","CI","CO","CU","DA","DE","DI","DO","DU",
  "FA","FE","FI","FO","FU","GA","GE","GI","GO","GU","JA","JE","JI","JO","JU",
  "LA","LE","LI","LO","LU","MA","ME","MI","MO","MU","PA","PE","PI","PO","PU",
  "RA","RE","RI","RO","RU","SA","SE","SI","SO","SU","TA","TE","TI","TO","TU",
  "VA","VE","VI","VO","VU","CHA","CHE","CHI","CHO","CHU","LHA","LHE","LHO","NHA","NHE","NHO"
];

const SILABAS_DIFICIL = [
  "ZA","ZE","ZI","ZO","ZU","XA","XE","XI","XO","XU","VU","VAI","ZAO",
  "BRA","BRE","BRI","BRO","BRU","CLA","CLE","CLI","CLO","CLU","CRA","CRE","CRI","CRO","CRU",
  "DRA","DRE","DRI","DRO","DRU","FRA","FRE","FRI","FRO","FRU","GRA","GRE","GRI","GRO","GRU",
  "PRA","PRE","PRI","PRO","PRU","TRA","TRE","TRI","TRO","TRU","BLA","BLE","BLI","BLO","BLU",
  "PLA","PLE","PLI","PLO","PLU","FLA","FLE","FLI","FLO","FLU","GLA","GLE","GLI","GLO","GLU",
  "LHI","LHU","NHI","NHU"
];

const SILABAS = [...new Set([...SILABAS_MEDIA, ...SILABAS_DIFICIL, "BI","BU","DI","DU","SI","SU","TI","TU","VU","ZA","ZE","ZI","ZO","ZU"])];

const SILABAS_BY_DIFFICULTY = {
  facil: SILABAS_FACIL,
  medio: SILABAS_MEDIA,
  dificil: SILABAS_DIFICIL,
  insano: SILABAS
};

const DIFFICULTY_LABEL = {
  facil: "🟢 Fácil",
  medio: "🟡 Médio",
  dificil: "🔴 Difícil",
  insano: "💀 Insano"
};

function sortearSilaba(roomOrDifficulty) {
  let pool;
  if (typeof roomOrDifficulty === 'string') pool = SILABAS_BY_DIFFICULTY[roomOrDifficulty] || SILABAS_MEDIA;
  else if (roomOrDifficulty && roomOrDifficulty.difficulty) pool = SILABAS_BY_DIFFICULTY[roomOrDifficulty.difficulty] || SILABAS_MEDIA;
  else pool = SILABAS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function hashPassword(pwd) {
  if (!pwd) return null;
  return crypto.createHash('sha256').update(pwd).digest('hex');
}

function gerarCodigo() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}

function destacarSilaba(palavra, silaba) {
  const normalizedPalavra = normalize(palavra);
  const normalizedSilaba = normalize(silaba);
  let result = "";
  let i=0;
  let lower = palavra;
  // precisa destacar todas ocorrências case-insensitive
  const regex = new RegExp(`(${silaba})`, 'gi');
  // usar split com regex mas preservando acentos
  // abordagem: percorrer com indexOf no normalized
  let idx = 0;
  let out = [];
  let last = 0;
  let nPal = normalizedPalavra;
  let nSil = normalizedSilaba;
  let pos = nPal.indexOf(nSil);
  while (pos !== -1) {
    out.push(palavra.slice(last, pos));
    out.push(`<span class="hl">${palavra.slice(pos, pos + silaba.length)}</span>`);
    last = pos + silaba.length;
    pos = nPal.indexOf(nSil, last);
  }
  out.push(palavra.slice(last));
  return out.join('');
}

// ===================== ESTADO SALAS =====================
const rooms = new Map(); // code -> room

function getPublicRoom(room) {
  return {
    code: room.code,
    game: room.game||'bomba',
    name: room.name,
    timerDuration: room.timerDuration,
    maxPlayers: room.maxPlayers,
    lives: room.lives || 2,
    hasPassword: !!room.passwordHash,
    status: room.status,
    difficulty: room.difficulty || 'medio',
    difficultyLabel: DIFFICULTY_LABEL[room.difficulty || 'medio'],
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      lives: p.lives,
      alive: p.alive,
      isAdmin: p.isAdmin,
      score: p.score || 0
    })),
    currentSilaba: room.currentSilaba,
    currentTurnId: room.currentTurnId,
    timeLeft: room.bombExpiresAt ? Math.max(0, room.bombExpiresAt - Date.now()) : null
  };
}

function getAlivePlayers(room) {
  return room.players.filter(p => p.alive);
}

function nextAliveIndex(room, fromIdx) {
  const n = room.players.length;
  for (let i=1;i<=n;i++) {
    const idx = (fromIdx + i) % n;
    if (room.players[idx].alive) return idx;
  }
  return -1;
}

function broadcastRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit('roomUpdate', getPublicRoom(room));
}

function startTimer(room) {
  if (room.timer) clearInterval(room.timer);
  room.bombExpiresAt = Date.now() + room.timerDuration * 1000;
  // broadcast tick 10x por segundo
  room.timer = setInterval(() => {
    const left = room.bombExpiresAt - Date.now();
    io.to(room.code).emit('tick', { timeLeft: Math.max(0, left), currentTurnId: room.currentTurnId, silaba: room.currentSilaba });
    if (left <= 0) {
      clearInterval(room.timer);
      handleExplosion(room);
    }
  }, 80);
}

function handleExplosion(room) {
  const player = room.players.find(p => p.id === room.currentTurnId);
  if (!player || !player.alive) return;
  player.lives -= 1;
  player.score = Math.max(0, (player.score||0) - 1);
  const eliminated = player.lives <= 0;
  if (eliminated) {
    player.alive = false;
    player.lives = 0;
  }
  io.to(room.code).emit('explosion', {
    playerId: player.id,
    playerName: player.name,
    lives: player.lives,
    eliminated,
    aliveCount: getAlivePlayers(room).length
  });

  // verifica vitória
  const alive = getAlivePlayers(room);
  if (alive.length === 1) {
    room.status = 'finished';
    clearInterval(room.timer);
    io.to(room.code).emit('victory', {
      winnerId: alive[0].id,
      winnerName: alive[0].name,
      ranking: [...room.players].sort((a,b) => (b.lives - a.lives) || (b.score - a.score)).map(p => ({ name: p.name, lives: p.lives, score: p.score||0, alive: p.alive }))
    });
    broadcastRoom(room.code);
    return;
  }
  if (alive.length === 0) {
    room.status = 'finished';
    clearInterval(room.timer);
    io.to(room.code).emit('victory', { winnerId: null, winnerName: null, ranking: [] });
    return;
  }

  // passa bomba para próximo vivo
  let curIdx = room.players.findIndex(p => p.id === room.currentTurnId);
  // se eliminado, próximo é nextAliveIndex(curIdx). Se não, também próximo
  let nextIdx = nextAliveIndex(room, curIdx);
  if (nextIdx === -1) nextIdx = room.players.findIndex(p => p.alive);
  room.currentTurnId = room.players[nextIdx].id;
  room.currentSilaba = sortearSilaba(room);
  broadcastRoom(room.code);
  // pequeno delay antes de reiniciar timer para animação
  setTimeout(() => {
    if (room.status !== 'playing') return;
    io.to(room.code).emit('newTurn', {
      silaba: room.currentSilaba,
      currentTurnId: room.currentTurnId,
      time: room.timerDuration
    });
    startTimer(room);
  }, 1800);
}

function validateWord(word, silaba, usedWords) {
  const normWord = normalize(word.trim());
  if (!normWord) return { valid: false, reason: 'Digite uma palavra.' };
  if (normWord.length < 2) return { valid: false, reason: 'Palavra muito curta.' };
  if (!DICTIONARY_SET.has(normWord)) return { valid: false, reason: 'A palavra não está no dicionário.' };
  if (!normWord.includes(normalize(silaba))) return { valid: false, reason: `A palavra não contém a sílaba ${silaba}.` };
  if (usedWords && usedWords.has(normWord)) return { valid: false, reason: `Palavra já usada nesta partida!` };
  return { valid: true };
}

// ===================== SOCKET.IO =====================
io.on('connection', (socket) => {
  console.log('conectou', socket.id);

  socket.on('createRoom', ({ playerName, roomName, password, timerDuration, maxPlayers, difficulty, lives }, cb) => {
    if (!playerName || !roomName) return cb({ error: 'Nome e sala obrigatórios' });
    let code;
    do { code = gerarCodigo(); } while (rooms.has(code));
    const diff = ['facil','medio','dificil','insano'].includes(difficulty) ? difficulty : 'medio';
    const parsedLives = Math.min(5, Math.max(1, Number(lives) || 2));
    const parsedTimer = Math.min(30, Math.max(3, Number(timerDuration) || 5));
    const room = {
      code,
      game:'bomba',
      name: roomName,
      passwordHash: hashPassword(password),
      timerDuration: parsedTimer,
      maxPlayers: Math.min(12, Math.max(2, Number(maxPlayers)||8)),
      difficulty: diff,
      lives: parsedLives,
      status: 'lobby',
      players: [],
      usedWords: new Set(),
      currentSilaba: null,
      currentTurnId: null,
      bombExpiresAt: null,
      timer: null
    };
    const player = {
      id: socket.id,
      socketId: socket.id,
      name: playerName.slice(0,16),
      lives: room.lives,
      alive: true,
      isAdmin: true,
      score: 0
    };
    room.players.push(player);
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    cb({ success: true, code, room: getPublicRoom(room) });
    broadcastRoom(code);
  });

  socket.on('joinRoom', ({ playerName, code, password }, cb) => {
    code = (code||'').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ error: 'Sala não encontrada.' });
    if (room.game==='velha') return cb({ error: 'Sala é de Velha. Acesse /velha' });
    if (room.passwordHash && room.passwordHash !== hashPassword(password)) return cb({ error: 'Senha incorreta.' });
    if (room.players.length >= room.maxPlayers) return cb({ error: 'Sala lotada.' });
    if (room.status === 'playing') return cb({ error: 'Partida já em andamento.' });
    if (room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) return cb({ error: 'Nome já em uso na sala.' });
    const player = {
      id: socket.id,
      socketId: socket.id,
      name: playerName.slice(0,16),
      lives: room.lives,
      alive: true,
      isAdmin: false,
      score: 0
    };
    room.players.push(player);
    socket.join(code);
    socket.data.roomCode = code;
    cb({ success: true, room: getPublicRoom(room) });
    io.to(code).emit('playerJoined', { name: player.name });
    broadcastRoom(code);
  });

  socket.on('startGame', (cb) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: 'Sala não encontrada' });
    const me = room.players.find(p => p.id === socket.id);
    if (!me || !me.isAdmin) return cb && cb({ error: 'Apenas administrador pode iniciar.' });
    if (room.players.length < 2) return cb && cb({ error: 'Mínimo 2 jogadores.' });
    if (room.status === 'playing') return cb && cb({ error: 'Já em jogo' });
    room.status = 'countdown';
    room.usedWords = new Set();
    room.players.forEach(p => { p.lives = room.lives; p.alive = true; p.score = 0; });
    // embaralha ordem
    for (let i = room.players.length -1; i>0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
    }
    broadcastRoom(code);
    io.to(code).emit('countdown', { from: 3 });
    let c = 3;
    const iv = setInterval(() => {
      c--;
      if (c>0) io.to(code).emit('countdown', { from: c });
      else if (c===0) {
        io.to(code).emit('countdown', { from: 0, go: true });
        clearInterval(iv);
        // inicia de fato
        room.status = 'playing';
        room.currentSilaba = sortearSilaba(room);
        room.currentTurnId = room.players[0].id;
        broadcastRoom(code);
        io.to(code).emit('gameStarted', { silaba: room.currentSilaba, currentTurnId: room.currentTurnId, timerDuration: room.timerDuration });
        startTimer(room);
      }
    }, 900);
    cb && cb({ success: true });
  });

  socket.on('typing', ({ text }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.status !== 'playing') return;
    if (socket.id !== room.currentTurnId) return;
    const player = room.players.find(p=>p.id===socket.id);
    if (!player || !player.alive) return;
    const safe = String(text||'').slice(0,32).replace(/</g,'&lt;');
    // broadcast para todos exceto quem digita
    socket.to(code).emit('playerTyping', { playerId: socket.id, playerName: player.name, text: safe });
  });

  socket.on('submitWord', ({ word }, cb) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.status !== 'playing') return cb && cb({ error: 'Fora de partida' });
    if (socket.id !== room.currentTurnId) return cb && cb({ error: 'Não é sua vez!' });
    const silaba = room.currentSilaba;
    if (!room.usedWords) room.usedWords = new Set();
    const res = validateWord(word, silaba, room.usedWords);
    if (!res.valid) {
      // anti-spam: debounce simples
      socket.emit('wordInvalid', { reason: res.reason, word });
      return cb && cb({ valid:false, reason: res.reason });
    }
    // válida! registra como usada
    const normWord = normalize(word.trim());
    room.usedWords.add(normWord);
    const player = room.players.find(p => p.id === socket.id);
    player.score = (player.score||0)+1;
    const highlighted = destacarSilaba(word, silaba);
    clearInterval(room.timer);
    io.to(code).emit('wordValid', {
      playerId: player.id,
      playerName: player.name,
      word,
      silaba,
      highlighted,
      score: player.score
    });
    // próximo turno
    const curIdx = room.players.findIndex(p => p.id === socket.id);
    const nextIdx = nextAliveIndex(room, curIdx);
    room.currentTurnId = room.players[nextIdx].id;
    room.currentSilaba = sortearSilaba(room);
    broadcastRoom(code);
    io.to(code).emit('newTurn', { silaba: room.currentSilaba, currentTurnId: room.currentTurnId, time: room.timerDuration });
    startTimer(room);
    cb && cb({ valid:true, highlighted });
  });

  socket.on('kickPlayer', ({ targetId }, cb) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    const me = room.players.find(p=>p.id===socket.id);
    if (!me || !me.isAdmin) return cb && cb({error:'Sem permissão'});
    const idx = room.players.findIndex(p=>p.id===targetId);
    if (idx===-1) return;
    if (room.players[idx].isAdmin) return;
    const kicked = room.players[idx];
    room.players.splice(idx,1);
    io.to(kicked.socketId).emit('kicked');
    const s = io.sockets.sockets.get(kicked.socketId);
    if (s) { s.leave(code); s.data.roomCode=null; }
    broadcastRoom(code);
    io.to(code).emit('playerLeft', { name: kicked.name });
    cb && cb({success:true});
  });

  socket.on('leaveRoom', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));

  function leaveRoom(sock) {
    const code = sock.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const idx = room.players.findIndex(p=>p.id===sock.id);
    if (idx!==-1) {
      const wasAdmin = room.players[idx].isAdmin;
      const wasTurn = room.currentTurnId === sock.id;
      const name = room.players[idx].name;
      room.players.splice(idx,1);
      sock.leave(code);
      sock.data.roomCode=null;
      if (room.players.length===0) {
        clearInterval(room.timer);
        if(room.futInterval) clearInterval(room.futInterval);
        rooms.delete(code);
        return;
      }
      if (wasAdmin && room.players.length>0) {
        room.players[0].isAdmin = true;
      }
      if (room.status==='playing' && wasTurn) {
        clearInterval(room.timer);
        // se só 1 vivo -> vitória
        const alive = getAlivePlayers(room);
        if (alive.length===1) {
          room.status='finished';
          io.to(code).emit('victory', { winnerId: alive[0].id, winnerName: alive[0].name, ranking: [...room.players].sort((a,b)=>b.lives-a.lives).map(p=>({name:p.name,lives:p.lives,score:p.score||0,alive:p.alive})) });
        } else if (alive.length>1) {
          // passa para próximo vivo
          let nextIdx = room.players.findIndex(p=>p.alive);
          if (nextIdx!==-1) {
            room.currentTurnId = room.players[nextIdx].id;
            room.currentSilaba = sortearSilaba(room);
            io.to(code).emit('newTurn', { silaba: room.currentSilaba, currentTurnId: room.currentTurnId, time: room.timerDuration });
            startTimer(room);
          }
        }
      }
      broadcastRoom(code);
      io.to(code).emit('playerLeft', { name });
    }
  }

  socket.on('changeDifficulty', ({ difficulty }, cb) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: 'Sala não encontrada' });
    const me = room.players.find(p=>p.id===socket.id);
    if (!me || !me.isAdmin) return cb && cb({ error: 'Só admin muda dificuldade' });
    if (room.status !== 'lobby') return cb && cb({ error: 'Só antes da partida' });
    if (!['facil','medio','dificil','insano'].includes(difficulty)) return cb && cb({ error: 'Dificuldade inválida' });
    room.difficulty = difficulty;
    broadcastRoom(code);
    io.to(code).emit('difficultyChanged', { difficulty, label: DIFFICULTY_LABEL[difficulty] });
    cb && cb({ success:true });
  });

  socket.on('updateSettings', ({ timerDuration, difficulty, lives, maxPlayers }, cb) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: 'Sala não encontrada' });
    const me = room.players.find(p=>p.id===socket.id);
    if (!me || !me.isAdmin) return cb && cb({ error: 'Só admin altera configurações' });
    if (room.status !== 'lobby') return cb && cb({ error: 'Só antes da partida' });
    let changed = false;
    if (timerDuration !== undefined) {
      const t = Number(timerDuration);
      if ([3,5,7,10,15].includes(t) || (t>=3 && t<=30)) { room.timerDuration = Math.min(30, Math.max(3, t)); changed=true; }
    }
    if (difficulty && ['facil','medio','dificil','insano'].includes(difficulty)) { room.difficulty = difficulty; changed=true; }
    if (lives !== undefined) {
      const l = Math.min(5, Math.max(1, Number(lives)));
      if (!isNaN(l)) { room.lives = l; room.players.forEach(p=> p.lives = l); changed=true; }
    }
    if (maxPlayers !== undefined) {
      const m = Math.min(12, Math.max(2, Number(maxPlayers)));
      if (!isNaN(m)) { room.maxPlayers = m; changed=true; }
    }
    if (changed) {
      broadcastRoom(code);
      io.to(code).emit('settingsUpdated', getPublicRoom(room));
    }
    cb && cb({ success:true, room: getPublicRoom(room) });
  });

  // ====== JOGO DA VELHA MULTIPLAYER ======
  function getVelhaPublic(room){
    return {
      code: room.code, game:'velha', status: room.status,
      players: room.players.map(p=>({id:p.id,name:p.name,mark:p.mark,isAdmin:p.isAdmin})),
      board: room.board, turn: room.turn, currentTurnId: room.currentTurnId, winner: room.winner, draw: room.draw, winLine: room.winLine
    };
  }
  function checkVelhaWin(board){
    const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for(const [a,b,c] of wins){ if(board[a] && board[a]===board[b] && board[a]===board[c]) return {winner:board[a], line:[a,b,c]}; }
    if(board.every(v=>v)) return {draw:true};
    return null;
  }
  socket.on('createVelhaRoom', ({playerName}, cb)=>{
    if(!playerName) return cb({error:'Nome obrigatório'});
    let code; do{code=gerarCodigo();}while(rooms.has(code));
    const room={code, name:'Velha', game:'velha', status:'lobby', players:[], board:Array(9).fill(null), turn:'X', currentTurnId:null, winner:null, draw:false, winLine:null};
    const p={id:socket.id, socketId:socket.id, name:playerName.slice(0,12), mark:'X', isAdmin:true};
    room.players.push(p); rooms.set(code,room); socket.join(code); socket.data.roomCode=code;
    cb({success:true, room:getVelhaPublic(room)});
    io.to(code).emit('velhaRoomUpdate', getVelhaPublic(room));
  });
  socket.on('joinVelhaRoom', ({playerName, code}, cb)=>{
    code=(code||'').toUpperCase().trim();
    const room=rooms.get(code);
    if(!room) return cb({error:'Sala não encontrada'});
    if(room.game!=='velha') return cb({error:'Sala é de Bomba, não Velha'});
    if(room.players.length>=2) return cb({error:'Sala lotada (máx 2)'});
    if(room.status==='playing') return cb({error:'Partida em andamento'});
    const p={id:socket.id, socketId:socket.id, name:playerName.slice(0,12), mark:'O', isAdmin:false};
    room.players.push(p); socket.join(code); socket.data.roomCode=code;
    cb({success:true, room:getVelhaPublic(room)});
    io.to(code).emit('velhaRoomUpdate', getVelhaPublic(room));
  });
  socket.on('velhaStart', (cb)=>{
    const code=socket.data.roomCode; const room=rooms.get(code);
    if(!room||room.game!=='velha') return cb&&cb({error:'Sala velha não encontrada'});
    const me=room.players.find(p=>p.id===socket.id);
    if(!me||!me.isAdmin) return cb&&cb({error:'Só admin inicia'});
    if(room.players.length<2) return cb&&cb({error:'Precisa 2 jogadores'});
    room.board=Array(9).fill(null); room.turn='X'; room.winner=null; room.draw=false; room.winLine=null;
    room.status='playing'; room.currentTurnId=room.players.find(p=>p.mark==='X').id || room.players[0].id;
    io.to(code).emit('velhaStarted',{board:room.board, turn:room.turn, currentTurnId:room.currentTurnId, players:room.players});
    io.to(code).emit('velhaRoomUpdate', getVelhaPublic(room));
    if(cb) cb({success:true});
  });
  socket.on('velhaMove', ({pos})=>{
    const code=socket.data.roomCode; const room=rooms.get(code);
    if(!room||room.game!=='velha'||room.status!=='playing') return socket.emit('velhaError','Fora de partida');
    if(socket.id!==room.currentTurnId) return socket.emit('velhaError','Não é sua vez');
    if(pos<0||pos>8||room.board[pos]) return socket.emit('velhaError','Posição ocupada');
    const me=room.players.find(p=>p.id===socket.id);
    room.board[pos]=me.mark;
    const res=checkVelhaWin(room.board);
    if(res?.winner){ room.winner=res.winner; room.winLine=res.line; room.status='finished'; room.winnerName=me.name; }
    else if(res?.draw){ room.draw=true; room.status='finished'; }
    else {
      room.turn = room.turn==='X'?'O':'X';
      room.currentTurnId = room.players.find(p=>p.mark===room.turn)?.id || room.players[0].id;
    }
    const payload={board:room.board, turn:room.turn, currentTurnId:room.currentTurnId, gameOver:!!(room.winner||room.draw), winner:room.winner, winnerName:room.winnerName, draw:room.draw, winLine:room.winLine, turnName: room.players.find(p=>p.mark===room.turn)?.name};
    io.to(code).emit('velhaUpdate', payload);
    io.to(code).emit('velhaRoomUpdate', getVelhaPublic(room));
  });
  socket.on('velhaRestart', ()=>{
    const code=socket.data.roomCode; const room=rooms.get(code);
    if(!room||room.game!=='velha') return;
    const me=room.players.find(p=>p.id===socket.id);
    if(!me||!me.isAdmin) return;
    room.board=Array(9).fill(null); room.turn='X'; room.winner=null; room.draw=false; room.winLine=null; room.status='playing';
    room.currentTurnId=room.players.find(p=>p.mark==='X').id;
    io.to(code).emit('velhaStarted',{board:room.board, turn:room.turn, currentTurnId:room.currentTurnId, players:room.players});
    io.to(code).emit('velhaRoomUpdate', getVelhaPublic(room));
  });

  // ====== FUTEBOL DE BOTÃO (HaxBall-like) ======
  const FUT_W=900, FUT_H=500, FUT_PR=22, FUT_BR=13, FUT_GOAL_H=100;
  function getFutebolPublic(room){
    return {code:room.code, game:'futebol', status:room.status, players:room.players.map(p=>({id:p.id,name:p.name,team:p.team,teamPref:p.teamPref,isAdmin:p.isAdmin})), score:room.score, ball:room.ball};
  }
  function createFutebolState(){
    return {
      ball:{x:FUT_W/2,y:FUT_H/2,vx:0,vy:0},
      players: [],
      score:{red:0,blue:0}
    };
  }
  function futebolPhysics(room){
    // players
    room.players.forEach(p=>{
      const inp=p.input||{};
      const acc=0.7;
      if(inp.up) p.vy-=acc;
      if(inp.down) p.vy+=acc;
      if(inp.left) p.vx-=acc;
      if(inp.right) p.vx+=acc;
      p.vx*=0.94; p.vy*=0.94;
      const sp=Math.hypot(p.vx,p.vy);
      if(sp>7){ p.vx*=7/sp; p.vy*=7/sp; }
      p.x+=p.vx; p.y+=p.vy;
      const goalH=FUT_GOAL_H, gy0=FUT_H/2-goalH/2, gy1=FUT_H/2+goalH/2;
      if(p.x-FUT_PR<0){ if(p.y>gy0&&p.y<gy1){} else {p.x=FUT_PR; p.vx*=-0.6;} }
      if(p.x+FUT_PR>FUT_W){ if(p.y>gy0&&p.y<gy1){} else {p.x=FUT_W-FUT_PR; p.vx*=-0.6;} }
      if(p.y-FUT_PR<0){ p.y=FUT_PR; p.vy*=-0.6; }
      if(p.y+FUT_PR>FUT_H){ p.y=FUT_H-FUT_PR; p.vy*=-0.6; }
    });
    // player-player
    if(room.players.length>=2){
      for(let i=0;i<room.players.length;i++) for(let j=i+1;j<room.players.length;j++){
        const a=room.players[i], b=room.players[j];
        let dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy);
        if(d<FUT_PR*2 && d>0){
          const overlap=(FUT_PR*2 - d)/2, nx=dx/d, ny=dy/d;
          a.x-=nx*overlap; a.y-=ny*overlap; b.x+=nx*overlap; b.y+=ny*overlap;
          const tvx=a.vx, tvy=a.vy; a.vx=b.vx*0.8; a.vy=b.vy*0.8; b.vx=tvx*0.8; b.vy=tvy*0.8;
        }
      }
    }
    // ball
    const ball=room.ball;
    ball.vx*=0.995; ball.vy*=0.995;
    ball.x+=ball.vx; ball.y+=ball.vy;
    const gy0=FUT_H/2-FUT_GOAL_H/2, gy1=FUT_H/2+FUT_GOAL_H/2;
    if(ball.y-FUT_BR<0){ ball.y=FUT_BR; ball.vy*=-0.9; }
    if(ball.y+FUT_BR>FUT_H){ ball.y=FUT_H-FUT_BR; ball.vy*=-0.9; }
    if(ball.x-FUT_BR<0){
      if(ball.y>gy0&&ball.y<gy1){} else {ball.x=FUT_BR; ball.vx*=-0.9;}
    }
    if(ball.x+FUT_BR>FUT_W){
      if(ball.y>gy0&&ball.y<gy1){} else {ball.x=FUT_W-FUT_BR; ball.vx*=-0.9;}
    }
    // player-ball
    room.players.forEach(p=>{
      let dx=ball.x-p.x, dy=ball.y-p.y, d=Math.hypot(dx,dy);
      if(d<FUT_PR+FUT_BR && d>0){
        const nx=dx/d, ny=dy/d, overlap=FUT_PR+FUT_BR - d;
        ball.x+=nx*overlap*0.6; ball.y+=ny*overlap*0.6;
        const kick=p.input?.kick ? 6 : 2.5;
        ball.vx+=nx*kick + p.vx*0.4;
        ball.vy+=ny*kick + p.vy*0.4;
        const sp=Math.hypot(ball.vx,ball.vy);
        if(sp>10){ ball.vx*=10/sp; ball.vy*=10/sp; }
      }
    });
    // gol
    if(ball.x < -12 && ball.y>gy0 && ball.y<gy1){
      room.score.blue++; ball.x=FUT_W/2; ball.y=FUT_H/2; ball.vx=(Math.random()-0.5)*4; ball.vy=(Math.random()-0.5)*4;
      io.to(room.code).emit('futebolGoal',{team:'blue', score:room.score});
    } else if(ball.x > FUT_W+12 && ball.y>gy0 && ball.y<gy1){
      room.score.red++; ball.x=FUT_W/2; ball.y=FUT_H/2; ball.vx=(Math.random()-0.5)*4; ball.vy=(Math.random()-0.5)*4;
      io.to(room.code).emit('futebolGoal',{team:'red', score:room.score});
    }
  }
  function startFutebolLoop(room){
    if(room.futInterval) clearInterval(room.futInterval);
    room.futInterval=setInterval(()=>{
      if(room.status!=='playing') return;
      futebolPhysics(room);
      io.to(room.code).emit('futebolState', {ball:room.ball, players:room.players.map(p=>({id:p.id,x:p.x,y:p.y,team:p.team,name:p.name})), score:room.score});
    }, 16);
  }
  socket.on('createFutebolRoom', ({playerName}, cb)=>{
    if(!playerName) return cb({error:'Nome obrigatório'});
    let code; do{code=gerarCodigo();}while(rooms.has(code));
    const room={code, name:'Futebol', game:'futebol', status:'lobby', players:[], ball:{x:FUT_W/2,y:FUT_H/2,vx:0,vy:0}, score:{red:0,blue:0}, futInterval:null};
    const p={id:socket.id, socketId:socket.id, name:playerName.slice(0,12), team:'red', teamPref:'auto', isAdmin:true, x:180,y:FUT_H/2,vx:0,vy:0, input:{}};
    room.players.push(p); rooms.set(code,room); socket.join(code); socket.data.roomCode=code;
    cb({success:true, room:getFutebolPublic(room)});
    io.to(code).emit('futebolRoomUpdate', getFutebolPublic(room));
  });
  socket.on('joinFutebolRoom', ({playerName, code}, cb)=>{
    code=(code||'').toUpperCase().trim();
    const room=rooms.get(code);
    if(!room) return cb({error:'Sala não encontrada'});
    if(room.game!=='futebol') return cb({error:'Sala não é de Futebol'});
    if(room.players.length>=4) return cb({error:'Sala lotada (máx 4)'});
    if(room.status==='playing') return cb({error:'Partida em andamento'});
    // balanceia time
    const reds=room.players.filter(p=>p.team==='red').length;
    const blues=room.players.filter(p=>p.team==='blue').length;
    const team = reds<=blues ? 'red':'blue';
    const pos = team==='red' ? {x:180+Math.random()*40,y:FUT_H/2+(Math.random()-0.5)*60} : {x:FUT_W-180-Math.random()*40,y:FUT_H/2+(Math.random()-0.5)*60};
    const p={id:socket.id, socketId:socket.id, name:playerName.slice(0,12), team, teamPref:'auto', isAdmin:false, x:pos.x, y:pos.y, vx:0,vy:0, input:{}};
    room.players.push(p); socket.join(code); socket.data.roomCode=code;
    cb({success:true, room:getFutebolPublic(room)});
    io.to(code).emit('futebolRoomUpdate', getFutebolPublic(room));
  });
  socket.on('futebolChooseTeam', ({team})=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.game!=='futebol'||room.status!=='lobby') return;
    const me=room.players.find(p=>p.id===socket.id);
    if(!me) return;
    me.teamPref=team;
    if(team==='red'||team==='blue'){ me.team=team; me.x= team==='red'?180:FUT_W-180; me.y=FUT_H/2; }
    else {
      const reds=room.players.filter(p=>p.id!==me.id && p.team==='red').length;
      const blues=room.players.filter(p=>p.id!==me.id && p.team==='blue').length;
      me.team = reds<=blues?'red':'blue';
    }
    io.to(room.code).emit('futebolRoomUpdate', getFutebolPublic(room));
  });
  socket.on('futebolStart', (cb)=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.game!=='futebol') return cb&&cb({error:'Sala não encontrada'});
    const me=room.players.find(p=>p.id===socket.id);
    if(!me?.isAdmin) return cb&&cb({error:'Só admin inicia'});
    if(room.players.length<2) return cb&&cb({error:'Precisa 2+ jogadores'});
    room.status='playing'; room.ball={x:FUT_W/2,y:FUT_H/2,vx:(Math.random()-0.5)*3,vy:(Math.random()-0.5)*3}; room.score={red:0,blue:0};
    // reposiciona
    room.players.forEach((p,i)=>{
      if(p.team==='red'){ p.x=180+(i%2)*40; p.y=FUT_H/2+(i%2? -40:40); }
      else { p.x=FUT_W-180-(i%2)*40; p.y=FUT_H/2+(i%2? -40:40); }
      p.vx=0; p.vy=0;
    });
    io.to(room.code).emit('futebolStarted',{state:{ball:room.ball, players:room.players.map(p=>({id:p.id,x:p.x,y:p.y,team:p.team,name:p.name})), score:room.score}});
    io.to(room.code).emit('futebolRoomUpdate', getFutebolPublic(room));
    startFutebolLoop(room);
    if(cb) cb({success:true});
  });
  socket.on('futebolInput', (inp)=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.game!=='futebol'||room.status!=='playing') return;
    const me=room.players.find(p=>p.id===socket.id);
    if(!me) return;
    me.input={up:!!inp.up, down:!!inp.down, left:!!inp.left, right:!!inp.right, kick:!!inp.kick};
  });
  socket.on('futebolRestart', ()=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.game!=='futebol') return;
    const me=room.players.find(p=>p.id===socket.id);
    if(!me?.isAdmin) return;
    room.ball={x:FUT_W/2,y:FUT_H/2,vx:0,vy:0}; room.score={red:0,blue:0};
    room.players.forEach(p=>{ p.vx=0; p.vy=0; });
    io.to(room.code).emit('futebolState',{ball:room.ball, players:room.players.map(p=>({id:p.id,x:p.x,y:p.y,team:p.team,name:p.name})), score:room.score});
  });

  socket.on('toggleSound', ()=>{});
});

// sanity check endpoints
app.get('/health', (req,res)=> res.json({ ok:true }));
app.get('/api/syllables', (req,res)=> res.json({ all: SILABAS, byDifficulty: SILABAS_BY_DIFFICULTY }));
app.get('/api/syllables/:difficulty', (req,res)=>{
  const d = req.params.difficulty;
  if (SILABAS_BY_DIFFICULTY[d]) res.json({ difficulty: d, label: DIFFICULTY_LABEL[d], syllables: SILABAS_BY_DIFFICULTY[d] });
  else res.status(404).json({ error: 'Dificuldade inválida. Use facil/medio/dificil/insano' });
});
app.get('/api/dictionary/size', (req,res)=> res.json({ size: DICTIONARY_SET.size }));

app.get('/bomba', (req,res)=> res.sendFile(path.join(__dirname,'public','bomba.html')));
app.get('/velha', (req,res)=> res.sendFile(path.join(__dirname,'public','velha.html')));
app.get('/futebol', (req,res)=> res.sendFile(path.join(__dirname,'public','futebol.html')));
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

server.listen(PORT, ()=> console.log(`💣 Bomba das Sílabas rodando em http://localhost:${PORT}`));
