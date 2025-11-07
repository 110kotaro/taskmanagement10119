import { Timestamp } from 'firebase/firestore';

export enum UserRole {
  Admin = 'admin',
  User = 'user'
}

export enum NotificationSetting {
  All = 'all',
  Project = 'project',
  Assigned = 'assigned',
  None = 'none'
}

export interface NotificationPreferences {
  // カテゴリごとの設定
  task: boolean;        // タスク関連カテゴリ
  project: boolean;     // プロジェクト関連カテゴリ
  reminder: boolean;    // リマインダーカテゴリ
  team: boolean;        // チームカテゴリ
  dateCheck: boolean;   // 日付チェックカテゴリ
  
  // タスク関連の個別設定
  taskCreated?: boolean;      // タスク作成
  taskUpdated?: boolean;      // タスク更新（ステータス変更、割り当て）
  taskDeleted?: boolean;      // タスク削除
  taskRestored?: boolean;     // タスク復元
  taskCompleted?: boolean;    // タスク完了
  
  // プロジェクト関連の個別設定
  projectCreated?: boolean;   // プロジェクト作成
  projectUpdated?: boolean;   // プロジェクト更新
  projectDeleted?: boolean;   // プロジェクト削除
  projectRestored?: boolean;  // プロジェクト復元
  projectCompleted?: boolean; // プロジェクト完了
  
  // リマインダーの個別設定
  taskOverdue?: boolean;      // 担当タスク（期限切れ）
  taskReminder?: boolean;     // リマインダー（作成タスク、所属プロジェクト）
  
  // 日付チェックの個別設定
  startDateOverdue?: boolean; // 開始日を過ぎた時
  endDateOverdue?: boolean;   // 終了日を過ぎた時
  
  // チーム関連の個別設定
  teamInvitation?: boolean;   // チーム招待
  teamInvitationAccepted?: boolean; // チーム招待承認
  teamInvitationRejected?: boolean; // チーム招待拒否
  teamLeave?: boolean;       // チーム退会
  teamPermissionChange?: boolean; // 権限変更
  teamAdminAnnouncement?: boolean; // 管理者からのお知らせ
  
  // WebPush通知のカテゴリごとの設定
  taskWebPush?: boolean;        // タスク関連カテゴリのWebPush
  projectWebPush?: boolean;     // プロジェクト関連カテゴリのWebPush
  reminderWebPush?: boolean;    // リマインダーカテゴリのWebPush
  teamWebPush?: boolean;        // チームカテゴリのWebPush
  dateCheckWebPush?: boolean;   // 日付チェックカテゴリのWebPush
  
  // WebPush通知の個別設定
  taskCreatedWebPush?: boolean;      // タスク作成のWebPush
  taskUpdatedWebPush?: boolean;      // タスク更新のWebPush
  taskDeletedWebPush?: boolean;      // タスク削除のWebPush
  taskRestoredWebPush?: boolean;     // タスク復元のWebPush
  taskCompletedWebPush?: boolean;    // タスク完了のWebPush
      projectCreatedWebPush?: boolean;   // プロジェクト作成のWebPush
      projectUpdatedWebPush?: boolean;   // プロジェクト更新のWebPush
      projectDeletedWebPush?: boolean;   // プロジェクト削除のWebPush
      projectRestoredWebPush?: boolean;    // プロジェクト復元のWebPush
      projectCompletedWebPush?: boolean;  // プロジェクト完了のWebPush
  taskOverdueWebPush?: boolean;      // タスク期限切れのWebPush
  taskReminderWebPush?: boolean;     // タスクリマインダーのWebPush
  startDateOverdueWebPush?: boolean; // 開始日過ぎのWebPush
  endDateOverdueWebPush?: boolean;   // 終了日過ぎのWebPush
  teamInvitationWebPush?: boolean;   // チーム招待のWebPush
  teamInvitationAcceptedWebPush?: boolean; // チーム招待承認のWebPush
  teamInvitationRejectedWebPush?: boolean; // チーム招待拒否のWebPush
  teamLeaveWebPush?: boolean;       // チーム退会のWebPush
  teamPermissionChangeWebPush?: boolean; // 権限変更のWebPush
  teamAdminAnnouncementWebPush?: boolean; // 管理者からのお知らせのWebPush
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
  role: UserRole;
  theme: 'light' | 'dark';
  notificationSettings: NotificationPreferences; // NotificationSettingから変更
  fcmToken?: string; // FCMトークン（Web Push通知用）
  showNextTasks?: boolean; // 次やるタスクの表示設定（デフォルト: true）
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

