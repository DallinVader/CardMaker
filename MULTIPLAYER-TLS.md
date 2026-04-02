# Multiplayer with TLS (`wss://`) for GitHub Pages

GitHub Pages is served over **HTTPS**. Browsers only allow **secure WebSockets (`wss://`)** from that origin—not plain `ws://`. This guide runs `multiplayer-server.js` with **your own certificate** so you can stay on `https://…github.io` and connect to **`wss://your-server…`**.

## What you need

1. A **VPS, home server, or PC** reachable from the internet (or at least from players).
2. A **hostname** (e.g. `relay.example.com`) with DNS **A record** pointing to that machine’s public IP.
3. **TCP port** open on the host firewall and forwarded from the router (often **8765**, or **443**).
4. **TLS certificates** trusted by browsers—usually from **Let’s Encrypt** via **Certbot**.

Never commit private keys (`.pem`) to git.

## Certificates (Let’s Encrypt, standalone)

On the relay machine, install [Certbot](https://certbot.eff.org/). With nothing else using port **80**:

```bash
sudo certbot certonly --standalone -d relay.example.com
```

Typical paths (Linux):

- Private key: `/etc/letsencrypt/live/relay.example.com/privkey.pem`
- Full chain (use this as the cert file): `/etc/letsencrypt/live/relay.example.com/fullchain.pem`

Renewal: Certbot sets a cron/systemd timer. After renew, restart Node (or reload) so it picks up new files.

## Run the server with TLS

Set **both** paths, then start (same as usual):

```bash
export SSL_KEY_PATH=/etc/letsencrypt/live/relay.example.com/privkey.pem
export SSL_CERT_PATH=/etc/letsencrypt/live/relay.example.com/fullchain.pem
export SERVER_PUBLIC_HOST=relay.example.com
export PORT=8765
npm start
```

**Windows PowerShell:**

```powershell
$env:SSL_KEY_PATH="C:\path\to\privkey.pem"
$env:SSL_CERT_PATH="C:\path\to\fullchain.pem"
$env:SERVER_PUBLIC_HOST="relay.example.com"
$env:PORT="8765"
npm start
```

- **`SERVER_PUBLIC_HOST`** is optional; it only makes the startup log print ready-to-copy `https://` / `wss://` URLs. It must match the **name on the certificate** (or a covered SAN).
- **`PORT=443`**: Browsers use default HTTPS/WSS without `:443` in the URL. On Linux binding to 443 usually requires root or `setcap`; **8765** avoids that.

## Card Player on GitHub Pages

1. Open your normal **Card Player** page on GitHub Pages.
2. In **WebSocket**, enter: **`wss://relay.example.com:8765`** (match your host and port).
3. Host creates a room; guest joins with the same `wss://` URL and room code.

Optional share link (encode the `wss://` URL):

`https://YOUR_USER.github.io/CardMaker/card-player.html?mp=wss%3A%2F%2Frelay.example.com%3A8765`

You can load the **game UI** from either GitHub Pages or **`https://relay.example.com:8765/card-player.html`** (this server serves the same static files when TLS is on).

## Files in this repo

- `multiplayer-tls.example.env` — copy and adjust paths (load variables however you prefer; Node does not read `.env` automatically).

## Troubleshooting

- **Certificate name mismatch:** The hostname in `wss://…` must match the cert (e.g. `relay.example.com`).
- **Connection refused:** Open firewall + router port-forward for **PORT**.
- **Mixed content:** Page must be `https://` to use `wss://`; `http://` pages use `ws://` to a non-TLS server.
