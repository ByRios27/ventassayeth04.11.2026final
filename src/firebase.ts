import { getApps, initializeApp } from "firebase/app";
import { 
  getFirestore, 
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection, 
  addDoc, 
  setDoc,
  query, 
  where, 
  onSnapshot as rawOnSnapshot, 
  orderBy, 
  serverTimestamp, 
  doc, 
  getDoc as rawGetDoc,
  updateDoc, 
  deleteDoc,
  getDocs as rawGetDocs,
  writeBatch,
  getDocFromServer,
  documentId,
  limit,
  increment,
  runTransaction,
  connectFirestoreEmulator
} from "firebase/firestore";
import { recordListenerOpen, recordListenerSnap, recordListenerClose, recordOneShot, describeTarget, readCallSite, hasUnsentReadMeterChanges, markReadMeterSent, getReadMeterPayload } from './readMeter';
import { 
  getAuth, 
  GoogleAuthProvider,
  browserLocalPersistence,
  inMemoryPersistence,
  initializeAuth,
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut, 
  updatePassword,
  connectAuthEmulator
} from "firebase/auth";

import productionConfig from '../firebase-applet-config.json';

// En modo emulador se usa un proyecto demo para que ninguna llamada llegue a producción.
const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
const firebaseConfig = useEmulators
  ? {
      ...productionConfig,
      projectId: 'demo-chances-local',
      apiKey: 'demo-api-key',
      authDomain: 'localhost',
      storageBucket: 'demo-chances-local.appspot.com',
    }
  : productionConfig;

const app = getApps().find(existingApp => existingApp.name === '[DEFAULT]')
  ?? initializeApp(firebaseConfig);
const secondaryApp = getApps().find(existingApp => existingApp.name === 'secondary')
  ?? initializeApp(firebaseConfig, 'secondary');
// Caché local persistente: al reabrir la app o reiniciar un listener solo se leen los documentos que cambiaron.
export const db = (() => {
  if (useEmulators) return getFirestore(app);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
})();
if (useEmulators) {
  try {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  } catch {
    // Ya conectado (HMR).
  }
}
export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: browserLocalPersistence,
    });
  } catch {
    return getAuth(app);
  }
})();
export const googleProvider = new GoogleAuthProvider();
export const secondaryAuth = (() => {
  try {
    return initializeAuth(secondaryApp, {
      persistence: inMemoryPersistence,
    });
  } catch {
    return getAuth(secondaryApp);
  }
})();
if (useEmulators) {
  try {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  } catch {
    // Ya conectado (HMR).
  }
}

// Etiqueta de origen para el medidor: ruta de la colección consultada.
const sourceOf = (target: any, snap?: any): string => {
  try {
    const path = target?._query?.path?.canonicalString?.() ?? target?.path;
    if (path) return String(path).split('/').filter((_, i) => i % 2 === 0).join('/');
    const first = snap?.docs?.[0] ?? snap;
    if (first?.ref?.parent?.id) return first.ref.parent.id;
  } catch {
    // Etiqueta desconocida.
  }
  return 'desconocido';
};

export const onSnapshot: typeof rawOnSnapshot = ((target: any, ...args: any[]) => {
  const source = sourceOf(target);
  const lid = recordListenerOpen(source, describeTarget(target), readCallSite());
  const wrap = (cb: any) => (snap: any) => {
    const fromCache = !!snap?.metadata?.fromCache;
    const docs = typeof snap?.docChanges === 'function'
      ? snap.docChanges().length
      : (snap?.exists?.() ? 1 : 0);
    recordListenerSnap(lid, source, docs, fromCache);
    return cb(snap);
  };
  const cbIndex = args.findIndex(a => typeof a === 'function');
  if (cbIndex >= 0) args[cbIndex] = wrap(args[cbIndex]);
  const unsubscribe = (rawOnSnapshot as any)(target, ...args);
  return () => {
    recordListenerClose(lid, source);
    unsubscribe();
  };
}) as any;

export const getDocs: typeof rawGetDocs = (async (q: any) => {
  const site = readCallSite();
  const started = Date.now();
  const snap = await rawGetDocs(q);
  recordOneShot('getDocs', sourceOf(q, snap), describeTarget(q), snap.size, !!snap.metadata?.fromCache, Date.now() - started, site);
  return snap;
}) as any;

export const getDoc: typeof rawGetDoc = (async (ref: any) => {
  const site = readCallSite();
  const started = Date.now();
  const snap = await rawGetDoc(ref);
  recordOneShot('getDoc', sourceOf(ref), String(ref?.path ?? ''), snap.exists() ? 1 : 0, !!snap.metadata?.fromCache, Date.now() - started, site);
  return snap;
}) as any;
let readMeterSyncTimer: ReturnType<typeof setInterval> | null = null;
let readMeterSyncEmail = '';

// Envía el registro del día a read_meter (solo escritura) cada 20 min si hubo cambios y al ocultar la app.
export const startReadMeterSync = (email: string) => {
  const clean = (email || '').trim().toLowerCase();
  if (!clean || useEmulators || readMeterSyncEmail === clean) return;
  readMeterSyncEmail = clean;
  const send = async () => {
    if (!auth.currentUser || !hasUnsentReadMeterChanges()) return;
    const payload = getReadMeterPayload();
    try {
      await setDoc(doc(db, 'read_meter', `${payload.date}__${clean}__${payload.device}`), { ...payload, email: clean });
      markReadMeterSent();
    } catch {
      // Se reintenta en el siguiente ciclo.
    }
  };
  if (readMeterSyncTimer) clearInterval(readMeterSyncTimer);
  readMeterSyncTimer = setInterval(send, 20 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void send();
  });
};

export {
  collection, 
  addDoc, 
  setDoc,
  query, 
  where, 
  orderBy, 
  serverTimestamp, 
  doc, 
  updateDoc, 
  deleteDoc,
  writeBatch,
  getDocFromServer,
  documentId,
  limit,
  increment,
  runTransaction,
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut, 
  updatePassword
};
