// ecosystem.config.cjs — تشغيل البوت دائماً (24/7) عبر PM2
// الاستخدام على السيرفر:
//   npm i -g pm2
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup        ← ليعمل تلقائياً بعد إعادة تشغيل السيرفر
//
// ملاحظة: أسرار البوت (BOT_TOKEN و ADMIN_IDS) تُقرأ من متغيّرات البيئة
// أو من ملف .env الموجود بجانب الملفات — لا تُضمّنها هنا.
module.exports = {
  apps: [
    {
      name: 'al-mohanndes-bot',
      script: 'bot.mjs',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 3000,
      max_memory_restart: '200M',
      time: true,
    },
  ],
};
