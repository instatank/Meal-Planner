import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAaj65Q3djx7jc1UZH-rIKYkeDbXsJUILQ",
  authDomain: "meal-planner-fa6ee.firebaseapp.com",
  projectId: "meal-planner-fa6ee",
  storageBucket: "meal-planner-fa6ee.firebasestorage.app",
  messagingSenderId: "487942784423",
  appId: "1:487942784423:web:2cef88382e4b41d78fe282",
  measurementId: "G-CNBSZSHC5E"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
