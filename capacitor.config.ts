import type { CapacitorConfig } from "@capacitor/cli";

/* The Android app (iOS later). The whole site is bundled into the app ("npm run build:app" →
   dist), so built-in games work offline; Supabase is reached over the network when online. */
const config: CapacitorConfig = {
  appId: "com.senevon.games",
  appName: "Senevon Games",
  webDir: "dist",
  android: {
    // keep the WebView's own scroll bounce / overscroll off (the site handles scrolling)
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2500,
      launchAutoHide: false, // hidden by the app once it has rendered (src/lib/native.ts)
      backgroundColor: "#121212",
      showSpinner: false,
      androidScaleType: "CENTER_INSIDE",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#121212",
    },
  },
};

export default config;
