/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const configuredFirebase = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

if (!configuredFirebase.apiKey || !configuredFirebase.authDomain || !configuredFirebase.projectId || !configuredFirebase.appId) {
  console.error("Firebase configuration is incomplete. Set VITE_FIREBASE_* environment variables.");
}

const app = initializeApp(configuredFirebase);

export const db = getFirestore(
  app,
  import.meta.env.VITE_FIRESTORE_DATABASE_ID || '(default)'
);
export const auth = getAuth(app);
