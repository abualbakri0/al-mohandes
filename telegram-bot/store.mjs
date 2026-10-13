// store.mjs — تخزين المشتركين وبيانات الإصدار (JSON على القرص)
// ============================================================
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { config } from './config.mjs';

function ensureDir() {
  if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`تعذّر قراءة ${file}:`, e.message);
  }
  return fallback;
}

function writeJson(file, data) {
  ensureDir();
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// -------------------- المشتركون --------------------
// subscribers: { [userId]: { id, first_name, last_name, username, joinedAt, blocked } }
export function loadSubscribers() {
  return readJson(config.subscribersFile, {});
}

export function saveSubscribers(subscribers) {
  writeJson(config.subscribersFile, subscribers);
}

export function addSubscriber(user) {
  const subs = loadSubscribers();
  const existed = Boolean(subs[user.id]);
  subs[user.id] = {
    id: user.id,
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    username: user.username || '',
    joinedAt: existed ? subs[user.id].joinedAt : new Date().toISOString(),
    blocked: false,
  };
  saveSubscribers(subs);
  return { subscribers: subs, isNew: !existed };
}

export function markBlocked(userId) {
  const subs = loadSubscribers();
  if (subs[userId]) {
    subs[userId].blocked = true;
    saveSubscribers(subs);
  }
}

export function activeSubscriberIds() {
  const subs = loadSubscribers();
  return Object.values(subs)
    .filter((s) => !s.blocked)
    .map((s) => s.id);
}

// -------------------- بيانات الإصدار --------------------
// meta: { versionName, versionCode, apkFile, changelog, updatedAt, size }
const defaultMeta = {
  versionName: null,
  versionCode: null,
  apkFile: null,
  changelog: '',
  updatedAt: null,
  size: null,
};

export function loadMeta() {
  const meta = { ...defaultMeta, ...readJson(config.metaFile, {}) };
  return meta;
}

export function saveMeta(meta) {
  writeJson(config.metaFile, meta);
}
