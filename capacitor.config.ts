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
      // Full branded splash (icon + "المهندس") on ALL Android versions.
      // useDialog forces the plugin's own full-screen view instead of the
      // Android 12+ native splash, which would crop the icon into a circle
      // and hide the app name. CENTER keeps the whole image (no cropping).
      launchShowDuration: 2500,
      launchAutoHide: true,
      launchFadeOutDuration: 500,
      backgroundColor: '#0A1929',
      androidScaleType: 'CENTER',
      androidSplashResourceName: 'splash',
      useDialog: true,
      splashFullScreen: true,
      splashImmersive: false,
      showSpinner: false,
    },
  },
};

export default config;