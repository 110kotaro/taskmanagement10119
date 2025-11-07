import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterOutlet, Router, RouterModule, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from './services/auth.service';
import { ReminderService } from './services/reminder.service';
import { NotificationService } from './services/notification.service';
import { TaskService } from './services/task.service';
import { ProjectService } from './services/project.service';
import { TeamService } from './services/team.service';
import { FcmService } from './services/fcm.service';
import { StatusChangeConfirmationComponent, ConfirmationAction } from './components/status-change-confirmation/status-change-confirmation.component';
import { EndDateChangeComponent } from './components/end-date-change/end-date-change.component';
import { ProjectCompletionConfirmationComponent, ProjectCompletionAction } from './components/project-completion-confirmation/project-completion-confirmation.component';
import { ProjectEndDateConfirmationComponent, ProjectEndDateAction } from './components/project-end-date-confirmation/project-end-date-confirmation.component';
import { Task, TaskStatus } from './models/task.model';
import { Project, ProjectStatus } from './models/project.model';
import { Team } from './models/team.model';
import { Subscription, filter } from 'rxjs';
import { ThemeService } from './services/theme.service';
import { NotificationType } from './models/notification.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterModule, CommonModule, FormsModule, StatusChangeConfirmationComponent, EndDateChangeComponent, ProjectCompletionConfirmationComponent, ProjectEndDateConfirmationComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  providers: [] // AppComponentを共有サービスとして提供
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'タスク管理アプリ';
  private authService = inject(AuthService);
  private router = inject(Router);
  private reminderService = inject(ReminderService);
  private notificationService = inject(NotificationService);
  private taskService = inject(TaskService);
  private projectService = inject(ProjectService);
  private teamService = inject(TeamService);
  private fcmService = inject(FcmService);
  private themeService = inject(ThemeService);
  private userSubscription?: Subscription;
  private routerSubscription?: Subscription;
  
  unreadCount = 0;
  currentRoute = '';
  isSidebarOpen = true; // デスクトップではデフォルトで開く
  authInitialized = false; // 認証状態の初期化が完了したかどうか
  
  // 個人/チーム切り替え（全ページで共有）
  viewMode: 'personal' | 'team' = 'personal';
  selectedTeamId: string | null = null;
  userTeams: Team[] = [];
  userTeamIds: string[] = [];
  
  // 日付チェック関連（タスク）
  pendingTasks: { task: Task; checkType: 'startDate' | 'endDate' }[] = [];
  currentConfirmationTask: { task: Task; checkType: 'startDate' | 'endDate' } | null = null;
  showStatusConfirmation = false;
  showEndDateChange = false;
  private dateCheckInterval?: any; // 定期チェック用のインターバルID
  
  // 日付チェック関連（プロジェクト）
  pendingProjects: { project: Project; type: 'completion' | 'endDate' }[] = [];
  currentConfirmationProject: { project: Project; type: 'completion' | 'endDate' } | null = null;
  showProjectCompletionConfirmation = false; // 完了率100%時の確認モーダル
  showProjectEndDateConfirmation = false; // 終了日経過時の確認モーダル

  ngOnInit() {
    // ブラウザの自動翻訳を無効化
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('translate', 'no');
      document.documentElement.setAttribute('data-translate', 'no');
      if (document.body) {
        document.body.setAttribute('translate', 'no');
      }
    }
    
    // 通知からの日付チェックモーダル表示イベントをリッスン
    window.addEventListener('showDateCheckModal', ((event: CustomEvent) => {
      const { taskId, checkType } = event.detail;
      this.showDateCheckModalFromNotification(taskId, checkType);
    }) as EventListener);
    
    // テーマを初期化（サイドバーとヘッダーが正しく表示されるように）
    // ThemeServiceのコンストラクタで初期化されているが、確実に適用するため明示的に初期化
    const currentTheme = this.themeService.getCurrentTheme();
    this.themeService.setTheme(currentTheme);
    
    // Service Workerを登録（FCM用）
    this.registerServiceWorker();
    
    // 認証状態の監視
    this.userSubscription = this.authService.currentUser$.subscribe(user => {
      // 認証状態の初期化が完了したことをマーク
      if (!this.authInitialized) {
        this.authInitialized = true;
      }
      
      const currentUrl = this.router.url;
      
      if (user) {
        // ログイン済みの場合、ログイン画面にいる場合はホームにリダイレクト
        if (currentUrl === '/login' || currentUrl === '/') {
          this.router.navigate(['/home']);
        }
        // チーム情報を読み込む
        this.loadUserTeams();
        // リマインダーチェックを開始
        this.reminderService.startReminderChecking();
        // 未読通知数を取得
        this.loadUnreadCount();
        // 日付チェックを実行（初回）
        this.checkAllTasksDates();
        this.checkAllProjectsDates();
        // 定期的な日付チェックを開始（1分ごと）
        this.startPeriodicDateCheck();
        // FCM通知許可をリクエストし、トークンを取得
        this.initializeFcm();
      } else {
        // 未ログインの場合、保護されたページにいる場合はログイン画面にリダイレクト
        if (currentUrl !== '/login' && currentUrl !== '/') {
          // ホームやプロジェクトページなどの保護されたページにいる場合はログイン画面へ
          this.router.navigate(['/login']);
        }
        // リマインダーチェックを停止
        this.reminderService.stopReminderChecking();
        this.unreadCount = 0;
        // 定期チェックを停止
        this.stopPeriodicDateCheck();
        // FCMトークンを削除
        this.fcmService.deleteToken();
      }
    });

    // ルート変更を監視してアクティブ状態を更新
    this.routerSubscription = this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: any) => {
        this.currentRoute = event.url;
        // ルート変更時に未読数を更新
        const user = this.authService.currentUser;
        if (user) {
          this.loadUnreadCount();
        }
      });
    
    // 初期ルートを設定
    this.currentRoute = this.router.url;
  }

  async loadUnreadCount() {
    try {
      const user = this.authService.currentUser;
      if (user) {
        this.unreadCount = await this.notificationService.getUnreadCount(
          user.uid,
          this.userTeamIds
        );
      }
    } catch (error) {
      console.error('Error loading unread count:', error);
      this.unreadCount = 0;
    }
  }

  // ナビゲーション関数
  viewHome() {
    this.router.navigate(['/home']);
  }

  viewNotifications() {
    this.router.navigate(['/notifications']);
  }

  viewGantt() {
    this.router.navigate(['/gantt']);
  }

  viewStatistics() {
    this.router.navigate(['/statistics']);
  }

  viewTaskList() {
    this.router.navigate(['/task-list']);
  }

  viewProjects() {
    this.router.navigate(['/projects']);
  }

  viewTeams() {
    this.router.navigate(['/teams']);
  }

  viewComments() {
    this.router.navigate(['/comments']);
  }

  viewArchive() {
    this.router.navigate(['/archive']);
  }

  viewSettings() {
    this.router.navigate(['/settings']);
  }

  async loadUserTeams() {
    try {
      const user = this.authService.currentUser;
      if (user) {
        // まず保存された状態を復元
        this.loadViewModeState();
        
        this.userTeams = await this.teamService.getTeamsForUser(user.uid);
        this.userTeamIds = this.userTeams.map(team => team.id);
        
        // チームに参加していない場合は常に個人モード
        if (this.userTeams.length === 0) {
          this.viewMode = 'personal';
          this.selectedTeamId = null;
          this.saveViewModeState();
        } else {
          // 保存されたチームIDが有効かチェック
          if (this.selectedTeamId && !this.userTeams.find(t => t.id === this.selectedTeamId)) {
            // 保存されたチームIDが無効な場合は最初のチームを選択
            this.selectedTeamId = this.userTeams[0].id;
            this.saveViewModeState();
          } else if (this.viewMode === 'team' && !this.selectedTeamId) {
            // チームモードが選択されているが、チームが選択されていない場合は最初のチームを選択
            this.selectedTeamId = this.userTeams[0].id;
            this.saveViewModeState();
          }
        }
        
        // 初期状態を通知
        this.notifyViewModeChange();
      }
    } catch (error) {
      console.error('Error loading teams:', error);
    }
  }

  onViewModeChange(mode: 'personal' | 'team') {
    // チームに参加していない場合は常に個人モード
    if (this.userTeams.length === 0) {
      this.viewMode = 'personal';
      this.selectedTeamId = null;
    } else {
      this.viewMode = mode;
      if (mode === 'team' && this.userTeams.length > 0 && !this.selectedTeamId) {
        this.selectedTeamId = this.userTeams[0].id;
      } else if (mode === 'personal') {
        this.selectedTeamId = null;
      }
    }
    this.saveViewModeState();
    // 状態変更を通知（各ページで再読み込みをトリガー）
    this.notifyViewModeChange();
  }

  onTeamChange(teamId: string | null) {
    this.selectedTeamId = teamId;
    if (teamId) {
      this.viewMode = 'team';
    }
    this.saveViewModeState();
    this.notifyViewModeChange();
  }

  private saveViewModeState() {
    // localStorageに状態を保存
    try {
      localStorage.setItem('viewMode', this.viewMode);
      if (this.selectedTeamId) {
        localStorage.setItem('selectedTeamId', this.selectedTeamId);
      } else {
        localStorage.removeItem('selectedTeamId');
      }
    } catch (error) {
      console.error('Error saving view mode state:', error);
    }
  }

  private loadViewModeState() {
    // localStorageから状態を復元
    try {
      const savedViewMode = localStorage.getItem('viewMode');
      if (savedViewMode === 'personal' || savedViewMode === 'team') {
        this.viewMode = savedViewMode;
      }
      const savedTeamId = localStorage.getItem('selectedTeamId');
      if (savedTeamId) {
        this.selectedTeamId = savedTeamId;
      }
    } catch (error) {
      console.error('Error loading view mode state:', error);
    }
  }

  private notifyViewModeChange() {
    // カスタムイベントで状態変更を通知（状態も含める）
    window.dispatchEvent(new CustomEvent('viewModeChanged', {
      detail: {
        viewMode: this.viewMode,
        selectedTeamId: this.selectedTeamId,
        userTeamIds: this.userTeamIds
      }
    }));
  }

  viewAccount() {
    this.router.navigate(['/account']);
  }

  viewTaskImport() {
    this.router.navigate(['/task-import']);
  }

  async logout() {
    await this.authService.signOut();
  }

  toggleSidebar() {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  isActiveRoute(route: string): boolean {
    if (route === '/home') {
      return this.currentRoute === '/home' || this.currentRoute === '';
    }
    return this.currentRoute.startsWith(route);
  }

  get isLoggedIn(): boolean {
    return !!this.authService.currentUser;
  }

  // モーダル表示前に通知を作成するヘルパーメソッド
  private async createDateCheckNotificationIfNeeded(
    task: Task, 
    checkType: 'startDate' | 'endDate'
  ): Promise<void> {
    const user = this.authService.currentUser;
    if (!user) return;

    try {
      const title = checkType === 'startDate' 
        ? 'タスクの開始日が過ぎています'
        : 'タスクの期限が過ぎています';
      const message = checkType === 'startDate'
        ? `タスク「${task.title}」の開始日が過ぎています。ステータスを変更してください。`
        : `タスク「${task.title}」の期限が過ぎています。ステータスを変更するか、期限を延長してください。`;

      const notificationId = await this.notificationService.createNotification({
        userId: user.uid,
        type: NotificationType.TaskOverdue,
        title,
        message,
        taskId: task.id,
        projectId: task.projectId,
        checkType
      });
      
      if (notificationId) {
        console.log(`[日付チェック] ${checkType === 'startDate' ? '開始日超過' : '期限切れ'}通知を作成しました: ${notificationId} (タスク: ${task.title})`);
      } else {
        console.warn(`[日付チェック] ${checkType === 'startDate' ? '開始日超過' : '期限切れ'}通知の作成がスキップされました（通知設定で無効化されている可能性があります）(タスク: ${task.title})`);
      }
    } catch (error) {
      console.error(`Error creating ${checkType} notification:`, error);
    }
  }

  // 通知から日付チェックモーダルを表示（通知クリック時に呼び出される）
  // 通知からモーダルを表示する場合は、通知を作成しない（既に通知が存在するため）
  async showDateCheckModalFromNotification(taskId: string, checkType: 'startDate' | 'endDate') {
    try {
      const task = await this.taskService.getTask(taskId);
      if (!task) {
        alert('タスクが見つかりません');
        return;
      }

      // 通知からモーダルを表示する場合は、dateCheckedAtを無視して日付が過ぎているかだけをチェック
      // ただし、checkTaskDatesと同じロジックでステータスと時間も考慮する
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      let shouldShowModal = false;
      
      if (checkType === 'startDate' && task.startDate) {
        // 開始日チェック: 未着手で開始日時を過ぎている
        const startDate = task.startDate.toDate();
        const startTime = startDate.getHours() * 3600 + startDate.getMinutes() * 60 + startDate.getSeconds();
        const needsStartDateCheck = task.status === TaskStatus.NotStarted && 
                                    (startTime === 0 ? 
                                      startDate.getTime() < today.getTime() : 
                                      startDate.getTime() < now.getTime());
        if (needsStartDateCheck) {
          shouldShowModal = true;
        }
      } else if (checkType === 'endDate' && task.endDate) {
        // 終了日チェック: 未着手または進行中で終了日時を過ぎている
        const endDate = task.endDate.toDate();
        const endTime = endDate.getHours() * 3600 + endDate.getMinutes() * 60 + endDate.getSeconds();
        const endTimeMax = 23 * 3600 + 59 * 60 + 59; // 23:59:59
        const needsEndDateCheck = (task.status === TaskStatus.NotStarted || task.status === TaskStatus.InProgress) &&
                                  (endTime === endTimeMax ? 
                                    endDate.getTime() < today.getTime() : 
                                    endDate.getTime() < now.getTime());
        if (needsEndDateCheck) {
          shouldShowModal = true;
        }
      }

      if (!shouldShowModal) {
        // 日付が過ぎていない、またはステータスが既に変更されている場合は、すでに処理済みとして扱う
        alert('すでにステータスを変更しています');
        return;
      }

      // まだチェックが必要な場合はモーダルを表示
      this.currentConfirmationTask = { task, checkType };
      this.showStatusConfirmation = true;
    } catch (error) {
      console.error('Error showing date check modal from notification:', error);
      alert('タスクの読み込みに失敗しました');
    }
  }

  // 全タスクの日付チェックを実行
  async checkAllTasksDates() {
    try {
      console.log('[日付チェック] checkAllTasksDates() 開始');
      const user = this.authService.currentUser;
      if (!user) {
        console.log('[日付チェック] ユーザーがログインしていません');
        return;
      }

      // 既にモーダルが表示されている場合は、新しいチェックをスキップ
      if (this.showStatusConfirmation || this.pendingTasks.length > 0) {
        console.log('[日付チェック] 既にモーダルが表示されているか、処理中のタスクがあるため、スキップします');
        return;
      }

      const allTasks = await this.taskService.getTasks({
        assigneeId: user.uid,
        isDeleted: false
      });
      console.log(`[日付チェック] 全タスク数: ${allTasks.length}`);

      // チェックが必要なタスクを収集
      this.pendingTasks = [];
      
      for (const task of allTasks) {
        // 日付チェック（dateCheckedAtを考慮、1日1回のみ）
        const checkResult = this.taskService.checkTaskDates(task);
        console.log(`[日付チェック] タスク「${task.title}」: needsStartDateCheck=${checkResult.needsStartDateCheck}, needsEndDateCheck=${checkResult.needsEndDateCheck}, dateCheckedAt=${task.dateCheckedAt ? task.dateCheckedAt.toDate().toLocaleString('ja-JP') : '未設定'}`);
        
        if (checkResult.needsStartDateCheck) {
          // 通知作成はモーダル表示時に行うため、ここではタスクを収集するだけ
          this.pendingTasks.push({ task, checkType: 'startDate' });
        } else if (checkResult.needsEndDateCheck) {
          // 通知作成はモーダル表示時に行うため、ここではタスクを収集するだけ
          this.pendingTasks.push({ task, checkType: 'endDate' });
        }
      }

      console.log(`[日付チェック] チェックが必要なタスク数: ${this.pendingTasks.length}`);

      // 最初のタスクの確認モーダルを表示
      if (this.pendingTasks.length > 0) {
        const firstTask = this.pendingTasks[0];
        // モーダル表示前に通知を作成
        await this.createDateCheckNotificationIfNeeded(firstTask.task, firstTask.checkType);
        
        this.currentConfirmationTask = firstTask;
        this.showStatusConfirmation = true;
        console.log('[日付チェック] モーダルを表示します');
      } else {
        console.log('[日付チェック] チェックが必要なタスクはありません');
      }
    } catch (error) {
      console.error('[日付チェック] Error checking task dates:', error);
    }
  }

  // 全プロジェクトの日付チェックを実行
  async checkAllProjectsDates() {
    try {
      console.log('[プロジェクト日付チェック] checkAllProjectsDates() 開始');
      const user = this.authService.currentUser;
      if (!user) {
        console.log('[プロジェクト日付チェック] ユーザーがログインしていません');
        return;
      }

      // 既にモーダルが表示されている場合は、新しいチェックをスキップ
      if (this.showProjectCompletionConfirmation || this.showProjectEndDateConfirmation) {
        console.log('[プロジェクト日付チェック] 既にモーダルが表示されているため、スキップします');
        return;
      }

      // ユーザーが関連する全プロジェクトを取得
      const allProjects = await this.projectService.getProjectsForUser(user.uid);
      console.log(`[プロジェクト日付チェック] 全プロジェクト数: ${allProjects.length}`);

      // 管理者または担当者かチェック（一度だけ取得）
      const userData = await this.authService.getUserData(user.uid);
      const isAdmin = userData?.role === 'admin';

      // チェックが必要なプロジェクトを収集
      this.pendingProjects = [];
      const endDateProjects: { project: Project; type: 'endDate' }[] = [];
      
      for (const project of allProjects) {
        // 開始日チェック（自動で準備中→進行中に変更）
        await this.projectService.checkAndUpdateProjectStartDate(project);
        
        // 終了日経過チェック
        const now = new Date();
        const endDate = project.endDate.toDate();
        const isEndDatePassed = endDate.getTime() < now.getTime();
        
        // 管理者または担当者かチェック
        const isAssignee = project.assigneeId === user.uid;
        const canConfirm = isAdmin || isAssignee;
        
        if (project.status !== ProjectStatus.Completed && canConfirm) {
          // 完了率100%で終了日経過の場合は終了日経過時のモーダルのみ（完了率100%チェックはスキップ）
          if (project.completionRate === 100 && isEndDatePassed) {
            endDateProjects.push({ project, type: 'endDate' });
          } else if (project.completionRate === 100 && !isEndDatePassed) {
            // 完了率100%で終了日未経過の場合のみ完了確認モーダル
            this.pendingProjects.push({ project, type: 'completion' });
          } else if (project.completionRate < 100 && isEndDatePassed) {
            // 完了率100%未満で終了日経過の場合
            endDateProjects.push({ project, type: 'endDate' });
          }
        }
      }

      // 終了日経過のプロジェクトを追加（完了率100%のものは優先度が高いので先に処理）
      this.pendingProjects = [...this.pendingProjects, ...endDateProjects];

      console.log(`[プロジェクト日付チェック] チェックが必要なプロジェクト数: ${this.pendingProjects.length}`);

      // 最初のプロジェクトの確認モーダルを表示
      if (this.pendingProjects.length > 0) {
        const firstProject = this.pendingProjects[0];
        this.currentConfirmationProject = firstProject;
        if (firstProject.type === 'completion') {
          this.showProjectCompletionConfirmation = true;
          console.log('[プロジェクト日付チェック] 完了率100%モーダルを表示します');
        } else {
          this.showProjectEndDateConfirmation = true;
          console.log('[プロジェクト日付チェック] 終了日経過モーダルを表示します');
        }
      }
    } catch (error) {
      console.error('[プロジェクト日付チェック] Error checking project dates:', error);
    }
  }

  // ステータス変更確認のアクション処理
  async onConfirmationAction(action: ConfirmationAction) {
    if (action === 'change_end_date') {
      // 終了日変更モーダルを表示
      this.showStatusConfirmation = false;
      this.showEndDateChange = true;
    } else if (action === 'change_to_in_progress') {
      // ステータスを進行中に変更した場合、同じタスクの終了日チェックも実行
      if (this.currentConfirmationTask) {
        try {
          const updatedTask = await this.taskService.getTask(this.currentConfirmationTask.task.id);
          if (updatedTask) {
            const checkResult = this.taskService.checkTaskDates(updatedTask);
            if (checkResult.needsEndDateCheck) {
              // 終了日チェックも必要
              this.currentConfirmationTask = { task: updatedTask, checkType: 'endDate' };
              this.showStatusConfirmation = true;
              return; // 終了日チェックを表示するため、processNextTaskは呼ばない
            }
          }
        } catch (error) {
          console.error('Error checking end date:', error);
        }
      }
      // 終了日チェックが不要な場合は次のタスクに進む
      this.processNextTask();
    } else {
      // 完了に変更した場合や無視など
      // app.componentは主にモーダル表示のみで、実際の再読み込みは各ページコンポーネントで行う
      // 次のタスクの確認に進む
      this.processNextTask();
    }
  }

  // ステータス変更確認モーダルを閉じる
  onConfirmationClosed() {
    this.processNextTask();
  }

  // 次のタスクを処理
  processNextTask() {
    if (this.pendingTasks.length > 0) {
      this.pendingTasks.shift(); // 処理済みのタスクを削除
    }

    if (this.pendingTasks.length > 0) {
      // 次のタスクのモーダルを表示
      const nextTask = this.pendingTasks[0];
      // モーダル表示前に通知を作成
      this.createDateCheckNotificationIfNeeded(nextTask.task, nextTask.checkType).then(() => {
        this.currentConfirmationTask = nextTask;
        this.showStatusConfirmation = true;
      });
    } else {
      // すべてのタスクを処理完了
      this.currentConfirmationTask = null;
      this.showStatusConfirmation = false;
    }
  }

  // 終了日変更モーダルを閉じる
  onEndDateChangeCancelled() {
    this.showEndDateChange = false;
    // 確認画面に戻る
    this.showStatusConfirmation = true;
  }

  // 終了日更新後の処理
  async onEndDateUpdated(taskId: string) {
    // 終了日変更モーダルを閉じる（タスク詳細画面に遷移しているので、ここでは閉じるだけ）
    this.showEndDateChange = false;
    // 次のタスクの確認に進む
    this.processNextTask();
  }

  // プロジェクト完了確認のアクション処理
  async onProjectCompletionAction(action: ProjectCompletionAction) {
    this.processNextProject();
  }

  // プロジェクト終了日確認のアクション処理
  async onProjectEndDateAction(action: ProjectEndDateAction) {
    if (action === 'extend') {
      // 終了日変更モーダルを表示（プロジェクト詳細画面に遷移）
      if (this.currentConfirmationProject) {
        this.showProjectEndDateConfirmation = false;
        this.router.navigate(['/project', this.currentConfirmationProject.project.id], {
          queryParams: { extendEndDate: 'true' }
        });
      }
    } else {
      // 完了または無視の場合
      this.processNextProject();
    }
  }

  // プロジェクト確認モーダルを閉じる
  onProjectConfirmationClosed() {
    this.processNextProject();
  }

  // 次のプロジェクトを処理
  processNextProject() {
    if (this.pendingProjects.length > 0) {
      this.pendingProjects.shift(); // 処理済みのプロジェクトを削除
    }

    if (this.pendingProjects.length > 0) {
      // 次のプロジェクトのモーダルを表示
      const nextProject = this.pendingProjects[0];
      this.currentConfirmationProject = nextProject;
      if (nextProject.type === 'completion') {
        this.showProjectCompletionConfirmation = true;
        this.showProjectEndDateConfirmation = false;
      } else {
        this.showProjectCompletionConfirmation = false;
        this.showProjectEndDateConfirmation = true;
      }
    } else {
      // すべてのプロジェクトを処理完了
      this.currentConfirmationProject = null;
      this.showProjectCompletionConfirmation = false;
      this.showProjectEndDateConfirmation = false;
    }
  }

  // Service Workerを登録
  private async registerServiceWorker(): Promise<void> {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      } catch (error) {
        console.error('Service Worker registration failed:', error);
      }
    }
  }

  // FCMを初期化（通知許可をリクエストし、トークンを取得）
  private async initializeFcm(): Promise<void> {
    try {
      // 通知許可をリクエストし、トークンを取得
      const token = await this.fcmService.requestPermission();
      
      if (token) {
        // フォアグラウンドメッセージのリスナーを設定
        this.fcmService.setupForegroundMessageListener((payload) => {
          // フォアグラウンドで通知を表示（オプション）
          // ブラウザの通知APIを使用して表示することも可能
          if (payload.notification) {
            new Notification(payload.notification.title || 'タスクリマインダー', {
              body: payload.notification.body || '',
              icon: '/favicon.ico',
              badge: '/favicon.ico'
            });
          }
        });
      } else {
        console.warn('FCM token not obtained');
      }
    } catch (error) {
      console.error('Error initializing FCM:', error);
    }
  }

  // 定期的な日付チェックを開始
  private startPeriodicDateCheck() {
    // 既存のインターバルをクリア（重複防止）
    this.stopPeriodicDateCheck();
    
    // 1分ごとにチェックを実行
    this.dateCheckInterval = setInterval(() => {
      this.checkAllTasksDates();
      this.checkAllProjectsDates();
    }, 60 * 1000); // 60秒 = 1分
  }

  // 定期的な日付チェックを停止
  private stopPeriodicDateCheck() {
    if (this.dateCheckInterval) {
      clearInterval(this.dateCheckInterval);
      this.dateCheckInterval = undefined;
    }
  }

  ngOnDestroy() {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
    this.reminderService.stopReminderChecking();
    // 定期チェックを停止
    this.stopPeriodicDateCheck();
  }
}
