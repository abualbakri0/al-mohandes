// panel.mjs — لوحة تحكم المشرف الكاملة (Admin Control Panel)
// ============================================================
// تُفتح بالأمر /panel أو زر «🛠️ لوحة التحكم» (يظهر للأدمن فقط).
// التنقل عبر أزرار Inline داخل رسالة واحدة تُعدَّل مكانها.
// كل التعديلات تُحفظ فوراً في data/settings.json + data/meta.json
// وتُقرأ مع كل رسالة → بدون إعادة تشغيل أو إعادة نشر.
//
// أنماط الإدخال (state.mode) التي تديرها اللوحة:
//   panel.text      تعديل أحد نصوص المستخدمين
//   panel.appname   تعديل اسم التطبيق
//   panel.version   تعديل رقم الإصدار
//   panel.date      تعديل تاريخ النشر
//   panel.link      تعديل رابط (iOS / تنزيل)
//   panel.descFull  تعديل وصف البوت الكامل
//   panel.descShort تعديل الوصف المختصر
//   panel.btnadd    إضافة زر جديد (النص أولاً ثم النوع)
//   panel.btnpick   اختيار نوع الزر بعد كتابة نصه
//   panel.btnurl    إدخال رابط زر نوع URL
//   panel.btnlabel  تعديل نص زر موجود
//   panel.broadcast بث رسالة لكل المشتركين

