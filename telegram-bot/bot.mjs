// bot.mjs — بوت تليجرام لتحديثات وتنزيل تطبيق "المهندس"
// ============================================================
// التشغيل:  node telegram-bot/bot.mjs
//
// المزايا:
//   • /start, /help          — ترحيب وقائمة الأوامر
//   • /download, /apk        — إرسال أحدث نسخة APK + رابط بديل
//   • /version               — عرض الإصدار الحالي وسجل التغييرات
//   • /about                 — بطاقة تعريف المطور
//   • /subscribe /unsubscribe— إدارة الاشتراك في إشعارات التحديث
//   • (أدمن) رفع ملف APK للبوت → يُحفظ ويصبح النسخة الحالية تلقائياً
//   • (أدمن) /panel          — لوحة التحكم الكاملة (نصوص/أزرار/روابط/إصدارات)
//   • (أدمن) /setchangelog   — تعديل نص التحديث
//   • (أدمن) /setdescription — تطبيق وصف البوت (About)
//   • (أدمن) /broadcast      — إرسال رسالة لكل المشتركين
//   • (أدمن) /notify         — إشعار بوجود تحديث جديد
//   • (أدمن) /stats          — إحصاءات المشتركين
//   • جميع النصوص والأزرار والروابط تُقرأ من data/settings.json ديناميكياً
//     (تُعدَّل من /panel بدون إعادة تشغيل أو إعادة نشر)
//   • ضبط وصف البوت تلقائياً عند كل تشغيل (يمكن تطبيقه مرة واحدة عبر:
//     node telegram-bot/bot.mjs --set-description)

import { existsSync, statSync, unlinkSync, renameSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { config, isAdmin, assertConfigured } from './config.mjs';
import {
  addSubscriber,
  markBlocked,
  loadSubscribers,
  loadMeta,
  saveMeta,
} from './store.mjs';
import { getSettings } from './settings.mjs';
import { getState, setState, clearState } from './state.mjs';
import {
  openPanel,
  handlePanelCallback,
  handlePanelInput,
  applyBotDescription,
  broadcast,
  PANEL_BTN,
} from './panel.mjs';
import {
  sendMessage,
  sendDocument,
  sendChatAction,
  getUpdates,
  answerCallbackQuery,
  downloadFile,
  editMessageText,
} from './api.mjs';
import { init as initDb } from './db.mjs';

assertConfigured();

// اسم التطبيق ديناميكي (من الإعدادات — قابل للتعديل من لوحة التحكم)
function APP() {
  return getSettings().appName || config.appName;
}

// نصوص ديناميكية (تُقرأ مع كل رسالة من data/settings.json)
function T(key) {
  const s = getSettings();
  return String(s.texts[key] || '').split('{app}').join(s.appName || config.appName);
}


// --------- حالة مؤقتة للأدمن ----------
// مُنقلة إلى state.mjs (مشتركة مع panel.mjs) — انظر getState/setState/clearState.

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

// النصوص الثابتة القديمة (WELCOME/HELP) استُبدلت بـ T('welcome') / T('help')
// التي تُقرأ ديناميكياً من data/settings.json (تُدار من /panel).

// ----------------- لوحة المفاتيح الثابتة (ديناميكية من الإعدادات) -----------------
// ReplyKeyboardMarkup: تظهر بشكل دائم أسفل حقل الكتابة.
// الأزرار تُقرأ من data/settings.json (تُدار من لوحة التحكم /panel).
// زر اللوحة «🛠️ لوحة التحكم» يظهر للمشرف فقط (عبر ADMIN_IDS).
function mainMenuKeyboard(chatId) {
  const s = getSettings();
  const rows = [];
  let row = [];
  for (const b of s.buttons) {
    if (!b.enabled) continue;
    row.push({ text: b.label });
    if (row.length === 2) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  // صف المشرف: زر لوحة التحكم (غير مرئي لبقية المستخدمين)
  if (chatId !== undefined && chatId !== null && isAdmin(chatId)) {
    rows.push([{ text: PANEL_BTN }]);
  }
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'اختر العملية المطلوبة 👇',
  };
}

// إجراء زر — يُنفَّذ حسب حقل action في الإعدادات
async function runButtonAction(btn, chatId, from) {
  switch (btn.action) {
    case 'download':
      return showOsChoice(chatId, false);
    case 'update':
      return showOsChoice(chatId, true);
    case 'android':
      return deliverAndroid(chatId);
    case 'ios':
      return deliverIos(chatId);
    case 'about':
      return cmdAbout(chatId);
    case 'help':
      return cmdHelp(chatId);
    case 'home':
      return cmdStart(chatId, from);
    case 'version':
      return cmdVersion(chatId);
    case 'url':
      return sendMessage(chatId, `🔗 اضغط لفتح الرابط:`, {
        reply_markup: {
          inline_keyboard: [[{ text: btn.label, url: btn.url || 'https://example.com' }]],
        },
      });
    default:
      return sendMessage(chatId, `اختر العملية المطلوبة من الأزرار بالأسفل 👇`, {
        reply_markup: mainMenuKeyboard(chatId),
      });
  }
}


// شاشة اختيار نظام التشغيل: تبقى Inline لأنها خطوة فرعية داخل المحادثة
// (روابط URL يجب أن تبقى Inline حصراً حسب قيود تيليجرام).
function osMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🤖 أندرويد', callback_data: 'os:android' },
        { text: '🍎 آيفون', callback_data: 'os:ios' },
      ],
      [{ text: '↩️ رجوع', callback_data: 'menu:back' }],
    ],
  };
}


