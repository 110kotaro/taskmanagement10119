# タスク管理アプリ - アーキテクチャ解説

## 概要
このアプリは Angular 18 + Firebase で構築されたタスク管理アプリケーションです。

## 1. Firebase設定 (`src/firebase-config.ts`)

### 役割
- Firebase サービス（Authentication, Firestore, Storage）の初期化
- アプリ全体で共有される設定とインスタンス

### 主要なエクスポート
- `auth`: Firebase Authentication のインスタンス（ログイン管理）
- `db`: Firestore データベースのインスタンス（データ保存）
- `storage`: Firebase Storage のインスタンス（ファイル保存）

---

## 2. データモデル (`src/app/models/`)

### 2.1 `task.model.ts` - タスクデータ構造

#### Enums（列挙型）
- **TaskStatus**: タスクの状態
  - `NotStarted`: 未着手
  - `InProgress`: 進行中
  - `Completed`: 完了
  - `Overdue`: 期限切れ

- **PriorityLabel**: 優先度
  - `Important`, `Normal`, `Low`, `None`, `Custom`

- **TaskType**: タスクの種類
  - `Normal`, `Meeting`, `Regular`, `Project`, `Other`

- **RecurrenceType**: 繰り返し設定
  - `None`, `Daily`, `Weekly`, `Monthly`, `Yearly`, `Biweekly`

#### 主要なインターフェース

##### `Task` - メインタスクインターフェース
```typescript
{
  id: string;                    // タスクの一意識別子
  title: string;                 // タスクのタイトル
  description?: string;          // 説明（オプション）
  projectId?: string;           // 所属プロジェクトID
  projectName?: string;         // プロジェクト名（表示用）
  assigneeId?: string;          // 担当者ID
  assigneeName?: string;        // 担当者名
  creatorId: string;            // 作成者ID
  creatorName: string;          // 作成者名
  status: TaskStatus;           // ステータス
  startDate: Timestamp;         // 開始日
  endDate: Timestamp;           // 期限
  priority: PriorityLabel;      // 優先度
  memo?: string;                // メモ
  files?: Array<{...}>;         // 添付ファイル
  subtasks: SubTask[];          // サブタスク
  progress: number;             // 進捗率（0-100）
  reminders: Reminder[];        // リマインダー
  workSessions: WorkSession[];  // 作業セッション
  totalWorkTime: number;        // 総作業時間（分）
  isDeleted: boolean;           // 削除フラグ
  createdAt: Timestamp;         // 作成日時
  updatedAt: Timestamp;         // 更新日時
}
```

##### 補助インターフェース
- **SubTask**: サブタスク（タスク内の子タスク）
- **WorkSession**: 作業セッション（ポモドーロタイマーなど）
- **Reminder**: リマインダー設定

### 2.2 `project.model.ts` - プロジェクトデータ構造

```typescript
Project {
  id: string;
  name: string;
  description?: string;
  ownerId: string;             // プロジェクト所有者のID
  ownerName: string;
  members: ProjectMember[];     // メンバーリスト
  startDate: Timestamp;
  endDate: Timestamp;
  completionRate: number;       // 完了率（0-100）
  totalTasks: number;           // 総タスク数
  completedTasks: number;       // 完了タスク数
  isDeleted: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

ProjectMember {
  userId: string;
  userName: string;
  userEmail: string;
  role: ProjectRole;           // owner, admin, member, viewer
  joinedAt: Timestamp;
}
```

### 2.3 `user.model.ts` - ユーザーデータ構造

```typescript
User {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
  role: UserRole;              // 'admin' or 'user'
  theme: 'light' | 'dark';
  notificationSettings: NotificationSetting;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## 3. サービス層 (`src/app/services/`)

### 3.1 `AuthService` - 認証サービス

#### 機能
- ユーザー登録・ログイン・ログアウト
- 認証状態の監視
- Firestoreへのユーザーデータ保存

#### 主要メソッド
```typescript
signUp(email, password, displayName): Promise<void>
  - 新規ユーザー登録
  - Firebase Authenticationでアカウント作成
  - Firestoreにユーザー情報を保存

signIn(email, password): Promise<void>
  - ユーザーログイン
  - 成功時、ホーム画面へリダイレクト

signOut(): Promise<void>
  - ログアウト
  - ログイン画面へリダイレクト

getUserData(uid): Promise<User | null>
  - Firestoreからユーザーデータを取得
```

#### 認証状態監視
```typescript
private currentUserSubject = new BehaviorSubject<FirebaseUser | null>(null);
public currentUser$ = this.currentUserSubject.asObservable();

constructor() {
  // Firebase Authenticationの状態変更を監視
  onAuthStateChanged(auth, (user) => {
    this.currentUserSubject.next(user);
  });
}
```

### 3.2 `TaskService` - タスク管理サービス

#### 主要メソッド

##### `createTask(taskData): Promise<string>`
- 新規タスク作成
- **重要**: `undefined` のフィールドは Firestore に保存しない
- Firestore は `undefined` を扱えないため、条件分岐で除外

##### `getTask(taskId): Promise<Task | null>`
- IDからタスクを取得

##### `updateTask(taskId, updates): Promise<void>`
- タスク更新
- **重要**: `undefined` の値は `deleteField()` を使って Firestore から削除

##### `deleteTask(taskId): Promise<void>`
- タスクを「ソフト削除」（`isDeleted: true` に設定）
- 物理削除ではなく、削除フラグで制御

##### `getTasks(filters): Promise<Task[]>`
- フィルタ条件でタスクを取得
- クライアント側でソート（インデックス不要）

##### `getTodayTasks(userId): Promise<Task[]>`
- 今日以降が期限のタスクを取得
- クライアント側でフィルタリング

##### `getWeekTasks(userId): Promise<Task[]>`
- 今週内に期限があるタスクを取得
- クライアント側でフィルタリング

### 3.3 `ProjectService` - プロジェクト管理サービス

#### 主要メソッド
```typescript
createProject(projectData): Promise<string>
  - 新規プロジェクト作成
  - 作成者を自動的に owner として追加

