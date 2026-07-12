import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ch.spritzwerkgrab.arbeitskarte',
  appName: 'Arbeitskarte',
  webDir: 'dist',
  // NEVER log the native bridge traffic. Capacitor's default ('debug') echoes
  // every plugin result — including Preferences.get of the scanner API key —
  // into logcat on debug builds, and we sideload debug APKs to real devices.
  loggingBehavior: 'none',
  plugins: {
    Keyboard: {
      // Native resize: WebView shrinks so the focused input stays visible.
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
