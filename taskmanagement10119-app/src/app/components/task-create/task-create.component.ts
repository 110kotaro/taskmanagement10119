import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Timestamp } from 'firebase/firestore';
import { AuthService } from '../../services/auth.service';
import { TaskService } from '../../services/task.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { Project } from '../../models/project.model';
import { TaskType, RecurrenceType } from '../../models/task.model';
import { User } from '../../models/user.model';
import { Team, TeamMember, TeamRole } from '../../models/team.model';

@Component({
  selector: 'app-task-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './task-create.component.html',
  styleUrl: './task-create.component.css'
})
export class TaskCreateComponent implements OnInit {
  private router = inject(Router);
  private authService = inject(AuthService);
  private taskService = inject(TaskService);
  private projectService = inject(ProjectService);
  private teamService = inject(TeamService);
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  createForm: FormGroup;
  isCreating = false;
  projects: Project[] = [];
  users: User[] = []; // ユーザーリスト（担当者選択用）
  teamMembers: TeamMember[] = []; // チームメンバーリスト（チームモード時）
  projectMembers: any[] = []; // プロジェクトメンバーリスト（プロジェクト選択時）
  userTeams: Team[] = []; // ユーザーが所属しているチームリスト
  viewMode: 'personal' | 'team' = 'personal';
  selectedTeamId: string | null = null;
  selectedTeam: Team | null = null;

  constructor() {
    this.createForm = this.fb.group({
      title: ['', Validators.required],
      description: [''],
      memo: [''],
      status: ['not_started', Validators.required],
      priority: ['normal', Validators.required],
      taskType: ['normal'],
      startDate: ['', Validators.required],
      startTime: [''], // 開始時間（任意）
      endDate: ['', Validators.required],
      endTime: [''], // 終了時間（任意）
      assigneeId: [''], // 担当者ID
      projectId: [''],
      teamId: [''], // チームID（チームモード時）
      recurrence: ['none'],
      recurrenceEndDate: [''],
      enableStartReminder: [false],
      startReminderType: ['none'],
      enableEndReminder: [false],
      endReminderType: ['none'],
      enableCustomReminder: [false],
      customReminderDateTime: [''],
      showProgress: [true] // デフォルトでtrue
    });

    // デフォルト値（今日と1週間後）
    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);

