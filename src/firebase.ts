import { getApps, initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  setDoc,
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  serverTimestamp, 
  doc, 
  getDoc,
  updateDoc, 
  deleteDoc,
  getDocs,
  writeBatch,
  getDocFromServer,
  documentId,
  limit,
  increment,
  runTransaction,
  connectFirestoreEmulator
} from "firebase/firestore";
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
export const db = getFirestore(app);
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

export {
  collection, 
  addDoc, 
  setDoc,
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  serverTimestamp, 
  doc, 
  getDoc,
  updateDoc, 
  deleteDoc,
  getDocs,
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
