// Sincronización con Google Drive (OAuth 2.0 flujo implícito por redirección + Drive API v3).
// Se usa redirección (no ventana emergente) porque es lo que funciona de forma fiable en
// una web app instalada en la pantalla de inicio del iPhone.

import { CONFIG } from './config.js';
import * as store from './store.js';

const LS = {
  token: 'cp.drive.token',
  exp: 'cp.drive.exp',
  fileId: 'cp.drive.fileId',
  email: 'cp.drive.email',
  clientId: 'cp.drive.clientId',
  connected: 'cp.drive.connected',
  lastSync: 'cp.drive.lastSync',
  dirty: 'cp.drive.dirty',
};
const SCOPE = 'https://www.googleapis.com/auth/drive openid email';
const FILE_NAME = 'contabilidad-personal.json';
export const NO_DRIVE_MSG =
  'Google no ha concedido acceso a Drive. Pulsa «Reconectar» y, en la pantalla de Google, marca la casilla «Ver, editar, crear y eliminar todos tus archivos de Google Drive».';

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

let status = { state: 'off', msg: 'Sin conectar' };
const statusListeners = new Set();
function setStatus(state, msg) {
  status = { state, msg };
  statusListeners.forEach((fn) => fn(status));
}
export const onStatus = (fn) => { statusListeners.add(fn); fn(status); };
export const getStatus = () => status;

export const clientId = () => ls.get(LS.clientId) || CONFIG.GOOGLE_CLIENT_ID || '';
export const setClientId = (v) => ls.set(LS.clientId, v?.trim() || null);
export const redirectUri = () => location.origin + location.pathname;
export const isConnected = () => ls.get(LS.connected) === '1';
export const email = () => ls.get(LS.email);
export const fileId = () => ls.get(LS.fileId);
export const lastSync = () => ls.get(LS.lastSync);
export const markDirty = () => ls.set(LS.dirty, '1');

function token() {
  const t = ls.get(LS.token);
  const exp = Number(ls.get(LS.exp) || 0);
  return t && Date.now() < exp - 60_000 ? t : null;
}

// ---------- OAuth ----------
export function login({ silent = false } = {}) {
  const id = clientId();
  if (!id) throw new Error('Falta el ID de cliente de Google (Ajustes).');
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem('cp.oauth.state', state);
  sessionStorage.setItem('cp.oauth.silent', silent ? '1' : '0');
  const p = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (silent) p.set('prompt', 'none');
  // 'consent' fuerza a Google a mostrar de nuevo la casilla de permiso de Drive
  else p.set('prompt', 'consent select_account');
  const hint = email();
  if (hint) p.set('login_hint', hint);
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString());
}

// Llamar al arrancar: recoge el token que Google devuelve en el #hash
export function handleRedirect() {
  if (!location.hash.includes('access_token') && !location.hash.includes('error=')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  const expected = sessionStorage.getItem('cp.oauth.state');
  if (p.get('state') !== expected) return { error: 'Respuesta de Google no válida (state).' };
  if (p.get('error')) {
    if (sessionStorage.getItem('cp.oauth.silent') === '1') return { error: 'silent', needsLogin: true };
    return { error: p.get('error') };
  }
  ls.set(LS.token, p.get('access_token'));
  ls.set(LS.exp, String(Date.now() + Number(p.get('expires_in') || 3600) * 1000));
  ls.set(LS.connected, '1');
  // Google permite desmarcar permisos: comprobamos que se concedió el de Drive
  const granted = p.get('scope') || '';
  if (!granted.includes('auth/drive')) {
    ls.set(LS.token, null);
    return { error: 'nodrive' };
  }
  return { ok: true };
}

export function logout() {
  const t = ls.get(LS.token);
  if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + t, { method: 'POST' }).catch(() => {});
  [LS.token, LS.exp, LS.connected, LS.fileId, LS.email, LS.lastSync].forEach((k) => ls.set(k, null));
  setStatus('off', 'Sin conectar');
}

