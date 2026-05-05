/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const configuredFirebase = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || firebaseConfig.measurementId,
};

if (!configuredFirebase.apiKey || !configuredFirebase.authDomain || !configuredFirebase.projectId || !configuredFirebase.appId) {
  console.error("Firebase configuration is incomplete. Set VITE_FIREBASE_* environment variables.");
}

const app = initializeApp(configuredFirebase);

export const db = getFirestore(
  app,
  import.meta.env.VITE_FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || '(default)'
);
export const auth = getAuth(app);
