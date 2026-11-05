import type { CapacitorConfig } from '@capacitor/cli';

// La app carga la web publicada en Firebase Hosting: cada despliegue se ve al abrir la app sin reinstalar el APK.
// Los archivos de dist se empaquetan solo como respaldo.
const config: CapacitorConfig = {
  appId: 'com.ventasdechances.app',
  appName: 'Ventas de Chances',
  webDir: 'dist',
  server: {
    url: 'https://chances-v5.web.app',
    cleartext: false,
    allowNavigation: ['chances-v5.web.app', '*.firebaseapp.com', '*.googleapis.com']
  }
};

export default config;
