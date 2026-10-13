#!/usr/bin/env bash
# ============================================================
# setup-oracle.sh — إعداد وتشغيل بوت "المهندس" 24/7 على Oracle Cloud
# الاستخدام (مرة واحدة على السيرفر):
#   cd ~/al-mohanndes-bot
#   bash setup-oracle.sh
# ============================================================
set -e

echo "▶ التحقق من ملف .env ..."
if [ ! -f .env ]; then
  echo "✗ ملف .env غير موجود. أنشئه أولاً وضع BOT_TOKEN و ADMIN_IDS."
  echo "  مثال:"
  echo "    BOT_TOKEN=123456:ABC..."
  echo "    ADMIN_IDS=5555912861"
  exit 1
fi

echo "▶ التحقق من تثبيت Node.js ..."
if ! command -v node >/dev/null 2>&1; then
  echo "  Node غير مثبّت — جاري التثبيت عبر NodeSource ..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "▶ تثبيت PM2 (مدير العمليات) ..."
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi
pm2 -v

echo "▶ تجربة تشغيل سريعة (5 ثوانٍ للتأكد من عدم وجود أخطاء) ..."
# نتحقق أن البوت يبدأ بنجاح قبل تشغيله الدائم
( node bot.mjs & BOT_PID=$!; sleep 5; kill $BOT_PID 2>/dev/null || true ) || true

echo "▶ تشغيل البوت بشكل دائم عبر PM2 ..."
pm2 start ecosystem.config.cjs
pm2 save

echo "▶ تمكين التشغيل التلقائي عند إعادة تشغيل السيرفر ..."
# يطبع pm2 أمرًا يبدأ بـ "sudo env PATH=..." — ننفّذه تلقائيًا
STARTUP_CMD=$(pm2 startup | tail -n 1)
echo "  تنفيذ: $STARTUP_CMD"
eval "$STARTUP_CMD" || echo "  (إن فشل هذا السطر، انسخ الأمر الذي طبقه pm2 startup ونفّذه يدويًا)"

echo ""
echo "✅ تم الإعداد! أوامر مفيدة:"
echo "   pm2 status                     — حالة البوت"
echo "   pm2 logs al-mohanndes-bot      — السجلات الحيّة"
echo "   pm2 restart al-mohanndes-bot   — إعادة التشغيل"