// ----------------- أوامر المستخدمين -----------------
async function cmdStart(chatId, from) {
  addSubscriber(from); // أي شخص يبدأ المحادثة يُسجَّل كمشترك تلقائياً
  await sendMessage(chatId, T('welcome'), {
    reply_markup: mainMenuKeyboard(chatId),
  });
}

async function cmdHelp(chatId) {
  await sendMessage(chatId, T('help'), { reply_markup: mainMenuKeyboard(chatId) });
}

async function cmdVersion(chatId) {
  const meta = loadMeta();
  const s = getSettings();
  if (!meta.versionName) {
    await sendMessage(chatId, T('noVersion'), {
      reply_markup: mainMenuKeyboard(chatId),
    });
    return;
  }
  const size = meta.apkFile ? safeSize(join(config.releasesDir, meta.apkFile)) : meta.size;
  const changelog = meta.changelog ? `\n\n${escapeHtml(meta.changelog)}` : '';
  const external = s.links.downloadUrl
    ? `\n\n🔗 <a href="${s.links.downloadUrl}">رابط تنزيل بديل</a>`
    : '';
  await sendMessage(
    chatId,
    `${escapeHtml(s.appName || config.appName)}\n\n` +
      `• الإصدار: <b>${escapeHtml(String(meta.versionName))}</b>\n` +
      `• تاريخ النشر: ${fmtDate(meta.updatedAt)}` +
      changelog +
      external,
    { reply_markup: mainMenuKeyboard(chatId) }
  );
}

// زر «عن المطور» — بطاقة تعريفية بالمطوّر (نص ديناميكي من الإعدادات)
async function cmdAbout(chatId) {
  await sendMessage(chatId, T('about'), { reply_markup: mainMenuKeyboard(chatId) });
}

// إرسال تطبيق أندرويد (APK) للمستخدم
async function deliverAndroid(chatId) {
  const meta = loadMeta();
  const s = getSettings();
  await sendChatAction(chatId, 'upload_document');

  const apkPath = meta.apkFile ? join(config.releasesDir, meta.apkFile) : null;
  const size = apkPath ? safeSize(apkPath) : null;

  // حد أقصى آمن لإرسال الملف عبر البوت (يمكن تجاوزه على الشبكات السريعة/السيرفرات).
  // إذا كان الملف أكبر أو لم يكن متاحاً، نستخدم الرابط الاحتياطي.
  const MAX_FILE_SEND = 8 * 1024 * 1024; // 8MB
  const canSendFile = apkPath && existsSync(apkPath) && size != null && size <= MAX_FILE_SEND;

  // 1) إرسال الملف مباشرةً إن كان الحجم مناسباً
  if (canSendFile) {
    const caption = `${s.appName || config.appName}\n\nالإصدار: ${meta.versionName ? 'v' + escapeHtml(String(meta.versionName)) : ''}`;
    try {
      await sendDocument(chatId, apkPath, caption, 'المهندس.apk');
      return;
    } catch (e) {
      console.error('فشل إرسال APK، سيتم اللجوء للرابط:', e.message);
      // نتابع للرابط الاحتياطي بالأسفل
    }
  }

  // 2) بديل: رابط خارجي لأندرويد (يُفضّل للملفات الكبيرة أو عند فشل الإرسال)
  if (s.links.downloadUrl) {
    const kb = {
      reply_markup: {
        inline_keyboard: [[{ text: '⬇️ تنزيل التطبيق', url: s.links.downloadUrl }]],
      },
    };
    await sendMessage(
      chatId,
      `📥 <b>تنزيل تطبيق ${escapeHtml(s.appName || config.appName)} (أندرويد)</b>` +
        (meta.versionName ? ` — الإصدار ${escapeHtml(String(meta.versionName))}` : '') +
        `\n\nاضغط الزر بالأسفل لتنزيل أحدث نسخة 👇`,
      kb
    );
    return;
  }

  // 3) لا ملف ولا رابط
  await sendMessage(chatId, T('androidUnavailable'));
}