import { config, isAdmin } from './config.mjs';
import { getSettings, saveSettings } from './settings.mjs';
import { loadMeta, saveMeta, loadSubscribers, activeSubscriberIds, markBlocked } from './store.mjs';
import { getState, setState, clearState } from './state.mjs';
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  setMyDescription,
  setMyShortDescription,
} from './api.mjs';
import { copyFileSync, unlinkSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// زر اللوحة في لوحة المفاتيح الثابتة (يظهر للأدمن فقط)
export const PANEL_BTN = '🛠️ لوحة التحكم';

// ----------------- أدوات صغيرة (مكررة عمداً لتفادي circular imports) -----------------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function appName() {
  return getSettings().appName || config.appName;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isUrl(s) {
  return /^https?:\/\/\S+$/i.test(String(s || '').trim());
}

// ----------------- تعريفات الأقسام -----------------
export const TEXT_LABELS = {
  welcome: 'رسالة الترحيب (/start)',
  help: 'رسالة التواصل (/help)',
  about: 'بطاقة «عن المطور»',
  noVersion: 'رسالة «لا توجد نسخة»',
  androidUnavailable: 'رسالة «لا توجد نسخة أندرويد»',
  iosUnavailable: 'رسالة «رابط الآيفون غير متاح»',
};

// إجراءات الأزرار المتاحة عند الإضافة
const BUTTON_ACTIONS = [
  ['download', '⬇️ تنزيل'],
  ['update', '🔄 تحديث'],
  ['android', '🤖 أندرويد'],
  ['ios', '🍎 آيفون'],
  ['about', '👨‍💻 عن المطور'],
  ['help', '💬 تواصل'],
  ['home', '🏠 رئيسية'],
  ['version', '📦 الإصدار'],
  ['url', '🔗 رابط خارجي'],
];

function actionLabel(action) {
  const found = BUTTON_ACTIONS.find(([a]) => a === action);
  return found ? found[1] : action;
}

// ----------------- بناء أقسام اللوحة (عرض + أزرار Inline) -----------------
function mainView() {
  const s = getSettings();
  const meta = loadMeta();
  const subs = Object.values(loadSubscribers());
  const active = subs.filter((x) => !x.blocked).length;
  return {
    text:
      `🛠️ <b>لوحة تحكم ${escapeHtml(appName())}</b>\n\n` +
      `اختر القسم الذي تريد إدارته 👇\n\n` +
      `📦 الإصدار: <b>${escapeHtml(String(meta.versionName || '—'))}</b>\n` +
      `👥 المشتركون: <b>${subs.length}</b> (نشط ${active})\n` +
      `💾 آخر حفظ للإعدادات: <b>${fmtDate(s.updatedAt)}</b>`,
    keyboard: [
      [{ text: '📝 النصوص والرسائل', callback_data: 'p:texts' }],
      [
        { text: '📦 بيانات التطبيق', callback_data: 'p:app' },
        { text: '🔘 الأزرار', callback_data: 'p:btns' },
      ],
      [
        { text: '🔗 الروابط', callback_data: 'p:links' },
        { text: '⚙️ وصف البوت', callback_data: 'p:desc' },
      ],
      [
        { text: '📊 الإحصائيات', callback_data: 'p:stats' },
        { text: '📣 إذاعة', callback_data: 'p:bcast' },
      ],
      [{ text: '🚀 إشعار تحديث', callback_data: 'p:notify' }],
      [{ text: '📤 رفع نسخة جديدة (APK)', callback_data: 'p:upload' }],
      [{ text: '✖️ إغلاق اللوحة', callback_data: 'p:close' }],
    ],
  };
}

function textsView() {
  const s = getSettings();
  const rows = Object.entries(TEXT_LABELS).map(([key, label]) => [
    { text: `✏️ ${label}`, callback_data: `p:text:${key}` },
  ]);
  rows.push([{ text: '↩️ رجوع للوحة الرئيسية', callback_data: 'p:main' }]);
  const preview = Object.keys(TEXT_LABELS)
    .map((k) => {
      const v = String(s.texts[k] || '').replace(/\n+/g, ' ').slice(0, 45);
      return `• <b>${TEXT_LABELS[k]}:</b> ${escapeHtml(v)}…`;
    })
    .join('\n');
  return {
    text: `📝 <b>إدارة النصوص والرسائل</b>\n\n${preview}\n\nاضغط على أي نص لتعديله — ثم أرسل النص الجديد.`,
    keyboard: rows,
  };
}

function appView() {
  const s = getSettings();
  const meta = loadMeta();
  return {
    text:
      `📦 <b>بيانات التطبيق</b>\n\n` +
      `• الاسم: <b>${escapeHtml(s.appName || config.appName)}</b>\n` +
      `• رقم الإصدار: <b>${escapeHtml(String(meta.versionName || '—'))}</b>\n` +
      `• تاريخ النشر: <b>${fmtDate(meta.updatedAt)}</b>\n` +
      `• سجل التحديث: ${escapeHtml(String(meta.changelog || '—')).slice(0, 120)}`,
    keyboard: [
      [{ text: '✏️ تعديل الاسم', callback_data: 'p:appname' }],
      [{ text: '✏️ تعديل رقم الإصدار', callback_data: 'p:ver' }],
      [{ text: '📅 تعديل تاريخ النشر', callback_data: 'p:date' }],
      [{ text: '📝 تعديل نص التحديث', callback_data: 'p:chlog' }],
      [{ text: '↩️ رجوع للوحة الرئيسية', callback_data: 'p:main' }],
    ],
  };
}

function linksView() {
  const s = getSettings();
  const ios = s.links.iosUrl || '(غير محدد)';
  const dl = s.links.downloadUrl || '(غير محدد)';
  return {
    text:
      `🔗 <b>إدارة الروابط</b>\n\n` +
      `• رابط iOS (Vercel): <code>${escapeHtml(ios)}</code>\n` +
      `• رابط التنزيل البديل: <code>${escapeHtml(dl)}</code>`,
    keyboard: [
      [{ text: '🍎 تعديل رابط iOS', callback_data: 'p:link:iosUrl' }],
      [{ text: '⬇️ تعديل رابط التنزيل', callback_data: 'p:link:downloadUrl' }],
      [{ text: '↩️ رجوع للوحة الرئيسية', callback_data: 'p:main' }],
    ],
  };
}

function buttonsView() {
  const s = getSettings();
  const rows = [];
  for (const b of s.buttons) {
    rows.push([
      {
        text: `${b.enabled ? '✅' : '❌'} ${b.label}  [${actionLabel(b.action)}]`,
        callback_data: `p:btg:${b.id}`,
      },
    ]);
    rows.push([
      { text: '✏️ تعديل النص', callback_data: `p:bte:${b.id}` },
      { text: '⬆️ لأعلى', callback_data: `p:btu:${b.id}` },
      { text: '🗑 حذف', callback_data: `p:btd:${b.id}` },
    ]);
  }
  rows.push([{ text: '➕ إضافة زر جديد', callback_data: 'p:btn:add' }]);
  rows.push([{ text: '↩️ رجوع للوحة الرئيسية', callback_data: 'p:main' }]);
  return {
    text:
      `🔘 <b>إدارة أزرار الواجهة</b>\n\n` +
      `• اضغط على اسم الزر لتفعيله/تعطيله ✅/❌\n` +
      `• إجمالي الأزرار: <b>${s.buttons.length}</b>\n` +
      `• «⬆️ لأعلى» يحرّك الزر مكانه في اللوحة.`,
    keyboard: rows,
  };
}

function descView() {
  const s = getSettings();
  return {
    text:
      `⚙️ <b>وصف البوت</b>\n\n` +
      `<b>الوصف الكامل (صفحة المحادثة):</b>\n${escapeHtml(s.description)}\n\n` +
      `<b>الوصف المختصر (نتائج البحث):</b>\n${escapeHtml(s.shortDescription)}`,
    keyboard: [
      [{ text: '✏️ تعديل الوصف الكامل', callback_data: 'p:desc:full' }],
      [{ text: '✏️ تعديل الوصف المختصر', callback_data: 'p:desc:short' }],
      [{ text: '🔄 تطبيق فوري على تيليجرام', callback_data: 'p:desc:apply' }],
      [{ text: '↩️ رجوع للوحة الرئيسية', callback_data: 'p:main' }],
    ],
  };
}

function statsView() {
  const subs = Object.values(loadSubscribers());
  const active = subs.filter((x) => !x.blocked).length;
  const meta = loadMeta();
  const s = getSettings();
  return {
    text:
      `📊 <b>إحصائيات البوت</b>\n\n` +
      `• إجمالي المشتركين: <b>${subs.length}</b>\n` +
      `• نشط: <b>${active}</b>\n` +
      `• موقوف/محظور: <b>${subs.length - active}</b>\n` +
      `• الإصدار الحالي: <b>${escapeHtml(String(meta.versionName || '—'))}</b>\n` +
      `• عدد الأزرار: <b>${s.buttons.length}</b>\n` +
      `• آخر حفظ للإعدادات: <b>${fmtDate(s.updatedAt)}</b>`,
    keyboard: [
      [{ text: '🔄 تحديث الإحصائيات', callback_data: 'p:stats' }],
      [{ text: '↩️ رجوع للوحة الرئيسية', callback_data: 'p:main' }],
    ],
  };
}

function btnPickView(label) {
  const rows = [];
  let row = [];
  for (const [action, text] of BUTTON_ACTIONS) {
    row.push({ text, callback_data: `p:btnact:${action}` });
    if (row.length === 2) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: '✖️ إلغاء الإضافة', callback_data: 'p:btn:cancel' }]);
  return {
    text: `🔘 نوع الزر لنص: <b>${escapeHtml(label)}</b>\n\nاختر ماذا يفعل الزر عند الضغط عليه 👇`,
    keyboard: rows,
  };
}