// ---------- Drive API ----------
async function api(url, opts = {}) {
  const t = token();
  if (!t) {
    const e = new Error('Sesión de Google caducada');
    e.code = 'auth';
    throw e;
  }
  const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (res.status === 401) {
    ls.set(LS.token, null);
    const e = new Error('Sesión de Google caducada');
    e.code = 'auth';
    throw e;
  }
  if (res.status === 403) {
    let j = null;
    try { j = await res.clone().json(); } catch {}
    const m = j?.error?.message || '';
    if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(m + JSON.stringify(j?.error?.details || ''))) {
      ls.set(LS.token, null);
      const e = new Error('Falta el permiso de Google Drive');
      e.code = 'scope';
      throw e;
    }
  }
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try { msg = (await res.json()).error.message || msg; } catch {}
    throw new Error(msg);
  }
  return res;
}

async function fetchEmail() {
  try {
    const r = await api('https://www.googleapis.com/oauth2/v3/userinfo');
    const j = await r.json();
    if (j.email) ls.set(LS.email, j.email);
  } catch {}
}

async function findFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&fields=files(id,name,owners(emailAddress),modifiedTime)&pageSize=10`);
  const j = await r.json();
  return j.files || [];
}

async function download(id) {
  const r = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function upload(id, data) {
  const body = JSON.stringify(data);
  if (id) {
    await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return id;
  }
  const boundary = 'cp' + Math.random().toString(36).slice(2);
  const meta = { name: FILE_NAME, mimeType: 'application/json', description: 'Base de datos de la app Contabilidad Personal' };
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  return (await r.json()).id;
}

export function parseFileId(input) {
  const s = (input || '').trim();
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
}

export function useFile(id) {
  ls.set(LS.fileId, id);
}

export async function shareWith(address) {
  const id = fileId();
  if (!id) throw new Error('Primero sincroniza para crear el archivo.');
  await api(`https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: address.trim() }),
  });
}

export async function fileInfo() {
  const id = fileId();
  if (!id || !token()) return null;
  const r = await api(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,webViewLink,owners(emailAddress,displayName),permissions(emailAddress,role,displayName)`);
  return r.json();
}

// ---------- Sincronización ----------
let syncing = null;
export async function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    if (!isConnected()) { setStatus('off', 'Sin conectar'); return; }
    if (!navigator.onLine) { setStatus('offline', 'Sin conexión: los cambios se guardan en el móvil'); return; }
    if (!token()) { setStatus('auth', 'Toca para reconectar con Google'); return; }
    setStatus('busy', 'Sincronizando…');
    try {
      if (!email()) await fetchEmail();
      let id = fileId();
      if (!id) {
        const files = await findFile();
        if (files.length) { id = files[0].id; ls.set(LS.fileId, id); }
      }
      let remote = null;
      if (id) {
        try { remote = await download(id); }
        catch (e) { if (/not found|404/i.test(e.message)) { id = null; ls.set(LS.fileId, null); } else throw e; }
      }
      // Un dispositivo recién instalado adopta los datos de la nube tal cual
      const merged = remote && store.get().pristine ? remote : store.merge(remote, store.get());
      store.replace(merged);
      const newId = await upload(id, merged);
      ls.set(LS.fileId, newId);
      ls.set(LS.dirty, null);
      ls.set(LS.lastSync, new Date().toISOString());
      setStatus('ok', 'Sincronizado');
    } catch (e) {
      if (e.code === 'auth') setStatus('auth', 'Toca para reconectar con Google');
      else if (e.code === 'scope') setStatus('auth', NO_DRIVE_MSG);
      else setStatus('error', 'Error de sincronización: ' + e.message);
      console.error(e);
    }
  })();
  try { await syncing; } finally { syncing = null; }
}

let timer = null;
export function scheduleSync(delay = 2500) {
  markDirty();
  clearTimeout(timer);
  timer = setTimeout(sync, delay);
}

// Al abrir la app: si la sesión caducó, intenta renovarla en silencio (una vez por arranque).
export function autoReconnect() {
  if (!isConnected() || token() || !navigator.onLine || !clientId()) return false;
  const last = Number(sessionStorage.getItem('cp.oauth.silentAt') || 0);
  if (Date.now() - last < 5 * 60_000) return false; // evita bucles
  sessionStorage.setItem('cp.oauth.silentAt', String(Date.now()));
  login({ silent: true });
  return true;
}

// El usuario desmarcó el permiso de Drive en la pantalla de Google
export function flagNoDrive() {
  setStatus('auth', NO_DRIVE_MSG);
}
