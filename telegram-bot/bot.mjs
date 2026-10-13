// bot.mjs — بوت تليجرام لتحديثات وتنزيل تطبيق "المهندس"
// ============================================================
// التشغيل:  node telegram-bot/bot.mjs
//
// المزايا:
//   • /start, /help          — ترحيب وقائمة الأوامر
//   • /download, /apk        — إرسال أحدث نسخة APK + رابط بديل
//   • /version               — عرض الإصدار الحالي وسجل التغييرات
//   • /subscribe /unsubscribe— إدارة الاشتراك في إشعارات التحديث
//   • (أدمن) رفع ملف APK للبوت → يُحفظ ويصبح النسخة الحالية تلقائياً
//   • (أدمن) /setchangelog    — تعديل سجل التغييرات
//   • (أدمن) /broadcast       — إرسال رسالة لكل المشتركين
//   • (أدمن) /notify          — إشعار بوجود تحديث جديد
//   • (أدمن) /stats           — إحصاءات المشتركين

import { existsSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { config, isAdmin, assertConfigured } from './config.mjs';
import {
  addSubscriber,
  markBlocked,
  activeSubscriberIds,
  loadSubscribers,
  loadMeta,
  saveMeta,
} from './store.mjs';
import {
  sendMessage,
  sendDocument,
  sendChatAction,
  getUpdates,
  answerCallbackQuery,
  downloadFile,
  editMessageText,
} from './api.mjs';

assertConfigured();

const APP = config.appName;

// --------- حالة مؤقتة للأدمن (بانتظار سجل تغييرات أو بث) ----------
// Map<chatId, { mode: 'changelog' | 'broadcast' }>
const adminState = new Map();

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeSize(p) {
  try {
    return statSync(p).size;
  } catch {
    return null;
  }
}

const WELCOME = `تطبيق المهندس

رقم الإصدار: v1.0.0
تاريخ النشر: 2026-10-13`;

const HELP = `تطبيق المهندس

رقم الإصدار: v1.0.0
تاريخ النشر: 2026-10-13`;

// ----------------- لوحة المفاتيح الثابتة -----------------
// ReplyKeyboardMarkup: تظهر بشكل دائم أسفل حقل الكتابة (تحت خانة الكتابة)
// بدلاً من InlineKeyboardMarkup المؤقتة داخل المحادثة.
// للأوامر الرئيسية: تنزيل التطبيق / تحديث التطبيق + أوامر مساعدة.
const BTN = {
  DOWNLOAD: '⬇️ تنزيل التطبيق',
  UPDATE: '🔄 تحديث التطبيق',
  ANDROID: '🤖 أندرويد',
  IOS: '🍎 آيفون',
  VERSION: '📦 الإصدار الحالي',
  HELP: 'ℹ️ المساعدة',
  HOME: '🏠 القائمة الرئيسية',
};

// اللوحة الرئيسية الثابتة — بدون أزرار (عرض البيانات فقط)
function mainMenuKeyboard() {
  return { remove_keyboard: true };
}

// شاشة اختيار نظام التشغيل: بدون أزرار (عرض البيانات فقط)
function osMenuKeyboard() {
  return { inline_keyboard: [] };
}


// ----------------- أوامر المستخدمين -----------------
async function cmdStart(chatId, from) {
  addSubscriber(from); // أي شخص يبدأ المحادثة يُسجَّل كمشترك تلقائياً
  await sendMessage(chatId, WELCOME, {
    reply_markup: mainMenuKeyboard(),
  });
}

async function cmdHelp(chatId) {
  await sendMessage(chatId, HELP, { reply_markup: mainMenuKeyboard() });
}

async function cmdVersion(chatId) {
  await sendMessage(
    chatId,
    `تطبيق المهندس\n\nرقم الإصدار: v1.0.0\nتاريخ النشر: 2026-10-13`,
    { reply_markup: mainMenuKeyboard() }
  );
}

// إرسال تطبيق أندرويد (APK) للمستخدم — عرض البيانات الأساسية فقط
async function deliverAndroid(chatId) {
  await sendMessage(
    chatId,
    `تطبيق المهندس\n\nرقم الإصدار: v1.0.0\nتاريخ النشر: 2026-10-13`
  );
}

// إرسال بيانات التطبيق الأساسية فقط
async function deliverIos(chatId) {
  await sendMessage(
    chatId,
    `تطبيق المهندس\n\nرقم الإصدار: v1.0.0\nتاريخ النشر: 2026-10-13`
  );
}

// الأمر النصي /download يفتح قائمة اختيار النظام
async function cmdDownload(chatId) {
  await showOsChoice(chatId, false);
}

function isSubscribed(userId) {
  const subs = loadSubscribers();
  return Boolean(subs[userId]) && !subs[userId].blocked;
}

async function cmdSubscribe(chatId, from) {
  addSubscriber(from);
  await sendMessage(
    chatId,
    `تطبيق المهندس\n\nرقم الإصدار: v1.0.0\nتاريخ النشر: 2026-10-13`,
    { reply_markup: mainMenuKeyboard() }
  );
}

async function cmdUnsubscribe(chatId, from) {
  markBlocked(from.id);
  await sendMessage(chatId, `تطبيق المهندس\n\nرقم الإصدار: v1.0.0\nتاريخ النشر: 2026-10-13`, {
    reply_markup: mainMenuKeyboard(),
  });
}


// ----------------- أوامر الأدمن -----------------
async function cmdStats(chatId) {
  const subs = loadSubscribers();
  const all = Object.values(subs);
  const active = all.filter((s) => !s.blocked).length;
  const blocked = all.length - active;
  await sendMessage(
    chatId,
    `📊 <b>إحصاءات البوت</b>\n\n• إجمالي المشتركين: <b>${all.length}</b>\n• نشط: <b>${active}</b>\n• موقوف/محظور: <b>${blocked}</b>`
  );
}

async function cmdSetChangelog(chatId) {
  const meta = loadMeta();
  adminState.set(chatId, { mode: 'changelog' });
  await sendMessage(
    chatId,
    `✏️ أرسل الآن نص <b>سجل التغييرات</b> الجديد.\n` +
      `النص الحالي:\n<code>${escapeHtml(meta.changelog || '(فارغ)')}</code>\n\n` +
      `أرسل /cancel للإلغاء.`
  );
}

async function cmdBroadcast(chatId) {
  adminState.set(chatId, { mode: 'broadcast' });
  await sendMessage(
    chatId,
    `📣 أرسل الآن <b>نص الرسالة</b> التي تريد بثّها لكل المشتركين.\nأرسل /cancel للإلغاء.`
  );
}

async function cmdNotify(chatId) {
  const meta = loadMeta();
  if (!meta.versionName) {
    await sendMessage(chatId, `⚠️ لا يوجد إصدار منشور لإشعار المشتركين به. ارفع APK أولاً.`);
    return;
  }
  const text =
    `🚀 <b>تحديث جديد متاح لـ ${APP}!</b>\n\n` +
    `الإصدار: <b>${escapeHtml(String(meta.versionName))}</b>\n` +
    (meta.changelog ? `\n${escapeHtml(meta.changelog)}\n` : '') +
    `\nللتنزيل أرسل /download`;
  await sendMessage(chatId, `⏳ جاري إرسال الإشعار للمشتركين...`);
  const { sent, failed } = await broadcast(text);
  await sendMessage(chatId, `✅ تم الإرسال.\n• نجح: <b>${sent}</b>\n• فشل: <b>${failed}</b>`);
}

async function broadcast(text) {
  const ids = activeSubscriberIds();
  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await sendMessage(id, text);
      sent++;
      // throttle بسيط لتجنّب حدود تيليجرام (~25 رسالة/ثانية)
      if (sent % 20 === 0) await sleep(1100);
    } catch {
      markBlocked(id);
      failed++;
    }
  }
  return { sent, failed };
}

