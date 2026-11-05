import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=4', { updateViaCache: 'none' })
      .then(() => navigator.serviceWorker.getRegistrations())
      .then((registrations) => Promise.all(registrations.map((registration) => registration.update())))
      .catch((err) => {
        console.log('ServiceWorker registration failed:', err);
      });
  });
}

const isNativeApp = !!(window as any).Capacitor?.isNativePlatform?.();
if (isNativeApp || window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone) {
  document.documentElement.classList.add('app-compact');
}

createRoot(document.getElementById('root')!).render(
  <App />,
);
