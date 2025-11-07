import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Timestamp, deleteField } from 'firebase/firestore';
import { TaskService } from '../../services/task.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { AuthService } from '../../services/auth.service';
// @ts-ignore - StorageServiceが認識されない場合は一時的に無視
import { StorageService } from '../../services/storage.service';
import { Project } from '../../models/project.model';
import { Task, TaskStatus, PriorityLabel, TaskType, SubTask, Comment, WorkSession, WorkSessionChangeLog } from '../../models/task.model';
import { User } from '../../models/user.model';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NextTaskCandidatesComponent } from '../next-task-candidates/next-task-candidates.component';

  @Component({
  selector: 'app-task-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, NextTaskCandidatesComponent],
  templateUrl: './task-detail.component.html',
  styleUrl: './task-detail.component.css'
})
export class TaskDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private taskService = inject(TaskService);
  private projectService = inject(ProjectService);
  private teamService = inject(TeamService);
  private authService = inject(AuthService);
  private storageService = inject(StorageService);
  private fb = inject(FormBuilder);

  task: Task | null = null;
  editForm: FormGroup;
  isEditing = false;
  isLoading = true;
  projectName: string | null = null;
  teamName: string | null = null;
  projects: Project[] = [];
  users: User[] = []; // ユーザーリスト（担当者選択用）
  newSubtaskTitle = '';
  newCommentContent = '';
  showCommentsTab = false;
  selectedFiles: File[] = [];
  isUploadingFiles = false;
  manualProgressValue: number = 0; // 手動入力中の進捗率値
  showManualInput: boolean = false; // 手動入力欄を表示するかどうか
  showWorkTimeDetails = false; // 作業時間詳細の表示/非表示
  editingSessionId: string | null = null; // 編集中のセッションID
  selectedSessionId: string | null = null; // 変更ログを表示するセッションID
  editSessionForm: FormGroup; // セッション編集フォーム
  addingNewSession = false; // 新規セッション追加中かどうか
  newSessionForm: FormGroup; // 新規セッション追加フォーム
  canEdit = false; // 編集権限
  canDelete = false; // 削除権限
  isFromArchive = false; // アーカイブから遷移したかどうか
  showNextTaskCandidates = false; // 次やるタスクモーダルの表示/非表示
  showNextTaskConfirmation = false; // 次やるタスク確認ダイアログの表示/非表示

  constructor() {
    this.editForm = this.fb.group({
      title: ['', Validators.required],
      description: [''],
      memo: [''],
      status: [''],
      priority: [''],
      startDate: [''],
      startTime: [''], // 開始時間（任意）
      endDate: ['', Validators.required],
      endTime: [''], // 終了時間（任意）
      assigneeId: [''], // 担当者ID
      projectId: [''],
      showProgress: [true],
      enableStartReminder: [false],
      startReminderType: ['none'],
      enableEndReminder: [false],
      endReminderType: ['none'],
      enableCustomReminder: [false],
      customReminderDateTime: ['']
    });

    // セッション編集フォームを追加
    this.editSessionForm = this.fb.group({
      startTime: ['', Validators.required],
      endTime: ['', Validators.required],
      breakDuration: [0, [Validators.required, Validators.min(0)]]
    });

    // 新規セッション追加フォームを追加
    this.newSessionForm = this.fb.group({
      startTime: ['', Validators.required],
      endTime: ['', Validators.required],
      breakDuration: [0, [Validators.required, Validators.min(0)]]
    });
  }

  async ngOnInit() {
    await this.loadProjects();
    await this.loadUsers();
    const taskId = this.route.snapshot.paramMap.get('id');
    if (taskId) {
      await this.loadTask(taskId);
    }
  }

  async loadUsers() {
    try {
      this.users = await this.authService.getAllUsers();
    } catch (error: any) {
      console.error('Error loading users:', error);
    }
  }

  async loadProjects() {
    try {
      const user = this.authService.currentUser;
      if (user) {
        this.projects = await this.projectService.getProjectsForUser(user.uid);
      }
    } catch (error: any) {
      console.error('Error loading projects:', error);
    }
  }

  async loadTask(taskId: string) {
    try {
      this.isLoading = true;
      this.task = await this.taskService.getTask(taskId);
      if (this.task) {
        // クエリパラメーターから遷移元を確認
        const from = this.route.snapshot.queryParamMap.get('from');
        this.isFromArchive = from === 'archive';

        // タスクが削除されているか確認
        const isDeleted = this.task.isDeleted === true;

        // アーカイブから来た場合、またはタスクが削除されている場合は編集・削除を無効化
        if (this.isFromArchive || isDeleted) {
          this.canEdit = false;
          this.canDelete = false;
        }else{
          // 権限チェック
          const user = this.authService.currentUser;
          if (user) {
            this.canEdit = await this.taskService.canEditTask(this.task, user.uid);
            this.canDelete = await this.taskService.canDeleteTask(this.task, user.uid);
          } else {
            this.canEdit = false;
            this.canDelete = false;
          }
        }
        
        // workSessionsがundefinedの場合は空配列に初期化
        if (!this.task.workSessions) {
          this.task.workSessions = [];
        } else {
          // workSessionsが存在する場合、各セッションのTimestampを確認
          this.task.workSessions = this.task.workSessions.map(session => {
            // startTimeがTimestampでない場合は変換
            if (session.startTime && typeof session.startTime.toDate !== 'function') {
              const dateValue = session.startTime as any;
              if (dateValue.seconds) {
                // Firestore Timestamp形式（{seconds, nanoseconds}）
                session.startTime = Timestamp.fromMillis(dateValue.seconds * 1000 + (dateValue.nanoseconds || 0) / 1000000);
              } else {
                // Dateまたは文字列
                session.startTime = Timestamp.fromDate(new Date(dateValue));
              }
            }
            // endTimeがTimestampでない場合は変換
            if (session.endTime && typeof session.endTime.toDate !== 'function') {
              const dateValue = session.endTime as any;
              if (dateValue.seconds) {
                // Firestore Timestamp形式（{seconds, nanoseconds}）
                session.endTime = Timestamp.fromMillis(dateValue.seconds * 1000 + (dateValue.nanoseconds || 0) / 1000000);
              } else {
                // Dateまたは文字列
                session.endTime = Timestamp.fromDate(new Date(dateValue));
              }
            }
            return session;
          });
        }
        
        // プロジェクト名が保存されていない場合は取得
        if (this.task.projectId && !this.task.projectName) {
          try {
            const project = await this.projectService.getProject(this.task.projectId);
            if (project) {
              this.projectName = project.name;
              console.log('Loaded project name:', this.projectName);
            }
          } catch (error) {
            console.error('Error loading project:', error);
          }
        }
        
        // チーム名が保存されていない場合は取得
        if (this.task.teamId && !this.task.teamName) {
          try {
            const team = await this.teamService.getTeam(this.task.teamId);
            if (team) {
              this.teamName = team.name;
              console.log('Loaded team name:', this.teamName);
            }
          } catch (error) {
            console.error('Error loading team:', error);
          }
        } else if (this.task.teamName) {
          // チーム名が既に保存されている場合はそれを使用
          this.teamName = this.task.teamName;
        }
        
            // 開始日時の処理
            const startDate = this.task.startDate.toDate();
            const startDateOnly = this.formatDateForInput(this.task.startDate);
            const startTimeOnly = this.formatTimeForInput(startDate);

            // 終了日時の処理
            const endDate = this.task.endDate.toDate();
            const endDateOnly = this.formatDateForInput(this.task.endDate);
            const endTimeOnly = this.formatTimeForInput(endDate);

            this.editForm.patchValue({
              title: this.task.title,
              description: this.task.description || '',
              memo: this.task.memo || '',
              status: this.task.status,
              priority: this.task.priority,
              startDate: startDateOnly,
              startTime: startTimeOnly,
              endDate: endDateOnly,
              endTime: endTimeOnly,
              assigneeId: this.task.assigneeId || '',
              projectId: this.task.projectId || '',
              showProgress: this.task.showProgress !== undefined ? this.task.showProgress : true
            });

        // 既存のリマインダーを復元
        this.restoreReminders(this.task.reminders || []);
      }
      this.isLoading = false;
      // manualProgressValueを初期化
      if (this.task) {
        this.manualProgressValue = this.task.progress || 0;
      }
    } catch (error: any) {
      console.error('Error loading task:', error);
      alert('タスクの読み込みに失敗しました: ' + error.message);
    }finally{
      this.isLoading = false;
    }
  }


  // リマインダーを復元（既存のリマインダーをフォームに反映）
  restoreReminders(reminders: any[]) {
    // 開始前のリマインダーを復元
    const startReminder = reminders.find((r: any) => r.type === 'before_start');
    if (startReminder) {
      this.editForm.patchValue({
        enableStartReminder: true,
        startReminderType: this.mapReminderToPreset(startReminder)
      });
    }

    // 期限前のリマインダーを復元
    const endReminder = reminders.find((r: any) => r.type === 'before_end');
    if (endReminder) {
      this.editForm.patchValue({
        enableEndReminder: true,
        endReminderType: this.mapReminderToPreset(endReminder)
      });
    }

    // カスタムリマインダーを復元
    const customReminder = reminders.find((r: any) => r.scheduledAt);
    if (customReminder && customReminder.scheduledAt) {
      const scheduledDate = customReminder.scheduledAt.toDate ? 
        customReminder.scheduledAt.toDate() : 
        new Date(customReminder.scheduledAt);
      const localDateTime = this.formatDateTimeForInput(scheduledDate);
      this.editForm.patchValue({
        enableCustomReminder: true,
        customReminderDateTime: localDateTime
      });
    }
  }

  // リマインダー情報をプリセットにマッピング
  mapReminderToPreset(reminder: any): string {
    if (!reminder.amount || !reminder.unit) return 'none';

    // リマインダーの設定を確認してマッチするプリセットを返す
    if (reminder.amount === 1 && reminder.unit === 'day') return '1day';
    if (reminder.amount === 3 && reminder.unit === 'hour') return '3hour';
    if (reminder.amount === 1 && reminder.unit === 'hour') return '1hour';
    if (reminder.amount === 30 && reminder.unit === 'minute') return '30min';
    if (reminder.amount === 15 && reminder.unit === 'minute') return '15min';
    if (reminder.amount === 10 && reminder.unit === 'minute') return '10min';
    if (reminder.amount === 5 && reminder.unit === 'minute') return '5min';
    if (reminder.amount === 1 && reminder.unit === 'minute') return '1min';

    return 'none';
  }

  // 日時をdatetime-local用のフォーマットに変換
  formatDateTimeForInput(date: Date): string {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  formatDateForInput(dateOrTimestamp: any): string {
    // TimestampまたはDateを受け取る
    const date = dateOrTimestamp.toDate ? dateOrTimestamp.toDate() : dateOrTimestamp;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatTimeForInput(date: Date): string {
    // 時間が00:00:00または23:59:59の場合は空文字を返す（時間未設定とみなす）
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    
    // 開始時間が00:00:00または終了時間が23:59:59の場合は空文字を返す
    if ((hours === 0 && minutes === 0 && seconds === 0) || 
        (hours === 23 && minutes === 59 && seconds === 59)) {
      return '';
    }
    
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  formatDate(timestamp: any): string {
    const date = timestamp.toDate();
    return date.toLocaleDateString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  toggleEdit() {
    this.isEditing = !this.isEditing;
  }

  async onSave() {
    if (!this.task || !this.editForm.valid) {
      return;
    }

    try {
      const formValue = this.editForm.value;
      
      // プロジェクト名を取得
      let projectName: string | undefined;
      let projectId: string | undefined;
      
      if (formValue.projectId && formValue.projectId.trim() !== '') {
        projectId = formValue.projectId;
        const project = this.projects.find(p => p.id === formValue.projectId);
        projectName = project?.name;
      }
      
      // リマインダー設定（開始前、終了前、カスタム）
      const reminders: any[] = [];
      let reminderCounter = 0;

      // 開始前のリマインダー
      if (formValue.enableStartReminder && formValue.startReminderType !== 'none') {
        const presetMap: { [key: string]: { amount: number; unit: 'minute' | 'hour' | 'day' } } = {
          '1day': { amount: 1, unit: 'day' },
          '3hour': { amount: 3, unit: 'hour' },
          '1hour': { amount: 1, unit: 'hour' },
          '30min': { amount: 30, unit: 'minute' },
          '15min': { amount: 15, unit: 'minute' },
          '10min': { amount: 10, unit: 'minute' },
          '5min': { amount: 5, unit: 'minute' },
          '1min': { amount: 1, unit: 'minute' }
        };
        
        const preset = presetMap[formValue.startReminderType];
        if (preset) {
          const existingStartReminder = this.task?.reminders?.find((r: any) => r.type === 'before_start');
          
          // リマインダーの設定が変更されたかチェック
          const isChanged = !existingStartReminder || 
            existingStartReminder.amount !== preset.amount || 
            existingStartReminder.unit !== preset.unit;
          
          const reminder: any = {
            id: existingStartReminder?.id || (Date.now() + reminderCounter).toString(),
            type: 'before_start',
            amount: preset.amount,
            unit: preset.unit,
            // 設定が変更された場合は sent を false にリセット
            sent: (existingStartReminder?.sent && !isChanged) || false,
            sentAt: (existingStartReminder?.sent && !isChanged) ? existingStartReminder?.sentAt : undefined
          };
          reminders.push(reminder);
          reminderCounter++;
        }
      }

      // 終了前（期限前）のリマインダー
      if (formValue.enableEndReminder && formValue.endReminderType !== 'none') {
        const presetMap: { [key: string]: { amount: number; unit: 'minute' | 'hour' | 'day' } } = {
          '1day': { amount: 1, unit: 'day' },
          '3hour': { amount: 3, unit: 'hour' },
          '1hour': { amount: 1, unit: 'hour' },
          '30min': { amount: 30, unit: 'minute' },
          '15min': { amount: 15, unit: 'minute' },
          '10min': { amount: 10, unit: 'minute' },
          '5min': { amount: 5, unit: 'minute' },
          '1min': { amount: 1, unit: 'minute' }
        };
        
        const preset = presetMap[formValue.endReminderType];
        if (preset) {
          const existingEndReminder = this.task?.reminders?.find((r: any) => r.type === 'before_end');
          
          // リマインダーの設定が変更されたかチェック
          const isChanged = !existingEndReminder || 
            existingEndReminder.amount !== preset.amount || 
            existingEndReminder.unit !== preset.unit;
          
          const reminder: any = {
            id: existingEndReminder?.id || (Date.now() + reminderCounter).toString(),
            type: 'before_end',
            amount: preset.amount,
            unit: preset.unit,
            // 設定が変更された場合は sent を false にリセット
            sent: (existingEndReminder?.sent && !isChanged) || false,
            sentAt: (existingEndReminder?.sent && !isChanged) ? existingEndReminder?.sentAt : undefined
          };
          reminders.push(reminder);
          reminderCounter++;
        }
      }

      // カスタム設定のリマインダー（絶対日時）
      if (formValue.enableCustomReminder && formValue.customReminderDateTime) {
        try {
          const existingCustomReminder = this.task?.reminders?.find((r: any) => r.scheduledAt);
          const reminderDateTime = formValue.customReminderDateTime.trim();
          
          if (!reminderDateTime) {
            throw new Error('リマインダー日時が入力されていません');
          }
          
          const newScheduledAt = Timestamp.fromDate(new Date(reminderDateTime));
          
          // 無効な日時の場合はエラー
          if (isNaN(newScheduledAt.toMillis())) {
            throw new Error('無効なリマインダー日時です');
          }
        
        // リマインダーの設定が変更されたかチェック（scheduledAt の時刻を比較）
        let isChanged = true;
        if (existingCustomReminder && existingCustomReminder.scheduledAt) {
          try {
            let existingDate: Date;
            const existingScheduledAt = existingCustomReminder.scheduledAt;
            
            // Timestamp型のチェック（toDateメソッドがあるかどうか）
            if (existingScheduledAt && typeof existingScheduledAt === 'object' && 'toDate' in existingScheduledAt && typeof (existingScheduledAt as any).toDate === 'function') {
              // Timestamp型の場合
              existingDate = (existingScheduledAt as any).toDate();
            } else if (existingScheduledAt instanceof Date) {
              // Date型の場合
              existingDate = existingScheduledAt;
            } else {
              // その他の場合（文字列や数値など）
              existingDate = new Date(existingScheduledAt as any);
            }
            
            const newDate = newScheduledAt.toDate();
            // 同じ日時（1分以内の誤差を許容）の場合は変更なしとみなす
            if (existingDate && !isNaN(existingDate.getTime()) && newDate && !isNaN(newDate.getTime())) {
              isChanged = Math.abs(existingDate.getTime() - newDate.getTime()) > 60000;
            }
          } catch (error) {
            console.error('Error comparing reminder dates:', error);
            // エラーが発生した場合は変更ありとみなす
            isChanged = true;
          }
        }
        
        const reminder: any = {
          id: existingCustomReminder?.id || (Date.now() + reminderCounter).toString(),
          scheduledAt: newScheduledAt,
          // 設定が変更された場合は sent を false にリセット
          sent: (existingCustomReminder?.sent && !isChanged) || false,
          sentAt: (existingCustomReminder?.sent && !isChanged) ? existingCustomReminder?.sentAt : undefined
        };
        reminders.push(reminder);
        } catch (error: any) {
          console.error('Error processing custom reminder:', error);
          alert('カスタムリマインダーの設定に失敗しました: ' + error.message);
          // エラーが発生した場合はリマインダーを追加しない
        }
      }

      // リマインダー配列を正しくシリアライズ（Timestampオブジェクトを確認）
      const serializedReminders = reminders.map((r: any) => {
        const reminder: any = {
          id: r.id,
          sent: r.sent || false
        };
        
        // タイプ別にフィールドを設定
        if (r.type) {
          reminder.type = r.type;
          reminder.amount = r.amount;
          reminder.unit = r.unit;
        }
        
        if (r.scheduledAt) {
          // Timestamp型であることを確認
          if (r.scheduledAt && typeof r.scheduledAt === 'object' && 'toDate' in r.scheduledAt && typeof r.scheduledAt.toDate === 'function') {
            reminder.scheduledAt = r.scheduledAt;
          } else {
            // Timestamp型でない場合は変換
            reminder.scheduledAt = Timestamp.fromDate(new Date(r.scheduledAt));
          }
        }
        
        // sentAtも同様に処理（undefinedの場合は追加しない）
        if (r.sentAt !== undefined && r.sentAt !== null) {
          if (r.sentAt && typeof r.sentAt === 'object' && 'toDate' in r.sentAt && typeof r.sentAt.toDate === 'function') {
            reminder.sentAt = r.sentAt;
          } else {
            reminder.sentAt = Timestamp.fromDate(new Date(r.sentAt));
          }
        }
        
        return reminder;
      });

             // 開始日時の処理（時間が設定されている場合は時間を考慮、未設定の場合は00:00:00）
             let startDateTime = new Date(formValue.startDate);
             if (formValue.startTime) {
               const [hours, minutes] = formValue.startTime.split(':');
               startDateTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
             } else {
               startDateTime.setHours(0, 0, 0, 0);
             }

             // 終了日時の処理（時間が設定されている場合は時間を考慮、未設定の場合は23:59:59）
             let endDateTime = new Date(formValue.endDate);
             if (formValue.endTime) {
               const [hours, minutes] = formValue.endTime.split(':');
               endDateTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
             } else {
               endDateTime.setHours(23, 59, 59, 999);
             }

             // 担当者の処理
             let assigneeId: string | undefined = undefined;
             let assigneeName: string | undefined = undefined;
             if (formValue.assigneeId && formValue.assigneeId.trim() !== '') {
               assigneeId = formValue.assigneeId;
               const selectedUser = this.users.find(u => u.id === assigneeId);
               assigneeName = selectedUser?.displayName || selectedUser?.email || 'Unknown';
             } else {
               // 担当者が未選択の場合は担当者なし（undefined）
               assigneeId = undefined;
               assigneeName = undefined;
             }

             const updates: Partial<Task> = {
               title: formValue.title,
               description: formValue.description,
               memo: formValue.memo,
               status: formValue.status,
               priority: formValue.priority,
               startDate: Timestamp.fromDate(startDateTime),
               endDate: Timestamp.fromDate(endDateTime),
               assigneeId: assigneeId,
               assigneeName: assigneeName,
               showProgress: formValue.showProgress !== undefined ? formValue.showProgress : true,
               reminders: serializedReminders
             };
      
      // 進捗率表示がfalseの場合、サブタスクを空にする
      if (!formValue.showProgress) {
        updates.subtasks = [];
        updates.progress = 0;
      }
      
      // ステータスが「完了」に変更された場合、completedAt を設定
      if (formValue.status === 'completed' && this.task.status !== 'completed') {
        updates.completedAt = Timestamp.now();
      }
      // ステータスが「完了」から変更された場合、completedAt を削除
      else if (formValue.status !== 'completed' && this.task.status === 'completed') {
        updates.completedAt = undefined;
      }
      
      // projectId と projectName は undefined の場合のみ追加しない（空文字列は undefined にする）
      if (projectId !== undefined) {
        updates.projectId = projectId;
      } else {
        // プロジェクトが指定されていない場合は undefined を明示的に設定
        updates.projectId = undefined;
      }
      
      if (projectName !== undefined) {
        updates.projectName = projectName;
      } else {
        updates.projectName = undefined;
      }

      // 完了に変更されたかどうかを記録
      const wasCompleted = formValue.status === 'completed' && this.task.status !== 'completed';
      
      try {
        await this.taskService.updateTask(this.task.id, updates);
        alert('タスクを更新しました');
        
        // 完了に変更された場合、次やるタスクを確認するかダイアログを表示
        if (wasCompleted) {
          // ユーザーの設定を確認
          const user = this.authService.currentUser;
          if (user) {
            const userData = await this.authService.getUserData(user.uid);
            const showNextTasks = userData?.showNextTasks !== false; // デフォルトはtrue
            
            if (showNextTasks) {
              const shouldShowNextTasks = confirm('次やるタスクを確認しますか？');
              if (shouldShowNextTasks) {
                this.showNextTaskCandidates = true;
              }
            }
          }
        }
        this.isEditing = false;
        await this.loadTask(this.task.id);
        
        // 編集後は詳細ページに留まる（自動で戻らない）
      } catch (error: any) {
        console.error('Error updating task:', error);
        alert('タスクの更新に失敗しました: ' + error.message);
      }
    } catch (error: any) {
      alert('更新に失敗しました: ' + error.message);
    }
  }

  async onDelete() {
    if (!this.task) return;
    
    if (!confirm('このタスクを削除しますか？')) {
      return;
    }

    try {
      await this.taskService.deleteTask(this.task.id);
      alert('タスクを削除しました');
      this.router.navigate(['/home']);
    } catch (error: any) {
      alert('削除に失敗しました: ' + error.message);
    }
  }

  onDuplicate() {
    if (!this.task) return;

    // タスク作成画面に遷移し、複製情報をクエリパラメータで渡す
    const queryParams: any = {
      duplicate: 'true',
      from: this.route.snapshot.queryParamMap.get('from') || 'task-detail'
    };

    // タスク情報をクエリパラメータに追加
    queryParams.title = `${this.task.title} (複製)`;
    if (this.task.description) queryParams.description = this.task.description;
    if (this.task.memo) queryParams.memo = this.task.memo;
    queryParams.status = 'not_started'; // 複製時は未着手にする
    queryParams.priority = this.task.priority || 'normal';
    if (this.task.customPriority) queryParams.customPriority = this.task.customPriority;
    queryParams.taskType = this.task.taskType || 'normal';
    if (this.task.customTaskType) queryParams.customTaskType = this.task.customTaskType;
    
    // 日付をフォーマット（YYYY-MM-DD形式）
    const startDate = this.task.startDate.toDate();
    queryParams.startDate = this.formatDateForInput(startDate);
    // 時間情報も引き継ぐ（時間が設定されている場合）
    const startTimeOnly = this.formatTimeForInput(startDate);
    if (startTimeOnly) {
      queryParams.startTime = startTimeOnly;
    }
    
    const endDate = this.task.endDate.toDate();
    queryParams.endDate = this.formatDateForInput(endDate);
    // 時間情報も引き継ぐ（時間が設定されている場合）
    const endTimeOnly = this.formatTimeForInput(endDate);
    if (endTimeOnly) {
      queryParams.endTime = endTimeOnly;
    }
    
    // 担当者情報も引き継ぐ
    if (this.task.assigneeId) {
      queryParams.assigneeId = this.task.assigneeId;
    }
    
    if (this.task.projectId) queryParams.projectId = this.task.projectId;
    if (this.task.recurrence && this.task.recurrence !== 'none') {
      queryParams.recurrence = this.task.recurrence;
      if (this.task.recurrenceEndDate) {
        const recurrenceEndDate = this.task.recurrenceEndDate.toDate();
        queryParams.recurrenceEndDate = this.formatDateForInput(recurrenceEndDate);
      }
    }
    queryParams.showProgress = this.task.showProgress !== undefined ? this.task.showProgress : true;

    // リマインダー情報をJSONで渡す
    if (this.task.reminders && this.task.reminders.length > 0) {
      const remindersInfo = this.task.reminders.map(r => ({
        type: r.type,
        amount: r.amount,
        unit: r.unit,
        scheduledAt: r.scheduledAt ? r.scheduledAt.toDate().toISOString() : null
      }));
      queryParams.reminders = JSON.stringify(remindersInfo);
    }

    this.router.navigate(['/task/create'], { queryParams });
  }

  formatWorkTime(seconds: number): string {
    if (!seconds || seconds === 0) return '0分';
    // 秒を分に変換して切り上げ
    const minutes = Math.ceil(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}時間 ${mins}分`;
    }
    return `${mins}分`;
  }

  startTimer() {
    if (this.task) {
      // 現在のfromクエリパラメータを引き継ぐ
      const from = this.route.snapshot.queryParamMap.get('from');
      const queryParams = from ? { from } : {};
      this.router.navigate(['/task', this.task.id, 'timer'], { queryParams });
    }
  }

  getStatusLabel(status: string): string {
    const statusMap: { [key: string]: string } = {
      'not_started': '未着手',
      'in_progress': '進行中',
      'completed': '完了'
    };
    return statusMap[status] || status;
  }

  getPriorityLabel(priority: string): string {
    const priorityMap: { [key: string]: string } = {
      'important': '重要',
      'normal': '普通',
      'low': '低め',
      'none': 'なし'
    };
    return priorityMap[priority] || priority;
  }

  goBack() {
    // どこから来たかを確認して戻る
    const from = this.route.snapshot.queryParamMap.get('from');
    if (from === 'gantt') {
      this.router.navigate(['/gantt']);
    } else if(from === 'task-list') {
      this.router.navigate(['/task-list']);
    } else if(from === 'statistics') {
      this.router.navigate(['/statistics']);
    } else {
      this.router.navigate(['/home']);
    }
  }

  // サブタスク関連メソッド
  async addSubtask() {
    if (!this.task || !this.newSubtaskTitle.trim()) return;
    
    // 進捗率表示が無効な場合は追加できない
    if (!this.task.showProgress) {
      alert('進捗率表示が無効なため、サブタスクを追加できません');
      return;
    }

    try {
      const newSubtask: SubTask = {
        id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 11), // よりユニークなIDを生成
        title: this.newSubtaskTitle,
        completed: false,
        assigneeId: this.authService.currentUser?.uid,
        assigneeName: this.authService.currentUser?.displayName || 'Unknown'
      };

      const currentSubtasks = this.task.subtasks || [];
      
      // Firestoreに保存する前に、undefinedのフィールドを除去
      const cleanSubtasks = currentSubtasks.map(subtask => {
        const cleanSubtask: any = {
          id: subtask.id,
          title: subtask.title,
          completed: subtask.completed,
          assigneeId: subtask.assigneeId,
          assigneeName: subtask.assigneeName
        };
        
        // completedAtはcompleted=trueの場合のみ追加
        if (subtask.completed && subtask.completedAt) {
          cleanSubtask.completedAt = subtask.completedAt;
        }
        
        return cleanSubtask;
      });
      
      const updatedSubtasks = [...cleanSubtasks, newSubtask];
      
      // サブタスク追加は自動コメントをスキップ
      await this.taskService.updateTask(this.task.id, {
        subtasks: updatedSubtasks
      }, true);

      this.newSubtaskTitle = '';
      await this.loadTask(this.task.id);
    } catch (error: any) {
      alert('サブタスクの追加に失敗しました: ' + error.message);
    }
  }

  async toggleSubtask(subtaskId: string, index?: number) {
    if (!this.task) return;

    try {
      const currentSubtasks = this.task.subtasks || []; // undefined対策
      
      // まずローカル状態を即座に更新（UIを即時に反映）
      const newSubtasks = currentSubtasks.map(subtask => {
        if (subtask.id === subtaskId) {
          return {
            ...subtask,
            completed: !subtask.completed,
            completedAt: !subtask.completed ? Timestamp.now() : undefined
          };
        }
        return subtask;
      });
      this.task.subtasks = newSubtasks;

      // Firestoreに保存用のデータを準備
      const updatedSubtasks: any = newSubtasks.map(subtask => {
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
        // completed=false の場合はフィールド自体を含めない（削除される）
        
        return updatedSubtask;
      });

      // 手動修正中でない場合のみ、進捗率を自動更新
      if (!this.task.progressManual) {
        const completedCount = newSubtasks.filter(s => s.completed).length;
        const totalCount = newSubtasks.length;
        const newProgress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
        
        // Firestoreに保存（進捗率も更新）
        await this.taskService.updateTask(this.task.id, {
          subtasks: updatedSubtasks,
          progress: newProgress
        }, true);
      } else {
        // 手動修正中の場合は、サブタスクのみ更新（進捗率は変更しない）
        await this.taskService.updateTask(this.task.id, {
          subtasks: updatedSubtasks
        }, true);
      }
    } catch (error: any) {
      alert('サブタスクの更新に失敗しました: ' + error.message);
      // エラーが発生した場合は再読み込み
      if (this.task) {
        await this.loadTask(this.task.id);
      }
    }
  }

  async deleteSubtask(subtaskId: string) {
    if (!this.task) return;

    try {
      const currentSubtasks = this.task.subtasks || []; // undefined対策
      const updatedSubtasks = currentSubtasks.filter(subtask => subtask.id !== subtaskId);
      
      // サブタスク削除は自動コメントをスキップ
      await this.taskService.updateTask(this.task.id, {
        subtasks: updatedSubtasks
      }, true);

      await this.loadTask(this.task.id);
    } catch (error: any) {
      alert('サブタスクの削除に失敗しました: ' + error.message);
    }
  }

  getCompletedSubtasks(): number {
    if (!this.task || !this.task.subtasks) return 0;
    return this.task.subtasks.filter(subtask => subtask.completed).length;
  }

  getProgressPercentage(): number {
    if (!this.task) return 0;
    
    // 手動修正中の場合は、task.progressを返す
    if (this.task.progressManual) {
      return this.task.progress;
    }
    
    // 自動計算の場合
    if (!this.task.subtasks || this.task.subtasks.length === 0) return 0;
    return Math.round((this.getCompletedSubtasks() / this.task.subtasks.length) * 100);
  }

  // 手動計算ボタンをクリックした時の処理
  showManualProgressInput() {
    if (this.task) {
      this.manualProgressValue = this.task.progress || 0;
      this.showManualInput = true;
    }
  }

  // 手動進捗率変更メソッド
  async onManualProgressChange(value: number) {
    if (!this.task) return;
    
    // 0-100の範囲に制限
    const clampedValue = Math.max(0, Math.min(100, value));
    
    try {
      // 手動修正モードに切り替え、進捗率を更新
      await this.taskService.updateTask(this.task.id, {
        progress: clampedValue,
        progressManual: true
      }, true); // 自動コメントをスキップ
      
      // タスクを再読み込み
      await this.loadTask(this.task.id);
      // 入力欄を非表示にする
      this.showManualInput = false;
    } catch (error: any) {
      alert('進捗率の更新に失敗しました: ' + error.message);
    }
  }

  // キャンセルボタンの処理
  cancelManualProgressInput() {
    this.showManualInput = false;
    if (this.task) {
      this.manualProgressValue = this.task.progress || 0;
    }
  }

  // 自動計算を再開するメソッド
  async resumeAutoProgress() {
    if (!this.task) return;
    
    try {
      // 自動計算を再開（progressManualをfalseに）
      await this.taskService.updateTask(this.task.id, {
        progressManual: false
      }, true); // 自動コメントをスキップ
      
      // タスクを再読み込み（自動計算された進捗率が反映される）
      await this.loadTask(this.task.id);
    } catch (error: any) {
      alert('自動計算の再開に失敗しました: ' + error.message);
    }
  }

  // コメント関連メソッド
  async addComment() {
    if (!this.task || !this.newCommentContent.trim()) return;

    try {
      const user = this.authService.currentUser;
      if (!user) {
        alert('ログインが必要です');
        return;
      }

      const newComment: Comment = {
        id: Date.now().toString(),
        userId: user.uid,
        userName: user.displayName || user.email || 'Unknown',
        content: this.newCommentContent.trim(),
        createdAt: Timestamp.now()
      };

      const currentComments = this.task.comments || [];
      const updatedComments = [...currentComments, newComment];

      // コメント追加時は自動コメントをスキップ
      await this.taskService.updateTask(this.task.id, {
        comments: updatedComments
      }, true);

      this.newCommentContent = '';
      await this.loadTask(this.task.id);
    } catch (error: any) {
      alert('コメントの追加に失敗しました: ' + error.message);
    }
  }

  formatDateTime(timestamp: any): string {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // リマインダー時間をフォーマット（通知メッセージ用）
  formatReminderTime(reminder: any): string {
    if (!reminder.amount || !reminder.unit) {
      return '';
    }

    const unitMap: {[key: string]: string} = {
      'minute': '分',
      'hour': '時間',
      'day': '日'
    };

    return `${reminder.amount}${unitMap[reminder.unit] || ''}`;
  }

  toggleCommentsTab() {
    this.showCommentsTab = !this.showCommentsTab;
  }

  get sortedComments(): Comment[] {
    if (!this.task || !this.task.comments) return [];
    // 作成日時の新しい順にソート
    return [...this.task.comments].sort((a, b) => {
      return b.createdAt.toMillis() - a.createdAt.toMillis();
    });
  }

  // ファイル関連メソッド
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFiles = Array.from(input.files);
    }
  }

  async uploadFiles(): Promise<void> {
    if (!this.task || this.selectedFiles.length === 0) return;

    try {
      this.isUploadingFiles = true;
      const taskId = this.task.id;
      type UploadResult = { id: string; name: string; url: string; uploadedAt: Timestamp };
      const uploadPromises: Promise<UploadResult>[] = this.selectedFiles.map((file: File) => {
        // @ts-ignore - StorageServiceの型推論の問題を回避
        return this.storageService.uploadFile(file, taskId);
      });

      const uploadedFiles = await Promise.all(uploadPromises);
      const currentFiles = this.task.files || [];
      const updatedFiles = [...currentFiles, ...uploadedFiles];

      await this.taskService.updateTask(this.task.id, {
        files: updatedFiles
      });

      this.selectedFiles = [];
      await this.loadTask(this.task.id);
      alert('ファイルをアップロードしました');
    } catch (error: any) {
      alert('ファイルのアップロードに失敗しました: ' + error.message);
    } finally {
      this.isUploadingFiles = false;
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!this.task) return;

    try {
      if (!this.task.files) return;
      
      type FileType = { id: string; url: string; name: string; uploadedAt: Timestamp };
      const fileArray: FileType[] = this.task.files;
      const file = fileArray.find((f: FileType) => f.id === fileId);
      if (!file) return;

      if (confirm('このファイルを削除しますか？')) {
        // Storageからファイルを削除
        const fileUrl: string = file.url;
        // @ts-ignore - StorageServiceの型推論の問題を回避
        await this.storageService.deleteFile(fileUrl);

        // タスクからファイル情報を削除
        const updatedFiles = this.task.files?.filter(f => f.id !== fileId) || [];
        await this.taskService.updateTask(this.task.id, {
          files: updatedFiles
        });

        await this.loadTask(this.task.id);
        alert('ファイルを削除しました');
      }
    } catch (error: any) {
      alert('ファイルの削除に失敗しました: ' + error.message);
    }
  }

  downloadFile(fileUrl: string, fileName: string): void {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // 作業時間詳細関連メソッド
  toggleWorkTimeDetails() {
    this.showWorkTimeDetails = !this.showWorkTimeDetails;
  }

  startEditSession(session: WorkSession) {
    this.editingSessionId = session.id;
    const startDate = session.startTime.toDate();
    const endDate = session.endTime?.toDate() || new Date();
    
    this.editSessionForm.patchValue({
      startTime: this.formatDateTimeForInput(startDate),
      endTime: this.formatDateTimeForInput(endDate),
      breakDuration: session.breakDuration
    });
  }

  calculateActualDuration(): number {
    if (!this.editSessionForm.valid) return 0;
    const formValue = this.editSessionForm.value;
    const startTime = new Date(formValue.startTime);
    const endTime = new Date(formValue.endTime);
    const breakDuration = formValue.breakDuration || 0;
    
    // 実働時間を計算（秒）
    const totalSeconds = Math.max(0, (endTime.getTime() - startTime.getTime()) / 1000 - (breakDuration * 60));
    return totalSeconds;
  }

  async saveSessionEdit() {
    if (!this.task || !this.editingSessionId || this.editSessionForm.invalid) {
      return;
    }

    try {
      const session = this.task.workSessions?.find(s => s.id === this.editingSessionId);
      if (!session) return;

      const formValue = this.editSessionForm.value;
      const newStartTime = new Date(formValue.startTime);
      const newEndTime = new Date(formValue.endTime);
      const newBreakDuration = formValue.breakDuration;

      // 実働時間を計算（秒）
      const totalSeconds = Math.max(0, (newEndTime.getTime() - newStartTime.getTime()) / 1000 - (newBreakDuration * 60));
      
      // 変更ログを作成
      const user = this.authService.currentUser;
      if (!user) return;

      const changeLogs: WorkSessionChangeLog[] = session.changeLogs || [];
      const changes: WorkSessionChangeLog[] = [];

      // 開始時間の変更
      if (session.startTime.toMillis() !== newStartTime.getTime()) {
        changes.push({
          id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
          sessionId: session.id,
          changedBy: user.uid,
          changedByName: user.displayName || user.email || 'Unknown',
          changedAt: Timestamp.now(),
          field: 'startTime',
          oldValue: session.startTime,
          newValue: Timestamp.fromDate(newStartTime)
        });
      }

      // 終了時間の変更
      if (!session.endTime || session.endTime.toMillis() !== newEndTime.getTime()) {
        changes.push({
          id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
          sessionId: session.id,
          changedBy: user.uid,
          changedByName: user.displayName || user.email || 'Unknown',
          changedAt: Timestamp.now(),
          field: 'endTime',
          oldValue: session.endTime || Timestamp.fromDate(new Date()),
          newValue: Timestamp.fromDate(newEndTime)
        });
      }

      // 休憩時間の変更
      if (session.breakDuration !== newBreakDuration) {
        changes.push({
          id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
          sessionId: session.id,
          changedBy: user.uid,
          changedByName: user.displayName || user.email || 'Unknown',
          changedAt: Timestamp.now(),
          field: 'breakDuration',
          oldValue: session.breakDuration,
          newValue: newBreakDuration
        });
      }

      // セッションを更新
      const updatedSessions = (this.task.workSessions || []).map(s => {
        if (s.id === session.id) {
          return {
            ...s,
            startTime: Timestamp.fromDate(newStartTime),
            endTime: Timestamp.fromDate(newEndTime),
            breakDuration: newBreakDuration,
            actualDuration: totalSeconds,
            changeLogs: [...changeLogs, ...changes]
          };
        }
        return s;
      });

      // 合計作業時間を再計算
      const totalWorkTime = updatedSessions.reduce((sum, s) => sum + s.actualDuration, 0);

      console.log('Updating sessions:', updatedSessions);
      console.log('Total work time:', totalWorkTime);

      // タスクを更新
      await this.taskService.updateTask(this.task.id, {
        workSessions: updatedSessions,
        totalWorkTime: totalWorkTime
      }, true);

      console.log('Task updated, reloading...');

      // タスクを再読み込み（Firestoreから最新データを取得）
      await this.loadTask(this.task.id);
      
      console.log('Task reloaded, workSessions:', this.task?.workSessions);
      console.log('Task reloaded, totalWorkTime:', this.task?.totalWorkTime);
      
      this.editingSessionId = null;
      this.editSessionForm.reset();
    } catch (error: any) {
      alert('セッションの更新に失敗しました: ' + error.message);
      console.error('Error saving session:', error);
    }
  }

  cancelSessionEdit() {
    this.editingSessionId = null;
    this.editSessionForm.reset();
  }

  getTotalWorkTime(): number {
    if (!this.task || !this.task.workSessions) return 0;
    return this.task.workSessions.reduce((sum, session) => sum + session.actualDuration, 0);
  }

  getSessionChangeLogs(sessionId: string): WorkSessionChangeLog[] {
    if (!this.task) return [];
    const session = this.task.workSessions?.find(s => s.id === sessionId);
    return session?.changeLogs || [];
  }

  viewSessionChangeLog(sessionId: string) {
    this.selectedSessionId = sessionId;
  }

  closeChangeLogModal() {
    this.selectedSessionId = null;
  }

  getFieldLabel(field: 'startTime' | 'endTime' | 'breakDuration'): string {
    const labels: { [key: string]: string } = {
      'startTime': '開始時間',
      'endTime': '終了時間',
      'breakDuration': '休憩時間'
    };
    return labels[field] || field;
  }

  formatChangeValue(field: 'startTime' | 'endTime' | 'breakDuration', value: any): string {
    if (field === 'breakDuration') {
      return `${value}分`;
    }
    // Timestampの場合
    if (value && value.toDate) {
      return this.formatDateTime(value);
    }
    // Dateの場合
    if (value instanceof Date) {
      return this.formatDateTime(value);
    }
    return String(value);
  }

  // 新規セッション追加を開始
  startAddNewSession() {
    this.addingNewSession = true;
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    
    this.newSessionForm.patchValue({
      startTime: this.formatDateTimeForInput(now),
      endTime: this.formatDateTimeForInput(oneHourLater),
      breakDuration: 0
    });
  }

  // 新規セッションを保存
  async saveNewSession() {
    if (!this.task || this.newSessionForm.invalid) {
      return;
    }

    try {
      const formValue = this.newSessionForm.value;
      const startTime = new Date(formValue.startTime);
      const endTime = new Date(formValue.endTime);
      const breakDuration = formValue.breakDuration || 0;

      // 実働時間を計算（秒）
      const totalSeconds = Math.max(0, (endTime.getTime() - startTime.getTime()) / 1000 - (breakDuration * 60));

      // 新規セッションを作成
      const newSession: WorkSession = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
        startTime: Timestamp.fromDate(startTime),
        endTime: Timestamp.fromDate(endTime),
        breakDuration: breakDuration,
        actualDuration: totalSeconds,
        isPomodoro: false,
        changeLogs: []
      };

      // セッションを追加
      const updatedSessions = [...(this.task.workSessions || []), newSession];

      // 合計作業時間を再計算
      const totalWorkTime = updatedSessions.reduce((sum, s) => sum + s.actualDuration, 0);

      // タスクを更新
      await this.taskService.updateTask(this.task.id, {
        workSessions: updatedSessions,
        totalWorkTime: totalWorkTime
      }, true);

      // ローカルのtaskオブジェクトも更新（即座に反映）
      if (this.task) {
        this.task.workSessions = updatedSessions;
        this.task.totalWorkTime = totalWorkTime;
      }

      // タスクを再読み込み（Firestoreから最新データを取得）
      await this.loadTask(this.task.id);
      this.addingNewSession = false;
      this.newSessionForm.reset();
    } catch (error: any) {
      alert('セッションの追加に失敗しました: ' + error.message);
      console.error('Error adding session:', error);
    }
  }

  // 新規セッション追加をキャンセル
  cancelNewSession() {
    this.addingNewSession = false;
    this.newSessionForm.reset();
  }

  // 新規セッションの実働時間を計算
  calculateNewSessionDuration(): number {
    if (!this.newSessionForm.valid) return 0;
    const formValue = this.newSessionForm.value;
    const startTime = new Date(formValue.startTime);
    const endTime = new Date(formValue.endTime);
    const breakDuration = formValue.breakDuration || 0;
    
    const totalSeconds = Math.max(0, (endTime.getTime() - startTime.getTime()) / 1000 - (breakDuration * 60));
    return totalSeconds;
  }
}

