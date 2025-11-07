# Firebase Cloud Messaging (FCM) セットアップガイド

## 概要

このアプリケーションでは、Firebase Cloud Messaging (FCM) を使用してWeb Push通知を実装しています。アプリが閉じている時でも、リマインダー通知を受け取ることができます。

## セットアップ手順

### 1. Firebase コンソールで FCM を有効化

1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. プロジェクトを選択
3. 左メニューから「プロジェクトの設定」をクリック
4. 「クラウドメッセージング」タブを開く
5. 「Web プッシュ証明書」セクションで「キーペアを生成」をクリック
6. 生成された VAPID キーをコピー

### 2. VAPID キーの設定

生成した VAPID キーを以下のファイルに設定してください：

**`src/app/services/fcm.service.ts`** (35行目)
```typescript
const vapidKey = 'YOUR_VAPID_KEY'; // ここに取得したVAPIDキーを設定
```

### 3. Service Worker の確認

Service Worker ファイル (`public/firebase-messaging-sw.js`) が正しく配置されていることを確認してください。

### 4. Firebase Cloud Functions の実装

アプリが閉じている時のリマインダー通知には、Firebase Cloud Functions が必要です。

#### 4.1 Firebase Functions の初期化

```bash
# Firebase CLI をインストール（未インストールの場合）
npm install -g firebase-tools

# Firebase にログイン
firebase login

# プロジェクトディレクトリで初期化
firebase init functions

# TypeScript を選択
# ESLint を使用するか選択
# 依存関係をインストールするか選択
```

#### 4.2 Cloud Functions の実装

`functions/src/index.ts` に以下のコードを追加：

```typescript
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as moment from 'moment';

admin.initializeApp();

// リマインダーチェック関数（1分ごとに実行）
export const checkReminders = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async (context) => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    try {
      // すべてのユーザーを取得
      const usersSnapshot = await db.collection('users').get();
      
      for (const userDoc of usersSnapshot.docs) {
        const user = userDoc.data();
        const userId = userDoc.id;
        const fcmToken = user.fcmToken;

        if (!fcmToken) {
          continue; // FCMトークンがない場合はスキップ
        }

        // ユーザーのタスクを取得
        const tasksSnapshot = await db.collection('tasks')
          .where('assigneeId', '==', userId)
          .where('isDeleted', '==', false)
          .get();

        for (const taskDoc of tasksSnapshot.docs) {
          const task = taskDoc.data();
          const taskId = taskDoc.id;

          // リマインダーを取得
          const remindersSnapshot = await db.collection('reminders')
            .where('taskId', '==', taskId)
            .where('isSent', '==', false)
            .get();

          for (const reminderDoc of remindersSnapshot.docs) {
            const reminder = reminderDoc.data();
            const reminderId = reminderDoc.id;

            // リマインダー時間をチェック
            const reminderTime = reminder.reminderTime.toMillis();
            const currentTime = now.toMillis();
            const timeDiff = currentTime - reminderTime;

            // リマインダー時間が過ぎている場合（1分以内の誤差を許容）
            if (timeDiff >= 0 && timeDiff <= 60000) {
              // Push通知を送信
              const message = {
                notification: {
                  title: task.title || 'タスクリマインダー',
                  body: reminder.message || 'タスクのリマインダーです',
                },
                data: {
                  taskId: taskId,
                  type: 'task_reminder',
                  url: `/task/${taskId}`
                },
                token: fcmToken
              };

              try {
                await admin.messaging().send(message);
                
                // リマインダーを送信済みにマーク
                await db.collection('reminders').doc(reminderId).update({
                  isSent: true,
                  sentAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // Firestoreに通知レコードを作成
                await db.collection('notifications').add({
                  userId: userId,
                  type: 'task_reminder',
                  title: task.title || 'タスクリマインダー',
                  message: reminder.message || 'タスクのリマインダーです',
                  taskId: taskId,
                  isRead: false,
                  createdAt: admin.firestore.FieldValue.serverTimestamp()
                });

                console.log(`Reminder sent to user ${userId} for task ${taskId}`);
              } catch (error) {
                console.error(`Error sending reminder to user ${userId}:`, error);
              }
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error checking reminders:', error);
      return null;
    }
  });
```

#### 4.3 依存関係のインストール

`functions/package.json` に以下を追加：

```json
{
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "firebase-functions": "^4.5.0",
    "moment": "^2.29.4"
  }
}
```

インストール：

```bash
cd functions
npm install
```

#### 4.4 Cloud Functions のデプロイ

```bash
firebase deploy --only functions
```

### 5. 動作確認

1. アプリを起動し、ログイン
2. ブラウザの通知許可ダイアログが表示されることを確認
3. 通知を許可
4. ブラウザのコンソールで FCM トークンが取得されていることを確認
5. Firestore の `users` コレクションで、ユーザーの `fcmToken` が保存されていることを確認

### 6. リマインダーのテスト

1. タスクを作成し、リマインダーを設定
2. リマインダー時間が過ぎるまで待機
3. Cloud Functions がリマインダーをチェックし、Push通知を送信することを確認

## トラブルシューティング

### Service Worker が登録されない

- `public/firebase-messaging-sw.js` が正しく配置されているか確認
- ブラウザの開発者ツールで Service Worker の登録エラーを確認
- HTTPS または localhost で実行しているか確認

### FCM トークンが取得できない

- VAPID キーが正しく設定されているか確認
- ブラウザの通知許可が承認されているか確認
- ブラウザのコンソールでエラーメッセージを確認

### Push通知が届かない

- Cloud Functions が正しくデプロイされているか確認
- Firestore の `reminders` コレクションにリマインダーが正しく保存されているか確認
- Cloud Functions のログを確認（`firebase functions:log`）

### フォアグラウンドで通知が表示されない

- アプリが開いている時は、フォアグラウンドメッセージリスナーで処理される
- `app.component.ts` の `initializeFcm` メソッドで通知を表示しているか確認

## コスト

- **Firebase Cloud Messaging**: 無料
- **Firebase Cloud Functions**: 
  - 無料枠: 1日125,000回の呼び出し、40,000 GB秒の計算時間
  - 小規模利用なら無料枠内で十分

## 参考資料

- [Firebase Cloud Messaging ドキュメント](https://firebase.google.com/docs/cloud-messaging)
- [Firebase Cloud Functions ドキュメント](https://firebase.google.com/docs/functions)
- [Web Push 通知 API](https://developer.mozilla.org/ja/docs/Web/API/Push_API)

