const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
// Supabase REST configuration (works without external npm packages)
let rawSbUrl = process.env.SUPABASE_URL || 'https://hsnktehlsyowatovgecr.supabase.co';
rawSbUrl = rawSbUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const SB_REST_URL = rawSbUrl + '/rest/v1';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzbmt0ZWhsc3lvd2F0b3ZnZWNyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODQ1OTI4OCwiZXhwIjoyMTA0MDM1Mjg4fQ.PAuqiIWgsXIcSjEZ7yaNyY5EOMN_UG1lc1Mp4tvbApk';

const sbHeaders = {
  'apikey': SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Supabase Cloud Database Helpers (100% Supabase REST) ────────────────────
const FOR_WHO = process.env.FOR_WHO || 'havrest';

async function dbGetKeys() {
  try {
    const res = await fetch(`${SB_REST_URL}/license_keys?for_who=eq.${encodeURIComponent(FOR_WHO)}&select=*&order=id.desc`, {
      headers: { ...sbHeaders }
    });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    }
    const errText = await res.text();
    console.error('Supabase dbGetKeys error:', res.status, errText);
  } catch (e) {
    console.error('dbGetKeys network error:', e.message);
  }
  return [];
}

async function dbFindKey(keyStr) {
  if (!keyStr) return null;
  const target = keyStr.trim().toUpperCase();
  try {
    const res = await fetch(`${SB_REST_URL}/license_keys?key=ilike.${encodeURIComponent(target)}&for_who=eq.${encodeURIComponent(FOR_WHO)}&limit=1`, {
      headers: { ...sbHeaders }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data[0];
    }
  } catch (e) {
    console.error('dbFindKey error:', e.message);
  }
  return null;
}

async function dbFindKeyById(id) {
  if (id === undefined || id === null || id === '') return null;
  try {
    const res = await fetch(`${SB_REST_URL}/license_keys?id=eq.${encodeURIComponent(id)}&for_who=eq.${encodeURIComponent(FOR_WHO)}&limit=1`, {
      headers: { ...sbHeaders }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data[0];
    }
  } catch (e) {
    console.error('dbFindKeyById error:', e.message);
  }
  return null;
}

async function dbFindKeyByIdOrKey(identifier) {
  if (identifier === undefined || identifier === null || identifier === '') return null;
  const str = String(identifier).trim();
  if (/^\d+$/.test(str)) {
    const byId = await dbFindKeyById(str);
    if (byId) return byId;
  }
  return await dbFindKey(str);
}

async function dbUpdateKeyById(id, updates) {
  if (id === undefined || id === null || id === '') throw new Error('Key ID is required for update.');
  const res = await fetch(`${SB_REST_URL}/license_keys?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, 'Prefer': 'return=representation' },
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase update by ID error (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function dbSaveKey(keyObj) {
  if (keyObj && keyObj.id !== undefined && keyObj.id !== null) {
    const updated = await dbUpdateKeyById(keyObj.id, keyObj);
    return updated || keyObj;
  }
  const res = await fetch(`${SB_REST_URL}/license_keys`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Prefer': 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify(keyObj)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase save error (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return Array.isArray(data) && data.length > 0 ? data[0] : keyObj;
}

async function dbInsertKeys(newKeys) {
  const res = await fetch(`${SB_REST_URL}/license_keys`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Prefer': 'return=representation' },
    body: JSON.stringify(newKeys)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase insert error (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : newKeys;
}

async function dbDeleteKeyById(id) {
  if (id === undefined || id === null || id === '') throw new Error('Key ID is required for delete.');
  const res = await fetch(`${SB_REST_URL}/license_keys?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...sbHeaders }
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase delete by ID error (${res.status}): ${errText}`);
  }
}

async function dbDeleteKey(keyStr) {
  const target = (keyStr || '').trim();
  const res = await fetch(`${SB_REST_URL}/license_keys?key=ilike.${encodeURIComponent(target)}`, {
    method: 'DELETE',
    headers: { ...sbHeaders }
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase delete error (${res.status}): ${errText}`);
  }
}

async function dbDeleteExpired() {
  const nowIso = new Date().toISOString();
  try {
    await fetch(`${SB_REST_URL}/license_keys?expires_at=not.is.null&expires_at=lt.${encodeURIComponent(nowIso)}`, {
      method: 'DELETE',
      headers: { ...sbHeaders }
    });
    await fetch(`${SB_REST_URL}/license_keys?is_active=eq.false`, {
      method: 'DELETE',
      headers: { ...sbHeaders }
    });
    return 1;
  } catch (e) {
    console.error('dbDeleteExpired error:', e.message);
    return 0;
  }
}

async function dbAddLog(logObj) {
  try {
    await fetch(`${SB_REST_URL}/logs`, {
      method: 'POST',
      headers: { ...sbHeaders },
      body: JSON.stringify([{
        timestamp: logObj.timestamp || new Date().toISOString(),
        key: logObj.key,
        hwid: logObj.hwid,
        device: logObj.device,
        status: logObj.status
      }])
    });
  } catch (e) {
    console.error('dbAddLog error:', e.message);
  }
}

async function dbGetLogs(limit = 200) {
  try {
    const res = await fetch(`${SB_REST_URL}/logs?select=*&order=timestamp.desc&limit=${limit}`, {
      headers: { ...sbHeaders }
    });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {
    console.error('dbGetLogs error:', e.message);
  }
  return [];
}

async function dbClearLogs() {
  const res = await fetch(`${SB_REST_URL}/logs?id=gt.0`, {
    method: 'DELETE',
    headers: { ...sbHeaders }
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase clear logs error (${res.status}): ${errText}`);
  }
}

// ─── Admin Session & User Authentication (100% Supabase) ──────────────────────
const AUTH_SECRET = process.env.AUTH_SECRET || 'flashios_supabase_admin_secret_token_2026';

function generateSessionToken(username) {
  const payload = { username, exp: Date.now() + 7 * 86400 * 1000 };
  const str = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(str).digest('hex');
  return `${str}.${sig}`;
}

function verifySessionToken(token) {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [str, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(str).digest('hex');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

async function dbFindAdminUser(username, password) {
  const u = (username || '').trim();
  const p = (password || '').trim();
  if (!u || !p) return null;

  // 1. Query Supabase table "admin_users"
  try {
    const res = await fetch(`${SB_REST_URL}/admin_users?username=eq.${encodeURIComponent(u)}&password=eq.${encodeURIComponent(p)}&limit=1`, {
      headers: { ...sbHeaders }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data[0];
    }
  } catch (e) {
    console.error('dbFindAdminUser (admin_users) error:', e.message);
  }

  // 2. Query Supabase table "users"
  try {
    const res = await fetch(`${SB_REST_URL}/users?username=eq.${encodeURIComponent(u)}&password=eq.${encodeURIComponent(p)}&limit=1`, {
      headers: { ...sbHeaders }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data[0];
    }
  } catch (e) {
    console.error('dbFindAdminUser (users) error:', e.message);
  }

  return null;
}

// ─── Cookie & Auth Helper ───────────────────────────────────────────────────
function parseCookies(req) {
  const list = {};
  const rc = req && req.headers && req.headers.cookie;
  if (!rc) return list;
  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = (parts[0] || '').trim();
    if (name) {
      list[name] = decodeURIComponent(parts.slice(1).join('=').trim());
    }
  });
  return list;
}

// ─── Secret API Key & Auth Middleware ─────────────────────────────────────────
const API_SECRET_KEY = process.env.ADMIN_KEY || process.env.API_KEY || 'M)lST*}}0+V%^*c7JU+{DD[t<47-d;+&';
const MASTER_KEY     = API_SECRET_KEY;

function authMiddleware(req, res, next) {
  const cookies = parseCookies(req);
  const authHeader = (req.headers['authorization'] || '').trim();
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;

  const providedKey = (
    req.headers['x-admin-key'] ||
    req.headers['x-api-key'] ||
    req.headers['apikey'] ||
    req.query.key ||
    req.query.api_key ||
    req.query.admin_key ||
    (req.body && (req.body.admin_key || req.body.api_key || req.body.master_key)) ||
    bearerToken
  );

  // 1. Direct Master Key authorization: "just with key can crud"
  if (providedKey && String(providedKey).trim() === MASTER_KEY) {
    req.adminUser = 'master_admin';
    return next();
  }

  // 2. Session Token verification
  const token = bearerToken || req.query.token || cookies['admin_token'];
  const session = verifySessionToken(token);
  if (session) {
    req.adminUser = session.username;
    return next();
  }

  return res.status(401).json({
    status: 'error',
    message: 'Unauthorized. Provide master key (header: x-admin-key / apikey / Bearer, or ?key=) or valid credentials.'
  });
}

// ─── Admin Login API (User & Password from Table or Master Key) ───────────────
app.post('/api/admin/login', async (req, res) => {
  try {
    const body = req.body || {};
    const username = (body.username || body.user || '').trim();
    const password = (body.password || body.key || '').trim();

    if (!username && !password) {
      return res.status(400).json({ status: 'error', message: 'Please provide credentials or master key.' });
    }

    let user = null;
    if (password === MASTER_KEY || username === MASTER_KEY) {
      user = { username: 'master_admin' };
    } else {
      user = await dbFindAdminUser(username, password);
    }

    if (!user) {
      return res.status(401).json({ status: 'error', message: 'Invalid username, password, or master key.' });
    }

    // Update last_login in Supabase if supported
    try {
      await fetch(`${SB_REST_URL}/admin_users?username=eq.${encodeURIComponent(user.username)}`, {
        method: 'PATCH',
        headers: { ...sbHeaders },
        body: JSON.stringify({ last_login: new Date().toISOString() })
      });
    } catch (e) {}

    const token = generateSessionToken(user.username);
    res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; SameSite=Lax; Max-Age=604800; HttpOnly`);
    return res.json({
      status: 'success',
      token,
      username: user.username,
      message: 'Logged in successfully.'
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Login server error: ' + err.message });
  }
});

// ─── Admin Logout API ─────────────────────────────────────────────────────────
app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_token=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly');
  return res.json({ status: 'success', message: 'Logged out successfully.' });
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_token=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly');
  return res.redirect('/');
});

