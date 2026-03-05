import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.pdfmax.app',
    appName: 'PDF Max',
    webDir: 'out',               // Next.js static export target (CAPACITOR=1 next build)

    // ── Uncomment for live-reload dev builds (npm run ios:dev) ───────────────
    // server: {
    //     url: 'http://YOUR_MAC_IP:3000',   // use your Mac's LAN IP, not localhost
    //     cleartext: true,
    //     androidScheme: 'https',
    // },

    ios: {
        contentInset: 'always',
        preferredContentMode: 'mobile',
        backgroundColor: '#ffffff',
        scrollEnabled: false,      // canvas handles its own scroll
    },
    plugins: {
        StatusBar: {
            style: 'light',
            backgroundColor: '#1e1b4b',
        },
        SplashScreen: {
            launchShowDuration: 0,
        },
        Filesystem: {
            iosScheme: 'ionic',
        },
    },
};

export default config;

