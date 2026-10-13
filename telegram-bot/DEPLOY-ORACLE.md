# 🚀 نشر البوت للعمل 24/7 على Oracle Cloud (مجاني للأبد)

بوت «المهندس» مكتوب بـ **Node.js خالص بدون أي مكتبات خارجية**، لذا النشر سهل:
لا يحتاج `npm install`، فقط Node.js 18+ وشغّل `bot.mjs`.

يعمل البوت بنمط **long polling** (اتصال صادر فقط)، لذلك **لا حاجة لفتح أي منفذ
في جدار الحماية** — وهذا يجعل إعداد Oracle أسهل بكثير.

---

## ✅ ما تحتاجه
1. حساب Oracle Cloud (مجاني دائم — Always Free). يتطلّب بطاقة للتحقق من الهوية فقط
   (لا يُخصم عليها للأبد إذا بقيتَ ضمن حدود Always Free).
2. جهاز VPS: **Ampere A1 (ARM)** أو **AMD micro** — كلاهما مجاني دائم.
3. بعد إنشاء الجهاز، ستحصل على **مفتاح SSH** وعنوان IP عام.

---

## 1) الدخول إلى السيرفر عبر SSH
من PowerShell/Terminal على جهازك:
```bash
ssh -i "مسار/المفتاح.key" ubuntu@عنوان-IP-العام
```

---

## 2) تثبيت Node.js (عبر NVM)
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
node -v        # يجب أن يظهر v20.x أو أحدث
```

---

## 3) نسخ ملفات البوت إلى السيرفر
ارفع **مجلد `telegram-bot` بالكامل** إلى السيرفر (باستثناء `node_modules` و`data` إن أردت).
من جهازك المحلي (PowerShell):
```powershell
scp -i "مسار/المفتاح.key" -r "d:\OneDrive\المستندات\البرنامج\project\telegram-bot" ubuntu@عنوان-IP:~/al-mohanndes-bot
```

> ارفع معه مجلد `data/` إذا كان فيه إعدادات/مشتركون تريد الاحتفاظ بهم.
> **لا ترفع** مجلد `releases/` (ملفات APK كبيرة) — يمكن نشرها لاحقًا.

على السيرفر:
```bash
cd ~/al-mohanndes-bot
```

---

## 4) ضبط الأسرار (BOT_TOKEN و ADMIN_IDS)
أنشئ ملف `.env` على السيرفر:
```bash
nano .env
```
وضع فيه (بدون علامات تنصيص):
```
BOT_TOKEN=8580339526:ضع_باقي_التوكن_هنا
ADMIN_IDS=5555912861
APP_NAME=المهندس
IOS_URL=https://al-mohandes-app-2026.vercel.app
```
> خذ `BOT_TOKEN` الكامل من ملف `.env` المحلي على جهازك (لا تشاركه مع أحد).

احفظ: `Ctrl+O` ثم `Enter` ثم `Ctrl+X`.

---

## 5) تجربة التشغيل أولًا
```bash
node bot.mjs
```
يجب أن تظهر:
```
🤖 بوت المهندس يعمل الآن (long polling)...
✅ تم تطبيق وصف البوت.
```
افتح [@Almohanndesbot](https://t.me/Almohanndesbot) وأرسل `/panel` للتأكد.
ثم أوقفه: `Ctrl+C`.

---

## 6) التشغيل الدائم 24/7 عبر PM2
```bash
# تثبيت PM2
sudo npm install -g pm2

# تشغيل البوت
pm2 start ecosystem.config.cjs

# حفظ القائمة + تشغيلها تلقائيًا بعد أي إعادة تشغيل للسيرفر
pm2 save
pm2 startup
# نفّذ الأمر الذي يطبعه pm2 startup (يبدأ بـ sudo env ...)
```

أوامر مفيدة:
```bash
pm2 status          # حالة البوت
pm2 logs al-mohanndes-bot   # متابعة السجلات الحيّة
pm2 restart al-mohanndes-bot
```

> الملف `ecosystem.config.cjs` مُعدّ ليعيد تشغيل البوت تلقائيًا لو توقّف لأي سبب.

---

## 7) (اختياري) تحديث الكود لاحقًا
على جهازك المحلي:
```powershell
scp -i "المفتاح.key" -r "d:\...\telegram-bot\*.mjs" ubuntu@عنوان-IP:~/al-mohanndes-bot
```
على السيرفر:
```bash
cd ~/al-mohanndes-bot && pm2 restart al-mohanndes-bot
```

---

## ⚠️ ملاحظات مهمّة
- **الأسرار:** لا تضع `BOT_TOKEN` داخل الكود ولا على GitHub. `.env` مُستثنى في `.gitignore`.
- **البيانات:** تُحفظ في `telegram-bot/data/` على قرص السيرفر (دائم). احتفظ بنسخة احتياطية منها من وقت لآخر:
  ```bash
  cp -r data data-backup-$(date +%F)
  ```
- **حد حجم تيليجرام:** استقبال APK عبر البوت محدود (Bot API ~50MB). للملفات الأكبر استخدم
  `publish.mjs` محليًا أو اضبط `DOWNLOAD_URL`.
- **الجهاز المجاني:** ضمن حدود Always Free يبقى مجانيًا للأبد. توقّف بسيط مؤقت لا يمسح ملفاتك.
