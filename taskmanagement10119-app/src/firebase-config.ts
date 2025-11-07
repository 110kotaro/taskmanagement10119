import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getMessaging, getToken, onMessage, Messaging } from 'firebase/messaging';

// Firebase設定 - 実際の設定値は環境変数から取得してください
const firebaseConfig = {
    apiKey: "AIzaSyBI5iwEIJQwg9JWQYIJYalp1wPtVh9_lAM",
    authDomain: "kensyu10119.firebaseapp.com",
    projectId: "kensyu10119",
    storageBucket: "kensyu10119.firebasestorage.app",
    messagingSenderId: "1072279896525",
    appId: "1:1072279896525:web:8ee239736010eaa7848484",
    measurementId: "G-DDV5D2G9DL"
  };

// Firebase を初期化
const app = initializeApp(firebaseConfig);

// Firebase サービスをエクスポート
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Firebase Cloud Messaging (FCM) を初期化
// 注意: Service Workerが登録されている場合のみ動作します
let messaging: Messaging | null = null;
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  try {
    messaging = getMessaging(app);
  } catch (error) {
    console.warn('Firebase Messaging initialization failed:', error);
  }
}
export { messaging };