// ─── Key generator helper ─────────────────────────────────────────────────────
function generateRandomKey(prefix = 'VIP') {
  const seg1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const seg2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const seg3 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${seg1}-${seg2}-${seg3}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT API: VERIFY
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/verify', async (req, res) => {
  try {
    const body = req.body || {};
    const key = body.key || req.query.key;
    const hwid = body.hwid || req.query.hwid;
    const device_name = body.device_name || req.query.device_name;

    // Authenticate request access from the game client
    const authHeader = (req.headers['authorization'] || '').trim();
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;
    const clientKey = (
      req.headers['x-api-key'] ||
      req.headers['x-admin-key'] ||
      req.headers['apikey'] ||
      body.api_key ||
      req.query.api_key ||
      bearerToken ||
      ''
    ).trim();

    if (clientKey !== API_SECRET_KEY) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized request. Valid access key required.' });
    }

    if (!key || !String(key).trim())
      return res.json({ status: 'error', message: 'License key is required.' });

    const inputKey = key.trim();
    const deviceHwid = (hwid || '').trim();
    const keyObj = await dbFindKey(inputKey);

    if (!keyObj)
      return res.json({ status: 'error', message: 'Invalid or non-existent license key.' });
    if (keyObj.for_who && String(keyObj.for_who).toLowerCase() !== FOR_WHO.toLowerCase())
      return res.json({ status: 'error', message: 'License key not authorized for this application.' });
    if (!keyObj.is_active)
      return res.json({ status: 'error', message: 'License key is paused by admin.' });
    if (keyObj.expires_at && Date.now() > new Date(keyObj.expires_at).getTime())
      return res.json({ status: 'error', message: 'License key has expired.' });

    // HWID Binding
    if (keyObj.bound_hwid && keyObj.bound_hwid !== '') {
      if (deviceHwid && keyObj.bound_hwid !== deviceHwid)
        return res.json({ status: 'error', message: 'Key already bound to another device. Reset HWID on panel.' });
    } else {
      if (deviceHwid) {
        keyObj.bound_hwid = deviceHwid;
        keyObj.device_name = device_name || 'iOS Device';
        if (keyObj.duration_days > 0 && !keyObj.expires_at)
          keyObj.expires_at = new Date(Date.now() + keyObj.duration_days * 86400000).toISOString();
        await dbSaveKey(keyObj);
      }
    }

    let remainingDays = 'Lifetime';
    let expiryFormatted = 'Permanent / Lifetime';
    let remainingSeconds = null;
    if (keyObj.expires_at) {
      const diffMs = Math.max(0, new Date(keyObj.expires_at).getTime() - Date.now());
      const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      remainingDays = days > 0 ? `${days} Days, ${hours} Hours` : `${hours} Hours, ${minutes} Mins`;
      remainingSeconds = Math.floor(diffMs / 1000);
      const expDate = new Date(keyObj.expires_at);
      const yyyy = expDate.getFullYear();
      const mm = String(expDate.getMonth() + 1).padStart(2, '0');
      const dd = String(expDate.getDate()).padStart(2, '0');
      const hh = String(expDate.getHours()).padStart(2, '0');
      const min = String(expDate.getMinutes()).padStart(2, '0');
      const ss = String(expDate.getSeconds()).padStart(2, '0');
      expiryFormatted = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    }

    await dbAddLog({
      timestamp: new Date().toISOString(),
      key: keyObj.key,
      hwid: deviceHwid,
      device: device_name || 'Unknown',
      status: 'Success'
    });

    return res.json({ 
      status: 'success', 
      message: 'Key verified successfully', 
      expires_at: expiryFormatted, 
      remaining_days: remainingDays,
      remaining_seconds: remainingSeconds,
      raw_expiry: keyObj.expires_at || null
    });
  } catch (err) {
    return res.json({ status: 'error', message: 'Server error: ' + err.message });
  }
});

