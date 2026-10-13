// state.mjs — الحالة المؤقتة للمشرف (بانتظار إدخال نص)
// ============================================================
// Map<chatId, { mode, key?, back?, label?, ... }>
// تُستخدم من bot.mjs (إدخال النصوص/Broadcast) ومن panel.mjs (لوحة التحكم)
// لتصبح متاحة عبر ملف واحد مشترك بدل حقن الاعتماديات.

const states = new Map();

export function getState(chatId) {
  return states.get(chatId);
}

export function setState(chatId, state) {
  states.set(chatId, state);
}

export function clearState(chatId) {
  states.delete(chatId);
}

export function hasState(chatId) {
  return states.has(chatId);
}