getProject(projectId): Promise<Project | null>
  - IDからプロジェクトを取得

updateProject(projectId, updates): Promise<void>
  - プロジェクト更新

getProjectsForUser(userId): Promise<Project[]>
  - ユーザーが参加しているプロジェクトを取得
  - 現在は owner のみ取得（メンバー検索は未実装）
```

---

## 4. コンポーネント層 (`src/app/components/`)

### 4.1 `AppComponent` - ルートコンポーネント

#### 役割
- アプリ全体の認証状態監視
- 未ログイン時のリダイレクト処理

#### 実装
```typescript
ngOnInit() {
  this.authService.currentUser$.subscribe(user => {
    if (user) {
      // ログイン済み: ログイン画面にいる場合はホームへ
      if (currentUrl === '/login') {
        this.router.navigate(['/home']);
      }
    } else {
      // 未ログイン: 保護されたページからはログイン画面へ
      if (currentUrl !== '/login' && currentUrl !== '/') {
        this.router.navigate(['/login']);
      }
    }
  });
}
```

### 4.2 `LoginComponent` - ログイン/登録

#### 機能
- ログインフォーム（メールアドレス、パスワード）
- 登録フォーム（表示名、メールアドレス、パスワード、パスワード確認）
- フォームの切り替え

#### バリデーション
- メールアドレス: `Validators.email`
- パスワード: 最低6文字

### 4.3 `HomeComponent` - ホーム画面

#### 機能
- 今日のタスク一覧（カテゴリ別表示）
- 今週のタスク一覧
- タスク作成・削除
- プロジェクト一覧への遷移
- ガントチャートへの遷移
- 通知画面への遷移

#### タスクカテゴリ分類
```typescript
TaskCategoryService.categorizeTasks(tasks)
  → [
    { name: '今日が期限', tasks: [...] },
    { name: '今日から開始', tasks: [...] },
    { name: '進行中', tasks: [...] },
    { name: '期限切れ（未完了）', tasks: [...] }
  ]
```

### 4.4 `TaskCreateComponent` - タスク作成

#### フォーム項目
- タイトル（必須）
- 説明
- メモ
- ステータス
- 優先度
- 開始日（必須）
- 期限（必須）
- プロジェクト（オプション）

#### 実装のポイント
- プロジェクト選択: ドロップダウンから選択
- プロジェクト名も自動保存: ID から名前に変換

### 4.5 `TaskDetailComponent` - タスク詳細・編集

#### 機能
- タスク情報の表示
- タスク情報の編集
- タスクの削除
- 作業時間計測の開始

#### 実装のポイント
- 表示モードと編集モードの切り替え
- プロジェクト名の取得（保存されていない場合は動的取得）
- プロジェクト変更: ドロップダウンで選択・削除可能
- メモ編集: 表示・編集両対応

### 4.6 `ProjectListComponent` - プロジェクト一覧

#### 機能
- ユーザーが参加しているプロジェクトの表示
- プロジェクト作成
- プロジェクト詳細への遷移

### 4.7 `ProjectCreateComponent` - プロジェクト作成

#### フォーム項目
- プロジェクト名（必須）
- 説明
- 開始日
- 期限

### 4.8 `ProjectDetailComponent` - プロジェクト詳細

#### 機能
- プロジェクト情報の表示
- プロジェクトに紐づくタスクの表示
- ガントチャートからの戻り対応

### 4.9 `GanttComponent` - ガントチャート

#### 機能
- タスクとプロジェクトのガントチャート表示
- 日付範囲の変更
- タスク/プロジェクトの切り替え
- タスク・プロジェクト詳細への遷移

#### 実装のポイント
- カスタムガントチャート実装
- Flexbox を使用したレイアウト
- プロジェクト完了率によるグラデーション色分け

#### 詳細解説

**1. データ構造**

```typescript
// ガントチャート用のタスクデータ
interface GanttTask {
  task: Task;                  // 元のタスクデータ
  startDateIndex: number;      // 開始日のインデックス（何日目か）
  durationDays: number;        // 継続日数
}

// ガントチャート用のプロジェクトデータ
interface GanttProject {
  project: Project;
  startDateIndex: number;
  durationDays: number;
}
```

**2. 日付範囲の計算**

```typescript
async loadTasks() {
  // 1. 全てのタスクの開始日・終了日を取得
  const dates = this.allTasks.flatMap(task => [
    task.startDate.toDate(),
    task.endDate.toDate()
  ]);
  
  // 2. 最も早い日と最も遅い日を取得
  const startDate = new Date(Math.min(...dates.map(d => d.getTime())));
  const endDate = new Date(Math.max(...dates.map(d => d.getTime())));
  
  // 3. 日付範囲を設定
  this.dateRange = { start: startDate, end: endDate };
  this.customDateRange = { start: new Date(startDate), end: new Date(endDate) };
}
```

**3. 日付列の生成**

```typescript
generateDateColumnsAndRecalculate() {
  // 1. 日付列を生成（開始日から終了日まで）
  this.dateColumns = [];
  const currentDate = new Date(this.customDateRange.start);
  
  // 2. 1日ずつ追加していく
  while (currentDate <= this.customDateRange.end) {
    this.dateColumns.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);  // 翌日に進む
  }
  
  // 3. ガントチャートの位置を再計算
  this.recalculateGanttWithAllDates(this.dateColumns);
}
```

**4. ガントチャートバーの位置計算**

```typescript
recalculateGanttWithAllDates(allDateColumns: Date[]) {
  this.ganttTasks = this.allTasks
    .map(task => {
      const taskStart = task.startDate.toDate();
      const taskEnd = task.endDate.toDate();
      
      // 1. 全ての日付列の中で該当するインデックスを探す
      const startIndex = allDateColumns.findIndex(date => {
        // 日時を捨てて、日付のみで比較
        const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const taskStartOnly = new Date(taskStart.getFullYear(), taskStart.getMonth(), taskStart.getDate());
        return dateOnly.getTime() === taskStartOnly.getTime();
      });

      const endIndex = allDateColumns.findIndex(date => {
        const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const taskEndOnly = new Date(taskEnd.getFullYear(), taskEnd.getMonth(), taskEnd.getDate());
        return dateOnly.getTime() === taskEndOnly.getTime();
      });

      // 2. 範囲外の場合は除外
      if (startIndex === -1 || endIndex === -1) {
        return null;
      }

      // 3. ガントチャートデータを返す
      return {
        task,
        startDateIndex: startIndex,           // 何日目から開始
        durationDays: endIndex - startIndex + 1  // 継続日数
      };
    })
    .filter(g => g !== null) as GanttTask[];
}
```

**5. ガントバーの表示位置（CSS + HTML）**

**現在の実装（Flexbox方式）**:

```html
<div class="gantt-bar-container" [style.flex]="dateColumns.length">
  <!-- 開始位置までのスペース -->
  <div class="gantt-bar-spacer" 
       *ngFor="let i of [].constructor(ganttTask.startDateIndex)" 
       style="flex: 1;"></div>
  
  <!-- バー本体 -->
  <div 
    class="gantt-bar" 
    [style.flex]="ganttTask.durationDays"
    [style.background-color]="getStatusColor(ganttTask.task.status)">
    <span class="bar-duration">{{ ganttTask.durationDays }}日</span>
  </div>
  
  <!-- 終了位置以降のスペース -->
  <div class="gantt-bar-spacer" 
       [style.flex]="dateColumns.length - ganttTask.startDateIndex - ganttTask.durationDays"></div>
