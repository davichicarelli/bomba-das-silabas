const socket = io();
let myId = null;
let currentRoom = null;
let myName = "";
let soundOn = localStorage.getItem('bombSound') !== 'off';
let timerDuration = 5;

// DOM helpers
const $ = id => document.getElementById(id);
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $(id).classList.add('active');
}
function toast(msg, t=2500){
  const el=$('toast'); el.textContent=msg; el.classList.remove('hidden');
  setTimeout(()=>el.classList.add('hidden'), t);
}
function playTone(freq, dur, type='sine', vol=0.2){
  if(!soundOn) return;
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o=ctx.createOscillator(); const g=ctx.createGain();
    o.type=type; o.frequency.value=freq; g.gain.value=vol;
    o.connect(g); g.connect(ctx.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+dur);
    o.stop(ctx.currentTime+dur);
  }catch{}
}

// sound toggle
$('btnSound').textContent = soundOn ? '🔊' : '🔇';
$('btnSound').onclick = ()=>{
  soundOn=!soundOn; localStorage.setItem('bombSound', soundOn?'on':'off');
  $('btnSound').textContent = soundOn?'🔊':'🔇';
  toast(soundOn?'Som ativado':'Som desativado');
};
$('btnLeave').onclick = ()=>{
  socket.emit('leaveRoom');
  currentRoom=null; showScreen('screen-home');
  $('btnLeave').classList.add('hidden');
};

// HOME
$('btnCreate').onclick=()=> showScreen('screen-create');
$('btnJoin').onclick=()=> showScreen('screen-join');
$('c-back').onclick=()=> showScreen('screen-home');
$('j-back').onclick=()=> showScreen('screen-home');

// hints de dificuldade (usado no lobby)
const DIFF_HINTS = {
  facil: '🟢 Sílabas fáceis e comuns: CA, MA, PA, TA, LA, SA, RA, CO, MO, TO... muitas palavras!',
  medio: '🟡 Padrão: todas as sílabas simples CV + CHA/LHA/NHA (80+ opções).',
  dificil: '🔴 Encontros difíceis: BRA, CLA, PRA, TRA, FLA, GRA... e raras ZA/ZU.',
  insano: '💀 Todas as 130 sílabas misturadas — caos total!'
};

// CREATE (configurações agora só no lobby)
$('c-submit').onclick=()=>{
  const playerName=$('c-name').value.trim();
  const roomName=$('c-room').value.trim();
  const password=$('c-pass').value;
  if(!playerName||!roomName){ $('c-error').textContent='Preencha nome e sala.'; return; }
  $('c-error').textContent='Criando...';
  socket.emit('createRoom',{playerName,roomName,password}, res=>{
    if(res.error){ $('c-error').textContent=res.error; return; }
    myName=playerName;
    currentRoom=res.room;
    $('btnLeave').classList.remove('hidden');
    enterLobby(res.code||res.room.code);
    toast('Sala criada: '+res.code+' • Configure no lobby');
  });
};

// JOIN
$('j-submit').onclick=()=>{
  const playerName=$('j-name').value.trim();
  const code=$('j-code').value.trim().toUpperCase();
  const password=$('j-pass').value;
  if(!playerName||!code){ $('j-error').textContent='Informe nome e código.'; return; }
  $('j-error').textContent='Entrando...';
  socket.emit('joinRoom',{playerName,code,password}, res=>{
    if(res.error){ $('j-error').textContent=res.error; return; }
    myName=playerName;
    currentRoom=res.room;
    $('btnLeave').classList.remove('hidden');
    enterLobby(res.room.code);
    toast('Entrou na sala!');
  });
};

function enterLobby(code){
  showScreen('screen-lobby');
}

