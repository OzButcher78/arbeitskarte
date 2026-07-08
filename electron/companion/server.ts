// ============================================================================
// LAN photo companion — a tiny HTTP server (Electron main process) that lets a
// phone on the SAME local network take a photo and hand it to the desktop app.
// ----------------------------------------------------------------------------
// Design choices (deliberate, for a trusted shop LAN):
//   • Plain HTTP, not HTTPS. The phone captures via the OS camera through an
//     <input type="file" capture="environment"> — that does NOT need a secure
//     context, so no self-signed cert / no certificate warnings. The image never
//     leaves the LAN: phone → desktop, direct.
//   • A single active pairing at a time, addressed by a random token in the URL
//     path. A new pairing invalidates the previous token (old links 404). A
//     pairing also self-expires after SESSION_TTL_MS so a crashed/force-reloaded
//     renderer can't leave the endpoint accepting uploads indefinitely.
//   • The phone downscales before upload; the captured image lives only in
//     memory and is consumed once (cleared on read). Nothing is written to disk.
//   • Bind to 0.0.0.0 so a phone can reach it; the OS firewall may prompt to
//     allow the port on first run.
// The image can contain owner PII (a Fahrzeugausweis) — it stays on the LAN and
// is handled exactly like a locally-captured photo once received.
// ============================================================================

import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';

/** Max upload size (bytes). The phone downscales first, so this is a safety cap. */
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
/** A pairing self-expires this long after it starts (bounds the exposure window). */
const SESSION_TTL_MS = 10 * 60 * 1000;

// Interface-name fragments that mark virtual / VPN / container adapters whose
// private IPv4 a LAN phone usually can't route to (Hyper-V, WSL, VM, VPN, …).
const VIRTUAL_IF = /(virtual|vethernet|vmware|vbox|virtualbox|hyper-v|docker|wsl|loopback|tailscale|zerotier|utun|tun\d|tap\d|bridge|radmin|hamachi)/i;

interface Session {
  token: string;
  image: string | null; // data: URL of the received capture (consumed on read)
  createdAt: number;
}

let server: http.Server | null = null;
let listenPort = 0;
let startPromise: Promise<number> | null = null;
let session: Session | null = null;

/** The active, non-expired session (clears it if the TTL has passed). */
function activeSession(): Session | null {
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    session = null;
    return null;
  }
  return session;
}

/** Best real LAN IPv4: skip virtual/VPN adapters, prefer 192.168 → 10 → 172.16. */
export function getLanIp(): string | null {
  const ifaces = os.networkInterfaces();
  const candidates: string[] = [];
  for (const name of Object.keys(ifaces)) {
    if (VIRTUAL_IF.test(name)) continue;
    for (const info of ifaces[name] ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      candidates.push(info.address);
    }
  }
  const rank = (ip: string): number => {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3; // public / unknown — last resort
  };
  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates[0] ?? null;
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > maxBytes) {
        done = true;
        req.pause(); // stop reading; don't destroy the socket before the response
        reject(new Error('payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!done) resolve(Buffer.concat(chunks)); });
    req.on('error', (err) => { if (!done) { done = true; reject(err); } });
  });
}