</div>
```

**仕組み**:
1. 開始位置までのスペース: `startDateIndex` 個のスペーサー要素を配置（1日 = 1スペーサー）
2. バー本体: `flex: durationDays` で幅を決定（継続日数分）
3. 終了位置以降のスペース: 残りのスペースを埋める

**CSS設定**:

```css
.gantt-bar-container {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-shrink: 0;
}

.gantt-bar-spacer {
  min-width: 30px;  /* 日付列と同じ最小幅 */
}

.gantt-bar {
  min-width: 30px;  /* 日付列と同じ最小幅 */
}
```

**日付列との連動**:
- 日付列が `min-width: 30px` で圧縮限界に達すると、バーも同じサイズに固定
- 両方が同じ `flex` ベース（`dateColumns.length`）を使用
- 期間を延ばしても位置がずれない

**6. プロジェクトのグラデーション色**

```typescript
getProjectColor(completionRate: number): string {
  // 0-30%: 青 → ライトブルー
  if (completionRate <= 30) {
    const intensity = completionRate / 30;
    const r = Math.round(33 + (173 - 33) * intensity);
    const g = Math.round(150 + (216 - 150) * intensity);
    const b = 243;
    return `rgb(${r}, ${g}, ${b})`;
  }
  
  // 30-60%: ライトブルー → 黄
  // 60-85%: 黄 → オレンジ
  // 85-100%: オレンジ → 緑
  // ... (以下同様)
}
```

**色の変化**:
- 0-30%: 青（開始前～初期段階）
- 30-60%: ライトブルー→黄（進行中）
- 60-85%: 黄→オレンジ（後半）
- 85-100%: オレンジ→緑（ほぼ完了）

**7. Flexbox によるレイアウト**

```css
/* 行全体 */
.gantt-row {
  display: flex;
  align-items: stretch;
  position: relative;
  overflow-x: visible;  /* stickyを効かせるため */
}

/* タスクラベル（固定） */
.task-label {
  flex: 0 0 200px;
  position: sticky;
  left: 1rem;  /* スクロール時も左端から1remの位置に固定 */
  z-index: 5;
  box-shadow: 2px 0 4px rgba(0, 0, 0, 0.05);
}

/* 日付列コンテナ */
.date-columns-container {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-shrink: 0;  /* 圧縮されない */
}

/* 日付1個 */
.date-column {
  flex: 1 1 0;
  min-width: 30px;  /* これ以上は圧縮されない */
}

/* バーコンテナ */
.gantt-bar-container {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-shrink: 0;  /* 圧縮されない */
}
```

**stickyによる固定**:
```css
/* ヘッダーのラベルも固定 */
.task-label-header {
  position: sticky;
  left: 1rem;  /* 左端から1rem */
  z-index: 15;  /* タスクラベルより前面 */
  box-shadow: 2px 0 4px rgba(0, 0, 0, 0.05);
}

/* ヘッダー行全体も上部に固定 */
.gantt-header-row {
  position: sticky;
  top: 0;
  z-index: 10;
}
```

**8. 日付の入力と変更**

```typescript
onStartDateChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const newDate = new Date(input.value);
  
  if (this.customDateRange) {
    this.customDateRange.start = newDate;  // 開始日を更新
    this.generateDateColumnsAndRecalculate();  // 再計算
  }
}

onEndDateChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const newDate = new Date(input.value);
  
  if (this.customDateRange) {
    this.customDateRange.end = newDate;    // 終了日を更新
    this.generateDateColumnsAndRecalculate();  // 再計算
  }
}
```

**9. 全体のフロー**

```typescript
// 1. 初期化
ngOnInit() {
  const mode = this.route.snapshot.queryParamMap.get('mode');
  if (mode === 'projects') {
    this.loadProjects();
  } else {
    this.loadTasks();
  }
}

// 2. データ読み込み
loadTasks() {
  // → タスク取得
  // → 日付範囲計算
  // → ガントチャート生成
}