// LOBBY render
function renderLobby(room){
  currentRoom=room;
  $('lobby-code').textContent=room.code;
  $('lobby-name').textContent=room.name;
  $('lobby-count').textContent=`${room.players.length}/${room.maxPlayers} jogadores`;
  $('lobby-time').textContent=`⏱️ ${room.timerDuration}s`;
  $('lobby-diff').textContent= room.difficultyLabel || room.difficulty;
  // adiciona vidas no header
  const livesInfo = `❤️ ${room.lives} vida${room.lives>1?'s':''}`;
  // mantém diff no header também
  if(!$('lobby-diff').textContent.includes('❤️')){} // placeholder
  $('lobby-status').textContent= room.status==='lobby'?`Aguardando • ${livesInfo}`:room.status;
  const isAdmin = room.players.find(p=>p.id===socket.id)?.isAdmin;
  const settingsWrap=$('lobby-settings');
  if(room.status==='lobby'){
    if(isAdmin){
      settingsWrap.classList.remove('hidden');
      $('lobby-time-select').value = String(room.timerDuration);
      $('lobby-diff-select').value = room.difficulty || 'medio';
      $('lobby-lives-select').value = String(room.lives || 2);
      $('lobby-max-select').value = String(room.maxPlayers);
      $('lobby-settings-hint').textContent = DIFF_HINTS[room.difficulty] || '';
    } else {
      settingsWrap.classList.add('hidden');
    }
    $('lobby-start').classList.toggle('hidden', !isAdmin);
    $('lobby-start').disabled = room.players.length<2;
    $('lobby-wait').style.display = isAdmin ? 'none' : 'block';
    if(isAdmin) $('lobby-wait').textContent = room.players.length<2 ? 'Mínimo 2 jogadores para iniciar' : 'Você é o administrador — ajuste tempo, dificuldade e vidas acima';
    else $('lobby-wait').textContent = `${room.difficultyLabel} • ${room.timerDuration}s • ${livesInfo} • Aguardando administrador...`;
  } else {
    settingsWrap.classList.add('hidden');
  }
  // badge no game também
  if($('game-diff-badge')) $('game-diff-badge').textContent = room.difficultyLabel ? `Dificuldade: ${room.difficultyLabel} • ${room.timerDuration}s • ${livesInfo}` : '';
  const grid=$('lobby-players'); grid.innerHTML='';
  const maxLives = room.lives || 2;
  room.players.forEach(p=>{
    const div=document.createElement('div');
    div.className='player-card'+(p.isAdmin?' admin':'')+(p.alive?'':' eliminated');
    div.innerHTML=`
      ${p.isAdmin?'<span class="badge">👑 ADM</span>':''}
      <div class="p-name">${p.name}${p.id===socket.id?' (você)':''}</div>
      <div class="p-lives">${'❤️'.repeat(p.lives)}${'🤍'.repeat(Math.max(0, maxLives-p.lives))}</div>
      <div class="p-score">${p.score||0} pts • ${p.alive?'🟢':'💀'}</div>
    `;
    if(isAdmin && p.id!==socket.id && room.status==='lobby'){
      const b=document.createElement('button');
      b.className='kick'; b.textContent='Expulsar';
      b.onclick=()=> socket.emit('kickPlayer',{targetId:p.id}, r=>{ if(r?.error) toast(r.error)});
      div.appendChild(b);
    }
    grid.appendChild(div);
  });
}

function emitSettings(patch){
  socket.emit('updateSettings', patch, res=>{
    if(res?.error) toast(res.error);
    else if(patch.difficulty) toast('Dificuldade: '+DIFF_HINTS[patch.difficulty]);
    else if(patch.timerDuration) toast('Tempo: '+patch.timerDuration+'s');
    else if(patch.lives) toast('Vidas: '+patch.lives+' ❤️');
  });
}
$('lobby-diff-select').addEventListener('change', e=> emitSettings({difficulty:e.target.value}));
$('lobby-time-select').addEventListener('change', e=> emitSettings({timerDuration:Number(e.target.value)}));
$('lobby-lives-select').addEventListener('change', e=> emitSettings({lives:Number(e.target.value)}));
$('lobby-max-select').addEventListener('change', e=> {
  socket.emit('updateSettings',{maxPlayers:Number(e.target.value)}, res=>{
    if(res?.error) toast(res.error);
    else toast('Máx. jogadores: '+e.target.value);
  });
});
// compat: old event
socket.on('difficultyChanged', ({label})=>{
  toast('Dificuldade alterada para '+label);
});
socket.on('settingsUpdated', ()=> toast('Configurações atualizadas'));

