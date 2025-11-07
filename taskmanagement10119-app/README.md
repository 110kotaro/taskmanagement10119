# タスク管理アプリ (Task Management App)

Angular 18とFirebaseを使用した包括的なタスク管理アプリケーションです。

## 機能概要

### 実装済み機能

1. **認証システム**
   - ユーザー登録・ログイン
   - Firebase Authentication による安全な認証

2. **タスク管理**
   - タスクのCRUD操作（作成、読み取り、更新、削除）
   - 今日のタスク・今週のタスクの表示
   - タスクステータス管理（未着手、進行中、完了済み）
   - 優先度（重要、普通、低め、なし、カスタム）
   - タスクタイプ（通常、会議、定期、プロジェクト、その他）

3. **プロジェクト管理**
   - プロジェクトの作成・管理
   - メンバー管理
   - 権限システム

4. **データモデル**
   - 完全なTypeScript型定義
   - Firestoreとの統合

### 開発中・予定機能

- タスク詳細画面
- カレンダー・ガントチャート表示
- 作業時間計測（通常タイマー・ポモドーロ）
- リマインダー機能
- 通知システム
- コメント機能
- ファイル添付
- サブタスク管理
- 統計・レポート
- テーマ設定
- Excel連携

## 技術スタック

- **Frontend**: Angular 18
- **Backend**: Firebase (Authentication, Firestore, Storage)
- **UI Framework**: Angular Material（予定）
- **言語**: TypeScript

## セットアップ

### 必要な環境

- Node.js 18以上
- npm または yarn

### インストール

```bash
# 依存関係のインストール
npm install

# Firebase設定
# FIREBASE_SETUP.md を参照してFirebase設定を行ってください
```

### 開発サーバーの起動

```bash
# 開発サーバーを起動
npm start

# ブラウザで http://localhost:4200 を開く
```

### ビルド

```bash
# 本番環境用ビルド
npm run build
```

## プロジェクト構造

```
src/
├── app/
│   ├── components/
│   │   ├── login/         # ログイン・登録コンポーネント
│   │   └── home/          # ホーム画面コンポーネント
│   ├── models/            # データモデル
│   │   ├── task.model.ts
│   │   ├── project.model.ts
│   │   ├── user.model.ts
│   │   └── notification.model.ts
│   ├── services/          # サービス
│   │   ├── auth.service.ts
│   │   ├── task.service.ts
│   │   └── project.service.ts
│   ├── app.component.ts
│   ├── app.config.ts
│   └── app.routes.ts
├── firebase-config.ts     # Firebase設定
└── styles.css

firebase-config.ts         # Firebase設定ファイル
FIREBASE_SETUP.md         # Firebase設定ガイド
```

## Firebase設定

Firebaseプロジェクトの設定方法は `FIREBASE_SETUP.md` を参照してください。

## 現在の進捗

- ✅ 基本的な認証システム
- ✅ タスクデータモデル設計
- ✅ プロジェクトデータモデル設計
- ✅ 基本的なサービス実装
- ✅ ホーム画面（今日・今週のタスク表示）
- ⏳ タスク詳細画面
- ⏳ カレンダー・ガントチャート表示
- ⏳ 作業時間計測機能
- ⏳ リマインダー機能
- ⏳ 通知システム

## 開発コマンド

```bash
# 開発サーバー起動
npm start

# ビルド
npm run build

# テスト実行
npm test

# リンター実行
npm run lint
```

## ライセンス

このプロジェクトは学習目的で作成されています。