// ----------------- معالجة APK المرفوع من الأدمن -----------------
async function handleDocument(msg) {
  const chatId = msg.chat.id;
  const from = msg.from;
  const doc = msg.document;

  if (!isAdmin(from.id)) {
    await sendMessage(chatId, `⛔ هذا الأمر متاح للمشرفين فقط.`);
    return;
  }

  const name = doc.file_name || '';
  if (!/\.apk$/i.test(name) && doc.mime_type !== 'application/vnd.android.package-archive') {
    await sendMessage(chatId, `⚠️ أرسل ملف APK فقط (امتداد .apk).`);
    return;
  }

  await sendChatAction(chatId, 'upload_document');
  await sendMessage(chatId, `⏳ جاري تنزيل الملف (${fmtSize(doc.file_size)}) وحفظه كنسخة حالية...`);

  const targetName = 'current.apk';
  const targetPath = join(config.releasesDir, targetName);
  const tmpPath = join(config.releasesDir, `upload-${Date.now()}.apk`);

  try {
    const info = await downloadFile(doc.file_id, tmpPath);
    // استخراج الإصدار من اسم الملف إن أمكن: app-release-1.2.apk أو 1.2.apk
    const verMatch = name.match(/(\d+\.\d+(?:\.\d+)?)/);
    const oldMeta = loadMeta();
    const meta = {
      versionName: verMatch ? verMatch[1] : oldMeta.versionName || '1.0',
      versionCode: (oldMeta.versionCode || 0) + 1,
      apkFile: targetName,
      changelog: oldMeta.changelog || '',
      updatedAt: new Date().toISOString(),
      size: info.size,
    };
    if (existsSync(targetPath)) unlinkSync(targetPath);
    renameSync(tmpPath, targetPath);

    saveMeta(meta);
    adminState.delete(chatId);

    await sendMessage(
      chatId,
      `✅ <b>تم نشر النسخة الجديدة!</b>\n\n` +
        `• الإصدار: <b>${escapeHtml(String(meta.versionName))}</b>\n` +
        `• رقم البناء: <code>${meta.versionCode}</code>\n` +
        `• الحجم: ${fmtSize(meta.size)}\n\n` +
        `استخدم /setchangelog لتحديث سجل التغييرات، و /notify لإشعار المشتركين.`
    );
  } catch (e) {
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* تجاهل */ }
    }
    await sendMessage(chatId, `❌ فشل حفظ الملف: ${escapeHtml(e.message)}`);
  }
}