// إرسال رابط نسخة الآيفون (موقع Vercel + شرح التثبيت)
async function deliverIos(chatId) {
  const s = getSettings();
  if (s.links.iosUrl) {
    const meta = loadMeta();
    const ver = meta.versionName ? ` (الإصدار ${escapeHtml(String(meta.versionName))})` : '';
    const kb = {
      reply_markup: {
        inline_keyboard: [[{ text: 'فتح رابط الآيفون في سفاري', url: s.links.iosUrl }]],
      },
    };
    await sendMessage(
      chatId,
      `<b>نسخة الآيفون${ver}</b>\n\n` +
        `اجهزة آبل <b>لا تدعم ملفات APK</b>، لذلك نستخدم نسخة الويب السريعة على هذا الرابط:\n${s.links.iosUrl}\n\n` +
        `<b>طريقة التثبيت (دقيقة واحدة):</b>\n` +
        `1 — افتح الرابط من متصفح <b>Safari</b> على الآيفون (وليس من داخل تيليجرام).\n` +
        `2 — اضغط زر <b>المشاركة</b> (مربع بسهم للاعلى) اسفل المتصفح.\n` +
        `3 — اختر <b>اضافة الى الشاشة الرئيسية / Add to Home Screen</b> ثم اضغط <b>اضافة</b>.\n` +
        `4 — ستجد ايقونة المهندس بجانب تطبيقاتك وتعمل كتطبيق حقيقي.\n\n` +
        `اضغط الزر بالاسفل للفتح المباشر.`,
      kb
    );
    return;
  }
  await sendMessage(chatId, T('iosUnavailable'));
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
    `🔔 تم تفعيل إشعارات التحديث.\nستصلك رسالة عند إطلاق كل نسخة جديدة.\n\nلإيقافها استخدم /unsubscribe`,
    { reply_markup: mainMenuKeyboard(chatId) }
  );
}