// 3. 表示モード切り替え
switchView(mode: 'tasks' | 'projects') {
  this.viewMode = mode;
  this.loadTasks();  // または loadProjects()
}
```

**10. 重要なポイント**

| ポイント | 説明 |
|---------|------|
| **日付の比較** | `getTime()` でミリ秒に変換して比較 |
| **日付のみ比較** | `new Date(年, 月, 日)` で時間部分を捨てる |
| **インデックス計算** | `findIndex()` で日付列の中の位置を探す |
| **Flexbox配置** | `*ngFor` でスペーサー要素を配置し、バーの位置を決定 |
| **バーの幅** | `flex: durationDays` で継続日数分の幅を指定 |
| **圧縮連動** | `min-width: 30px` を日付列とバー両方に設定して連動 |
| **sticky固定** | `position: sticky` と `left: 1rem` でタスクラベルを固定 |
| **スクロール** | `overflow-x: auto` で横スクロール、`overflow: visible` でstickyを効かせる |
| **flex-shrink** | `flex-shrink: 0` で要素が圧縮されないよう設定 |

---

## 5. ルーティング (`src/app/app.routes.ts`)

```typescript
'/login'           → LoginComponent
'/home'            → HomeComponent
'/task/create'     → TaskCreateComponent
'/task/:id'        → TaskDetailComponent
'/task/:taskId/timer' → TimerComponent
'/projects'        → ProjectListComponent
'/projects/create' → ProjectCreateComponent
'/project/:id'     → ProjectDetailComponent
'/notifications'   → NotificationsComponent
'/gantt'           → GanttComponent

'' (空)            → '/login' にリダイレクト
'**' (その他)      → '/login' にリダイレクト
```

---

## 6. 主要な実装パターン

### 6.1 ソフト削除
タスクやプロジェクトは物理削除せず、`isDeleted: true` フラグで管理。

**メリット**:
- 誤削除からの復旧が可能
- 削除履歴の保持
- 統計データの維持

### 6.2 クライアント側フィルタリング
Firestore のインデックス要件を回避するため、クライアント側でフィルタリング・ソート。

**理由**:
- 開発中のインデックス作成コスト削減
- シンプルなクエリで実装

**デメリット**:
- データ量が多い場合は非効率
- 本番環境では Firestore インデックス検討推奨

### 6.3 Angular の `inject()` パターン
```typescript
private service = inject(Service);
```
- `constructor` での依存性注入の代替
- よりシンプルな記述

### 6.4 Reactive Forms
```typescript
FormBuilder.group({
  field: ['初期値', [Validators.required, Validators.email]]
});
```
- タイプセーフなフォーム管理
- バリデーションの集約

### 6.5 Firestore の `undefined` 扱い
Firestore は `undefined` を許可しないため、条件分岐でフィールドを除外。

```typescript
// ❌ エラー
const data = { field: undefined };

// ✅ 正しい
const data: any = { ... };
if (value !== undefined) {
  data.field = value;
}
```

### 6.6 Firestore フィールド削除
```typescript
import { deleteField } from 'firebase/firestore';
cleanUpdates[key] = deleteField();
```
- `undefined` を設定したい場合は `deleteField()` を使用

---

## 7. Firebase セキュリティルール（推奨）

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // ユーザーデータ
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // タスク
    match /tasks/{taskId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null && 
        (request.auth.uid == resource.data.creatorId || 
         request.auth.uid == resource.data.assigneeId);
    }
    
    // プロジェクト
    match /projects/{projectId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null && 
        request.auth.uid == resource.data.ownerId;
    }
  }
}
```

---

## 8. 今後の拡張性

### 実装済み機能
- タスク管理（CRUD）
- プロジェクト管理（CRUD）
- ユーザー認証
- ガントチャート
- タスクカテゴリ分類
- メモ機能
- プロジェクト紐付け

### 実装済み機能（追加）
- ✅ サブタスク機能
- ✅ ワークタイムトラッキング
- ✅ ポモドーロタイマー
- ✅ リマインダー機能（開始前・期限前・カスタム設定）
- ✅ 繰り返しタスク
- ✅ カスタムラベル・タスクタイプ
- ✅ メモ機能
- ✅ プロジェクト紐付け

### 未実装機能
- ファイル添付
- 通知システム
- テーマ切り替え

---

## 9. トラブルシューティング

### インデックスエラー
```
Error: The query requires an index
```
→ **対応**: クライアント側フィルタリングを採用

### undefined エラー
```
Unsupported field value: undefined
```
→ **対応**: `undefined` フィールドを条件分岐で除外

### 認証エラー
```
User not authenticated
```
→ **対応**: `AuthService.currentUser` のチェック

### 日付のミスアライメント
- タイムゾーン問題: `setHours(0, 0, 0, 0)` で日付のみ比較

---

## 7. 追加実装機能の詳細解説

### 8.1 サブタスク機能

#### データモデル
```typescript
export interface SubTask {
  id: string;
  title: string;
  assigneeId?: string;
  assigneeName?: string;
  completed: boolean;
  completedAt?: Timestamp;
}
```

#### 主な機能
- タスク内にサブタスクを作成
- チェックボックスで完了状態を管理
- 完了率の自動計算

#### 実装のポイント
```typescript
// サブタスクの追加
const newSubtask: SubTask = {
  id: Date.now().toString(),
  title: this.newSubtaskTitle,
  completed: false,
  assigneeId: this.authService.currentUser?.uid,
  assigneeName: this.authService.currentUser?.displayName || 'Unknown'
};

const updatedSubtasks = [...this.task.subtasks, newSubtask];
await this.taskService.updateTask(this.task.id, { subtasks: updatedSubtasks });
```

#### Firestore 配列の更新制約
- 配列内では `deleteField()` が使えない
- 代わりに、`completedAt` を条件付きで含める/除外するアプローチを採用

```typescript
// 完了状態を更新する際の処理
const updatedSubtasks = this.task.subtasks.map(subtask => {
  const updatedSubtask: any = {
    id: subtask.id,
    title: subtask.title,
    completed: subtask.completed,
    assigneeId: subtask.assigneeId,
    assigneeName: subtask.assigneeName
  };
  
  // completedAt は completed の場合のみ追加
  if (subtask.completed && subtask.completedAt) {
    updatedSubtask.completedAt = subtask.completedAt;
  }
  // completed=false の場合は completedAt を省略
  
  return updatedSubtask;
});
```

