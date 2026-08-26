import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Proyecto Firebase: domis-6947e
// Estas credenciales Web NO son secretos. La protección real está en
// Firebase Authentication + Firestore Security Rules.
export const firebaseConfig = {
  apiKey: "AIzaSyD4x4D8OhBv8lQ4jiA_fAMJZ0B-PNL0PhQ",
  authDomain: "domis-6947e.firebaseapp.com",
  projectId: "domis-6947e",
  storageBucket: "domis-6947e.firebasestorage.app",
  messagingSenderId: "252408533038",
  appId: "1:252408533038:web:aa720a586658fb5b308fbf"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// IndexedDB mantiene la operación disponible con conexión intermitente.
// El gestor multi-pestaña evita conflictos si el usuario abre la app dos veces.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
