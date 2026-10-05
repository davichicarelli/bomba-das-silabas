# 💣 Bomba das Sílabas

Jogo multiplayer criado conforme `prompt.txt` (874 linhas).

## Como rodar
```powershell
cd "C:\Users\Davi\Desktop\bomba"
npm install
npm start
# abra http://localhost:3000
```

Abra em 2 dispositivos/navegadores diferentes:
1. **Criar sala** → define tempo (3/5/7/10/15/custom), max jogadores, senha opcional → gera código `ABC742`
2. Outro dispositivo → **Entrar em sala** → código + senha

## Regras implementadas
- 2 vidas por jogador (❤️ ❤️), -1 por explosão, 0 = eliminado
- 5s padrão, configurável antes da partida (bloqueado durante jogo)
- Sílaba sorteada do inventário PT-BR (simples + complexas BRA/CLA/PRA/TRA/CHA etc)
- Palavra precisa: existir no dicionário PT-BR **E** conter sílaba (início/meio/fim)
- Validação **backend** (`validateWord` em `server.js:182`), dicionário normalizado (case/acento insensitive) mas sem transformar inexistente em válida
- Destaque verde da sílaba (todas ocorrências)
- Anti-cheat: servidor é fonte da verdade (sílaba, bomba, timer, vidas, turno), só quem tem a bomba envia
- Ordem de turnos circular, remove eliminados, vence último vivo
- Lobby com admin (iniciar, expulsar, config), contagem 3-2-1, explosão, vitória com ranking

## Telas (8)
1. Inicial 2. Criar sala 3. Entrar 4. Lobby 5. Partida (sílaba + bomba + timer + input) 6. Explosão 7. Eliminação 8. Vitória — todas responsivas (celular vertical com bomba grande, desktop com placar lateral)

## Arquitetura
- `server.js` → Express + Socket.IO, salas em memória, timer 80ms tick, hash SHA256 senha, validação eficiente via `Set` normalizado
- `public/index.html` / `style.css` (tema escuro neon, animações shake/blink/boom) / `app.js` (Socket.IO cliente, 8 telas, sons WebAudio toggle)
- Endpoints úteis: `/health`, `/api/syllables`, `/api/dictionary/size`

## Tecnologias
Node 24, Express 4, Socket.IO 4, WebAudio para efeitos (início, sílaba, correta, inválida, últimos 2s, explosão, vitória)
