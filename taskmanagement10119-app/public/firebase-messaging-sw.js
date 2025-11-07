// Import Firebase scripts
importScripts('https://www.gstatic.com/firebasejs/12.4.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.4.0/firebase-messaging-compat.js');

// Firebase設定
const firebaseConfig = {
  apiKey: "AIzaSyBI5iwEIJQwg9JWQYIJYalp1wPtVh9_lAM",
  authDomain: "kensyu10119.firebaseapp.com",
  projectId: "kensyu10119",
  storageBucket: "kensyu10119.firebasestorage.app",
  messagingSenderId: "1072279896525",
  appId: "1:1072279896525:web:8ee239736010eaa7848484",
  measurementId: "G-DDV5D2G9DL"
};

// Firebaseを初期化
firebase.initializeApp(firebaseConfig);

// Messagingインスタンスを取得
const messaging = firebase.messaging();

// バックグラウンドメッセージのハンドラー
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification?.title || 'タスクリマインダー';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.message || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: payload.data || {}
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// 通知クリック時の処理
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Notification click received.');
  
  event.notification.close();

  // 通知のデータからページURLを取得
  const urlToOpen = event.notification.data?.url || '/home';
  
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // 既に開いているウィンドウがある場合はそこにフォーカス
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // 新しいウィンドウを開く
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

