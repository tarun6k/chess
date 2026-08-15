import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.adaptivechess.app',
  appName: 'Chess',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
