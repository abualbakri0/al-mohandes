import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.almohanndes.app',
  appName: 'المهندس',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#0D9488',
    },
    SplashScreen: {
      // الافتتاحية الواحدة فقط هي شاشة الويب (IntroScreen في App.tsx:
      // اللوجو + المهندس + "صُنِعَ بشغف هندسي" لمدة 3 ثوانٍ مع Fade).
      // لذلك نخفي شاشة البلجن الأصلية فوراً (مدة 0) حتى لا تظهر
      // أي افتتاحية أخرى قبلها — فقط لون الخلفية أثناء تحميل WebView.
      launchShowDuration: 0,
      launchAutoHide: true,
      launchFadeOutDuration: 0,
      backgroundColor: '#0A1929',
      androidScaleType: 'CENTER',
      androidSplashResourceName: 'splash',
      useDialog: false,
      splashFullScreen: true,
      splashImmersive: false,
      showSpinner: false,
    },
  },
};

export default config;