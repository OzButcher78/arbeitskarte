import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ch.spritzwerkgrab.arbeitskarte',
  appName: 'Arbeitskarte',
  webDir: 'dist',
  plugins: {
    Keyboard: {
      // Native resize: WebView shrinks so the focused input stays visible.
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