function buildView(name, arg) {
  switch (name) {
    case 'main':
      return mainView();
    case 'texts':
      return textsView();
    case 'app':
      return appView();
    case 'links':
      return linksView();
    case 'btns':
      return buttonsView();
    case 'desc':
      return descView();
    case 'stats':
      return statsView();
    case 'btnpick':
      return btnPickView(arg || '');
    default:
      return mainView();
  }
}

// عرض قسم: يُعدّل رسالة اللوحة إن أمكن، وإلا يرسل رسالة جديدة
export async function renderPanel(chatId, messageId, name, arg) {
  const view = buildView(name, arg);
  const payload = { reply_markup: { inline_keyboard: view.keyboard } };
  if (messageId) {
    try {
      await editMessageText(chatId, messageId, view.text, payload);
      return;
    } catch (e) {
      if (/message is not modified/i.test(e.message)) return;
      // مساحة غير صالحة للتعديل → نرسل رسالة جديدة بالأسفل
    }
  }
  await sendMessage(chatId, view.text, payload);
}

// فتح اللوحة (رسالة جديدة)
export async function openPanel(chatId, messageId) {
  await renderPanel(chatId, messageId || null, 'main');
}

// رسالة إدخال مع زر رجوع Inline
async function prompt(chatId, text, backView) {
  await sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [[{ text: '↩️ رجوع للوحة', callback_data: `p:${backView || 'main'}` }]],
    },
  });
}