#### 進捗率の計算
```typescript
getCompletedSubtasks(): number {
  return this.task.subtasks.filter(subtask => subtask.completed).length;
}

getProgressPercentage(): number {
  if (this.task.subtasks.length === 0) return 0;
  return Math.round((this.getCompletedSubtasks() / this.task.subtasks.length) * 100);
}
```

### 8.2 ワークタイムトラッキング機能

#### データモデル
```typescript
export interface WorkSession {
  id: string;
  startTime: Timestamp;
  endTime?: Timestamp;
  breakDuration: number;  // 分
  actualDuration: number; // 分
  isPomodoro: boolean;
  completedPomodoros?: number;
}
```

#### タスクデータへの統合
- `workSessions: WorkSession[]` - 作業セッションの履歴
- `totalWorkTime: number` - 総作業時間（分）

#### 実装のポイント
```typescript
// 作業セッションの保存
const workSession = {
  id: Date.now().toString(),
  startTime: Timestamp.fromMillis(this.timerState.startTime),
  endTime: now,
  breakDuration: this.timerState.breaks * 5, // 休憩時間
  actualDuration: minutes,  // 実際の作業時間
  isPomodoro: this.mode === 'pomodoro',
  completedPomodoros: this.mode === 'pomodoro' ? this.timerState.breaks + 1 : undefined
};

const currentWorkSessions = this.task.workSessions || [];
const updatedSessions = [...currentWorkSessions, workSession];
const newTotalTime = (this.task.totalWorkTime || 0) + minutes;

await this.taskService.updateTask(this.task.id, {
  workSessions: updatedSessions,
  totalWorkTime: newTotalTime
});
```

### 8.3 ポモドーロタイマー機能

#### 機能概要
- 25分間の作業と5分の休憩を繰り返す
- 作業セッション終了時に Firestore に保存
- 通常のタイマーとポモドーロの両方をサポート

#### タイマー状態管理
```typescript
interface TimerState {
  isRunning: boolean;
  isPaused: boolean;
  startTime: number;
  pausedTime: number;
  breaks: number;  // 休憩回数
}
```

#### ポモドーロサイクル
```typescript
// 25分経過で休憩時間に
if (this.mode === 'pomodoro' && elapsed >= 25 * 60) {
  this.showBreakNotification();
}

// 休憩時間は5分
if (this.mode === 'pomodoro' && this.isOnBreak && elapsed >= 5 * 60) {
  this.resume();
}
```

### 8.4 リマインダー機能

#### データモデル（更新版）
```typescript
export interface Reminder {
  id: string;
  type?: 'before_start' | 'before_end';  // 相対リマインダーの場合
  amount?: number;                         // 相対リマインダーのみ
  unit?: 'minute' | 'hour' | 'day';       // 相対リマインダーのみ
  scheduledAt?: Timestamp;                // カスタム設定（絶対日時）の場合のみ
  sent: boolean;
  sentAt?: Timestamp;
}
```

#### 3種類のリマインダー

##### 1. 開始前のリマインダー
- チェックボックスで有効化
- 開始日からの相対時間をプリセットから選択
- 例: 1日前、3時間前、1時間前、30分前、15分前、10分前、5分前、1分前

##### 2. 期限前のリマインダー
- チェックボックスで有効化
- 期限日からの相対時間をプリセットから選択
- 同じプリセット選択肢

##### 3. カスタム設定のリマインダー
- チェックボックスで有効化
- 特定の日時を直接入力（datetime-local）
- 開始前/期限前の区別なし

#### データ保存ロジック

```typescript
// 開始前のリマインダー
if (formValue.enableStartReminder && formValue.startReminderType !== 'none') {
  const preset = presetMap[formValue.startReminderType];
  if (preset) {
    reminders.push({
      id: (Date.now() + reminderCounter).toString(),
      type: 'before_start' as const,
      amount: preset.amount,
      unit: preset.unit,
      sent: false,
      scheduledAt: undefined
    });
  }
}

// 期限前のリマインダー
if (formValue.enableEndReminder && formValue.endReminderType !== 'none') {
  // 同様のロジック
}

// カスタム設定のリマインダー
if (formValue.enableCustomReminder && formValue.customReminderDateTime) {
  reminders.push({
    id: (Date.now() + reminderCounter).toString(),
    type: undefined,
    amount: undefined,
    unit: undefined,
    scheduledAt: Timestamp.fromDate(new Date(formValue.customReminderDateTime)),
    sent: false
  });
}
```

#### 実装のポイント
- **相対リマインダー**: `type` + `amount` + `unit` で開始日/期限日からの相対時間を表現
- **カスタムリマインダー**: `scheduledAt` で絶対日時を保存
- 複数のリマインダーを同時に設定可能

### 8.5 繰り返しタスク機能

#### データモデル
```typescript
export enum RecurrenceType {
  None = 'none',
  Daily = 'daily',
  Weekly = 'weekly',
  Monthly = 'monthly',
  Yearly = 'yearly',
  Biweekly = 'biweekly'
}

Task {
  recurrence: RecurrenceType;
  recurrenceEndDate?: Timestamp;
}
```

#### 実装
- UIで繰り返しパターンを選択
- 繰り返し終了日を設定可能
- `RecurrenceType` enumで値を管理

### 8.6 カスタムラベル・タスクタイプ機能

#### 優先度のカスタム設定
```typescript
// モデル
priority: PriorityLabel;
customPriority?: string;

// フォーム選択
<select id="priority" formControlName="priority">
  <option value="important">重要</option>
  <option value="normal">普通</option>
  <option value="low">低め</option>
  <option value="none">なし</option>
  <option value="custom">カスタム</option>
</select>

// カスタム入力
<input *ngIf="priority === 'custom'" formControlName="customPriority" placeholder="例: 緊急">
```