async function cmdUnsubscribe(chatId, from) {
  markBlocked(from.id);
  await sendMessage(chatId, `🔕 تم إيقاف إشعارات التحديث.\nلإعادة تفعيلها استخدم /subscribe`, {
    reply_markup: mainMenuKeyboard(chatId),
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
  setState(chatId, { mode: 'changelog', back: 'app' });
  await sendMessage(
    chatId,
    `✏️ أرسل الآن النص الجديد.\n` +
      `النص الحالي:\n<code>${escapeHtml(meta.changelog || '(فارغ)')}</code>\n\n` +
      `أرسل /cancel للإلغاء.`
  );
}

// (أدمن) تطبيق وصف البوت الرسمي — يظهر في صفحة محادثة البوت وفي البحث
async function cmdSetDescription(chatId) {
  try {
    await applyBotDescription();
    const s = getSettings();
    await sendMessage(
      chatId,
      `✅ تم تطبيق وصف البوت:\n\n` +
        `<b>${escapeHtml(s.description)}</b>\n\n` +
        `• الوصف المختصر:\n<code>${escapeHtml(s.shortDescription)}</code>`
    );
  } catch (e) {
    await sendMessage(chatId, `⚠️ فشل تطبيق الوصف: ${escapeHtml(e.message)}`);
  }
}

async function cmdBroadcast(chatId) {
  setState(chatId, { mode: 'broadcast', back: 'main' });
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
    `🚀 <b>تحديث جديد متاح لـ ${escapeHtml(APP())}!</b>\n\n` +
    `الإصدار: <b>${escapeHtml(String(meta.versionName))}</b>\n` +
    (meta.changelog ? `\n${escapeHtml(meta.changelog)}\n` : '') +
    `\nللتنزيل أرسل /download`;
  await sendMessage(chatId, `⏳ جاري إرسال الإشعار للمشتركين...`);
  const { sent, failed } = await broadcast(text);
  await sendMessage(chatId, `✅ تم الإرسال.\n• نجح: <b>${sent}</b>\n• فشل: <b>${failed}</b>`);
}

// broadcast() مُستوردة الآن من panel.mjs (نسخة واحدة مشتركة)

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
  await sendMessage(chatId, `⏳ جاري حفظ النسخة الجديدة...`);

  const targetName = 'المهندس.apk';
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
    // استبدال آمن متوافق مع OneDrive: انسخ ثم احذف القديم ثم احذف المؤقت
    // (renameSync قد يفشل بين وحدات/مجلدات OneDrive المتزامنة)
    if (existsSync(targetPath)) unlinkSync(targetPath);
    copyFileSync(tmpPath, targetPath);
    try { unlinkSync(tmpPath); } catch { /* تجاهل */ }

    saveMeta(meta);
    clearState(chatId);

    // أزرار متابعة: إضافة نص التحديث ثم إشعار المشتركين
    const kb = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📝 إضافة نص التحديث', callback_data: 'upl:chlog' }],
          [{ text: '🚀 إشعار كل المشتركين', callback_data: 'upl:notify' }],
        ],
      },
    };

    await sendMessage(
      chatId,
      `✅ <b>تم اعتماد النسخة الجديدة بنجاح!</b>\n\n` +
        `${escapeHtml(getSettings().appName || config.appName)}\n` +
        `• الإصدار: <b>${escapeHtml(String(meta.versionName))}</b>\n` +
        `• تاريخ النشر: ${fmtDate(meta.updatedAt)}\n\n` +
        `أصبحت هذه هي النسخة الحالية التي يستلمها المستخدمون عند التنزيل.\n\n` +
        `<b>الخطوة التالية (اختياري):</b>\n` +
        `• ✏️ أضف <b>نص التحديث</b> (ما الجديد في هذه النسخة).\n` +
        `• 📣 ثم أرسل <b>إشعاراً لكل المشتركين</b> بضغطة زر.`,
      kb
    );
  } catch (e) {
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* تجاهل */ }
    }
    await sendMessage(chatId, `❌ فشل حفظ الملف: ${escapeHtml(e.message)}`);
  }
}


