/**
 * Capacitor configuration for the Android and iOS shells.
 *
 * The web build in `dist/` is copied verbatim into both native projects, so
 * there is exactly one game to test and one to fix.
 */

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.blackholepyramid.game',
  appName: 'Black Hole Pyramid',
  webDir: 'dist',

  // The game paints its own background; a matching native background removes
  // the white flash between the splash screen and the first rendered frame.
  backgroundColor: '#05060f',

  android: {
    backgroundColor: '#05060f',
    // Keeps the canvas crisp and lets the WebView use hardware acceleration.
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
  },

  ios: {
    backgroundColor: '#05060f',
    contentInset: 'never',
    // The layout already accounts for safe areas via CSS env() insets.
    scrollEnabled: false,
    limitsNavigationsToAppBoundDomains: true,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#05060fff',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    Haptics: {},
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#05060f',
      overlaysWebView: true,
    },
  },

  server: {
    // Required for localStorage to persist reliably in the WebView.
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
};

export default config;
