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

createRoot(document.getElementById('root')!).render(
  <App />,
);
