'use strict';

const crypto = require('crypto');

const SYNC_VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const PBKDF2_ITERS = 120000;

function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(String(passphrase), salt, PBKDF2_ITERS, KEY_BYTES, 'sha256');
}

function encryptVault(passphrase, payload) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = JSON.stringify({ v: SYNC_VERSION, exportedAt: Date.now(), data: payload });
  const enc = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    format: 'enigma-vault-v1',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: enc.toString('base64'),
  };
}

function decryptVault(passphrase, vault) {
  if (!vault || vault.format !== 'enigma-vault-v1') throw new Error('Invalid vault format');
  const salt = Buffer.from(vault.salt, 'base64');
  const iv = Buffer.from(vault.iv, 'base64');
  const tag = Buffer.from(vault.tag, 'base64');
  const ciphertext = Buffer.from(vault.ciphertext, 'base64');
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const parsed = JSON.parse(plain);
  if (!parsed?.data) throw new Error('Vault payload missing');
  return parsed.data;
}

module.exports = {
  SYNC_VERSION,
  encryptVault,
  decryptVault,
};
