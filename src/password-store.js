'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PW_VERSION = 1;
const IV_BYTES = 12;

function normalizeHost(h) {
  return String(h || '').toLowerCase().replace(/^www\./, '');
}

function deriveLocalKey(userId, machineId) {
  return crypto.pbkdf2Sync(
    `${machineId}:enigma-pw-v1:${userId}`,
    'enigma-password-store',
    100000,
    32,
    'sha256',
  );
}

function encryptSecret(key, plain) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  };
}

function decryptSecret(key, blob) {
  if (!blob?.data) return '';
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const data = Buffer.from(blob.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function passwordsPath(userDirFn, userId) {
  return path.join(userDirFn(userId), 'passwords.json');
}

function loadPasswordDoc(read, userDirFn, userId) {
  const raw = read(passwordsPath(userDirFn, userId), { v: PW_VERSION, entries: [] });
  return {
    v: PW_VERSION,
    entries: Array.isArray(raw.entries) ? raw.entries : [],
  };
}

function savePasswordDoc(write, userDirFn, userId, doc) {
  write(passwordsPath(userDirFn, userId), { v: PW_VERSION, entries: doc.entries || [] });
}

function listForHost(doc, sessionId, host, key) {
  const h = normalizeHost(host);
  return doc.entries
    .filter(e => e.sessionId === sessionId && normalizeHost(e.host) === h)
    .map(e => ({
      id: e.id,
      host: e.host,
      username: e.username,
      label: e.label || e.username,
      password: decryptSecret(key, e.secret),
      updated: e.updated || 0,
    }));
}

function upsertEntry(doc, { sessionId, host, username, password, label }, key) {
  const h = normalizeHost(host);
  const user = String(username || '').trim();
  if (!h || !user || !password) throw new Error('Host, username, and password required');
  const now = Date.now();
  let entry = doc.entries.find(
    e => e.sessionId === sessionId && normalizeHost(e.host) === h && e.username === user,
  );
  if (entry) {
    entry.secret = encryptSecret(key, password);
    entry.label = label || user;
    entry.updated = now;
  } else {
    entry = {
      id: `pw_${now}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      host: h,
      username: user,
      label: label || user,
      secret: encryptSecret(key, password),
      created: now,
      updated: now,
    };
    doc.entries.push(entry);
  }
  return entry;
}

function removeEntry(doc, id) {
  const before = doc.entries.length;
  doc.entries = doc.entries.filter(e => e.id !== id);
  return doc.entries.length < before;
}

function listBySession(doc, sessionId, key) {
  return doc.entries
    .filter(e => e.sessionId === sessionId)
    .map(e => ({
      id: e.id,
      host: e.host,
      username: e.username,
      label: e.label || e.username,
      password: decryptSecret(key, e.secret),
      updated: e.updated || 0,
    }))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

function exportPlain(doc, key) {
  return doc.entries.map(e => ({
    id: e.id,
    sessionId: e.sessionId,
    host: e.host,
    username: e.username,
    label: e.label || e.username,
    password: decryptSecret(key, e.secret),
    updated: e.updated || 0,
  }));
}

function importPlain(doc, entries, key) {
  for (const row of entries || []) {
    if (!row?.host || !row?.username || !row?.password || !row?.sessionId) continue;
    upsertEntry(doc, row, key);
  }
}

module.exports = {
  normalizeHost,
  deriveLocalKey,
  loadPasswordDoc,
  savePasswordDoc,
  listForHost,
  listBySession,
  upsertEntry,
  removeEntry,
  exportPlain,
  importPlain,
};
