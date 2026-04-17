import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const env = (key, fallback) =>
  (typeof import.meta !== 'undefined' && import.meta.env?.[key]) || fallback;

const firebaseConfig = {
  apiKey: env('VITE_FIREBASE_API_KEY', "AIzaSyAaj65Q3djx7jc1UZH-rIKYkeDbXsJUILQ"),
  authDomain: env('VITE_FIREBASE_AUTH_DOMAIN', "meal-planner-fa6ee.firebaseapp.com"),
  projectId: env('VITE_FIREBASE_PROJECT_ID', "meal-planner-fa6ee"),
  storageBucket: env('VITE_FIREBASE_STORAGE_BUCKET', "meal-planner-fa6ee.firebasestorage.app"),
  messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID', "487942784423"),
  appId: env('VITE_FIREBASE_APP_ID', "1:487942784423:web:2cef88382e4b41d78fe282"),
  measurementId: env('VITE_FIREBASE_MEASUREMENT_ID', "G-CNBSZSHC5E")
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