// CLIENT API: STATUS POLL (lightweight — no HWID rebinding side-effects)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  try {
    const key  = (req.query.key  || '').trim();
    const hwid = (req.query.hwid || '').trim();

    if (!key)
      return res.json({ status: 'error', message: 'Key required.' });

    const keyObj = await dbFindKey(key);

    if (!keyObj)
      return res.json({ status: 'invalid', message: 'Invalid key.' });

    if (!keyObj.is_active)
      return res.json({ status: 'paused', message: 'Your key has been paused by admin.' });

    if (keyObj.expires_at && Date.now() > new Date(keyObj.expires_at).getTime())
      return res.json({ status: 'expired', message: 'Your license key has expired.' });

    if (hwid && keyObj.bound_hwid && keyObj.bound_hwid !== hwid)
      return res.json({ status: 'hwid_mismatch', message: 'HWID mismatch — contact admin.' });

    return res.json({ status: 'active', message: 'Key is active.' });

  } catch (err) {
    return res.json({ status: 'error', message: 'Server error: ' + err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// ADMIN API
// ─────────────────────────────────────────────────────────────────────────────

// Stats + key list + logs
app.get('/api/admin/data', authMiddleware, async (req, res) => {
  try {
    const keys = await dbGetKeys();
    const logs = await dbGetLogs(200);
    const total = keys.length;
    let active = 0, expired = 0, bound = 0;
    keys.forEach(k => {
      if (!k.is_active || (k.expires_at && Date.now() > new Date(k.expires_at).getTime())) expired++;
      else active++;
      if (k.bound_hwid) bound++;
    });
    return res.json({ status: 'success', stats: { total, active, expired, bound }, keys, logs });
  } catch (err) {
    return res.json({ status: 'error', message: err.message });
  }
});

// Generate random keys
app.post('/api/admin/generate', authMiddleware, async (req, res) => {
  try {
    const { count = 1, duration_days = 30, prefix = 'VIP', note = '' } = req.body;
    const newKeys = [];
    for (let i = 0; i < count; i++) {
      const keyStr = generateRandomKey(prefix);
      const isLifetime = parseInt(duration_days) === 0;
      const keyItem = {
        key: keyStr,
        type: isLifetime ? 'lifetime' : `${duration_days}d`,
        duration_days: parseInt(duration_days),
        created_at: new Date().toISOString(),
        expires_at: null,
        bound_hwid: null,
        device_name: null,
        is_active: true,
        note: note || (isLifetime ? 'Lifetime' : `${duration_days} Days`),
        for_who: FOR_WHO
      };
      newKeys.push(keyItem);
    }
    await dbInsertKeys(newKeys);
    return res.json({ status: 'success', keys: newKeys });
  } catch (err) {
    return res.json({ status: 'error', message: err.message });
  }
});

// REST GET single key by ID or Key
app.get(['/api/admin/keys/:id', '/api/admin/key/:id'], authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const keyObj = await dbFindKeyByIdOrKey(id);
    if (!keyObj) return res.status(404).json({ status: 'error', message: 'Key not found.' });
    if (keyObj.for_who && keyObj.for_who !== FOR_WHO) return res.status(403).json({ status: 'error', message: 'Access denied.' });
    return res.json({ status: 'success', key: keyObj });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// Add a custom (manually typed) key / REST POST
app.post(['/api/admin/add-custom', '/api/admin/keys'], authMiddleware, async (req, res) => {
  try {
    const { key, duration_days = 30, note = '', id } = req.body;
    if (!key || !key.trim()) return res.json({ status: 'error', message: 'Key text is required.' });
    const keyStr = key.trim().toUpperCase();
    const existing = await dbFindKey(keyStr);
    if (existing)
      return res.json({ status: 'error', message: 'Key already exists.' });
    const isLifetime = parseInt(duration_days) === 0;
    const keyItem = {
      key: keyStr,
      type: isLifetime ? 'lifetime' : `${duration_days}d`,
      duration_days: parseInt(duration_days),
      created_at: new Date().toISOString(),
      expires_at: null,
      bound_hwid: null,
      device_name: null,
      is_active: true,
      note: note || (isLifetime ? 'Lifetime (Custom)' : `${duration_days} Days (Custom)`),
      for_who: FOR_WHO
    };
    if (id !== undefined && id !== null && id !== '') {
      keyItem.id = parseInt(id);
    }
    const inserted = await dbInsertKeys([keyItem]);
    return res.json({ status: 'success', key: inserted && inserted[0] ? inserted[0] : keyItem });
  } catch (err) {
    return res.json({ status: 'error', message: err.message });
  }
});

// Edit key by ID (or key fallback) - Supports POST /api/admin/edit and REST PUT/PATCH /api/admin/keys/:id
async function handleEditKey(req, res) {
  try {
    const body = req.body || {};
    const id = req.params.id || body.id || req.query.id;
    const keyParam = body.key || req.query.key;

    let keyObj = null;
    if (id !== undefined && id !== null && String(id).trim() !== '') {
      keyObj = await dbFindKeyById(String(id).trim());
    }
    if (!keyObj && keyParam) {
      keyObj = await dbFindKey(String(keyParam).trim());
    }
    if (!keyObj) return res.json({ status: 'error', message: 'Key not found.' });
    if (keyObj.for_who && keyObj.for_who !== FOR_WHO) return res.json({ status: 'error', message: 'Access denied.' });

    const updates = {};

    // Allow updating key text if ID is specified
    if (body.key && keyObj.id !== undefined && String(body.key).trim().toUpperCase() !== String(keyObj.key).trim().toUpperCase()) {
      const newKeyStr = String(body.key).trim().toUpperCase();
      const existing = await dbFindKey(newKeyStr);
      if (existing && existing.id !== keyObj.id) {
        return res.json({ status: 'error', message: `Key "${newKeyStr}" already exists.` });
      }
      updates.key = newKeyStr;
      keyObj.key = newKeyStr;
    }

    if (body.duration_days !== undefined) {
      const days = parseInt(body.duration_days);
      keyObj.duration_days = days;
      keyObj.type = days === 0 ? 'lifetime' : `${days}d`;
      updates.duration_days = days;
      updates.type = keyObj.type;
      if (days === 0) {
        keyObj.expires_at = null;
        updates.expires_at = null;
      } else if (keyObj.bound_hwid) {
        keyObj.expires_at = new Date(Date.now() + days * 86400000).toISOString();
        updates.expires_at = keyObj.expires_at;
      } else {
        keyObj.expires_at = null;
        updates.expires_at = null;
      }
    }

    if (body.expires_at !== undefined) {
      keyObj.expires_at = body.expires_at ? new Date(body.expires_at).toISOString() : null;
      updates.expires_at = keyObj.expires_at;
    }

    if (body.note !== undefined) {
      keyObj.note = body.note;
      updates.note = body.note;
    }

    if (body.is_active !== undefined) {
      keyObj.is_active = Boolean(body.is_active);
      updates.is_active = keyObj.is_active;
    }

    if (body.bound_hwid !== undefined) {
      keyObj.bound_hwid = body.bound_hwid || null;
      updates.bound_hwid = keyObj.bound_hwid;
    }

    if (body.device_name !== undefined) {
      keyObj.device_name = body.device_name || null;
      updates.device_name = keyObj.device_name;
    }

    let saved = null;
    if (keyObj.id !== undefined && keyObj.id !== null) {
      saved = await dbUpdateKeyById(keyObj.id, updates);
    } else {
      await dbSaveKey(keyObj);
      saved = keyObj;
    }

    return res.json({ status: 'success', key: saved || keyObj });
  } catch (err) {
    return res.json({ status: 'error', message: err.message });
  }
}
app.post('/api/admin/edit', authMiddleware, handleEditKey);
app.put(['/api/admin/keys/:id', '/api/admin/key/:id'], authMiddleware, handleEditKey);
app.patch(['/api/admin/keys/:id', '/api/admin/key/:id'], authMiddleware, handleEditKey);

// Reset HWID by ID or Key
async function handleResetHwid(req, res) {
  try {
    const id = req.params.id || (req.body && req.body.id) || req.query.id;
    const keyParam = (req.body && req.body.key) || req.query.key;

    let keyObj = null;
    if (id !== undefined && id !== null && String(id).trim() !== '') {
      keyObj = await dbFindKeyById(String(id).trim());
    }
    if (!keyObj && keyParam) {
      keyObj = await dbFindKey(String(keyParam).trim());
    }
    if (!keyObj) return res.json({ status: 'error', message: 'Key not found.' });
    if (keyObj.for_who && keyObj.for_who !== FOR_WHO) return res.json({ status: 'error', message: 'Access denied.' });

    if (keyObj.id !== undefined && keyObj.id !== null) {
      await dbUpdateKeyById(keyObj.id, { bound_hwid: null, device_name: null });
    } else {
      keyObj.bound_hwid = null;
      keyObj.device_name = null;
      await dbSaveKey(keyObj);
    }
    return res.json({ status: 'success', message: `HWID reset for ${keyObj.key} (ID #${keyObj.id || '?'})` });
  } catch (err) {
    return res.json({ status: 'error', message: err.message });
  }
}
app.post('/api/admin/reset-hwid', authMiddleware, handleResetHwid);
app.post(['/api/admin/keys/:id/reset-hwid', '/api/admin/key/:id/reset-hwid'], authMiddleware, handleResetHwid);

// Toggle enable/disable by ID or Key
async function handleToggle(req, res) {
  try {
    const id = req.params.id || (req.body && req.body.id) || req.query.id;
    const keyParam = (req.body && req.body.key) || req.query.key;

    let keyObj = null;
    if (id !== undefined && id !== null && String(id).trim() !== '') {
      keyObj = await dbFindKeyById(String(id).trim());
    }
    if (!keyObj && keyParam) {
      keyObj = await dbFindKey(String(keyParam).trim());
    }
    if (!keyObj) return res.json({ status: 'error', message: 'Key not found.' });
    if (keyObj.for_who && keyObj.for_who !== FOR_WHO) return res.json({ status: 'error', message: 'Access denied.' });

    const newActive = !keyObj.is_active;
    if (keyObj.id !== undefined && keyObj.id !== null) {
      await dbUpdateKeyById(keyObj.id, { is_active: newActive });
    } else {
      keyObj.is_active = newActive;
      await dbSaveKey(keyObj);
    }
    return res.json({ status: 'success', is_active: newActive, id: keyObj.id, key: keyObj.key });
  } catch (err) {
    return res.json({ status: 'error', message: err.message });
  }
}
app.post('/api/admin/toggle', authMiddleware, handleToggle);
app.post(['/api/admin/keys/:id/toggle', '/api/admin/key/:id/toggle'], authMiddleware, handleToggle);

// Delete key by ID or Key - Supports POST /api/admin/delete and REST DELETE /api/admin/keys/:id
async function handleDeleteKey(req, res) {
  try {
    const id = req.params.id || (req.body && req.body.id) || req.query.id;
    const keyParam = (req.body && req.body.key) || req.query.key;

    let keyObj = null;
    if (id !== undefined && id !== null && String(id).trim() !== '') {
      keyObj = await dbFindKeyById(String(id).trim());
    }
    if (!keyObj && keyParam) {
      keyObj = await dbFindKey(String(keyParam).trim());
    }
    if (!keyObj) return res.json({ status: 'error', message: 'Key not found.' });
    if (keyObj.for_who && keyObj.for_who !== FOR_WHO) return res.json({ status: 'error', message: 'Access denied.' });

    if (keyObj.id !== undefined && keyObj.id !== null) {
      await dbDeleteKeyById(keyObj.id);
    } else {
      await dbDeleteKey(keyObj.key);
    }
    return res.json({ status: 'success', message: `Key ${keyObj.key} (ID #${keyObj.id || '?'}) deleted.` });
  } catch (err) {
    return res.json({ status: 'error', message: err.message });
  }
}
app.post('/api/admin/delete', authMiddleware, handleDeleteKey);
app.delete(['/api/admin/keys/:id', '/api/admin/key/:id'], authMiddleware, handleDeleteKey);

// Delete all expired keys
app.post('/api/admin/delete-expired', authMiddleware, async (req, res) => {
  try {
    const removed = await dbDeleteExpired();
    return res.json({ status: 'success', message: `Deleted ${removed} expired/inactive key(s).` });
  } catch (err) {
    return res.json({ status: 'error', message: err.message });
  }
});

// Clear logs
app.post('/api/admin/clear-logs', authMiddleware, async (req, res) => {
  try {
    await dbClearLogs();
    return res.json({ status: 'success', message: 'Logs cleared.' });
  } catch (err) {
    return res.json({ status: 'error', message: err.message });
  }
});

// Change admin password in Supabase
app.post('/api/admin/change-password', authMiddleware, async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.trim().length < 4)
    return res.json({ status: 'error', message: 'New password must be at least 4 characters.' });
  const np = new_password.trim();
  const username = req.adminUser || 'admin';

  try {
    const r1 = await fetch(`${SB_REST_URL}/admin_users?username=eq.${encodeURIComponent(username)}`, {
      method: 'PATCH',
      headers: { ...sbHeaders },
      body: JSON.stringify({ password: np })
    });
    if (!r1.ok) {
      await fetch(`${SB_REST_URL}/users?username=eq.${encodeURIComponent(username)}`, {
        method: 'PATCH',
        headers: { ...sbHeaders },
        body: JSON.stringify({ password: np })
      });
    }
    const newToken = generateSessionToken(username);
    return res.json({ status: 'success', token: newToken, message: 'Password updated successfully in Supabase.' });
  } catch (err) {
    return res.json({ status: 'error', message: 'Supabase update error: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// WEB DASHBOARD HTML
// ─────────────────────────────────────────────────────────────────────────────
function renderDashboard(username, token) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FLASHIOS Web Auth Panel</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d0f17; --card-bg: #141724; --card-border: #23283e;
      --primary: #6c47ff; --primary-hover: #5835ea; --accent: #00d2ff;
      --text: #f0f2f8; --text-muted: #8b92ad;
      --success: #00e676; --danger: #ff3d71; --warning: #ffaa00;
    }
    * { margin:0; padding:0; box-sizing:border-box; font-family:'Plus Jakarta Sans',sans-serif; }
    body { background:var(--bg); color:var(--text); min-height:100vh; padding:20px; }
    .container { max-width:1280px; margin:0 auto; }

    /* ── Inputs ── */
    .input-field {
      width:100%; padding:12px 15px; background:#0e111c; border:1px solid var(--card-border);
      border-radius:10px; color:var(--text); font-size:14px; outline:none; margin-bottom:14px; transition:border .2s;
    }
    .input-field:focus { border-color:var(--primary); }
    select.input-field { cursor:pointer; }

    /* ── Buttons ── */
    .btn {
      padding:11px 18px; border-radius:10px; font-weight:600; cursor:pointer; border:none;
      transition:all .2s; font-size:13px; display:inline-flex; align-items:center; justify-content:center; gap:6px; text-decoration:none;
    }
    .btn-primary   { background:var(--primary); color:#fff; }
    .btn-primary:hover { background:var(--primary-hover); transform:translateY(-1px); }
    .btn-danger    { background:rgba(255,61,113,.15); color:var(--danger); border:1px solid rgba(255,61,113,.3); }
    .btn-danger:hover { background:var(--danger); color:#fff; }
    .btn-warning   { background:rgba(255,170,0,.15); color:var(--warning); border:1px solid rgba(255,170,0,.3); }
    .btn-warning:hover { background:var(--warning); color:#111; }
    .btn-success   { background:rgba(0,230,118,.15); color:var(--success); border:1px solid rgba(0,230,118,.3); }
    .btn-success:hover { background:var(--success); color:#111; }
    .btn-ghost     { background:rgba(255,255,255,.05); color:var(--text-muted); border:1px solid var(--card-border); }
    .btn-ghost:hover { background:rgba(255,255,255,.1); color:var(--text); }
    .btn-sm  { padding:5px 12px; font-size:12px; border-radius:7px; }
    .btn-xs  { padding:3px 8px; font-size:11px; border-radius:5px; }
    .btn-full { width:100%; }

    /* ── Header ── */
    header { display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; padding-bottom:16px; border-bottom:1px solid var(--card-border); }
    .logo-area h1 { font-size:22px; font-weight:800; background:linear-gradient(135deg,#a78bfa,#38bdf8); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
    .logo-area span { font-size:12px; color:var(--text-muted); }
    .header-actions { display:flex; gap:8px; align-items:center; }

    /* ── Tabs ── */
    .tabs { display:flex; gap:4px; margin-bottom:22px; border-bottom:1px solid var(--card-border); padding-bottom:0; }
    .tab-btn {
      padding:9px 18px; border:none; background:none; color:var(--text-muted); cursor:pointer;
      font-size:13px; font-weight:600; border-bottom:2px solid transparent; transition:all .2s; font-family:inherit;
    }
    .tab-btn.active { color:var(--primary); border-bottom-color:var(--primary); }
    .tab-content { display:none; }
    .tab-content.active { display:block; }

    /* ── Stats ── */
    .stats-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin-bottom:22px; }
    .stat-card { background:var(--card-bg); border:1px solid var(--card-border); border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:5px; }
    .stat-card .num { font-size:30px; font-weight:800; color:#fff; }
    .stat-card .label { font-size:12px; color:var(--text-muted); text-transform:uppercase; font-weight:600; }

    /* ── Layout ── */
    .layout { display:grid; grid-template-columns:320px 1fr; gap:20px; }
    @media(max-width:900px) { .layout { grid-template-columns:1fr; } }

    /* ── Cards ── */
    .card { background:var(--card-bg); border:1px solid var(--card-border); border-radius:14px; padding:22px; }
    .card h3 { font-size:16px; margin-bottom:14px; font-weight:700; color:#fff; }
    .form-group { margin-bottom:12px; }
    .form-group label { display:block; font-size:11px; font-weight:600; color:var(--text-muted); margin-bottom:5px; text-transform:uppercase; }

    /* ── Table ── */
    .table-wrap { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; text-align:left; font-size:12px; }
    th { padding:10px 12px; color:var(--text-muted); font-size:10px; text-transform:uppercase; border-bottom:1px solid var(--card-border); white-space:nowrap; }
    td { padding:10px 12px; border-bottom:1px solid #1a1e2f; vertical-align:middle; }
    tr:hover { background:rgba(255,255,255,.02); }
    .key-badge { font-family:monospace; font-size:12px; font-weight:700; color:#38bdf8; background:rgba(56,189,248,.1); padding:3px 7px; border-radius:6px; }
    .status-badge { display:inline-block; padding:2px 8px; border-radius:20px; font-size:10px; font-weight:700; }
    .status-active   { background:rgba(0,230,118,.15); color:var(--success); }
    .status-expired  { background:rgba(255,61,113,.15); color:var(--danger); }
    .status-disabled { background:rgba(139,146,173,.15); color:var(--text-muted); }
    .hwid-badge { font-family:monospace; font-size:10px; color:var(--text-muted); }

    /* ── Search bar ── */
    .search-bar { display:flex; gap:8px; margin-bottom:14px; }
    .search-bar .input-field { margin-bottom:0; flex:1; }

    /* ── Filter pills ── */
    .filter-pills { display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap; }
    .pill { padding:4px 12px; border-radius:20px; border:1px solid var(--card-border); background:none; color:var(--text-muted); cursor:pointer; font-size:11px; font-weight:600; font-family:inherit; transition:all .2s; }
    .pill.active { border-color:var(--primary); color:var(--primary); background:rgba(108,71,255,.12); }

    /* ── Modal ── */
    .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.75); display:none; align-items:center; justify-content:center; z-index:500; }
    .modal-overlay.open { display:flex; }
    .modal { background:var(--card-bg); border:1px solid var(--card-border); border-radius:16px; padding:28px; width:100%; max-width:460px; }
    .modal h3 { margin-bottom:18px; font-size:17px; }
    .modal-actions { display:flex; gap:8px; margin-top:18px; justify-content:flex-end; }

    /* ── Toast ── */
    #toast {
      position:fixed; bottom:22px; right:22px; padding:12px 20px; border-radius:10px;
      font-size:13px; font-weight:600; box-shadow:0 10px 25px rgba(0,0,0,.4);
      display:none; z-index:2000; transition:opacity .3s;
    }
    .toast-ok  { background:#00e676; color:#111; }
    .toast-err { background:#ff3d71; color:#fff; }

    /* ── Log table ── */
    .log-entry-success { color:var(--success); }
    .log-entry-error   { color:var(--danger); }

    /* ── Section divider ── */
    .section-divider { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
  </style>
</head>
<body>


<!-- Edit Key Modal -->
<div class="modal-overlay" id="editModal">
  <div class="modal">
    <h3>✏️ Edit Key</h3>
    <input type="hidden" id="editKeyId">
    <div class="form-group">
      <label>Database ID</label>
      <input type="text" id="editKeyIdDisplay" class="input-field" disabled style="color:var(--accent);font-weight:700;">
    </div>
    <div class="form-group">
      <label>License Key Text</label>
      <input type="text" id="editKeyDisplay" class="input-field" style="text-transform:uppercase;font-family:monospace;font-weight:600;">
    </div>
    <div class="form-group">
      <label>Duration (days, 0 = Lifetime)</label>
      <input type="number" id="editDuration" class="input-field" min="0">
    </div>
    <div class="form-group">
      <label>Set Exact Expiry Date (optional override)</label>
      <input type="datetime-local" id="editExpiry" class="input-field">
    </div>
    <div class="form-group">
      <label>Admin Note</label>
      <input type="text" id="editNote" class="input-field" placeholder="Customer name, order, etc.">
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal('editModal')">Cancel</button>
      <button class="btn btn-primary" onclick="saveEdit()">Save Changes</button>
    </div>
  </div>
</div>

<!-- Change Password Modal -->
<div class="modal-overlay" id="pwModal">
  <div class="modal">
    <h3>🔐 Change Admin Password</h3>
    <div class="form-group">
      <label>New Password</label>
      <input type="password" id="newPwInput" class="input-field" placeholder="Minimum 4 characters...">
    </div>
    <div class="form-group">
      <label>Confirm New Password</label>
      <input type="password" id="confirmPwInput" class="input-field" placeholder="Repeat password...">
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal('pwModal')">Cancel</button>
      <button class="btn btn-primary" onclick="changePassword()">Change Password</button>
    </div>
  </div>
</div>

<div class="container">
  <header>
    <div class="logo-area">
      <h1>FLASHIOS v4.5</h1>
      <span>License Management &amp; Web Auth Panel</span>
    </div>
    <div class="header-actions">
      <span style="font-size:12px; color:var(--text-muted); margin-right:4px;">👤 ${username || 'Admin'}</span>
      <button class="btn btn-ghost btn-sm" onclick="openModal('pwModal')">🔐 Password</button>
      <button class="btn btn-danger btn-sm" onclick="logout()">Logout</button>
    </div>
  </header>

  <!-- Stats -->
  <div class="stats-grid">
    <div class="stat-card">
      <span class="label">Total Keys</span>
      <span class="num" id="statTotal">0</span>
    </div>
    <div class="stat-card">
      <span class="label">Active Licenses</span>
      <span class="num" style="color:var(--success)" id="statActive">0</span>
    </div>
    <div class="stat-card">
      <span class="label">Bound Devices (HWID)</span>
      <span class="num" style="color:var(--accent)" id="statBound">0</span>
    </div>
    <div class="stat-card">
      <span class="label">Expired / Inactive</span>
      <span class="num" style="color:var(--danger)" id="statExpired">0</span>
    </div>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('tab-keys',this)">🔑 License Keys</button>
    <button class="tab-btn" onclick="switchTab('tab-generate',this)">➕ Generate</button>
    <button class="tab-btn" onclick="switchTab('tab-custom',this)">✍️ Custom Key</button>
    <button class="tab-btn" onclick="switchTab('tab-logs',this)">📋 Logs</button>
  </div>

  <!-- TAB: Keys -->
  <div id="tab-keys" class="tab-content active">
    <div class="card">
      <div class="section-divider">
        <h3 style="margin:0">📋 License Keys</h3>
        <div style="display:flex;gap:8px">
          <button class="btn btn-warning btn-sm" onclick="deleteExpired()">🗑 Remove Expired</button>
          <button class="btn btn-success btn-sm" onclick="exportCSV()">⬇ Export CSV</button>
          <button class="btn btn-sm btn-primary" onclick="loadData()">↻ Refresh</button>
        </div>
      </div>

      <div class="search-bar">
        <input type="text" id="searchInput" class="input-field" placeholder="Search key, HWID, device, note..." oninput="filterTable()">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('searchInput').value='';filterTable()">Clear</button>
      </div>
      <div class="filter-pills">
        <button class="pill active" data-filter="all" onclick="setPill(this)">All</button>
        <button class="pill" data-filter="active" onclick="setPill(this)">Active</button>
        <button class="pill" data-filter="expired" onclick="setPill(this)">Expired</button>
        <button class="pill" data-filter="disabled" onclick="setPill(this)">Disabled</button>
        <button class="pill" data-filter="bound" onclick="setPill(this)">Bound HWID</button>
        <button class="pill" data-filter="unbound" onclick="setPill(this)">Unbound</button>
        <button class="pill" data-filter="lifetime" onclick="setPill(this)">Lifetime</button>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:60px">ID</th>
              <th>License Key</th>
              <th>Type</th>
              <th>Status</th>
              <th>Device (HWID)</th>
              <th>Expires</th>
              <th>Note</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="keysTableBody"></tbody>
        </table>
      </div>
      <div id="keysCount" style="font-size:12px;color:var(--text-muted);margin-top:10px;"></div>
    </div>
  </div>

  <!-- TAB: Generate -->
  <div id="tab-generate" class="tab-content">
    <div class="layout">
      <div class="card">
        <h3>🎲 Generate Random Keys</h3>
        <div class="form-group">
          <label>Duration / Plan</label>
          <select id="genDuration" class="input-field">
            <option value="1">1 Day (Trial)</option>
            <option value="3">3 Days</option>
            <option value="7">7 Days (Weekly)</option>
            <option value="14">14 Days (2 Weeks)</option>
            <option value="30" selected>30 Days (Monthly)</option>
            <option value="60">60 Days (2 Months)</option>
            <option value="90">90 Days (3 Months)</option>
            <option value="180">180 Days (6 Months)</option>
            <option value="365">365 Days (1 Year)</option>
            <option value="0">Permanent (Lifetime)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Key Prefix</label>
          <input type="text" id="genPrefix" class="input-field" value="VIP">
        </div>
        <div class="form-group">
          <label>Quantity (1–50)</label>
          <input type="number" id="genCount" class="input-field" value="1" min="1" max="50">
        </div>
        <div class="form-group">
          <label>Admin Note</label>
          <input type="text" id="genNote" class="input-field" placeholder="Customer / Order #">
        </div>
        <button class="btn btn-primary btn-full" onclick="generateKeys()">⚡ Generate Keys</button>
        <div id="genResult" style="margin-top:14px;font-size:12px;color:var(--success)"></div>
      </div>

      <div class="card" id="genPreviewCard" style="display:none">
        <div class="section-divider">
          <h3 style="margin:0">Generated Keys</h3>
          <button class="btn btn-success btn-sm" onclick="copyGeneratedKeys()">📋 Copy All</button>
        </div>
        <div id="genPreviewList" style="font-family:monospace;font-size:13px;line-height:2;"></div>
      </div>
    </div>
  </div>

  <!-- TAB: Custom Key -->
  <div id="tab-custom" class="tab-content">
    <div style="max-width:500px">
      <div class="card">
        <h3>✍️ Add Custom Key</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Create a key with any text you want — e.g. a customer's name or a special code.</p>
        <div class="form-group">
          <label>Key Text</label>
          <input type="text" id="customKey" class="input-field" placeholder="e.g. MYKEY-GOLD or CUSTOMER123" style="text-transform:uppercase">
        </div>
        <div class="form-group">
          <label>Duration (days, 0 = Lifetime)</label>
          <select id="customDuration" class="input-field">
            <option value="1">1 Day</option>
            <option value="3">3 Days</option>
            <option value="7">7 Days</option>
            <option value="30" selected>30 Days</option>
            <option value="90">90 Days</option>
            <option value="365">1 Year</option>
            <option value="0">Lifetime</option>
          </select>
        </div>
        <div class="form-group">
          <label>Admin Note</label>
          <input type="text" id="customNote" class="input-field" placeholder="e.g. VIP Customer">
        </div>
        <button class="btn btn-primary btn-full" onclick="addCustomKey()">➕ Add Key</button>
      </div>
    </div>
  </div>

  <!-- TAB: Logs -->
  <div id="tab-logs" class="tab-content">
    <div class="card">
      <div class="section-divider">
        <h3 style="margin:0">📋 Verification Logs</h3>
        <button class="btn btn-danger btn-sm" onclick="clearLogs()">🗑 Clear All Logs</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Key</th>
              <th>Device</th>
              <th>HWID</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="logsTableBody"></tbody>
        </table>
      </div>
    </div>
  </div>

</div><!-- /container -->

<div id="toast"></div>

<script>
  let currentToken = '${token || ""}' || localStorage.getItem('flash_admin_token') || '';
  let allKeys = [];
  let allLogs = [];
  let currentFilter = 'all';
  let lastGeneratedKeys = [];

  // ── Toast ──
  function showToast(msg, ok = true) {
    const t = document.getElementById('toast');
    t.className = ok ? 'toast-ok' : 'toast-err';
    t.innerText = msg;
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 2800);
  }

  // ── Fetch helper with Auth Token ──
  async function api(path, body = null, method = 'POST') {
    const opts = {
      headers: {
        'Authorization': 'Bearer ' + (currentToken || '')
      }
    };
    if (body) {
      opts.method = method;
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    try {
      const r = await fetch(path, opts);
      if (r.status === 401) {
        logout();
        return { status: 'error', message: 'Unauthorized' };
      }
      return await r.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  // ── Load data ──
  async function loadData() {
    const data = await api('/api/admin/data');
    if (data.status !== 'success') return;

    // Stats
    document.getElementById('statTotal').innerText   = data.stats.total;
    document.getElementById('statActive').innerText  = data.stats.active;
    document.getElementById('statBound').innerText   = data.stats.bound;
    document.getElementById('statExpired').innerText = data.stats.expired;

    allKeys = data.keys;
    allLogs = data.logs;
    renderTable();
    renderLogs();
  }

  // ── Table rendering ──
  function getKeyStatus(k) {
    if (!k.is_active) return 'disabled';
    if (k.expires_at && new Date(k.expires_at) < new Date()) return 'expired';
    return 'active';
  }

  function renderTable() {
    const q = document.getElementById('searchInput').value.toLowerCase().trim();
    let keys = allKeys.filter(k => {
      const st = getKeyStatus(k);
      const fOk = currentFilter === 'all'      ? true
                : currentFilter === 'active'   ? st === 'active'
                : currentFilter === 'expired'  ? st === 'expired'
                : currentFilter === 'disabled' ? st === 'disabled'
                : currentFilter === 'bound'    ? !!k.bound_hwid
                : currentFilter === 'unbound'  ? !k.bound_hwid
                : currentFilter === 'lifetime' ? k.duration_days === 0
                : true;
      const sOk = !q || [String(k.id !== undefined ? k.id : ''), k.key, k.bound_hwid||'', k.device_name||'', k.note||''].join(' ').toLowerCase().includes(q);
      return fOk && sOk;
    });

    const tbody = document.getElementById('keysTableBody');
    tbody.innerHTML = '';
    keys.forEach((k, i) => {
      const st = getKeyStatus(k);
      const stBadge = st === 'active'   ? '<span class="status-badge status-active">Active</span>'
                    : st === 'expired'  ? '<span class="status-badge status-expired">Expired</span>'
                                        : '<span class="status-badge status-disabled">Disabled</span>';
      const hwidText = k.bound_hwid
        ? '<span class="hwid-badge" title="' + k.bound_hwid + '">📱 ' + k.bound_hwid.substring(0,10) + '... (' + (k.device_name||'iOS') + ')</span>'
        : '<span style="color:#555">Unbound</span>';
      const expText = k.expires_at
        ? new Date(k.expires_at).toLocaleDateString()
        : (k.duration_days === 0 ? 'Lifetime' : 'Unused (' + k.duration_days + 'd)');
      const keyIdVal = k.id !== undefined && k.id !== null ? k.id : '';

      const tr = document.createElement('tr');
      tr.innerHTML = \`
        <td style="color:var(--accent);font-weight:700;font-size:12px">#\${k.id !== undefined ? k.id : (i+1)}</td>
        <td>
          <span class="key-badge">\${k.key}</span>
          <button class="btn btn-xs btn-ghost" style="margin-left:4px" onclick="copyText('\${k.key}')">📋</button>
        </td>
        <td><strong>\${(k.type||'').toUpperCase()}</strong></td>
        <td>\${stBadge}</td>
        <td>\${hwidText}</td>
        <td style="font-size:11px;color:var(--text-muted)">\${expText}</td>
        <td style="font-size:11px;color:var(--text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\${k.note||''}">\${k.note||'—'}</td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <button class="btn btn-xs btn-ghost" onclick="openEdit(\${keyIdVal !== '' ? keyIdVal : '\\'' + k.key + '\\''})" title="Edit Key (ID #\${k.id})">✏️</button>
            \${k.bound_hwid ? '<button class="btn btn-xs btn-warning" onclick="resetHwid(' + (keyIdVal !== '' ? keyIdVal : '\\'' + k.key + '\\'') + ')" title="Reset HWID">↺ HWID</button>' : ''}
            <button class="btn btn-xs \${k.is_active ? 'btn-warning' : 'btn-success'}" onclick="toggleKey(' + (keyIdVal !== '' ? keyIdVal : '\\'' + k.key + '\\'') + ')" title="\${k.is_active ? 'Disable Key' : 'Enable Key'}">\${k.is_active ? '⏸' : '▶'}</button>
            <button class="btn btn-xs btn-danger" onclick="deleteKey(' + (keyIdVal !== '' ? keyIdVal : '\\'' + k.key + '\\'') + ', \\'' + k.key + '\\')" title="Delete Key">✕</button>
          </div>
        </td>
      \`;
      tbody.appendChild(tr);
    });
    document.getElementById('keysCount').innerText = keys.length + ' key(s) shown of ' + allKeys.length + ' total';
  }

  function filterTable() { renderTable(); }
  function setPill(el) {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    currentFilter = el.dataset.filter;
    renderTable();
  }

  // ── Logs ──
  function renderLogs() {
    const tbody = document.getElementById('logsTableBody');
    tbody.innerHTML = '';
    allLogs.forEach(l => {
      const tr = document.createElement('tr');
      const t = new Date(l.timestamp);
      tr.innerHTML = \`
        <td style="font-size:11px;white-space:nowrap;color:var(--text-muted)">\${t.toLocaleDateString()} \${t.toLocaleTimeString()}</td>
        <td><span class="key-badge">\${l.key}</span></td>
        <td style="font-size:11px">\${l.device||'?'}</td>
        <td class="hwid-badge" style="font-size:10px">\${l.hwid ? l.hwid.substring(0,14)+'...' : '—'}</td>
        <td><span class="status-badge \${l.status==='Success'?'status-active':'status-expired'}">\${l.status}</span></td>
      \`;
      tbody.appendChild(tr);
    });
  }

  // ── Tabs ──
  function switchTab(id, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    btn.classList.add('active');
  }

  // ── Generate ──
  async function generateKeys() {
    const duration_days = document.getElementById('genDuration').value;
    const prefix = document.getElementById('genPrefix').value;
    const count = document.getElementById('genCount').value;
    const note = document.getElementById('genNote').value;
    const data = await api('/api/admin/generate', { duration_days, prefix, count, note });
    if (data.status === 'success') {
      showToast('Generated ' + data.keys.length + ' key(s)!');
      lastGeneratedKeys = data.keys.map(k => k.key);
      const preview = document.getElementById('genPreviewList');
      preview.innerHTML = data.keys.map(k => '<div style="color:#38bdf8">' + k.key + ' (ID #' + (k.id || 'new') + ')</div>').join('');
      document.getElementById('genPreviewCard').style.display = 'block';
      document.getElementById('genResult').innerText = '✅ ' + data.keys.length + ' key(s) created successfully.';
      loadData();
    } else { showToast(data.message, false); }
  }

  function copyGeneratedKeys() {
    navigator.clipboard.writeText(lastGeneratedKeys.join('\n'));
    showToast('Copied ' + lastGeneratedKeys.length + ' keys!');
  }

  // ── Custom Key ──
  async function addCustomKey() {
    const key = document.getElementById('customKey').value;
    const duration_days = document.getElementById('customDuration').value;
    const note = document.getElementById('customNote').value;
    if (!key.trim()) { showToast('Enter a key name!', false); return; }
    const data = await api('/api/admin/add-custom', { key, duration_days, note });
    if (data.status === 'success') {
      showToast('Custom key added: ' + data.key.key + ' (ID #' + (data.key.id || '') + ')');
      document.getElementById('customKey').value = '';
      document.getElementById('customNote').value = '';
      loadData();
    } else { showToast(data.message, false); }
  }

  // ── Edit Modal (Lookup by ID or Key) ──
  function openEdit(idOrKey) {
    const k = allKeys.find(x => x.id == idOrKey || x.key === idOrKey);
    if (!k) return;
    document.getElementById('editKeyId').value = k.id !== undefined ? k.id : '';
    document.getElementById('editKeyIdDisplay').value = k.id !== undefined ? '#' + k.id : 'N/A';
    document.getElementById('editKeyDisplay').value = k.key;
    document.getElementById('editDuration').value = k.duration_days;
    document.getElementById('editNote').value = k.note || '';
    document.getElementById('editExpiry').value = k.expires_at ? new Date(k.expires_at).toISOString().slice(0,16) : '';
    openModal('editModal');
  }

  async function saveEdit() {
    const id = document.getElementById('editKeyId').value;
    const key = document.getElementById('editKeyDisplay').value.trim();
    const duration_days = document.getElementById('editDuration').value;
    const note = document.getElementById('editNote').value;
    const expiry_raw = document.getElementById('editExpiry').value;
    const expires_at = expiry_raw ? new Date(expiry_raw).toISOString() : null;
    const data = await api('/api/admin/edit', { id, key, duration_days, note, expires_at });
    if (data.status === 'success') {
      showToast('Key updated successfully!');
      closeModal('editModal');
      loadData();
    } else { showToast(data.message, false); }
  }

  // ── Actions by ID ──
  async function resetHwid(idOrKey) {
    const k = allKeys.find(x => x.id == idOrKey || x.key === idOrKey);
    const label = k ? (k.key + ' (#' + k.id + ')') : '#' + idOrKey;
    if (!confirm('Reset HWID for ' + label + '?')) return;
    const data = await api('/api/admin/reset-hwid', { id: idOrKey, key: k ? k.key : undefined });
    showToast(data.message, data.status === 'success');
    loadData();
  }

  async function toggleKey(idOrKey) {
    const k = allKeys.find(x => x.id == idOrKey || x.key === idOrKey);
    const data = await api('/api/admin/toggle', { id: idOrKey, key: k ? k.key : undefined });
    showToast(data.is_active ? 'Key enabled' : 'Key disabled', true);
    loadData();
  }

  async function deleteKey(idOrKey, keyName) {
    const label = keyName ? (keyName + ' (#' + idOrKey + ')') : '#' + idOrKey;
    if (!confirm('Delete key ' + label + '?')) return;
    const data = await api('/api/admin/delete', { id: idOrKey, key: keyName });
    showToast(data.message, data.status === 'success');
    loadData();
  }

  async function deleteExpired() {
    if (!confirm('Remove all expired and disabled keys?')) return;
    const data = await api('/api/admin/delete-expired', {});
    showToast(data.message, data.status === 'success');
    loadData();
  }

  async function clearLogs() {
    if (!confirm('Clear all verification logs?')) return;
    const data = await api('/api/admin/clear-logs', {});
    showToast(data.message, data.status === 'success');
    loadData();
  }

  // ── Change password ──
  async function changePassword() {
    const np = document.getElementById('newPwInput').value;
    const cp = document.getElementById('confirmPwInput').value;
    if (!np || np.length < 4) { showToast('Password must be at least 4 chars', false); return; }
    if (np !== cp) { showToast('Passwords do not match', false); return; }
    const data = await api('/api/admin/change-password', { new_password: np });
    if (data.status === 'success') {
      showToast('Password changed! Please log in again.');
      currentToken = np;
      localStorage.setItem('flash_admin_token', np);
      closeModal('pwModal');
    } else { showToast(data.message, false); }
  }

  // ── Export CSV ──
  function exportCSV() {
    const header = 'ID,Key,Type,Status,BoundHWID,Device,Expires,Note';
    const rows = allKeys.map(k => {
      const st = getKeyStatus(k);
      const exp = k.expires_at ? new Date(k.expires_at).toLocaleDateString() : (k.duration_days === 0 ? 'Lifetime' : 'Unused');
      return [k.id !== undefined ? k.id : '', k.key, k.type, st, k.bound_hwid||'', k.device_name||'', exp, k.note||''].map(v => '"'+String(v).replace(/"/g,'""')+'"').join(',');
    });
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flashios_keys_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
  }

  // ── Auth & Helpers ──
  async function logout() {
    localStorage.removeItem('flash_admin_token');
    document.cookie = 'admin_token=; path=/; max-age=0; SameSite=Lax';
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch (e) {}
    window.location.href = '/';
  }

  function copyText(text) { navigator.clipboard.writeText(text); showToast('Copied!'); }
  function openModal(id)  { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }

  // ── Init ──
  loadData();
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECURE LOGIN PAGE HTML (Returned when unauthenticated)
// ─────────────────────────────────────────────────────────────────────────────
function renderLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FLASHIOS Admin Login</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d0f17;
      --card-bg: #141724;
      --card-border: #23283e;
      --primary: #6c47ff;
      --primary-hover: #5835ea;
      --accent: #00d2ff;
      --text: #f0f2f8;
      --text-muted: #8b92ad;
      --danger: #ff3d71;
    }
    * { margin:0; padding:0; box-sizing:border-box; font-family:'Plus Jakarta Sans',sans-serif; }
    body {
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .login-box {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 18px;
      padding: 40px;
      width: 100%;
      max-width: 420px;
      text-align: center;
      box-shadow: 0 24px 48px rgba(0,0,0,0.6);
    }
    .login-box h2 {
      font-size: 28px;
      margin-bottom: 6px;
      background: linear-gradient(135deg,#6c47ff,#00d2ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 800;
    }
    .login-box p { color: var(--text-muted); font-size: 14px; margin-bottom: 24px; }
    .form-group { margin-bottom: 14px; text-align: left; }
    .form-group label { display: block; font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 5px; text-transform: uppercase; }
    .input-field {
      width: 100%; padding: 12px 15px; background: #0e111c; border: 1px solid var(--card-border);
      border-radius: 10px; color: var(--text); font-size: 14px; outline: none; transition: border .2s;
    }
    .input-field:focus { border-color: var(--primary); }
    .btn {
      width: 100%; padding: 12px; border-radius: 10px; font-weight: 700; cursor: pointer; border: none;
      transition: all .2s; font-size: 15px; background: var(--primary); color: #fff;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; margin-top: 6px;
    }
    .btn:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    #loginErr {
      color: var(--danger); font-size: 13px; margin-bottom: 16px;
      background: rgba(255,61,113,0.1); border: 1px solid rgba(255,61,113,0.25);
      border-radius: 8px; padding: 10px; display: none; text-align: left;
    }
  </style>
</head>
<body>
  <div class="login-box">
    <h2>⚡ FLASHIOS</h2>
    <p>Admin Login — Sign In to Continue</p>
    <div id="loginErr"></div>
    <form id="loginForm" onsubmit="handleLogin(event)">
      <div class="form-group">
        <label>Username</label>
        <input type="text" id="username" class="input-field" placeholder="Enter username..." required autofocus autocomplete="username">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="password" class="input-field" placeholder="Enter password..." required autocomplete="current-password">
      </div>
      <button type="submit" id="loginBtn" class="btn">🔓 Sign In to Panel</button>
    </form>
  </div>
  <script>
    (function() {
      const savedToken = localStorage.getItem('flash_admin_token');
      if (savedToken && !sessionStorage.getItem('reloaded_auth')) {
        sessionStorage.setItem('reloaded_auth', '1');
        document.cookie = 'admin_token=' + encodeURIComponent(savedToken) + '; path=/; max-age=604800; SameSite=Lax';
        window.location.reload();
      }
    })();

    async function handleLogin(e) {
      if (e) e.preventDefault();
      const u = document.getElementById('username').value.trim();
      const p = document.getElementById('password').value.trim();
      const btn = document.getElementById('loginBtn');
      const err = document.getElementById('loginErr');
      if (!u || !p) return;
      btn.disabled = true;
      btn.innerText = 'Verifying...';
      err.style.display = 'none';
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
          sessionStorage.removeItem('reloaded_auth');
          if (data.token) {
            localStorage.setItem('flash_admin_token', data.token);
            document.cookie = 'admin_token=' + encodeURIComponent(data.token) + '; path=/; max-age=604800; SameSite=Lax';
          }
          window.location.reload();
        } else {
          err.innerText = data.message || 'Invalid username or password.';
          err.style.display = 'block';
        }
      } catch (e) {
        err.innerText = 'Network error: ' + e.message;
        err.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.innerText = '🔓 Sign In to Panel';
      }
    }
  </script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// WEB DASHBOARD ROUTE (Server-Side Protected)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const cookies = parseCookies(req);
  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;
  const token = (
    req.headers['x-admin-key'] ||
    req.headers['x-api-key'] ||
    req.query.key ||
    req.query.api_key ||
    req.query.token ||
    cookies['admin_token'] ||
    bearerToken ||
    ''
  ).trim();

  if (token === MASTER_KEY) {
    const sessionToken = generateSessionToken('master_admin');
    res.setHeader('Set-Cookie', `admin_token=${sessionToken}; Path=/; SameSite=Lax; Max-Age=604800; HttpOnly`);
    return res.send(renderDashboard('master_admin', sessionToken));
  }

  const session = verifySessionToken(token);
  if (!session) {
    return res.send(renderLoginPage());
  }

  return res.send(renderDashboard(session.username, token));
});

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 FLASHIOS Web Auth Panel running on port ${PORT}`);
    console.log(`🌐 Web Dashboard : http://localhost:${PORT}`);
    console.log(`🔑 Verify API    : http://localhost:${PORT}/api/verify`);
    console.log(`🗄️ Database      : Supabase Cloud (${rawSbUrl})`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