$('lobby-start').onclick=()=>{
  socket.emit('startGame', res=>{
    if(res?.error) $('lobby-error').textContent=res.error;
  });
};

// GAME helpers
let myTurn=false;
function renderScoreboard(room){
  const list=$('score-list'); list.innerHTML='';
  // order by lives then score
  [...room.players].sort((a,b)=> (b.lives-a.lives)||(b.score-a.score)).forEach(p=>{
    const div=document.createElement('div');
    div.className='row'+(p.id===socket.id?' me':'')+(p.alive?'':' out');
    const hasBomb = room.currentTurnId===p.id && room.status==='playing';
    div.innerHTML=`
      <span><span class="status-dot ${p.alive?'alive':'dead'}"></span>${p.name} ${hasBomb?'💣':''} ${p.isAdmin?'👑':''}</span>
      <span>${'❤️'.repeat(p.lives)} ${p.alive?'':'💀'} • ${p.score||0}pts</span>
    `;
    list.appendChild(div);
  });
}

function setTurnState(){
  if(!currentRoom) return;
  const isMyTurn = currentRoom.currentTurnId === socket.id;
  const aliveMe = currentRoom.players.find(p=>p.id===socket.id)?.alive;
  myTurn = isMyTurn && aliveMe && currentRoom.status==='playing';
  const ind=$('turn-indicator');
  if(!aliveMe){ ind.textContent='💀 Você foi eliminado - assistindo'; ind.className='turn-indicator'; $('word-input').disabled=true; $('btn-send').disabled=true; return; }
  if(isMyTurn){ ind.textContent='🔥 É SUA VEZ! Digite rápido!'; ind.className='turn-indicator mine'; $('word-input').disabled=false; $('btn-send').disabled=false; $('word-input').focus(); }
  else{
    const holder = currentRoom.players.find(p=>p.id===currentRoom.currentTurnId);
    ind.textContent = holder ? `⏳ Vez de ${holder.name}` : 'Aguardando...';
    ind.className='turn-indicator';
    $('word-input').disabled=true; $('btn-send').disabled=true;
  }
}

function updateTimer(timeLeft, duration){
  const pct = Math.max(0, Math.min(100, (timeLeft/(duration*1000))*100));
  const fill=$('timer-fill');
  fill.style.width=pct+'%';
  const s=(timeLeft/1000).toFixed(1);
  $('timer').textContent = s+'s';
  const danger = timeLeft < 2000;
  $('timer').classList.toggle('danger', danger);
  fill.classList.toggle('danger', danger);
  $('bomb').classList.toggle('danger', danger);
  $('bomb').classList.toggle('shake', danger && timeLeft%400<200);
  if(danger && timeLeft%900<100) playTone(900,0.08,'square',0.08);
}

// events
socket.on('connect', ()=>{ myId=socket.id; });

socket.on('roomUpdate', room=>{
  currentRoom=room; timerDuration=room.timerDuration;
  if(room.status==='lobby') renderLobby(room);
  else if(room.status==='playing' || room.status==='countdown' || room.status==='finished'){
    // if in lobby and game started, go to countdown/game
    renderScoreboard(room);
    setTurnState();
    if($('lobby-code').textContent) {} // already
    if(room.currentSilaba) $('syllable').textContent=room.currentSilaba;
  }
});

socket.on('countdown', ({from, go})=>{
  showScreen('screen-countdown');
  if(go){ $('count-num').textContent='💣 GO!'; $('count-text').textContent='Começou!'; playTone(600,0.3,'sine',0.3); }
  else{ $('count-num').textContent=from; $('count-text').textContent='Prepare-se...'; playTone(400+from*100,0.2); $('count-num').classList.remove('go'); void $('count-num').offsetWidth; }
});

