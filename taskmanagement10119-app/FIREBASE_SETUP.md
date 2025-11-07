# Firebase設定ガイド

このアプリケーションを使用するには、Firebase設定が必要です。

## 手順

### 1. Firebaseプロジェクトの作成

1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. 「プロジェクトを追加」をクリック
3. プロジェクト名を入力し、プロジェクトを作成

### 2. Firebase設定の取得

#### ステップ1: プロジェクトの設定画面を開く
1. Firebase Console で左側の**歯車アイコン** ⚙️ をクリック
2. 「**プロジェクトの設定**」を選択

#### ステップ2: Webアプリを追加（まだ追加していない場合）
「マイアプリ」セクションまでスクロールして：

1. 「**</> Web**」アイコンをクリック
2. アプリの**ニックネーム**を入力（例: "タスク管理アプリ"）
3. 「**アプリを登録**」ボタンをクリック

#### ステップ3: Firebase SDK追加画面のスキップ
**注意**: 「Firebase SDKの追加」という画面が表示されますが、これはスキップできます。
なぜなら、私たちはすでに `npm install firebase` でインストール済みだからです。

画面右上の「✕」ボタンをクリックして、設定画面に戻ります。

#### ステップ4: 設定情報を取得
再度プロジェクトの設定画面から、追加したアプリを選択すると、以下のような設定オブジェクトが表示されます：

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

2. この設定オブジェクト全体をコピーします
3. 「閉じる」をクリックして設定画面を閉じます

**注意**: 既存のWebアプリがある場合は、そのアプリを選択すると設定情報が表示されます

### 3. アプリケーションへの設定追加

1. `src/firebase-config.ts` ファイルを開く
2. Firebase Consoleでコピーした設定オブジェクトの値を、以下のように貼り付けます：

**変更前:**
```typescript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

**変更後（例）:**
```typescript
const firebaseConfig = {
  apiKey: "AIza...（実際の値）",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

**重要**: `YOUR_API_KEY` などのプレースホルダーを、Firebase Consoleからコピーした**実際の値**に置き換えてください。

### 4. Firebase Authentication の有効化

1. Firebase Console で「Authentication」を選択
2. 「始める」をクリック
3. 「ログイン方法」タブで「メール/パスワード」を有効化

### 5. Firestore Database のセットアップ

1. Firebase Console で「**Firestore Database**」を選択
2. 「**データベースを作成**」をクリック

#### エディションの選択
**「Blaze（従量課金制）」を選択してください**

- Blaze には無料枠があります（1日の読み取り50,000件、書き込み20,000件、削除20,000件まで無料）
- 学習・開発用途では無料で十分です
- 制限に達していない限り課金されません

#### セキュリティルールの選択
**「テストモードで開始」を選択してください**

- テストモードは開発中に使用しやすい
- 30日間は全員が読み書き可能（開発用）
- 後でセキュリティルールを設定できます

#### ロケーションの選択
- 「asia-northeast1（Tokyo）」を選択（日本国内）
- または推奨される最寄りのロケーションを選択

4. 「**有効にする**」ボタンをクリック

### 6. Firestore セキュリティルール（開発用）

開発中は以下のルールを使用：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 開発用：30日間全ての読み書きを許可
    match /{document=**} {
      allow read, write: if request.time < timestamp.date(2026, 12, 31);
    }
  }
}
```

**本番環境用の厳密なルール（後で使用）：**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // ユーザーは自分のドキュメントのみ読み書き可能
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // タスクは作成者または担当者のみアクセス可能
    // 新規作成時も許可、既存データは検証
    match /tasks/{taskId} {
      allow create: if request.auth != null && 
        (request.resource.data.creatorId == request.auth.uid || 
         request.resource.data.assigneeId == request.auth.uid);
      
      allow read, update, delete: if request.auth != null && 
        (resource.data.creatorId == request.auth.uid || 
         resource.data.assigneeId == request.auth.uid);
    }
    
    // プロジェクトはメンバーのみアクセス可能
    match /projects/{projectId} {
      allow read: if request.auth != null && 
        (resource.data.ownerId == request.auth.uid || 
         exists(/databases/$(database)/documents/projects/$(projectId)/members/$(request.auth.uid)));
    }
  }
}
```

### 7. Storage のセットアップ（オプション）

ファイル添付機能を使用する場合：

1. Firebase Console で「Storage」を選択
2. 「**始める**」をクリック
3. デフォルトバケットセットアップ画面が表示されます

#### セキュリティルールの選択
**「テストモードで開始」を選択してください**

- 無料枠があります（5GBのストレージ、1日1GBのダウンロードまで無料）
- 開発用途では無料で十分です
- テストモードは一時的に全ての読み書きを許可します

#### ロケーションの選択
**重要**: どのロケーションを選んでも、無料枠（5GBストレージ、1日1GBダウンロード）は同じです。

**推奨**: 日本国内からアクセスする場合は「asia-northeast1（Tokyo）」を選択
- レイテンシー（遅延）が少ない
- データ転送速度が速い

他のロケーションも表示される場合は、以下のうちどれかを選択できます：
- **asia-northeast1 (Tokyo)**: 日本 - 最も推奨
- **asia-northeast2 (Osaka)**: 日本
- **asia-east1 (Taiwan)**: 台湾（比較的近い）

4. 「**完了**」ボタンをクリック

**注意**: テストモードは**開発用**です。本番環境では適切なセキュリティルールを設定してください。

## アプリの起動

設定完了後、以下のコマンドでアプリを起動します：

```bash
npm start
```

ブラウザで `http://localhost:4200` を開いてください。

## 注意事項

- 本番環境では、適切なFirestoreセキュリティルールを設定してください
- APIキーなどの機密情報は環境変数を使用することを推奨します
- Production ビルドでは、Firebaseの設定を環境変数から読み込むように変更してください