// ----------------- بث رسالة لكل المشتركين (مشترك مع bot.mjs) -----------------
export async function broadcast(text) {
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

// تطبيق وصف البوت على تيليجرام من الإعدادات الحالية
export async function applyBotDescription() {
  const s = getSettings();
  await setMyDescription(s.description || config.description);
  await setMyShortDescription(s.shortDescription || config.shortDescription);
}

// ----------------- معالجة أزرار اللوحة (Callback Queries) -----------------
export async function handlePanelCallback(cq) {
  const data = cq.data || '';
  if (!data.startsWith('p:')) return false;

  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;

  // صلاحية صارمة: الأدمن فقط (عبر ADMIN_IDS)
  if (!isAdmin(cq.from?.id)) {
    await answerCallbackQuery(cq.id, '⛔ هذه اللوحة متاحة للمشرفين فقط.');
    return true;
  }
  await answerCallbackQuery(cq.id);
  if (!chatId) return true;

  try {
    const [, view, arg] = data.split(':');

    switch (view) {
      // ---- عرض الأقسام ----
      case 'main':
      case 'texts':
      case 'app':
      case 'links':
      case 'btns':
      case 'desc':
      case 'stats':
        await renderPanel(chatId, messageId, view);
        return true;

      case 'close':
        await editMessageText(chatId, messageId, '✖️ تم إغلاق لوحة التحكم.', {
          reply_markup: { inline_keyboard: [] },
        });
        clearState(chatId);
        return true;

      // ---- تعديل أحد نصوص المستخدمين ----
      case 'text': {
        const key = arg;
        if (!TEXT_LABELS[key]) return true;
        const s = getSettings();
        setState(chatId, { mode: 'panel.text', key, back: 'texts' });
        await prompt(
          chatId,
          `✏️ أرسل النص الجديد لـ <b>${TEXT_LABELS[key]}</b>:\n\n` +
            `<b>الحالي:</b>\n<code>${escapeHtml(s.texts[key] || '(فارغ)')}</code>\n\n` +
            `يدعم تنسيق HTML: <code>&lt;b&gt;</code> للعريض.\nأرسل /cancel للإلغاء.`,
          'texts'
        );
        return true;
      }

      // ---- بيانات التطبيق ----
      case 'appname':
        setState(chatId, { mode: 'panel.appname', back: 'app' });
        await prompt(
          chatId,
          `✏️ أرسل <b>اسم التطبيق</b> الجديد:\n\nال الحالي: <b>${escapeHtml(appName())}</b>\n\n/cancel للإلغاء.`,
          'app'
        );
        return true;

      case 'ver': {
        const meta = loadMeta();
        setState(chatId, { mode: 'panel.version', back: 'app' });
        await prompt(
          chatId,
          `✏️ أرسل <b>رقم الإصدار</b> الجديد:\n\nال الحالي: <b>${escapeHtml(String(meta.versionName || '—'))}</b>\n\n/cancel للإلغاء.`,
          'app'
        );
        return true;
      }

      case 'date':
        setState(chatId, { mode: 'panel.date', back: 'app' });
        await prompt(
          chatId,
          `📅 أرسل <b>تاريخ النشر</b> بصيغة يقبلها JavaScript، مثال:\n` +
            `<code>2026-10-13</code> أو <code>2026-10-13 18:30</code>\n\n/cancel للإلغاء.`,
          'app'
        );
        return true;

      case 'chlog': {
        const meta = loadMeta();
        setState(chatId, { mode: 'changelog', back: 'app' });
        await prompt(
          chatId,
          `📝 أرسل نص التحديث الجديد:\n\n<b>الحالي:</b>\n<code>${escapeHtml(meta.changelog || '(فارغ)')}</code>\n\n/cancel للإلغاء.`,
          'app'
        );
        return true;
      }

      // ---- الروابط ----
      case 'link': {
        const key = arg; // iosUrl | downloadUrl
        if (key !== 'iosUrl' && key !== 'downloadUrl') return true;
        const s = getSettings();
        setState(chatId, { mode: 'panel.link', key, back: 'links' });
        await prompt(
          chatId,
          `🔗 أرسل الرابط الجديد (${key === 'iosUrl' ? 'iOS / Vercel' : 'تنزيل بديل'}):\n\n` +
            `ال الحالي: <code>${escapeHtml(s.links[key] || '(فارغ)')}</code>\n\n` +
            `يجب أن يبدأ بـ http:// أو https://\n/cancel للإلغاء.`,
          'links'
        );
        return true;
      }

      // ---- وصف البوت ----
      case 'desc': {
        const sub = arg; // full | short | apply
        const s = getSettings();
        if (sub === 'apply') {
          await applyBotDescription();
          await answerCallbackQuery(cq.id, '✅ تم تطبيق الوصف على تيليجرام');
          return true;
        }
        if (sub === 'full') {
          setState(chatId, { mode: 'panel.descFull', back: 'desc' });
          await prompt(
            chatId,
            `✏️ أرسل <b>وصف البوت الكامل</b> (حتى 512 حرفاً):\n\n` +
              `<b>الحالي:</b>\n<code>${escapeHtml(s.description)}</code>\n\n/cancel للإلغاء.`,
            'desc'
          );
          return true;
        }
        if (sub === 'short') {
          setState(chatId, { mode: 'panel.descShort', back: 'desc' });
          await prompt(
            chatId,
            `✏️ أرسل <b>الوصف المختصر</b> (حتى 120 حرفاً):\n\n` +
              `<b>الحالي:</b>\n<code>${escapeHtml(s.shortDescription)}</code>\n\n/cancel للإلغاء.`,
            'desc'
          );
          return true;
        }
        return true;
      }

      // ---- الأزرار: تفعيل/تعطيل ----
      case 'btg': {
        const s = getSettings();
        const b = s.buttons.find((x) => x.id === arg);
        if (!b) return true;
        b.enabled = !b.enabled;
        saveSettings(s);
        await renderPanel(chatId, messageId, 'btns');
        return true;
      }

      // ---- الأزرار: تعديل النص ----
      case 'bte': {
        const s = getSettings();
        const b = s.buttons.find((x) => x.id === arg);
        if (!b) return true;
        setState(chatId, { mode: 'panel.btnlabel', id: b.id, back: 'btns' });
        await prompt(
          chatId,
          `✏️ أرسل <b>النص الجديد</b> لزر: <b>${escapeHtml(b.label)}</b>\n\n/cancel للإلغاء.`,
          'btns'
        );
        return true;
      }

      // ---- الأزرار: نقل لأعلى ----
      case 'btu': {
        const s = getSettings();
        const i = s.buttons.findIndex((x) => x.id === arg);
        if (i > 0) {
          const tmp = s.buttons[i - 1];
          s.buttons[i - 1] = s.buttons[i];
          s.buttons[i] = tmp;
          saveSettings(s);
        }
        await renderPanel(chatId, messageId, 'btns');
        return true;
      }

      // ---- الأزرار: حذف (تأكيد) ----
      case 'btd': {
        const s = getSettings();
        const b = s.buttons.find((x) => x.id === arg);
        if (!b) return true;
        await editMessageText(
          chatId,
          messageId,
          `🗑 <b>تأكيد الحذف</b>\n\nهل تريد حذف زر <b>${escapeHtml(b.label)}</b> نهائياً؟`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🗑 نعم، احذف', callback_data: `p:btdd:${b.id}` }],
                [{ text: '↩️ تراجع', callback_data: 'p:btns' }],
              ],
            },
          }
        );
        return true;
      }

      case 'btdd': {
        const s = getSettings();
        const before = s.buttons.length;
        s.buttons = s.buttons.filter((x) => x.id !== arg);
        if (s.buttons.length !== before) saveSettings(s);
        await renderPanel(chatId, messageId, 'btns');
        return true;
      }

      // ---- إضافة زر جديد ----
      case 'btn': {
        if (arg === 'add') {
          setState(chatId, { mode: 'panel.btnadd', back: 'btns' });
          await prompt(
            chatId,
            `➕ أرسل <b>نص الزر</b> الجديد (ما يظهر للمستخدم):\nمثال: <code>📘 موقعنا</code>\n\n/cancel للإلغاء.`,
            'btns'
          );
          return true;
        }
        if (arg === 'cancel') {
          clearState(chatId);
          await renderPanel(chatId, messageId, 'btns');
          return true;
        }
        return true;
      }

      case 'btnact': {
        // اختيار نوع الزر بعد كتابة نصه (النص محفوظ في الحالة)
        const state = getState(chatId);
        if (!state || state.mode !== 'panel.btnpick' || !state.label) {
          await answerCallbackQuery(cq.id, '⚠️ ابدأ أولاً بزر «➕ إضافة زر جديد».');
          return true;
        }
        if (arg === 'url') {
          setState(chatId, { mode: 'panel.btnurl', label: state.label, back: 'btns' });
          await prompt(
            chatId,
            `🔗 أرسل <b>الرابط</b> لزر: <b>${escapeHtml(state.label)}</b>\n` +
              `مثال: <code>https://example.com</code>\n\n/cancel للإلغاء.`,
            'btns'
          );
          return true;
        }
        const s = getSettings();
        s.buttons.push({
          id: `b${Date.now().toString(36)}`,
          action: arg,
          label: state.label,
          enabled: true,
        });
        saveSettings(s);
        clearState(chatId);
        await renderPanel(chatId, messageId, 'btns');
        await sendMessage(chatId, `✅ تم إضافة الزر <b>${escapeHtml(state.label)}</b> بنجاح.`);
        return true;
      }

      // ---- إذاعة ----
      case 'bcast':
        setState(chatId, { mode: 'panel.broadcast', back: 'main' });
        await prompt(
          chatId,
          `📣 أرسل <b>نص الرسالة</b> التي تريد بثّها لكل المشتركين:\n\n/cancel للإلغاء.`,
          'main'
        );
        return true;

      // ---- رفع نسخة جديدة (APK) ----
      // نضع البوت في وضع انتظار: إمّا ملف APK (يُعالَج في bot.mjs/handleDocument)
      // أو رابط تنزيل مباشر (يُعالَج في handlePanelInput/panel.uploadUrl).
      case 'upload':
        setState(chatId, { mode: 'panel.upload', back: 'app' });
        await prompt(
          chatId,
          `📤 <b>رفع نسخة جديدة من التطبيق</b>\n\n` +
            `أرسل الآن <b>أحدهما</b>:\n\n` +
            `1️⃣ <b>ملف APK</b> مباشرةً في هذه المحادثة (إن كان حجمه ≤ 50 ميجابايت).\n` +
            `2️⃣ <b>رابط تنزيل مباشر</b> للملف (للملفات الكبيرة أو الاستضافة على سيرفرك).\n\n` +
            `سيُعتمد الملف تلقائياً كـ<b>النسخة الحالية</b> التي يستلمها كل المستخدمين.\n\n` +
            `أرسل /cancel للإلغاء.`,
          'app'
        );
        return true;

      // ---- إشعار تحديث ----
      case 'notify': {
        const meta = loadMeta();
        if (!meta.versionName) {
          await sendMessage(chatId, `⚠️ لا يوجد إصدار منشور لإشعار المشتركين به. ارفع APK أولاً.`);
          return true;
        }
        const text =
          `🚀 <b>تحديث جديد متاح لـ ${escapeHtml(appName())}!</b>\n\n` +
          `الإصدار: <b>${escapeHtml(String(meta.versionName))}</b>\n` +
          (meta.changelog ? `\n${escapeHtml(meta.changelog)}\n` : '') +
          `\nللتنزيل أرسل /download`;
        await sendMessage(chatId, `⏳ جاري إرسال الإشعار للمشتركين...`);
        const { sent, failed } = await broadcast(text);
        await sendMessage(chatId, `✅ تم الإرسال.\n• نجح: <b>${sent}</b>\n• فشل: <b>${failed}</b>`);
        return true;
      }

      default:
        await renderPanel(chatId, messageId, 'main');
        return true;
    }
  } catch (e) {
    console.error('خطأ في لوحة التحكم:', e.message);
    await sendMessage(chatId, `⚠️ حدث خطأ في اللوحة: ${escapeHtml(e.message)}`);
    return true;
  }
}

