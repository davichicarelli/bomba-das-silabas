# 🚀 Subir Bomba das Sílabas — Acesso por outros dispositivos

Seu servidor já está rodando em `http://localhost:3000` e escutando em `0.0.0.0:3000` (PID 1840). 3 formas de compartilhar:

---

## 1) Rede local (mesmo Wi-Fi) — MAIS RÁPIDO, sem internet

Funciona para celular/tablet conectados no mesmo Wi-Fi.

**Seu IP local:** `192.168.15.9` (Ethernet) — confirme com `ipconfig`

**URL para outros dispositivos:** `http://192.168.15.9:3000`

**Passos:**
1. No Windows, abra **PowerShell como Administrador** (clique direito > Executar como administrador) e rode:
   ```powershell
   New-NetFirewallRule -DisplayName "Bomba das Silabas 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private,Public
   ```
   *Você tentou criar e deu “Acesso negado” justamente por não ser admin — rode como admin que libera.*

2. No celular, abra o navegador e acesse `http://192.168.15.9:3000` (ou `http://SEU_IP:3000` se o IP mudar).

3. Se não abrir, verifique se ambos estão no mesmo Wi-Fi e se o Firewall não bloqueou.

> Dica: IP pode mudar ao reconectar. Rode `ipconfig | findstr IPv4` para conferir.

---

## 2) Túnel público instantâneo — Compartilhar com qualquer pessoa na internet (sem deploy)

Não precisa hospedar. Gera um link `https://xxxx.ngrok.io` ou `https://xxxx.loca.lt`.

### Opção A — LocalTunnel (grátis, sem cadastro)
```powershell
cd "C:\Users\Davi\Desktop\bomba"
npx localtunnel --port 3000
# vai mostrar: your url is: https://spicy-birds-jump.loca.lt
```
Copie a URL e envie para amigos. Enquanto seu PC ficar ligado e o comando rodando, todos acessam.

### Opção B — Ngrok (mais estável, precisa cadastro gratuito em https://dashboard.ngrok.com)
```powershell
npm install -g ngrok
ngrok config add-authtoken SEU_TOKEN
ngrok http 3000
# Forwarding https://1a2b-...ngrok-free.app -> http://localhost:3000
```

### Opção C — Cloudflare Tunnel (sem cadastro, via cloudflared)
Baixe https://developers.cloudflare.com/cloudflare-one/connections/connect/networks/downloads/
```powershell
cloudflared tunnel --url http://localhost:3000
```

---

## 3) Deploy permanente (gratuito) — Render / Railway / Fly.io

Seu projeto já tem `Dockerfile`, `render.yaml` e `package.json` prontos.

### Render.com (recomendado, free tier)
1. Crie repo no GitHub e dê push da pasta `bomba`:
   ```powershell
   cd "C:\Users\Davi\Desktop\bomba"
   git init
   git add .
   git commit -m "bomba das silabas"
   git remote add origin https://github.com/SEUUSER/bomba.git
   git push -u origin main
   ```
2. Acesse https://dashboard.render.com > New > Web Service > Connect seu repo
3. Build Command: `npm install`
   Start Command: `node server.js`
   Env Var: `PORT=10000` (Render injeta, seu server já usa `process.env.PORT`)
4. Deploy → Render dá URL `https://bomba-das-silabas.onrender.com`

### Railway.app
1. https://railway.app > New Project > Deploy from GitHub
2. Adiciona variável `PORT=3000` se precisar.

### Fly.io
```powershell
npm install -g @flydot/cli
fly launch   # dentro da pasta bomba, escolha nome
fly deploy
```

---

## Checklist antes de subir
- `palavras.txt` (3.7MB, 315k palavras) já está na pasta — faça commit dele também.
- `server.js` usa `process.env.PORT || 3000` → compatível com qualquer host.
- Socket.IO já configurado com CORS `origin: "*"` → funciona em qualquer domínio.

Quer que eu já gere o túnel `localtunnel` agora e te passe o link público?
