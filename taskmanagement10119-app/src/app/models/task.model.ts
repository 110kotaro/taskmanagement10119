import { Timestamp } from 'firebase/firestore';

export enum TaskStatus {
  NotStarted = 'not_started',
  InProgress = 'in_progress',
  Completed = 'completed',
  Overdue = 'overdue'
}

export enum PriorityLabel {
  Important = 'important',
  Normal = 'normal',
  Low = 'low',
  None = 'none',
  Custom = 'custom'
}

export enum TaskType {
  Normal = 'normal',
  Meeting = 'meeting',
  Regular = 'regular',
  Project = 'project',
  Other = 'other'
}

export enum RecurrenceType {
  None = 'none',
  Daily = 'daily',
  Weekly = 'weekly',
  Monthly = 'monthly',
  Yearly = 'yearly',
  Biweekly = 'biweekly'
}

export interface SubTask {
  id: string;
  title: string;
  assigneeId?: string;
  assigneeName?: string;
  completed: boolean;
  completedAt?: Timestamp;
}

export interface WorkSessionChangeLog {
  id: string;
  sessionId: string;
  changedBy: string; // userId
  changedByName: string;
  changedAt: Timestamp;
  field: 'startTime' | 'endTime' | 'breakDuration';
  oldValue: any;
  newValue: any;
}

export interface WorkSession {
  id: string;
  startTime: Timestamp;
  endTime?: Timestamp;
  breakDuration: number; // 分
  actualDuration: number; // 秒
  isPomodoro: boolean;
  completedPomodoros?: number;
  changeLogs?: WorkSessionChangeLog[]; // 変更ログ
}

export interface Reminder {
  id: string;
  type?: 'before_start' | 'before_end'; // カスタム設定の場合は undefined
  amount?: number; // 相対リマインダーの場合のみ
  unit?: 'minute' | 'hour' | 'day'; // 相対リマインダーの場合のみ
  scheduledAt?: Timestamp; // カスタム設定（絶対日時）の場合のみ
  sent: boolean;
  sentAt?: Timestamp;
}

export interface Comment {
  id: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  projectId?: string;
  projectName?: string;
  teamId?: string; // チームID（未設定の場合は個人タスク）
  teamName?: string; // チーム名（所属チームのタスクの場合）
  assigneeId?: string;
  assigneeName?: string;
  creatorId: string;
  creatorName: string;
  status: TaskStatus;
  startDate: Timestamp;
  endDate: Timestamp;
  completedAt?: Timestamp;
  priority: PriorityLabel;
  customPriority?: string;
  taskType: TaskType;
  customTaskType?: string;
  memo?: string;
  files?: Array<{
    id: string;
    name: string;
    url: string;
    uploadedAt: Timestamp;
  }>;
  subtasks: SubTask[];
  progress: number; // 0-100
  showProgress: boolean; // 進捗率表示の有無
  progressManual: boolean; // 進捗率が手動修正中かどうか（自動計算を停止する）
  reminders: Reminder[];
  comments: Comment[];
  workSessions: WorkSession[];
  totalWorkTime: number; // 秒
  recurrence: RecurrenceType;
  recurrenceEndDate?: Timestamp;
  parentTaskId?: string; // 繰り返し元のタスクID（最初のタスクのID、自分自身の場合はundefined）
  recurrenceInstance?: number; // 繰り返しインスタンス番号（0が最初、親タスクは0）
  isRecurrenceParent?: boolean; // 親タスクかどうか（最初のタスク）
  isDeleted: boolean;
  deletedAt?: Timestamp;
  statusBeforeDeletion?: TaskStatus; // 削除前のステータス（復元時に使用）
  dateCheckedAt?: Timestamp; // 日付チェック済み日時（同じ日は再チェックしない）
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