// ----------------- الحالة المؤقتة (إدخال نص من الأدمن) -----------------
async function handleAdminText(msg) {
  const chatId = msg.chat.id;
  const state = adminState.get(chatId);
  if (!state) return false;

  const text = msg.text || '';
  if (text === '/cancel') {
    adminState.delete(chatId);
    await sendMessage(chatId, `✖️ تم الإلغاء.`);
    return true;
  }

  if (state.mode === 'changelog') {
    const meta = loadMeta();
    meta.changelog = text;
    saveMeta(meta);
    adminState.delete(chatId);
    await sendMessage(chatId, `✅ تم تحديث سجل التغييرات.`);
    return true;
  }

  if (state.mode === 'broadcast') {
    adminState.delete(chatId);
    await sendMessage(chatId, `⏳ جاري بث الرسالة...`);
    const { sent, failed } = await broadcast(text);
    await sendMessage(chatId, `✅ تم البث.\n• نجح: <b>${sent}</b>\n• فشل: <b>${failed}</b>`);
    return true;
  }

  return false;
}

// ----------------- موجّه الأوامر -----------------
const USER_COMMANDS = {
  '/start': (chatId, from) => cmdStart(chatId, from),
  '/help': (chatId) => cmdHelp(chatId),
  '/download': (chatId) => cmdDownload(chatId),
  '/apk': (chatId) => cmdDownload(chatId),
  '/version': (chatId) => cmdVersion(chatId),
  '/subscribe': (chatId, from) => cmdSubscribe(chatId, from),
  '/unsubscribe': (chatId, from) => cmdUnsubscribe(chatId, from),
};