#### タスクタイプのカスタム設定
```typescript
// モデル
taskType: TaskType;
customTaskType?: string;

// フォーム選択
<select id="taskType" formControlName="taskType">
  <option value="normal">通常</option>
  <option value="meeting">会議</option>
  <option value="regular">定期</option>
  <option value="project">プロジェクト</option>
  <option value="other">その他</option>
  <option value="custom">カスタム設定</option>
</select>

// カスタム入力
<input *ngIf="taskType === 'custom'" formControlName="customTaskType" placeholder="例: リサーチ">
```

#### 実装のポイント
```typescript
// タスクタイプの決定
let taskTypeValue = TaskType.Normal;
let customTaskTypeValue = undefined;

if (formValue.taskType === 'normal') taskTypeValue = TaskType.Normal;
else if (formValue.taskType === 'custom') {
  taskTypeValue = TaskType.Other;
  customTaskTypeValue = formValue.customTaskType || undefined;
}

// データ保存
await this.taskService.createTask({
  taskType: taskTypeValue,
  customTaskType: customTaskTypeValue,
  // ...
});
```

### 8.7 メモ機能

#### データモデル
```typescript
Task {
  memo?: string;
}
```

#### 実装
- タスク作成時にメモを入力可能
- タスク詳細画面でメモを表示・編集
- 任意項目（オプション）

---

## 8. よくある質問と回答

### 8.1 Enum とは？
**Enum（列挙型）**は、関連する値を定数としてグループ化する機能。

```typescript
export enum TaskStatus {
  NotStarted = 'not_started',
  InProgress = 'in_progress',
  Completed = 'completed',
  Overdue = 'overdue'
}
```

**目的**:
- タイポ（入力ミス）の防止
- 有効な値を限定して型安全性を確保
- コードの可読性向上

**使用例**:
```typescript
task.status = TaskStatus.NotStarted;  // ✅ OK
task.status = 'not_started';          // ✅ OK（値は同じ）
task.status = 'invalid';              // ❌ TypeScriptがエラー
```

### 8.2 Interface とは？
**Interface（インターフェース）**は、データ構造の定義。

```typescript
export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  // ...
}
```

**目的**:
- データ構造の明確化
- 型チェックの実行
- コードの自己文書化

**使用例**:
```typescript
const task: Task = {
  id: 'abc123',
  title: 'タスク1',
  status: TaskStatus.InProgress
  // status: 'invalid'  // ❌ TypeScriptがエラー
};
```

### 8.3 async / await とは？
**async/await** は非同期処理を同期的に見せる構文。

```typescript
async createTask() {
  try {
    const taskId = await this.taskService.createTask(data);
    console.log('タスク作成完了');
  } catch (error) {
    console.error('エラー:', error);
  }
}
```

**特徴**:
- `async`: 関数を非同期にするキーワード
- `await`: Promise が完了するまで待つ
- `try-catch`: エラーハンドリング

**従来の書き方（コールバック）との比較**:
```typescript
// ❌ コールバック（古い書き方）
createTask(data, (id) => {
  console.log('完了:', id);
});

// ✅ async/await（現代的な書き方）
const id = await createTask(data);
console.log('完了:', id);
```

### 8.4 BehaviorSubject とは？
**BehaviorSubject** は現在の値を保持し、新しい値があると通知する Observable。

```typescript
private currentUserSubject = new BehaviorSubject<FirebaseUser | null>(null);
public currentUser$ = this.currentUserSubject.asObservable();
```

**特徴**:
- 現在の値を保持: `currentUserSubject.value`
- 新しい購読者には最新値を即時に配信
- `next()` で新しい値を設定

**使用例**:
```typescript
// 値の設定
this.currentUserSubject.next(user);

// 値の購読
this.authService.currentUser$.subscribe(user => {
  console.log('現在のユーザー:', user);
});
```

### 8.5 Observable（Observable パターン）とは？
**Observable** は、値のストリーム（流れ）を表現する仕組み。

```typescript
public currentUser$ = this.currentUserSubject.asObservable();
//                      ↑「$」は Observable の命名規則
```

**特徴**:
- データの変化を監視できる
- 複数の購読者に配信可能
- メモリリーク対策: `unsubscribe()` が必要

**使用例**:
```typescript
ngOnInit() {
  const subscription = this.currentUser$.subscribe(user => {
    console.log('ユーザー:', user);
  });
  
  // 必要なくなったら購読を解除
  // subscription.unsubscribe();
}
```

### 8.6 onAuthStateChanged とは？
Firebase の認証状態変化を監視する関数。

```typescript
onAuthStateChanged(auth, (user) => {
  // ユーザーがログイン/ログアウトするたびに実行される
  this.currentUserSubject.next(user);
});
```

**動作**:
- ユーザーがログイン → `user` にユーザー情報が入る
- ユーザーがログアウト → `user` が `null` になる

### 8.7 try-catch とは？
エラー処理を行うための構文。

```typescript
try {
  // エラーが発生する可能性のある処理
  await this.taskService.createTask(data);
} catch (error) {
  // エラーが発生した場合の処理
  console.error('エラー:', error);
  alert('タスク作成に失敗しました');
}
```

**目的**:
- プログラムのクラッシュ防止
- エラーメッセージの表示
- 適切なエラーハンドリング

### 8.8 FormBuilder とは？
Angular のフォーム作成を簡単にするサービス。

```typescript
private fb = inject(FormBuilder);

loginForm = this.fb.group({
  email: ['', [Validators.required, Validators.email]],
  password: ['', [Validators.required]]
});
```

**目的**:
- フォームの状態管理
- バリデーション（入力検証）
- タイプセーフなフォーム作成

### 8.9 Validators とは？
入力値の検証を行うバリデータ。

```typescript
email: ['', [Validators.required, Validators.email]]
//               ↑必須入力    ↑メール形式チェック

password: ['', [Validators.required, Validators.minLength(6)]]
//                 ↑必須入力      ↑最低6文字
```

**使用可能なバリデータ**:
- `Validators.required`: 必須入力
- `Validators.email`: メール形式チェック
- `Validators.minLength(n)`: 最低文字数
- `Validators.maxLength(n)`: 最大文字数

