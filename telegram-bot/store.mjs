// store.mjs — تخزين المشتركين وبيانات الإصدار
// ============================================================
// الطبقة الفعلية الآن في db.mjs (Supabase + ذاكرة مؤقتة + بديل محلي).
// نحافظ هنا على نفس أسماء الدوال المتزامنة التي يستخدمها bot.mjs و panel.mjs.
//
// subscribers: { [userId]: { id, first_name, last_name, username, joinedAt, blocked } }
// meta: { versionName, versionCode, apkFile, changelog, updatedAt, size }

import { getRaw, setRaw } from './db.mjs';

// -------------------- المشتركون --------------------
export function loadSubscribers() {
  return getRaw('subscribers') || {};
}

export function saveSubscribers(subscribers) {
  setRaw('subscribers', subscribers);
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
const defaultMeta = {
  versionName: null,
  versionCode: null,
  apkFile: null,
  changelog: '',
  updatedAt: null,
  size: null,
};

export function loadMeta() {
  const raw = getRaw('meta');
  return { ...defaultMeta, ...(raw || {}) };
}

export function saveMeta(meta) {
  setRaw('meta', meta);
}