    this.createForm.patchValue({
      startDate: this.formatDateForInput(today),
      endDate: this.formatDateForInput(nextWeek)
    });
  }

  async ngOnInit() {
    const queryParams = this.route.snapshot.queryParamMap;
    
    // ユーザーが所属しているチームを取得
    const user = this.authService.currentUser;
    if (user) {
      this.userTeams = await this.teamService.getTeamsForUser(user.uid);
    }
    
    // 個人/チームモードの設定
    const viewModeParam = queryParams.get('viewMode');
    const teamIdParam = queryParams.get('teamId');
    
    if (viewModeParam === 'team' && teamIdParam) {
      this.viewMode = 'team';
      this.selectedTeamId = teamIdParam;
      await this.loadTeamMembers(teamIdParam);
      
      // チーム情報を取得
      const selectedTeam = this.userTeams.find(t => t.id === teamIdParam);
      this.selectedTeam = selectedTeam || null;
    } else {
      this.viewMode = 'personal';
      this.selectedTeamId = null;
      await this.loadUsers(); // 個人モードの場合は全ユーザーを読み込む（実際には使用しない）
    }
    
    // userTeamIdsを取得
    const userTeamIds = this.userTeams.map(team => team.id);
    
    // プロジェクトを読み込む（viewModeとselectedTeamIdを設定した後）
    await this.loadProjects(this.selectedTeamId, userTeamIds);
    
    // 個人モードの場合は担当者を自分自身に固定
    if (this.viewMode === 'personal') {
      if (user) {
        this.createForm.patchValue({
          assigneeId: user.uid
        });
      }
    }
    
    
    // 複製モードの場合
    if (queryParams.get('duplicate') === 'true') {
      this.loadDuplicateData(queryParams);
    } else {
      // 通常のプロジェクトID設定
      const projectId = queryParams.get('projectId');
      if (projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (project) {
          this.createForm.patchValue({
            projectId: projectId,
            taskType: 'project' // プロジェクトが設定されている場合、タスクタイプを自動設定
          });
          // プロジェクトメンバーを読み込む
          await this.loadProjectMembers(projectId);
        }
      }
    }

    // プロジェクトIDの変更を監視してプロジェクトメンバーを読み込む
    this.createForm.get('projectId')?.valueChanges.subscribe(async (projectId) => {
      if (projectId) {
        await this.loadProjectMembers(projectId);
        // プロジェクトが設定された場合、タスクタイプを自動で「project」に設定
        const currentTaskType = this.createForm.get('taskType')?.value;
        if (currentTaskType !== 'project') {
          this.createForm.patchValue({ taskType: 'project' });
        }
      } else {
        this.projectMembers = [];
        // プロジェクトが解除された場合、タスクタイプが「project」の場合は「normal」に戻す
        const currentTaskType = this.createForm.get('taskType')?.value;
        if (currentTaskType === 'project') {
          this.createForm.patchValue({ taskType: 'normal' });
        }
      }
    });
  }
  
  async loadTeamMembers(teamId: string) {
    try {
      this.selectedTeam = await this.teamService.getTeam(teamId);
      if (this.selectedTeam) {
        this.teamMembers = this.selectedTeam.members;
      }
    } catch (error) {
      console.error('Error loading team members:', error);
    }
  }

  async loadProjectMembers(projectId: string) {
    try {
      const project = await this.projectService.getProject(projectId);
      if (project && project.members) {
        this.projectMembers = project.members;
      } else {
        this.projectMembers = [];
      }
    } catch (error) {
      console.error('Error loading project members:', error);
      this.projectMembers = [];
    }
  }

  loadDuplicateData(queryParams: any) {
    const formData: any = {};

    // 基本情報
    if (queryParams.get('title')) formData.title = queryParams.get('title');
    if (queryParams.get('description')) formData.description = queryParams.get('description');
    if (queryParams.get('memo')) formData.memo = queryParams.get('memo');
    if (queryParams.get('status')) formData.status = queryParams.get('status');
    if (queryParams.get('priority')) formData.priority = queryParams.get('priority');
    if (queryParams.get('customPriority')) formData.customPriority = queryParams.get('customPriority');
    if (queryParams.get('taskType')) formData.taskType = queryParams.get('taskType');
    if (queryParams.get('startDate')) formData.startDate = queryParams.get('startDate');
    if (queryParams.get('startTime')) formData.startTime = queryParams.get('startTime');
    if (queryParams.get('endDate')) formData.endDate = queryParams.get('endDate');
    if (queryParams.get('endTime')) formData.endTime = queryParams.get('endTime');
    if (queryParams.get('assigneeId')) formData.assigneeId = queryParams.get('assigneeId');
    if (queryParams.get('projectId')) formData.projectId = queryParams.get('projectId');
    if (queryParams.get('recurrence')) formData.recurrence = queryParams.get('recurrence');
    if (queryParams.get('recurrenceEndDate')) formData.recurrenceEndDate = queryParams.get('recurrenceEndDate');
    if (queryParams.get('showProgress')) formData.showProgress = queryParams.get('showProgress') === 'true';

    // フォームに値を設定
    this.createForm.patchValue(formData);

    // リマインダー情報を復元
    const remindersJson = queryParams.get('reminders');
    if (remindersJson) {
      try {
        const remindersInfo = JSON.parse(remindersJson);
        this.restoreReminders(remindersInfo);
      } catch (e) {
        console.error('Failed to parse reminders:', e);
      }
    }
  }

  restoreReminders(remindersInfo: any[]) {
    // 開始前のリマインダーを復元
    const startReminder = remindersInfo.find(r => r.type === 'before_start');
    if (startReminder) {
      this.createForm.patchValue({
        enableStartReminder: true,
        startReminderType: this.mapReminderToPreset(startReminder)
      });
    }

    // 期限前のリマインダーを復元
    const endReminder = remindersInfo.find(r => r.type === 'before_end');
    if (endReminder) {
      this.createForm.patchValue({
        enableEndReminder: true,
        endReminderType: this.mapReminderToPreset(endReminder)
      });
    }

    // カスタムリマインダーを復元
    const customReminder = remindersInfo.find(r => r.scheduledAt);
    if (customReminder) {
      const scheduledDate = new Date(customReminder.scheduledAt);
      const localDateTime = this.formatDateTimeLocal(scheduledDate);
      this.createForm.patchValue({
        enableCustomReminder: true,
        customReminderDateTime: localDateTime
      });
    }
  }

  mapReminderToPreset(reminder: any): string {
    // リマインダー情報をプリセットにマッピング
    if (!reminder.amount || !reminder.unit) return 'none';

    // プリセットマップを作成
    const presetMap: { [key: string]: string } = {
      '1day': '1day',
      '3hour': '3hour',
      '1hour': '1hour',
      '30minute': '30min',
      '15minute': '15min',
      '10minute': '10min',
      '5minute': '5min',
      '1minute': '1min'
    };

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

  formatDateTimeLocal(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  async loadUsers() {
    try {
      this.users = await this.authService.getAllUsers();
    } catch (error: any) {
      console.error('Error loading users:', error);
    }
  }

  async loadProjects(teamId: string | null = null, userTeamIds: string[] = []) {
    try {
      const user = this.authService.currentUser;
      if (user) {
        this.projects = await this.projectService.getProjectsForUser(user.uid, teamId, userTeamIds);
      }
    } catch (error: any) {
      console.error('Error loading projects:', error);
    }
  }

  formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async onCreate() {
    if (!this.createForm.valid) {
      alert('必須項目を入力してください');
      return;
    }

    try {
      const user = this.authService.currentUser;
      if (!user) {
        alert('ユーザーがログインしていません');
        return;
      }

      this.isCreating = true;
      const formValue = this.createForm.value;
      
      // プロジェクト名を取得
      let projectName: string | undefined;
      let project: Project | undefined;
      if (formValue.projectId) {
        project = this.projects.find(p => p.id === formValue.projectId);
        projectName = project?.name;
        
        // チームプロジェクトの場合、プロジェクトメンバー、プロジェクトオーナー、またはチーム管理者かどうかをチェック
        if (project && project.teamId) {
          const isProjectMember = project.members && project.members.some(m => m.userId === user.uid);
          const isProjectOwner = project.ownerId === user.uid;
          
          // チーム管理者かどうかをチェック
          let isTeamAdmin = false;
          if (project.teamId) {
            try {
              const team = await this.teamService.getTeam(project.teamId);
              if (team) {
                const member = team.members.find(m => m.userId === user.uid);
                isTeamAdmin = member?.role === TeamRole.Admin || member?.role === TeamRole.Owner || team.ownerId === user.uid;
              }
            } catch (error) {
              console.error('Error checking team admin:', error);
            }
          }
          
          if (!isProjectMember && !isProjectOwner && !isTeamAdmin) {
            alert('このプロジェクトのタスクを作成する権限がありません。プロジェクトメンバー、プロジェクトオーナー、またはチーム管理者のみがタスクを作成できます。');
            this.isCreating = false;
            return;
          }
        }
      }
      
      // タスクタイプの決定
      let taskTypeValue = TaskType.Normal;
      
      if (formValue.taskType === 'normal') taskTypeValue = TaskType.Normal;
      else if (formValue.taskType === 'meeting') taskTypeValue = TaskType.Meeting;
      else if (formValue.taskType === 'regular') taskTypeValue = TaskType.Regular;
      else if (formValue.taskType === 'project') taskTypeValue = TaskType.Project;
      else if (formValue.taskType === 'other') taskTypeValue = TaskType.Other;

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
          const reminder: any = {
            id: (Date.now() + reminderCounter).toString(),
            type: 'before_start',
            amount: preset.amount,
            unit: preset.unit,
            sent: false
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
          const reminder: any = {
            id: (Date.now() + reminderCounter).toString(),
            type: 'before_end',
            amount: preset.amount,
            unit: preset.unit,
            sent: false
          };
          reminders.push(reminder);
          reminderCounter++;
        }
      }

      // カスタム設定のリマインダー（絶対日時）
      if (formValue.enableCustomReminder && formValue.customReminderDateTime) {
        const reminder: any = {
          id: (Date.now() + reminderCounter).toString(),
          scheduledAt: Timestamp.fromDate(new Date(formValue.customReminderDateTime)),
          sent: false
        };
        reminders.push(reminder);
      }

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

      // 終了日時が開始日時より前でないかチェック
      if (endDateTime.getTime() < startDateTime.getTime()) {
        alert('終了日時は開始日時より後である必要があります');
        this.isCreating = false;
        return;
      }

      // 担当者の処理
      let assigneeId: string | undefined = undefined;
      let assigneeName: string | undefined = undefined;
      if (formValue.assigneeId && formValue.assigneeId.trim() !== '') {
        assigneeId = formValue.assigneeId;
        // プロジェクトが選択されている場合はプロジェクトメンバーから検索
        if (formValue.projectId && this.projectMembers.length > 0) {
          const selectedMember = this.projectMembers.find(m => m.userId === assigneeId);
          assigneeName = selectedMember?.userName || selectedMember?.userEmail || 'Unknown';
        }
        // プロジェクトが選択されていない場合はチームメンバーから検索
        else if (this.teamMembers.length > 0) {
          const selectedMember = this.teamMembers.find(m => m.userId === assigneeId);
          assigneeName = selectedMember?.userName || selectedMember?.userEmail || 'Unknown';
        }
        // フォールバック：usersから検索
        else {
          const selectedUser = this.users.find(u => u.id === assigneeId);
          assigneeName = selectedUser?.displayName || selectedUser?.email || 'Unknown';
        }
      } else {
        // 担当者が未選択の場合は担当者なし（undefined）
        assigneeId = undefined;
        assigneeName = undefined;
      }

      // チームIDの処理（チームモードの場合は現在選択中のチームを使用）
      let teamId: string | undefined = undefined;
      let teamName: string | undefined = undefined;
      
      if (this.viewMode === 'team' && this.selectedTeamId) {
        teamId = this.selectedTeamId;
        teamName = this.selectedTeam?.name;
      }

      // 繰り返しタスクのバリデーション
      const recurrenceType = formValue.recurrence || 'none';
      if (recurrenceType !== 'none') {
        const maxPeriods: { [key: string]: number } = {
          'daily': 3,
          'weekly': 3,
          'biweekly': 6,
          'monthly': 12,
          'yearly': 36
        };
        const maxPeriod = maxPeriods[recurrenceType] || 0;

        if (formValue.recurrenceEndDate) {
          // 繰り返し終了日が設定されている場合
          const recurrenceEndDate = new Date(formValue.recurrenceEndDate);
          // 開始日に最大期間を加算した日付を計算
          const maxEndDate = new Date(startDateTime);
          maxEndDate.setMonth(maxEndDate.getMonth() + maxPeriod);
          
          // 日付レベルで比較（時刻部分を無視）
          const recurrenceEndDateOnly = new Date(recurrenceEndDate.getFullYear(), recurrenceEndDate.getMonth(), recurrenceEndDate.getDate());
          const maxEndDateOnly = new Date(maxEndDate.getFullYear(), maxEndDate.getMonth(), maxEndDate.getDate());
          
          if (recurrenceEndDateOnly > maxEndDateOnly) {
            alert(`繰り返し終了日が最大生成期間（${maxPeriod}か月）を超えています。設定し直してください。`);
            return;
          }
        } else {
          // 繰り返し終了日が未設定の場合
          alert(`繰り返し終了日が設定されていません。最大${maxPeriod}か月分のタスクを生成します。`);
        }
      }

      const taskId = await this.taskService.createTask({
        title: formValue.title,
        description: formValue.description,
        memo: formValue.memo,
        assigneeId: assigneeId,
        assigneeName: assigneeName,
        status: formValue.status,
        priority: formValue.priority,
        customPriority: formValue.customPriority || undefined,
        taskType: taskTypeValue,
        startDate: Timestamp.fromDate(startDateTime),
        endDate: Timestamp.fromDate(endDateTime),
        projectId: formValue.projectId || undefined,
        projectName: projectName,
        teamId: teamId, // チーム内公開が有効な場合のみ設定
        teamName: teamName,
        recurrence: recurrenceType as RecurrenceType,
        recurrenceEndDate: formValue.recurrenceEndDate ? Timestamp.fromDate(new Date(formValue.recurrenceEndDate)) : undefined,
        showProgress: formValue.showProgress !== undefined ? formValue.showProgress : true,
        reminders: reminders
      });

      // 繰り返しタスクを生成
      if (recurrenceType !== 'none') {
        try {
          const parentTask = await this.taskService.getTask(taskId);
          if (parentTask) {
            await this.taskService.generateRecurringTasks(parentTask);
            alert('タスクと繰り返しタスクを作成しました！');
          } else {
            alert('タスクを作成しました！');
          }
        } catch (error: any) {
          alert('タスクは作成しましたが、繰り返しタスクの生成に失敗しました: ' + error.message);
        }
      } else {
        alert('タスクを作成しました！');
      }
      
      // 作成後の遷移先を決定
      const from = this.route.snapshot.queryParamMap.get('from');
      if (from === 'project-detail' && formValue.projectId) {
        // プロジェクト詳細ページに戻る
        this.router.navigate(['/project', formValue.projectId]);
      } else {
        // 通常通りタスク詳細ページへ
        this.router.navigate(['/task', taskId]);
      }
    } catch (error: any) {
      alert('タスクの作成に失敗しました: ' + error.message);
    } finally {
      this.isCreating = false;
    }
  }

  getSelectedProjectName(): string {
    const projectId = this.createForm.get('projectId')?.value;
    if (projectId) {
      const project = this.projects.find(p => p.id === projectId);
      return project?.name || '';
    }
    return '';
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/home']);
    }
  }
}