### 8.10 .valid / .invalid とは？
フォーム/フィールドの妥当性チェック。

```typescript
this.loginForm.valid    // フォーム全体が有効 → true/false
this.loginForm.invalid  // フォーム全体が無効 → true/false

this.loginForm.get('email')?.valid   // email フィールドが有効
this.loginForm.get('email')?.invalid // email フィールドが無効
```

**使用例**:
```typescript
// ボタンが無効化される
<button [disabled]="loginForm.invalid">ログイン</button>

// エラーメッセージの表示
<div *ngIf="loginForm.get('email')?.invalid">
  メールアドレスが不正です
</div>
```

### 8.11 padStart() とは？
文字列の前に指定した文字を追加して指定長にするメソッド。

```typescript
String(date.getMonth() + 1).padStart(2, '0')
// 例: 1 → '01', 10 → '10'
```

**使用例**:
```typescript
const month = String(5).padStart(2, '0');  // '05'
const day = String(25).padStart(2, '0');    // '25'
```

### 8.12 find() とは？
配列から条件に合う最初の要素を取得するメソッド。

```typescript
const project = this.projects.find(p => p.id === formValue.projectId);
```

**動作**:
- 条件に合う要素を探す
- 見つかったらその要素を返す
- 見つからなかったら `undefined` を返す

**使用例**:
```typescript
const projects = [
  { id: '1', name: 'プロジェクトA' },
  { id: '2', name: 'プロジェクトB' }
];

const project = projects.find(p => p.id === '1');
// → { id: '1', name: 'プロジェクトA' }

const notFound = projects.find(p => p.id === '999');
// → undefined
```

### 8.13 オプショナルチェーン（?.）とは？
オブジェクトのプロパティに安全にアクセスする演算子。

```typescript
project?.name  // project が null/undefined でもエラーにならない
```

**通常のアクセスとの違い**:
```typescript
// ❌ project が undefined の場合にエラー
const name = project.name;

// ✅ project が undefined の場合でもエラーにならない
const name = project?.name;  // undefined が返る
```

### 8.14 スプレッド演算子（...）とは？
配列やオブジェクトを展開する演算子。

```typescript
const updates: Partial<Task> = {
  title: formValue.title,
  description: formValue.description,
  memo: formValue.memo
  // ...
};

await updateDoc(taskRef, { ...updates, updatedAt: Timestamp.now() });
```

**使用例**:
```typescript
// オブジェクトの結合
const obj1 = { a: 1 };
const obj2 = { b: 2 };
const combined = { ...obj1, ...obj2 };
// → { a: 1, b: 2 }

// 配列の展開
const arr1 = [1, 2, 3];
const arr2 = [...arr1, 4, 5];
// → [1, 2, 3, 4, 5]
```

### 8.15 patchValue() とは？
フォームの値を部分的に更新するメソッド。

```typescript
this.editForm.patchValue({
  title: this.task.title,
  description: this.task.description || ''
});
```

**setValue() との違い**:
```typescript
// patchValue: 指定したフィールドのみ更新
this.form.patchValue({ title: '新タイトル' });

// setValue: すべてのフィールドに値を設定する（値がないとエラー）
this.form.setValue({ 
  title: '新タイトル', 
  description: '説明'  // これも必須
});
```

### 8.16 snapshot とは？
現在の状態の「写真」を取得する方法。

```typescript
const taskId = this.route.snapshot.paramMap.get('id');
```

**特徴**:
- 一度だけ値を取得（その時点での値）
- その後URLが変わっても値は変わらない
- Observable と違って購読（subscribe）が不要

**Observable との違い**:
```typescript
// snapshot: その時点の値だけ
const taskId = this.route.snapshot.paramMap.get('id');

// Observable: 値の変化を監視
this.route.paramMap.subscribe(params => {
  const taskId = params.get('id');
  // URL が変わるたびに実行される
});
```

### 8.17 ソフト削除とは？
物理削除ではなく、削除フラグで「削除済み」とマークする方法。

```typescript
await this.taskService.deleteTask(taskId);
// ↓ 内部では
{
  isDeleted: true,
  deletedAt: Timestamp.now()
}
```

**メリット**:
- 誤削除から復旧可能
- 削除履歴の保持
- 統計データの維持

**物理削除との違い**:
```typescript
// ソフト削除（推奨）
isDeleted: true  // データは残る

// 物理削除（データが完全に消える）
await deleteDoc(taskRef);  // ❌ 復旧不可能
```

### 8.18 query（クエリ）とは？
データベースからデータを取得するための条件を指定すること。

```typescript
// Firestore で例
const q = query(
  collection(db, 'tasks'),
  where('isDeleted', '==', false),
  orderBy('endDate')
);

const snapshot = await getDocs(q);
```

**クエリの種類**:
- `where()`: フィルタ条件
- `orderBy()`: ソート条件
- `limit()`: 件数制限

### 8.19 getFullYear() / getMonth() / getDate() とは？
Date オブジェクトから年月日を取得するメソッド。

```typescript
const date = new Date();
const year = date.getFullYear();      // 2025
const month = date.getMonth();        // 0-11（注意: 0が1月）
const day = date.getDate();          // 1-31
```

**注意点**:
```typescript
const month = date.getMonth();  // 0-11
const month2 = date.getMonth() + 1;  // 1-12（月の表示用）
```

### 8.20 プロジェクトID と プロジェクト名の関係
- **プロジェクトID**: 内部での識別子（自動生成）
- **プロジェクト名**: 表示用の名前（ユーザーが入力）

```typescript
// タスクにプロジェクトを紐付ける場合
{
  projectId: 'abc123',          // IDで紐付け
  projectName: 'プロジェクト名'  // 表示用（検索不要）
}
```

**なぜ両方保存するか**:
- `projectId`: Firestore で検索・フィルタリング
- `projectName`: 表示用（プロジェクトを取得しなくても名前を表示可能）