// ----------------- الحالة المؤقتة (إدخال نص من الأدمن) -----------------
// تُنادى لكل نص يرسله الأدمن عند وجود حالة محفوظة.
// أنماط panel.* تُسلَّم لـ handlePanelInput (لوحة التحكم)،
// وأنماط changelog/broadcast تُعالج هنا ثم تُغلق الحالة.
async function handleAdminText(msg) {
  const chatId = msg.chat.id;
  const state = getState(chatId);
  if (!state) return false;

  const text = msg.text || '';
  if (text === '/cancel') {
    clearState(chatId);
    await sendMessage(chatId, `✖️ تم الإلغاء.`);
    return true;
  }

  // أنشطة لوحة التحكم (نصوص/أزرار/روابط/إصدارات/وصف/بث…)
  if (String(state.mode).startsWith('panel.') || state.mode === 'changelog') {
    const handled = await handlePanelInput(msg, state);
    if (handled) return true;
    return false;
  }

  // الإذاعة الكلاسيكية (أمر /broadcast)
  if (state.mode === 'broadcast') {
    clearState(chatId);
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
  '/about': (chatId) => cmdAbout(chatId),
  '/subscribe': (chatId, from) => cmdSubscribe(chatId, from),
  '/unsubscribe': (chatId, from) => cmdUnsubscribe(chatId, from),
};

const ADMIN_COMMANDS = {
  '/panel': (chatId) => openPanel(chatId),
  '/admin': (chatId) => openPanel(chatId),
  '/stats': (chatId) => cmdStats(chatId),
  '/setchangelog': (chatId) => cmdSetChangelog(chatId),
  '/setdescription': (chatId) => cmdSetDescription(chatId),
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

  // --- 0) أثناء وجود حالة إدخال للمشرف (لوحة تحكم/نص تحديث/بث) ---
  // نمنح الإدخال الأولوية، مع السماح بـ /cancel لإغلاق الوضع.
  if (isAdmin(from.id) && getState(chatId)) {
    if (text === '/cancel') {
      clearState(chatId);
      await sendMessage(chatId, `✖️ تم الإلغاء.`);
      return;
    }
    if (text.startsWith('/')) {
      await sendMessage(chatId, `⏳ أنت في وضع الإدخال حالياً.\nأرسل النص المطلوب أو /cancel للإلغاء.`);
      return;
    }
    const handled = await handleAdminText(msg);
    if (handled) return;
  }

  // --- 1) أزرار لوحة المفاتيح الثابتة (ReplyKeyboardMarkup) ---
  // تيليجرام يرسل نص الزر كرسالة نصية عادية، لذلك نطابقه بنصوص
  // الإعدادات ديناميكياً (قابلة للتعديل/الحذف/الإضافة من /panel).
  if (text === PANEL_BTN && isAdmin(from.id)) {
    await openPanel(chatId);
    return;
  }
  const pressedBtn = getSettings().buttons.find((b) => b.enabled && b.label === text);
  if (pressedBtn) {
    await runButtonAction(pressedBtn, chatId, from);
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
    await sendMessage(chatId, `لم أفهم هذا الأمر. اختر من الأزرار بالأسفل 👇`, {
      reply_markup: mainMenuKeyboard(chatId),
    });
    return;
  }

  // نص عادي بدون حالة: رد افتراضي بالقائمة
  await sendMessage(chatId, `اختر العملية المطلوبة من الأزرار بالأسفل 👇`, {
    reply_markup: mainMenuKeyboard(chatId),
  });
}

// رسالة اختيار نظام التشغيل — تُستخدم من أزرار اللوحة الثابتة والأوامر النصية
async function showOsChoice(chatId, isUpdate = false) {
  const title = isUpdate
    ? `🔄 <b>تحديث التطبيق</b>\n\nاختر نظام التشغيل الخاص بجهازك للحصول على أحدث نسخة 👇`
    : `⬇️ <b>تنزيل التطبيق</b>\n\nاختر نظام التشغيل الخاص بجهازك 👇`;
  // ملاحظة: هذه الرسالة تحمل أزرار Inline (اختيار النظام)،
  // بينما تبقى اللوحة الثابتة ظاهرة أسفل حقل الكتابة تلقائياً.
  await sendMessage(chatId, title, { reply_markup: osMenuKeyboard() });
}

async function handleCallbackQuery(cq) {
  const data = cq.data || '';

  // --- أزرار لوحة التحكم (للمشرف فقط) — تُعالج أولاً وتُجيب عن الاستعلام ذاتها ---
  if (data.startsWith('p:')) {
    await handlePanelCallback(cq);
    return;
  }

  // --- أزرار متابعة رفع نسخة جديدة (للمشرف فقط): نص التحديث / إشعار ---
  if (data.startsWith('upl:')) {
    if (!isAdmin(cq.from?.id)) {
      await answerCallbackQuery(cq.id, '⛔ هذه الأزرار متاحة للمشرفين فقط.');
      return;
    }
    await answerCallbackQuery(cq.id);
    const upChatId = cq.message?.chat?.id;
    if (!upChatId) return;
    try {
      if (data === 'upl:chlog') {
        // ندخل وضع إدخال نص التحديث (نفس نمط changelog)
        const meta = loadMeta();
        setState(upChatId, { mode: 'changelog', back: 'app' });
        await sendMessage(
          upChatId,
          `📝 أرسل <b>نص التحديث</b> الجديد (ما الجديد في هذه النسخة):\n\n` +
            `<b>الحالي:</b>\n<code>${escapeHtml(meta.changelog || '(فارغ)')}</code>\n\n` +
            `أرسل /cancel للإلغاء.`
        );
        return;
      }
      if (data === 'upl:notify') {
        await cmdNotify(upChatId);
        return;
      }
    } catch (e) {
      console.error('خطأ في أزرار الرفع:', e.message);
      await sendMessage(upChatId, `⚠️ حدث خطأ أثناء تنفيذ طلبك.`);
    }
    return;
  }

  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  if (!chatId) return;

  // نُجيب دائماً على الاستعلام لإخفاء "ساعة التحميل" على الزر
  await answerCallbackQuery(cq.id);

  try {
    // زر "تنزيل" أو "تحديث" → عرض قائمة اختيار نظام التشغيل
    if (data === 'menu:download' || data === 'menu:update') {
      const isUpdate = data === 'menu:update';
      const title = isUpdate
        ? `🔄 <b>تحديث التطبيق</b>\n\nاختر نظام التشغيل الخاص بجهازك للحصول على أحدث نسخة 👇`
        : `⬇️ <b>تنزيل التطبيق</b>\n\nاختر نظام التشغيل الخاص بجهازك 👇`;
      // نحدّث نفس الرسالة لتبقى القائمة نظيفة
      if (messageId) {
        await editMessageText(chatId, messageId, title, {
          reply_markup: osMenuKeyboard(),
        });
      } else {
        await sendMessage(chatId, title, { reply_markup: osMenuKeyboard() });
      }
      return;
    }

    // زر "رجوع" → العودة للقائمة الرئيسية
    // ملاحظة: لا يمكن إرفاق ReplyKeyboard برسالة معدّلة (editMessageText يقبل Inline فقط)،
    // لذلك نرسل رسالة جديدة تحمل اللوحة الثابتة.
    if (data === 'menu:back') {
      await sendMessage(chatId, T('welcome'), { reply_markup: mainMenuKeyboard(chatId) });
      return;
    }

    // اختيار أندرويد → إرسال ملف APK
    if (data === 'os:android') {
      await deliverAndroid(chatId);
      return;
    }

    // اختيار آيفون → إرسال الرابط
    if (data === 'os:ios') {
      await deliverIos(chatId);
      return;
    }
  } catch (e) {
    console.error('خطأ في معالجة الزر:', e.message);
    await sendMessage(chatId, `⚠️ حدث خطأ أثناء تنفيذ طلبك. حاول مرة أخرى.`);
  }
}

// ----------------- خادم صحة (يبقي الحاوية مستيقظة + للمراقبة) -----------------
// البوت يعمل بـ long polling (اتصال صادر)، لكن استضافات مثل Railway
// تُبطّئ/تُسبت الحاوية عند غياب الطلبات الواردة. لذلك نفتح منفذ HTTP بسيط
// يستمع على PORT (توفره Railway/Render) ويردّ 200 — يُبقي الحاوية مستيقظة
// ويجعل خدمات المراقبة (UptimeRobot) تتفقّد البوت فعلياً.
function startHealthServer() {
  const port = process.env.PORT;
  if (!port) return; // محلياً لا حاجة له
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('OK — al-mohandes bot is alive');
  });
  server.listen(port, () => {
    console.log(`🌐 خادم الصحة يعمل على المنفذ ${port} (للمراقبة وإبقاء الحاوية مستيقظة).`);
  });
  server.on('error', (e) => console.warn('⚠️ تعذّر تشغيل خادم الصحة:', e.message));
}