socket.on('gameStarted', ({silaba, currentTurnId, timerDuration:td})=>{
  showScreen('screen-game');
  timerDuration=td;
  $('syllable').textContent=silaba;
  $('feedback').classList.add('hidden');
  $('highlight').classList.add('hidden');
  $('history').innerHTML='';
  $('last-words').textContent='';
  const tdEl=$('typing-display'); if(tdEl) tdEl.classList.add('hidden');
  playTone(800,0.25,'sine',0.25);
  renderScoreboard(currentRoom||{players:[]});
  setTurnState();
});

socket.on('tick', ({timeLeft, currentTurnId, silaba})=>{
  if(!currentRoom) return;
  currentRoom.currentTurnId=currentTurnId;
  currentRoom.currentSilaba=silaba;
  if($('screen-game').classList.contains('active')){
    updateTimer(timeLeft, currentRoom.timerDuration);
    setTurnState();
  }
});

socket.on('newTurn', ({silaba, currentTurnId})=>{
  if(!currentRoom) return;
  currentRoom.currentSilaba=silaba;
  currentRoom.currentTurnId=currentTurnId;
  $('syllable').textContent=silaba;
  $('feedback').classList.add('hidden');
  $('highlight').classList.add('hidden');
  $('game-error').textContent='';
  $('word-input').value='';
  const td=$('typing-display'); if(td) td.classList.add('hidden');
  updateTimer(currentRoom.timerDuration*1000, currentRoom.timerDuration);
  setTurnState();
  playTone(500,0.12);
  const holder=currentRoom.players.find(p=>p.id===currentTurnId);
  if(holder) addHistory(`🔄 Vez de <b>${holder.name}</b> • sílaba <b>${silaba}</b>`);
});

function addHistory(html){
  const h=$('history'); const d=document.createElement('div'); d.className='hrow'; d.innerHTML=html; h.prepend(d);
  const mobile=document.getElementById('last-words'); if(mobile) mobile.innerHTML=html;
}

socket.on('wordValid', ({playerName, word, silaba, highlighted})=>{
  $('feedback').className='feedback success';
  $('feedback').innerHTML=`✓ <b>${playerName}</b> acertou!`;
  $('feedback').classList.remove('hidden');
  $('highlight').innerHTML = highlighted;
  $('highlight').classList.remove('hidden');
  const td=$('typing-display'); if(td) td.classList.add('hidden');
  addHistory(`✅ <b>${playerName}</b>: ${highlighted}`);
  playTone(700,0.18,'sine',0.2);
});

socket.on('wordInvalid', ({reason})=>{
  $('feedback').className='feedback error';
  $('feedback').innerHTML=`❌ PALAVRA INVÁLIDA<br><small>${reason}</small>`;
  $('feedback').classList.remove('hidden');
  $('game-error').textContent=reason;
  playTone(200,0.25,'square',0.15);
  // shake input
  const inp=$('word-input'); inp.animate([{transform:'translateX(0)'},{transform:'translateX(-6px)'},{transform:'translateX(6px)'},{transform:'translateX(0)'}],{duration:250});
  setTimeout(()=>{ $('feedback').classList.add('hidden'); },1500);
});

socket.on('explosion', ({playerName, lives, eliminated})=>{
  const td=$('typing-display'); if(td) td.classList.add('hidden');
  showScreen('screen-explosion');
  playTone(120,0.6,'sawtooth',0.25);
  setTimeout(()=>playTone(80,0.8,'square',0.25),150);
  $('explosion-text').innerHTML = `💥 A bomba explodiu com <b>${playerName}</b>!`;
  if(eliminated) $('explosion-lives').innerHTML = `💀 <b>${playerName}</b> foi eliminado! (0 ❤️)`;
  else $('explosion-lives').innerHTML = `${playerName} perdeu 1 vida. Restam: ${'❤️'.repeat(lives)}`;
  $('explosion-next').textContent='';
  // check if I was eliminated
  if(currentRoom){
    const me=currentRoom.players.find(p=>p.id===socket.id);
    // will be updated via roomUpdate
  }
  setTimeout(()=>{
    if($('screen-explosion').classList.contains('active')){
      const room=currentRoom;
      if(room && room.status==='playing'){
        showScreen('screen-game');
        // check if I'm dead
        const me=room.players.find(p=>p.id===socket.id);
        if(me && !me.alive){
          showScreen('screen-eliminated');
        }
      }
    }
  },1800);
});