function mobilePageHtml(token: string): string {
  // Self-contained page served to the phone. Uses the OS camera via a file
  // input (no getUserMedia → no HTTPS requirement), downscales the pick on the
  // phone, then auto-uploads it.
  return `<!doctype html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Arbeitskarte – Foto vom Handy</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f1f5f9; min-height: 100vh; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 24px 18px 40px; }
  h1 { font-size: 19px; margin: 8px 0 4px; }
  p.sub { color: #94a3b8; font-size: 13px; margin: 0 0 22px; }
  label.pick { display: flex; align-items: center; justify-content: center; gap: 10px; background: #2563eb; color: #fff; font-size: 17px; font-weight: 600; padding: 18px; border-radius: 14px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  label.pick:active { background: #1d4ed8; }
  input[type=file] { display: none; }
  .preview { margin-top: 18px; border-radius: 12px; overflow: hidden; border: 1px solid #334155; display: none; }
  .preview img { display: block; width: 100%; }
  .status { margin-top: 18px; padding: 14px; border-radius: 12px; font-size: 14px; text-align: center; display: none; }
  .status.ok { background: #064e3b; color: #6ee7b7; display: block; }
  .status.busy { background: #1e293b; color: #cbd5e1; display: block; }
  .status.err { background: #7f1d1d; color: #fecaca; display: block; }
  .retake { margin-top: 14px; width: 100%; background: transparent; border: 1px solid #334155; color: #cbd5e1; padding: 12px; border-radius: 12px; font-size: 14px; }
  .hint { margin-top: 26px; color: #64748b; font-size: 12px; text-align: center; line-height: 1.5; }
</style></head>
<body>
  <div class="wrap">
    <h1>Foto vom Handy</h1>
    <p class="sub">Fahrzeugausweis oder Schaden fotografieren – das Bild wird direkt an den Computer gesendet.</p>

    <label class="pick" for="file">📷 Foto aufnehmen</label>
    <input id="file" type="file" accept="image/*" capture="environment">

    <div class="preview" id="preview"><img id="previewImg" alt=""></div>
    <div class="status" id="status"></div>
    <button class="retake" id="retake" style="display:none">Neues Foto</button>

    <p class="hint">Gerät muss im selben WLAN wie der Computer sein.<br>Diese Seite nach dem Senden schliessen.</p>
  </div>

  <script>
    var token = ${JSON.stringify(token)};
    var MAX_EDGE = 2000;
    var fileEl = document.getElementById('file');
    var statusEl = document.getElementById('status');
    var previewEl = document.getElementById('preview');
    var previewImg = document.getElementById('previewImg');
    var retakeEl = document.getElementById('retake');

    function setStatus(kind, text) { statusEl.className = 'status ' + kind; statusEl.textContent = text; }

    function upload(dataUrl) {
      previewImg.src = dataUrl;
      previewEl.style.display = 'block';
      setStatus('busy', 'Wird gesendet …');
      retakeEl.style.display = 'none';
      fetch('/c/' + token + '/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: dataUrl })
      }).then(function (res) {
        if (res.ok) setStatus('ok', '✓ Gesendet. Sie können zum Computer zurückkehren.');
        else if (res.status === 410) setStatus('err', 'Sitzung abgelaufen. Am Computer neuen QR-Code erzeugen.');
        else setStatus('err', 'Senden fehlgeschlagen. Bitte erneut versuchen.');
        retakeEl.style.display = 'block';
      }).catch(function () {
        setStatus('err', 'Verbindung fehlgeschlagen. Gleiches WLAN?');
        retakeEl.style.display = 'block';
      });
    }

    function sendOriginal(file) {
      var r = new FileReader();
      r.onload = function () { upload(r.result); };
      r.readAsDataURL(file);
    }

    function process(file) {
      // Downscale on the phone so the LAN transfer stays small (and re-encode
      // HEIC → JPEG, which the desktop can then decode).
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { sendOriginal(file); return; }
        if (w > MAX_EDGE || h > MAX_EDGE) {
          if (w >= h) { h = Math.round(h * MAX_EDGE / w); w = MAX_EDGE; }
          else { w = Math.round(w * MAX_EDGE / h); h = MAX_EDGE; }
        }
        try {
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          upload(c.toDataURL('image/jpeg', 0.82));
        } catch (e) { sendOriginal(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); sendOriginal(file); };
      img.src = url;
    }

    fileEl.addEventListener('change', function () {
      var file = fileEl.files && fileEl.files[0];
      if (file) process(file);
    });
    retakeEl.addEventListener('click', function () { fileEl.value = ''; fileEl.click(); });
  </script>
</body></html>`;
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url || '/';
  const active = activeSession();

  const send = (status: number, type: string, body: string | Buffer) => {
    if (res.headersSent || res.writableEnded) return;
    try {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      /* socket already gone — nothing to do */
    }
  };

  // GET /c/:token  → mobile page
  const pageMatch = /^\/c\/([a-f0-9]+)\/?$/.exec(url);
  if (req.method === 'GET' && pageMatch) {
    if (!active || pageMatch[1] !== active.token) {
      send(404, 'text/plain; charset=utf-8', 'Sitzung abgelaufen. Bitte am Computer einen neuen QR-Code erzeugen.');
      return;
    }
    send(200, 'text/html; charset=utf-8', mobilePageHtml(active.token));
    return;
  }

  // POST /c/:token/upload  → store the capture
  const uploadMatch = /^\/c\/([a-f0-9]+)\/upload\/?$/.exec(url);
  if (req.method === 'POST' && uploadMatch) {
    if (!active || uploadMatch[1] !== active.token) {
      send(410, 'application/json', JSON.stringify({ error: 'expired' }));
      return;
    }
    readBody(req, MAX_UPLOAD_BYTES)
      .then((buf) => {
        // Re-check the live session: it may have been replaced/expired while the
        // body streamed. Don't report success into a session that's gone.
        const live = activeSession();
        if (!live || live.token !== uploadMatch[1]) {
          send(410, 'application/json', JSON.stringify({ error: 'expired' }));
          return;
        }
        let dataUrl = '';
        try {
          const parsed = JSON.parse(buf.toString('utf-8'));
          if (parsed && typeof parsed.dataUrl === 'string') dataUrl = parsed.dataUrl;
        } catch {
          /* fall through to validation */
        }
        if (!dataUrl.startsWith('data:image/')) {
          send(400, 'application/json', JSON.stringify({ error: 'invalid' }));
          return;
        }
        live.image = dataUrl;
        send(200, 'application/json', JSON.stringify({ ok: true }));
      })
      .catch(() => {
        send(413, 'application/json', JSON.stringify({ error: 'too_large' }));
      });
    return;
  }

  send(404, 'text/plain; charset=utf-8', 'Not found');
}