// ----------------- معالجة النصوص المُرسلة أثناء تعديل اللوحة -----------------
// تُنادى من bot.mjs عندما تكون الحالة المؤقتة أحد أنماط panel.* أو changelog
// تُرجع true إذا استلمت النص (توقفت بقية المسارات).
export async function handlePanelInput(msg, state) {
  const chatId = msg.chat.id;
  const text = msg.text || '';

  switch (state.mode) {
    // ---- تعديل نصوص المستخدمين ----
    case 'panel.text': {
      const s = getSettings();
      s.texts[state.key] = text;
      saveSettings(s);
      clearState(chatId);
      await sendMessage(chatId, `✅ تم حفظ «${TEXT_LABELS[state.key] || state.key}» فورياً.`);
      await renderPanel(chatId, null, 'texts');
      return true;
    }

    // ---- اسم التطبيق ----
    case 'panel.appname': {
      const name = text.trim();
      if (!name) return true;
      const s = getSettings();
      s.appName = name;
      saveSettings(s);
      clearState(chatId);
      await sendMessage(chatId, `✅ أصبح اسم التطبيق: <b>${escapeHtml(name)}</b>`);
      await renderPanel(chatId, null, 'app');
      return true;
    }

    // ---- رقم الإصدار ----
    case 'panel.version': {
      const meta = loadMeta();
      meta.versionName = text.trim();
      saveMeta(meta);
      clearState(chatId);
      await sendMessage(chatId, `✅ تم تحديث رقم الإصدار: <b>${escapeHtml(meta.versionName)}</b>`);
      await renderPanel(chatId, null, 'app');
      return true;
    }

    // ---- تاريخ النشر ----
    case 'panel.date': {
      const d = new Date(text.trim());
      if (Number.isNaN(d.getTime())) {
        await sendMessage(chatId, `⚠️ صيغة تاريخ غير صالحة. مثال: <code>2026-10-13 18:30</code>`);
        return true; // يبقى في نفس وضع الانتظار
      }
      const meta = loadMeta();
      meta.updatedAt = d.toISOString();
      saveMeta(meta);
      clearState(chatId);
      await sendMessage(chatId, `✅ تاريخ النشر: <b>${fmtDate(meta.updatedAt)}</b>`);
      await renderPanel(chatId, null, 'app');
      return true;
    }

    // ---- نص التحديث (changelog) — مشترك مع cmdSetChangelog ----
    case 'changelog': {
      const meta = loadMeta();
      meta.changelog = text;
      saveMeta(meta);
      clearState(chatId);
      await sendMessage(chatId, `✅ تم التحديث.`);
      await renderPanel(chatId, null, state.back || 'app');
      return true;
    }

    // ---- الروابط ----
    case 'panel.link': {
      const url = text.trim();
      if (!isUrl(url)) {
        await sendMessage(chatId, `⚠️ يجب أن يبدأ الرابط بـ <code>http://</code> أو <code>https://</code>`);
        return true;
      }
      const s = getSettings();
      s.links[state.key] = url;
      saveSettings(s);
      clearState(chatId);
      await sendMessage(chatId, `✅ تم حفظ الرابط فورياً — سيظهر في الواجهة مباشرة.`);
      await renderPanel(chatId, null, 'links');
      return true;
    }

    // ---- وصف البوت الكامل ----
    case 'panel.descFull': {
      if (text.length > 512) {
        await sendMessage(chatId, `⚠️ الحد الأقصى 512 حرفاً (أرسلت ${text.length}).`);
        return true;
      }
      const s = getSettings();
      s.description = text;
      saveSettings(s);
      clearState(chatId);
      try {
        await applyBotDescription();
        await sendMessage(chatId, `✅ تم حفظ الوصف وتطبيقه على تيليجرام فورياً.`);
      } catch (e) {
        await sendMessage(chatId, `✅ تم الحفظ، لكن فشل التطبيق: ${escapeHtml(e.message)}`);
      }
      await renderPanel(chatId, null, 'desc');
      return true;
    }

    // ---- وصف البوت المختصر ----
    case 'panel.descShort': {
      if (text.length > 120) {
        await sendMessage(chatId, `⚠️ الحد الأقصى 120 حرفاً (أرسلت ${text.length}).`);
        return true;
      }
      const s = getSettings();
      s.shortDescription = text;
      saveSettings(s);
      clearState(chatId);
      try {
        await applyBotDescription();
        await sendMessage(chatId, `✅ تم حفظ الوصف المختصر وتطبيقه فورياً.`);
      } catch (e) {
        await sendMessage(chatId, `✅ تم الحفظ، لكن فشل التطبيق: ${escapeHtml(e.message)}`);
      }
      await renderPanel(chatId, null, 'desc');
      return true;
    }

    // ---- إضافة زر: الخطوة 1 = نص الزر ----
    case 'panel.btnadd': {
      const label = text.trim();
      if (!label) return true;
      setState(chatId, { mode: 'panel.btnpick', label, back: 'btns' });
      const view = btnPickView(label);
      await sendMessage(chatId, view.text, { reply_markup: { inline_keyboard: view.keyboard } });
      return true;
    }

    // ---- إضافة زر: الخطوة 3 = الرابط (نوع url) ----
    case 'panel.btnurl': {
      const url = text.trim();
      if (!isUrl(url)) {
        await sendMessage(chatId, `⚠️ يجب أن يبدأ الرابط بـ <code>http://</code> أو <code>https://</code>`);
        return true;
      }
      const s = getSettings();
      s.buttons.push({
        id: `b${Date.now().toString(36)}`,
        action: 'url',
        label: state.label,
        url,
        enabled: true,
      });
      saveSettings(s);
      clearState(chatId);
      await sendMessage(chatId, `✅ تم إضافة زر الرابط <b>${escapeHtml(state.label)}</b>.`);
      await renderPanel(chatId, null, 'btns');
      return true;
    }

    // ---- تعديل نص زر موجود ----
    case 'panel.btnlabel': {
      const label = text.trim();
      if (!label) return true;
      const s = getSettings();
      const b = s.buttons.find((x) => x.id === state.id);
      if (b) {
        b.label = label;
        saveSettings(s);
      }
      clearState(chatId);
      await sendMessage(chatId, `✅ تم تعديل نص الزر.`);
      await renderPanel(chatId, null, 'btns');
      return true;
    }

    // ---- إذاعة ----
    case 'panel.broadcast': {
      clearState(chatId);
      await sendMessage(chatId, `⏳ جاري بث الرسالة...`);
      const { sent, failed } = await broadcast(text);
      await sendMessage(chatId, `✅ تم البث.\n• نجح: <b>${sent}</b>\n• فشل: <b>${failed}</b>`);
      return true;
    }

    // ---- رفع نسخة عبر رابط مباشر (للملفات الكبيرة) ----
    case 'panel.upload': {
      const url = text.trim();
      // إن أرسل ملفاً لا نصاً، handleDocument في bot.mjs يتولّاه — نتجاهل هنا
      if (!isUrl(url)) {
        await sendMessage(
          chatId,
          `⚠️ أرسل <b>ملف APK</b> مباشرةً، أو <b>رابط تنزيل مباشر</b> يبدأ بـ http:// أو https://\n\nأرسل /cancel للإلغاء.`
        );
        return true; // نبقى في نفس وضع الانتظار
      }
      await sendMessage(chatId, `⏳ جاري تنزيل النسخة من الرابط وحفظها...`);
      const tmpPath = join(config.releasesDir, `dl-${Date.now()}.apk`);
      try {
        const size = await downloadApkFromUrl(url, tmpPath);
        const meta = await adoptApk(tmpPath, url);
        await sendMessage(
          chatId,
          `✅ <b>تم اعتماد النسخة الجديدة من الرابط!</b>\n\n` +
            `${escapeHtml(appName())}\n` +
            `• الإصدار: <b>${escapeHtml(String(meta.versionName))}</b>\n` +
            `• الحجم: <b>${escapeHtml(fmtSize(size))}</b>\n` +
            `• تاريخ النشر: ${fmtDate(meta.updatedAt)}\n\n` +
            `أصبحت هذه النسخة الحالية لكل المستخدمين.\n\n` +
            `<b>التالي (اختياري):</b> أضف نص التحديث ثم أرسل الإشعار للمشتركين.`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📝 إضافة نص التحديث', callback_data: 'upl:chlog' }],
                [{ text: '🚀 إشعار كل المشتركين', callback_data: 'upl:notify' }],
              ],
            },
          }
        );
        await renderPanel(chatId, null, 'app');
        return true;
      } catch (e) {
        if (existsSync(tmpPath)) {
          try { unlinkSync(tmpPath); } catch { /* تجاهل */ }
        }
        await sendMessage(
          chatId,
          `❌ فشل تنزيل الملف: ${escapeHtml(e.message)}\n\nتأكد أن الرابط مباشر (ينتهي بـ .apk ولا يتطلب تسجيل دخول). حاول مجدداً أو أرسل الملف مباشرةً.`
        );
        return true; // نبقى في نفس الوضع ليعيد المحاولة
      }
    }

    default:
      return false; // ليس نمطاً تديره اللوحة
  }
}

