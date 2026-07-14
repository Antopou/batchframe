// Google OAuth2 client for Drive access.
// Uses a loopback (127.0.0.1) redirect flow suitable for Electron desktop apps.
// OAuth client credentials come from src/drive/config.js (hardcoded once per
// user install). Only the refresh token + profile are persisted on disk,
// encrypted with electron.safeStorage.

const { app, safeStorage, shell } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
const { google } = require('googleapis');

const CONFIG = require('./config');

// Full drive scope is required because the folder picker browses arbitrary
// user folders (not just files created by this app, which is what drive.file
// would restrict to). The consent screen makes this explicit to the user.
const SCOPES = ['https://www.googleapis.com/auth/drive'];

const SUCCESS_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signed in</title>
<style>
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: #0f1013;
    color: #e6e6e8;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
  }
  body {
    display: flex; align-items: center; justify-content: center;
  }
  .card {
    max-width: 380px;
    padding: 32px 28px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    text-align: center;
    animation: rise .35s cubic-bezier(.34,1.2,.64,1) both;
  }
  @keyframes rise {
    from { transform: translateY(6px); opacity: 0; }
    to   { transform: translateY(0);   opacity: 1; }
  }
  .check {
    width: 56px; height: 56px; margin: 0 auto 18px;
    border-radius: 50%;
    background: rgba(74,222,128,.12);
    border: 1px solid rgba(74,222,128,.35);
    display: flex; align-items: center; justify-content: center;
    color: #4ade80;
  }
  h1 {
    font-size: 17px; font-weight: 600; margin: 0 0 6px;
    letter-spacing: -0.2px;
  }
  p {
    font-size: 13px; color: #9a9aa2;
    margin: 0; line-height: 1.5;
  }
  .brand {
    margin-top: 22px;
    font-size: 11px;
    color: #6a6a72;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="check">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    </div>
    <h1>Signed in to Google Drive</h1>
    <p>You can close this tab and return to the app.</p>
    <div class="brand">Image Dataset Selector</div>
  </div>
  <script>
    // Auto-close the tab after a short delay when possible (only works if the
    // tab was opened by a script — safe no-op otherwise).
    setTimeout(function () { try { window.close(); } catch (e) {} }, 1500);
  </script>
</body>
</html>`;

let cachedClient = null;
let cachedProfile = null;

function tokenPath() {
  return path.join(app.getPath('userData'), 'drive-token.enc');
}

function hasConfiguredClient() {
  return !!(CONFIG.CLIENT_ID && CONFIG.CLIENT_SECRET);
}

async function readToken() {
  try {
    const buf = await fs.readFile(tokenPath());
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage unavailable — cannot read encrypted token');
    }
    const plain = safeStorage.decryptString(buf);
    return JSON.parse(plain);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeToken(obj) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage unavailable — cannot persist token');
  }
  const enc = safeStorage.encryptString(JSON.stringify(obj));
  await fs.writeFile(tokenPath(), enc, { mode: 0o600 });
}

async function clearToken() {
  try { await fs.unlink(tokenPath()); } catch { /* ignore */ }
}

async function isSignedIn() {
  if (!hasConfiguredClient()) return false;
  const t = await readToken();
  return !!(t && t.refreshToken);
}

async function getProfile() {
  if (cachedProfile) return cachedProfile;
  const t = await readToken();
  return t?.profile || null;
}

function buildOAuth2(redirectUri) {
  return new google.auth.OAuth2(CONFIG.CLIENT_ID, CONFIG.CLIENT_SECRET, redirectUri);
}

// Runs the OAuth 2.0 loopback flow. Opens the Google consent URL in the
// user's default browser, spins up a one-shot local HTTP server to catch the
// redirect, exchanges the code for tokens, and persists the refresh token.
async function signIn() {
  if (!hasConfiguredClient()) {
    throw new Error('OAuth client not configured. Set CLIENT_ID and CLIENT_SECRET in src/drive/config.js.');
  }

  const port = await findFreePort();
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const state = crypto.randomBytes(16).toString('hex');

  const oauth2 = buildOAuth2(redirectUri);
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });

  const codePromise = new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const parsed = new URL(req.url, redirectUri);
        if (parsed.pathname !== '/oauth2callback') {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const code = parsed.searchParams.get('code');
        const returnedState = parsed.searchParams.get('state');
        const error = parsed.searchParams.get('error');
        if (error) {
          res.statusCode = 400;
          res.end('Sign-in failed. You can close this tab.');
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }
        if (returnedState !== state) {
          res.statusCode = 400;
          res.end('State mismatch. You can close this tab.');
          server.close();
          reject(new Error('OAuth state mismatch'));
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(SUCCESS_PAGE);
        server.close();
        resolve(code);
      } catch (e) {
        try { res.statusCode = 500; res.end(); } catch {}
        try { server.close(); } catch {}
        reject(e);
      }
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1');

    // Safety timeout — abort if user never completes consent.
    setTimeout(() => {
      try { server.close(); } catch {}
      reject(new Error('Sign-in timed out (5 min).'));
    }, 5 * 60 * 1000).unref();
  });

  await shell.openExternal(authUrl);
  const code = await codePromise;
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('No refresh token returned. Revoke prior access in Google Account settings and try again.');
  }

  oauth2.setCredentials(tokens);
  // Fetch profile so we can display "Signed in as ...".
  const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
  let profile = null;
  try {
    const { data } = await oauth2Api.userinfo.get();
    profile = { email: data.email, name: data.name };
  } catch { /* non-fatal */ }

  await writeToken({ refreshToken: tokens.refresh_token, profile });
  cachedProfile = profile;
  cachedClient = oauth2;
  return { ok: true, profile };
}

async function signOut() {
  const t = await readToken();
  if (t?.refreshToken) {
    try {
      const oauth2 = buildOAuth2('http://127.0.0.1');
      await oauth2.revokeToken(t.refreshToken);
    } catch { /* ignore — we still drop it locally */ }
  }
  await clearToken();
  cachedClient = null;
  cachedProfile = null;
  return { ok: true };
}

// Returns an authenticated google.auth.OAuth2 client ready for API calls.
// Throws if the user is not signed in.
async function getAuthClient() {
  if (cachedClient) return cachedClient;
  if (!hasConfiguredClient()) {
    throw new Error('OAuth client not configured.');
  }
  const t = await readToken();
  if (!t || !t.refreshToken) {
    throw new Error('Not signed in to Google Drive.');
  }
  const oauth2 = buildOAuth2('http://127.0.0.1');
  oauth2.setCredentials({ refresh_token: t.refreshToken });
  cachedClient = oauth2;
  cachedProfile = t.profile || null;
  return oauth2;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

module.exports = {
  SCOPES,
  hasConfiguredClient,
  isSignedIn,
  getProfile,
  signIn,
  signOut,
  getAuthClient,
};