// ----------------- حلقة الاستطلاع -----------------
async function main() {
  // تحميل بيانات البوت من Supabase (أو الملفات المحلية) قبل أي شيء
  await initDb();

  // خادم الصحة (على السحابة فقط) — يجب أن يبدأ قبل الاستطلاع
  startHealthServer();

  // تطبيق وصف البوت مرة واحدة فقط (بدون دخول في حلقة الاستطلاع)
  if (process.argv.includes('--set-description')) {
    try {
      await applyBotDescription();
      const s = getSettings();
      console.log('✅ تم تطبيق وصف البوت:\n');
      console.log(s.description);
      console.log('\n— الوصف المختصر —');
      console.log(s.shortDescription);
      console.log('');
      process.exit(0);
    } catch (e) {
      console.error('⚠️ فشل تطبيق وصف البوت:', e.message);
      process.exit(1);
    }
  }

  console.log(`\n🤖 بوت ${APP()} يعمل الآن (long polling)...`);
  console.log(`   BOT_TOKEN: ${config.botToken.slice(0, 6)}…`);
  console.log(`   المشرفون: ${config.adminIds.join(', ') || '(لا يوجد)'}`);
  console.log(`   لوحة التحكم: /panel أو زر «${PANEL_BTN}» (للمشرف فقط)`);
  console.log(`   اضغط Ctrl+C للإيقاف.\n`);

  // تطبيق وصف البوت (About) — يُتجاهل الخطأ حتى لا يمنع تشغيل البوت
  try {
    await applyBotDescription();
    console.log('✅ تم تطبيق وصف البوت.\n');
  } catch (e) {
    console.warn('⚠️ تعذّر تطبيق وصف البوت:', e.message);
  }

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