socket.on('victory', ({winnerName, ranking})=>{
  showScreen('screen-victory');
  $('victory-name').textContent= winnerName ? winnerName : 'Empate';
  const r=$('victory-ranking'); r.innerHTML='';
  (ranking||[]).forEach((p,i)=>{
    const div=document.createElement('div');
    div.className='rrow'+(i===0?' winner':'');
    div.innerHTML=`<span>${i===0?'🏆':''} ${p.name} ${p.alive?'':'💀'}</span><span>${'❤️'.repeat(p.lives)} • ${p.score} pts</span>`;
    r.appendChild(div);
  });
  playTone(900,0.5,'sine',0.25);
  setTimeout(()=>playTone(1200,0.5,'sine',0.25),300);
});

socket.on('playerJoined', ({name})=> toast(`🟢 ${name} entrou`));
socket.on('playerLeft', ({name})=> toast(`🔴 ${name} saiu`));
socket.on('kicked', ()=>{ toast('Você foi expulso da sala'); currentRoom=null; showScreen('screen-home'); $('btnLeave').classList.add('hidden'); });

// live typing — emite em tempo real para espectadores
let typingThrottle = 0;
$('word-input').addEventListener('input', e=>{
  if(!myTurn) return;
  const now = Date.now();
  if(now - typingThrottle < 50) return;
  typingThrottle = now;
  socket.emit('typing', { text: e.target.value });
});
$('word-input').addEventListener('keyup', e=>{
  if(e.key==='Escape'){ socket.emit('typing', {text:''}); }
});

// submit word
function submitWord(){
  const w=$('word-input').value.trim();
  if(!w) return;
  if(!myTurn){ toast('Não é sua vez!'); return; }
  socket.emit('typing', {text:''}); // limpa indicador dos outros
  socket.emit('submitWord',{word:w}, res=>{
    if(res && res.error) toast(res.error);
    if(res && res.valid===false) {}
  });
  $('word-input').value='';
}
$('btn-send').onclick=submitWord;
$('word-input').addEventListener('keydown', e=>{ if(e.key==='Enter') submitWord(); });

// recebe digitação ao vivo
socket.on('playerTyping', ({playerName, text})=>{
  const disp=$('typing-display');
  const nameEl=$('typing-name');
  const textEl=$('typing-text');
  if(!disp) return;
  if(!text || !playerName){
    disp.classList.add('hidden');
    return;
  }
  nameEl.textContent = playerName;
  const sil = currentRoom?.currentSilaba || '';
  if(sil && text.toLowerCase().includes(sil.toLowerCase())){
    const re = new RegExp(`(${sil.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi');
    textEl.innerHTML = text.replace(re, '<span class="hl">$1</span>');
  } else {
    textEl.textContent = text || '…';
  }
  disp.classList.remove('hidden');
  clearTimeout(window._typingHide);
  window._typingHide = setTimeout(()=> disp.classList.add('hidden'), 2500);
});

$('btn-spectate').onclick=()=> showScreen('screen-game');
$('btn-play-again').onclick=()=>{
  // volta ao lobby se ainda houver sala
  if(currentRoom) showScreen('screen-lobby');
  else showScreen('screen-home');
};
$('btn-home').onclick=()=>{
  socket.emit('leaveRoom');
  currentRoom=null;
  $('btnLeave').classList.add('hidden');
  showScreen('screen-home');
};

// auto uppercase code
$('j-code').addEventListener('input', e=> e.target.value=e.target.value.toUpperCase());
