import { Timestamp } from 'firebase/firestore';
import { NotificationPreferences } from './user.model';

export enum NotificationType {
  TaskCreated = 'task_created',
  TaskUpdated = 'task_updated',
  TaskDeleted = 'task_deleted',
  TaskRestored = 'task_restored',
  TaskCompleted = 'task_completed',
  TaskOverdue = 'task_overdue',
  TaskReminder = 'task_reminder',
  ProjectCreated = 'project_created',
  ProjectUpdated = 'project_updated',
  ProjectDeleted = 'project_deleted',
  ProjectRestored = 'project_restored',
  ProjectCompleted = 'project_completed',
  ProjectMemberAdded = 'project_member_added',
  ProjectMemberRemoved = 'project_member_removed',
  ProjectMemberRoleChanged = 'project_member_role_changed',
  TeamInvitation = 'team_invitation',
  TeamInvitationAccepted = 'team_invitation_accepted',
  TeamInvitationRejected = 'team_invitation_rejected',
  TeamLeave = 'team_leave',
  TeamPermissionChange = 'team_permission_change',
  TeamAdminAnnouncement = 'team_admin_announcement',
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  taskId?: string;
  projectId?: string;
  teamId?: string;
  invitationId?: string; // チーム招待ID
  checkType?: 'startDate' | 'endDate' | 'completion' | 'projectEndDate'; // 日付チェックの種類（TaskOverdue/Project日付チェック通知用）
  isRead: boolean;
  readAt?: Timestamp;
  createdAt: Timestamp;
  isDeleted?: boolean; // 削除フラグ
  deletedAt?: Timestamp; // 削除日時
}

// 通知タイプからカテゴリを取得する関数
export function getNotificationCategory(type: NotificationType, checkType?: 'startDate' | 'endDate' | 'completion' | 'projectEndDate'): 'task' | 'project' | 'reminder' | 'team' | 'dateCheck' {
  switch (type) {
    case NotificationType.TaskCreated:
    case NotificationType.TaskUpdated:
    case NotificationType.TaskDeleted:
    case NotificationType.TaskRestored:
    case NotificationType.TaskCompleted:
      return 'task';
    case NotificationType.TaskOverdue:
      // checkTypeがある場合は日付チェックカテゴリ
      if (checkType) {
        return 'dateCheck';
      }
      // 従来の動作（reminderカテゴリ）を維持
      return 'reminder';
    case NotificationType.TaskReminder:
      return 'reminder';
    case NotificationType.ProjectCreated:
    case NotificationType.ProjectUpdated:
    case NotificationType.ProjectDeleted:
    case NotificationType.ProjectRestored:
    case NotificationType.ProjectCompleted:
    case NotificationType.ProjectMemberAdded:
    case NotificationType.ProjectMemberRemoved:
    case NotificationType.ProjectMemberRoleChanged:
      return 'project';
    case NotificationType.TeamInvitation:
    case NotificationType.TeamInvitationAccepted:
    case NotificationType.TeamInvitationRejected:
    case NotificationType.TeamLeave:
    case NotificationType.TeamPermissionChange:
    case NotificationType.TeamAdminAnnouncement:
      return 'team';
    default:
      return 'task';
  }
}

// 通知タイプから個別設定のキーを取得する関数
export function getNotificationSettingKey(type: NotificationType, checkType?: 'startDate' | 'endDate' | 'completion' | 'projectEndDate'): keyof NotificationPreferences | null {
  switch (type) {
    case NotificationType.TaskCreated:
      return 'taskCreated';
    case NotificationType.TaskUpdated:
      return 'taskUpdated';
    case NotificationType.TaskDeleted:
      return 'taskDeleted';
    case NotificationType.TaskRestored:
      return 'taskRestored';
    case NotificationType.TaskCompleted:
      return 'taskCompleted';
    case NotificationType.ProjectCreated:
      return 'projectCreated';
    case NotificationType.ProjectUpdated:
      return 'projectUpdated';
    case NotificationType.ProjectDeleted:
      return 'projectDeleted';
    case NotificationType.ProjectRestored:
      return 'projectRestored';
    case NotificationType.ProjectCompleted:
      return 'projectCompleted';
    case NotificationType.ProjectMemberAdded:
      return 'projectMemberAdded';
    case NotificationType.ProjectMemberRemoved:
      return 'projectMemberRemoved';
    case NotificationType.ProjectMemberRoleChanged:
      return 'projectMemberRoleChanged';
    case NotificationType.TaskOverdue:
      // checkTypeに基づいて設定キーを返す
      if (checkType === 'startDate') {
        return 'startDateOverdue';
      } else if (checkType === 'endDate') {
        return 'endDateOverdue';
      }
      // 従来の動作（taskOverdue）を維持
      return 'taskOverdue';
    case NotificationType.TaskReminder:
      return 'taskReminder';
    case NotificationType.TeamInvitation:
      return 'teamInvitation';
    case NotificationType.TeamInvitationAccepted:
      return 'teamInvitationAccepted';
    case NotificationType.TeamInvitationRejected:
      return 'teamInvitationRejected';
    case NotificationType.TeamLeave:
      return 'teamLeave';
    case NotificationType.TeamPermissionChange:
      return 'teamPermissionChange';
    case NotificationType.TeamAdminAnnouncement:
      return 'teamAdminAnnouncement';
    default:
      return null;
  }
}

// 通知タイプからWebPush設定のキーを取得する関数
export function getWebPushSettingKey(type: NotificationType, checkType?: 'startDate' | 'endDate' | 'completion' | 'projectEndDate'): keyof NotificationPreferences | null {
  const baseKey = getNotificationSettingKey(type, checkType);
  if (!baseKey) return null;
  
  // ベースキーに"WebPush"を追加
  return `${baseKey}WebPush` as keyof NotificationPreferences;
}

// カテゴリからWebPushカテゴリ設定のキーを取得する関数
export function getWebPushCategoryKey(category: 'task' | 'project' | 'reminder' | 'team' | 'dateCheck'): keyof NotificationPreferences {
  switch (category) {
    case 'task':
      return 'taskWebPush';
    case 'project':
      return 'projectWebPush';
    case 'reminder':
      return 'reminderWebPush';
    case 'team':
      return 'teamWebPush';
    case 'dateCheck':
      return 'dateCheckWebPush';
  }
}