### 8.21 router.navigate() とは？
プログラムで画面を遷移させるメソッド。

```typescript
this.router.navigate(['/task', taskId]);
```

**使用例**:
```typescript
// ホーム画面へ
this.router.navigate(['/home']);

// タスク詳細へ
this.router.navigate(['/task', 'abc123']);

// クエリパラメータ付き
this.router.navigate(['/task', 'abc123'], { 
  queryParams: { from: 'gantt' } 
});
```

### 8.22 toLocaleDateString() とは？
日付をロケール形式の文字列に変換するメソッド。

```typescript
const date = new Date();
date.toLocaleDateString('ja-JP', { 
  year: 'numeric', 
  month: 'long', 
  day: 'numeric' 
});
// → '2025年10月27日'
```

**使用例**:
```typescript
// 日本語形式
date.toLocaleDateString('ja-JP');  // '2025/10/27'

// 英語形式
date.toLocaleDateString('en-US');  // '10/27/2025'
```

### 8.23 なぜ Field initializers を使うのか？
コンストラクタを使わずに、フィールド宣言時に初期化する書き方。

```typescript
// 従来の書き方（constructor）
constructor(private fb: FormBuilder) {
  this.loginForm = this.fb.group({...});
}

// 現代的な書き方（Field initializers）
private fb = inject(FormBuilder);
loginForm = this.fb.group({...});
```

**メリット**:
- コードがシンプル
- 依存性注入が不要な場合に便利
- Angular 17+ の推奨パターン

### 8.24 なぜ || '' を使うのか？
FormBuilder の値が `string | null | undefined` の可能性があるため、空文字列に変換。

```typescript
const email = form.value.email || '';
const password = form.value.password || '';
```

**動作**:
```typescript
form.value.email = 'user@example.com';  // → 'user@example.com'
form.value.email = null;                // → ''
form.value.email = undefined;          // → ''
```

### 8.25 overflow とは？
要素の内容が要素のサイズを超えた場合の処理を指定する CSS プロパティ。

```css
.gantt-chart-wrapper {
  overflow-x: auto;  /* 横方向にスクロール */
  overflow-y: visible;  /* 縦方向ははみ出しOK */
}
```

**値の種類**:

| 値 | 説明 | 使用例 |
|---|------|--------|
| `visible` | 内容を切らずにはみ出して表示 | `overflow: visible` |
| `hidden` | はみ出した部分を隠す | `overflow: hidden` |
| `scroll` | 常にスクロールバーを表示 | `overflow: scroll` |
| `auto` | 必要な場合だけスクロールバー | `overflow: auto` |

**方向指定**:
- `overflow-x`: 横方向（左右）
- `overflow-y`: 縦方向（上下）
- `overflow`: 両方向

**ガントチャートでの使用例**:
```css
.gantt-chart-wrapper {
  overflow-x: auto;        /* 横スクロール可能 */
  overflow-y: visible;     /* 縦ははみ出しOK */
}

.date-columns-container {
  overflow-x: visible;     /* はみ出しOK */
}

.gantt-row {
  overflow-x: visible;     /* はみ出しOK（stickyのため） */
}
```

**なぜ overflow が重要か**:
- `sticky` を効かせるためには親要素で `overflow: visible` が必要
- スクロールが必要な要素には `overflow: auto` を設定
- コンテンツを切るには `overflow: hidden` を使用

### 8.26 sticky（position: sticky）とは？
スクロール時に指定した位置で固定される CSS プロパティ。

```css
.task-label {
  position: sticky;
  left: 0;
  z-index: 5;
}
```

**他のpositionとの比較**:

| 値 | 説明 | 固定位置 | スクロール時の挙動 |
|---|------|---------|------------------|
| `static` | 通常の配置 | なし | スクロールと一緒に動く |
| `relative` | 相対配置 | なし | スクロールと一緒に動く |
| `absolute` | 絶対配置 | 親要素内 | スクロールと一緒に動く |
| `fixed` | 固定配置 | 画面内 | 常に同じ位置に固定 |
| **`sticky`** | **粘着配置** | **指定した位置** | **スクロールで指定位置に到達すると固定** |

**stickyの動作**:

```css
/* 例: 左端で固定 */
.task-label {
  position: sticky;
  left: 0;  /* 左端で固定 */
}

/* 例: 上部で固定 */
.header {
  position: sticky;
  top: 0;  /* 上端で固定 */
}
```

**動作の流れ**:
1. 通常時: 要素は通常の位置に配置（スクロールと一緒に動く）
2. 指定位置に到達: 要素が指定した位置（`left: 0`など）に達すると固定される
3. 固定後: スクロールしても固定位置から動かない

**ガントチャートでの使用例**:
```css
/* タスクラベルを左端で固定 */
.task-label {
  position: sticky;
  left: 0;  /* スクロール時も左端に固定 */
}

/* ヘッダーを上部で固定 */
.task-label-header {
  position: sticky;
  top: 0;   /* スクロール時も上部に固定 */
  left: 0;  /* かつ左端にも固定 */
}
```

**stickyを効かせるための条件**:
1. 親要素に `overflow: visible` が必要
2. 固定位置を指定（`top`, `bottom`, `left`, `right` のいずれか）
3. スクロール可能な領域が必要

**ガントチャートでの使用目的**:
- タスクラベルを左端に固定 → 日付部分をスクロールしてもラベルは見える
- ヘッダーを上部に固定 → 縦スクロールしてもヘッダーは見える
- 両方を固定 → 常に見える状態を保つ

---

## 9. まとめ

このアプリは以下の特徴を持っています：

1. **シンプルなアーキテクチャ**: サービス層 + コンポーネント層
2. **Firebase バックエンド**: Authentication + Firestore
3. **Reactive Forms**: タイプセーフなフォーム管理
4. **Angular 18**: 最新の Standalone Components
5. **クライアント側フィルタリング**: インデックス要件を回避

拡張しやすい構造になっており、機能追加が容易です。