// ----------------- أدوات رفع النسخة عبر رابط مباشر -----------------

// تنزيل ملف APK من رابط مباشر إلى مسار محلي (مع متابعة الحجم)
async function downloadApkFromUrl(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`استجابة غير صالحة من الرابط (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('الملف المُنزَّل فارغ');
  writeFileSync(destPath, buf);
  return buf.length;
}

// اعتماد ملف APK (محفوظ مسبقاً في tmpPath) كالنسخة الحالية وتحديث meta.json
// versionHint: نص يُستنتج منه رقم الإصدار إن وُجد (اسم الملف/الرابط)
async function adoptApk(tmpPath, versionHint) {
  const targetName = 'المهندس.apk';
  const targetPath = join(config.releasesDir, targetName);
  const oldMeta = loadMeta();
  const { statSync } = await import('node:fs');

  const verMatch = String(versionHint || '').match(/(\d+\.\d+(?:\.\d+)?)/);
  const meta = {
    versionName: verMatch ? verMatch[1] : oldMeta.versionName || '1.0',
    versionCode: (oldMeta.versionCode || 0) + 1,
    apkFile: targetName,
    changelog: oldMeta.changelog || '',
    updatedAt: new Date().toISOString(),
    size: statSync(tmpPath).size,
  };

  // استبدال آمن متوافق مع OneDrive: انسخ ثم احذف القديم ثم احذف المؤقت
  if (existsSync(targetPath)) unlinkSync(targetPath);
  copyFileSync(tmpPath, targetPath);
  try { unlinkSync(tmpPath); } catch { /* تجاهل */ }

  saveMeta(meta);
  clearState(chatId);
  return meta;
}










