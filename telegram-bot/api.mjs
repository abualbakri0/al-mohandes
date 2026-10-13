// api.mjs — غلاف خفيف حول Telegram Bot API باستخدام fetch الأصلي
// ============================================================
import { config } from './config.mjs';

const BASE = `https://api.telegram.org/bot${config.botToken}`;

async function call(method, params) {
  let res;
  try {
    res = await fetch(`${BASE}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    });
  } catch (networkErr) {
    throw new Error(`فشل الاتصال بـ Telegram (${method}): ${networkErr.message}`);
  }
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram ${method} خطأ: ${data.description || 'غير معروف'}`);
  }
  return data.result;
}

// رفع ملف (multipart) — لإرسال APK (fileName اختياري لتخصيص اسم الملف الظاهر للمستخدم)
export async function sendDocument(chatId, filePath, caption, fileName) {
  const { readFileSync } = await import('node:fs');
  const buffer = readFileSync(filePath);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  // اسم مقروء للملف (يُستخدم fileName المخصص إن وُجد، وإلا اسم الملف الأصلي)
  const name = fileName || filePath.split(/[\\/]/).pop() || 'app.apk';
  form.append('document', new Blob([buffer]), name);

  // مهلة زمنية سخيّة حسب حجم الملف (حد أدنى 60 ثانية) لتجنّب التعليق اللانهائي
  const timeoutMs = Math.max(60000, Math.ceil(buffer.length / 1024) * 40);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`sendDocument خطأ: ${data.description}`);
    return data.result;
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`انتهت المهلة الزمنية أثناء إرسال الملف (${timeoutMs}ms)`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMessage(chatId, text, extra = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

// تعديل رسالة قائمة (النص + الأزرار) — لتجربة تفاعلية أنظف
export async function editMessageText(chatId, messageId, text, extra = {}) {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

export async function sendChatAction(chatId, action = 'typing') {
  try {
    return await call('sendChatAction', { chat_id: chatId, action });
  } catch {
    /* تجاهل */
  }
}

// جلب آخر التحديثات (long polling)
export async function getUpdates(offset, timeout = 30) {
  return call('getUpdates', {
    offset,
    timeout,
    allowed_updates: ['message', 'callback_query'],
  });
}

export async function answerCallbackQuery(id, text) {
  try {
    return await call('answerCallbackQuery', { callback_query_id: id, text });
  } catch {
    /* تجاهل */
  }
}

// ------------- وصف البوت (Bot API 6.4+) -------------
// الوصف الكامل: يظهر في صفحة المحادثة أسفل اسم البوت (حد أقصى 512 حرفاً)
export async function setMyDescription(description, languageCode) {
  return call('setMyDescription', {
    description,
    ...(languageCode ? { language_code: languageCode } : {}),
  });
}

// الوصف المختصر: يظهر في نتائج البحث عن البوت (حد أقصى 120 حرفاً)
export async function setMyShortDescription(shortDescription, languageCode) {
  return call('setMyShortDescription', {
    short_description: shortDescription,
    ...(languageCode ? { language_code: languageCode } : {}),
  });
}

// تنزيل ملف من Telegram إلى المسار المحلي (لاستقبال APK من الأدمن)
export async function downloadFile(fileId, destPath) {
  const file = await call('getFile', { file_id: fileId });
  const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`تنزيل الملف فشل: ${res.status}`);
  const { writeFileSync } = await import('node:fs');
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
  return { size: buf.length, destPath };
}