const ADMIN_COMMANDS = {
  '/stats': (chatId) => cmdStats(chatId),
  '/setchangelog': (chatId) => cmdSetChangelog(chatId),
  '/broadcast': (chatId) => cmdBroadcast(chatId),
  '/notify': (chatId) => cmdNotify(chatId),
};

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const from = msg.from || {};

  // مستند (APK) من الأدمن
  if (msg.document) {
    await handleDocument(msg);
    return;
  }

  const text = (msg.text || '').trim();
  if (!text) return;

  // --- 1) أزرار لوحة المفاتيح الثابتة (ReplyKeyboardMarkup) ---
  // تيليجرام يرسل نص الزر كرسالة نصية عادية، لذلك نطابقه هنا.
  if (text === BTN.DOWNLOAD) {
    await showOsChoice(chatId, false);
    return;
  }
  if (text === BTN.UPDATE) {
    await showOsChoice(chatId, true);
    return;
  }
  if (text === BTN.ANDROID) {
    await deliverAndroid(chatId);
    return;
  }
  if (text === BTN.IOS) {
    await deliverIos(chatId);
    return;
  }
  if (text === BTN.VERSION) {
    await cmdVersion(chatId);
    return;
  }
  if (text === BTN.HELP) {
    await cmdHelp(chatId);
    return;
  }
  if (text === BTN.HOME) {
    await cmdStart(chatId, from);
    return;
  }

  // أوامر (قد تحتوي على @BotName في المجموعات)
  if (text.startsWith('/')) {
    const cmd = text.split(/[@\s]/)[0].toLowerCase();

    if (USER_COMMANDS[cmd]) {
      await USER_COMMANDS[cmd](chatId, from);
      return;
    }
    if (ADMIN_COMMANDS[cmd] && isAdmin(from.id)) {
      await ADMIN_COMMANDS[cmd](chatId);
      return;
    }
    await sendMessage(chatId, `تطبيق المهندس\n\nرقم الإصدار: v1.0.0\nتاريخ النشر: 2026-10-13`, {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }

  // نص عادي: ربما الأدمن في حالة إدخال (سجل تغييرات/بث)
  if (isAdmin(from.id)) {
    const handled = await handleAdminText(msg);
    if (handled) return;
  }

  await sendMessage(chatId, `تطبيق المهندس\n\nرقم الإصدار: v1.0.0\nتاريخ النشر: 2026-10-13`, {
    reply_markup: mainMenuKeyboard(),
  });
}

// رسالة اختيار نظام التشغيل — تعرض البيانات الأساسية فقط
async function showOsChoice(chatId, isUpdate = false) {
  await sendMessage(chatId, `تطبيق المهندس\n\nرقم الإصدار: v1.0.0\nتاريخ النشر: 2026-10-13`, { reply_markup: osMenuKeyboard() });
}

async function handleCallbackQuery(cq) {
  const data = cq.data || '';
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  if (!chatId) return;

  // نُجيب دائماً على الاستعلام لإخفاء "ساعة التحميل" على الزر
  await answerCallbackQuery(cq.id);

  try {
    const INFO = `تطبيق المهندس\n\nرقم الإصدار: v1.0.0\nتاريخ النشر: 2026-10-13`;
    // زر "تنزيل" أو "تحديث" → عرض البيانات الأساسية
    if (data === 'menu:download' || data === 'menu:update') {
      if (messageId) {
        await editMessageText(chatId, messageId, INFO, {
          reply_markup: osMenuKeyboard(),
        });
      } else {
        await sendMessage(chatId, INFO, { reply_markup: osMenuKeyboard() });
      }
      return;
    }

    // زر "رجوع" → العودة للبيانات الأساسية
    if (data === 'menu:back') {
      await sendMessage(chatId, WELCOME, { reply_markup: mainMenuKeyboard() });
      return;
    }

    // اختيار أندرويد → عرض البيانات الأساسية
    if (data === 'os:android') {
      await deliverAndroid(chatId);
      return;
    }

    // اختيار آيفون → عرض البيانات الأساسية
    if (data === 'os:ios') {
      await deliverIos(chatId);
      return;
    }
  } catch (e) {
    console.error('خطأ في معالجة الزر:', e.message);
    await sendMessage(chatId, `تطبيق المهندس\n\nرقم الإصدار: v1.0.0\nتاريخ النشر: 2026-10-13`);
  }
}

// ----------------- حلقة الاستطلاع -----------------
async function main() {
  console.log(`\n🤖 بوت ${APP} يعمل الآن (long polling)...`);
  console.log(`   BOT_TOKEN: ${config.botToken.slice(0, 6)}…`);
  console.log(`   المشرفون: ${config.adminIds.join(', ') || '(لا يوجد)'}`);
  console.log(`   اضغط Ctrl+C للإيقاف.\n`);

  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const updates = await getUpdates(offset, 30);
      for (const upd of updates) {
        offset = upd.update_id + 1;
        try {
          if (upd.message) await handleMessage(upd.message);
          else if (upd.callback_query) await handleCallbackQuery(upd.callback_query);
        } catch (handlerErr) {
          console.error('خطأ في معالجة تحديث:', handlerErr.message);
        }
      }
    } catch (pollErr) {
      console.error('خطأ في الاستطلاع:', pollErr.message);
      await sleep(3000);
    }
  }
}

main().catch((e) => {
  console.error('خطأ غير متوقع:', e);
  process.exit(1);
});