/** Ensure the HTTP server is listening; resolves with the bound port. Safe to
 *  call concurrently (a single listen is shared) and after a failed listen. */
export async function ensureServer(): Promise<number> {
  if (server && listenPort) return listenPort;
  if (startPromise) return startPromise;
  startPromise = new Promise<number>((resolve, reject) => {
    const s = http.createServer(handleRequest);
    s.once('error', (err) => {
      server = null;
      listenPort = 0;
      reject(err);
    });
    // Bind on all interfaces so a LAN phone can reach it; port 0 = ephemeral.
    s.listen(0, '0.0.0.0', () => {
      const addr = s.address();
      server = s;
      listenPort = typeof addr === 'object' && addr ? addr.port : 0;
      // Swap the startup error handler for a non-fatal runtime logger.
      s.removeAllListeners('error');
      s.on('error', (e) => console.error('[companion] server error:', (e as Error).message));
      resolve(listenPort);
    });
  });
  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

/** Start a fresh pairing session and return the phone URL (or null if no LAN). */
export async function startSession(): Promise<{ url: string; token: string } | { error: string }> {
  const ip = getLanIp();
  if (!ip) return { error: 'no_lan' };
  const port = await ensureServer();
  const token = crypto.randomBytes(16).toString('hex');
  session = { token, image: null, createdAt: Date.now() };
  return { url: `http://${ip}:${port}/c/${token}`, token };
}

/** Return the received image for the token (once), then clear it. */
export function takeImage(token: string): string | null {
  const s = activeSession();
  if (!s || s.token !== token) return null;
  const img = s.image;
  s.image = null;
  return img;
}

/** End the active pairing (old token/URL stops working). Server keeps listening. */
export function stopSession(): void {
  session = null;
}
