import { Timestamp } from 'firebase/firestore';

export enum ProjectRole {
  Owner = 'owner',
  // Admin = 'admin', // 削除：チーム管理者が権限を持つ
  Member = 'member',
  Viewer = 'viewer'
}

export enum ProjectStatus {
  NotStarted = 'not_started',  // 準備中（表示用）
  InProgress = 'in_progress',   // 進行中
  Completed = 'completed'        // 完了
}

export interface ProjectMember {
  userId: string;
  userName: string;
  userEmail: string;
  role: ProjectRole;
  joinedAt: Timestamp;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  ownerName: string;
  assigneeId?: string;    // 担当者ID
  assigneeName?: string;  // 担当者名
  members: ProjectMember[];
  teamId?: string;        // チームID（未設定の場合は個人プロジェクト）
  teamName?: string;      // チーム名
  status: ProjectStatus;  // ステータス（準備中、進行中、完了）
  startDate: Timestamp;
  endDate: Timestamp;
  completionRate: number; // 0-100
  totalTasks: number;
  completedTasks: number;
  isDeleted: boolean;
  deletedAt?: Timestamp;
  statusBeforeDeletion?: ProjectStatus; // 削除前のステータス（復元時に使用）
  dateCheckedAt?: Timestamp; // 日付チェック実行日時（1日1回のみチェック）
  originalTaskIds?: string[]; // 削除時に配下にあったタスクのID（復元時に使用）
  files?: Array<{
    id: string;
    name: string;
    url: string;
    uploadedAt: Timestamp;
  }>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

