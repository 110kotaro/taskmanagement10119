import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterOutlet, Router, RouterModule, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase-config';
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
  unreadCommentTaskCount = 0; // 未読コメントがあるタスク数
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
  private isProcessingTask = false; // タスク処理中フラグ（処理中は新しいチェックを開始しない）
  private dateCheckInterval?: any; // 定期チェック用のインターバルID
  
  // 日付チェック関連（プロジェクト）
  pendingProjects: { project: Project; type: 'completion' | 'endDate' }[] = [];
  currentConfirmationProject: { project: Project; type: 'completion' | 'endDate' } | null = null;
  showProjectCompletionConfirmation = false; // 完了率100%時の確認モーダル
  showProjectEndDateConfirmation = false; // 終了日経過時の確認モーダル
  private isProcessingProject = false; // プロジェクト処理中フラグ（処理中は新しいチェックを開始しない）

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

    // プロジェクト日付チェックモーダル表示イベントをリッスン
    window.addEventListener('showProjectDateCheckModal', ((event: CustomEvent) => {
      const { projectId, checkType } = event.detail;
      this.showProjectDateCheckModalFromNotification(projectId, checkType);
    }) as EventListener);
    
    // テーマを初期化（サイドバーとヘッダーが正しく表示されるように）
    // ThemeServiceのコンストラクタで初期化されているが、確実に適用するため明示的に初期化
    const currentTheme = this.themeService.getCurrentTheme();
    this.themeService.setTheme(currentTheme);
    
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
        // 未読コメント数を取得
        this.loadUnreadCommentTaskCount();
        // 日付チェックを実行（初回）
        this.checkAllTasksDates();
        this.checkAllProjectsDates();
        // 定期的な日付チェックを開始（1分ごと）
        this.startPeriodicDateCheck();
        // FCM通知許可をリクエストし、トークンを取得
        this.initializeFcm();
      } else {
        // 未ログインの場合、保護されたページにいる場合はログイン画面にリダイレクト
        // ただし、チーム招待リンクページは除外
        if (currentUrl !== '/login' && currentUrl !== '/' && !currentUrl.startsWith('/team-invitation')) {
          // ホームやプロジェクトページなどの保護されたページにいる場合はログイン画面へ
          this.router.navigate(['/login']);
        }
        // リマインダーチェックを停止
        this.reminderService.stopReminderChecking();
        this.unreadCount = 0;
        this.unreadCommentTaskCount = 0;
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
          this.loadUnreadCommentTaskCount();
        }
      });
    
    // ビューモード変更を監視して未読コメント数を更新
    window.addEventListener('viewModeChanged', () => {
      const user = this.authService.currentUser;
      if (user) {
        this.loadUnreadCommentTaskCount();
      }
    });
    
    // コメント更新を監視して未読コメント数を更新
    window.addEventListener('commentUpdated', () => {
      const user = this.authService.currentUser;
      if (user) {
        this.loadUnreadCommentTaskCount();
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

  // 未読コメントがあるタスク数とプロジェクト数を取得
  async loadUnreadCommentTaskCount() {
    try {
      const user = this.authService.currentUser;
      if (!user) {
        this.unreadCommentTaskCount = 0;
        return;
      }

      // 個人/チームモードに応じてタスクを取得（タスク一覧と同じロジック）
      const viewMode = localStorage.getItem('viewMode') === 'team' ? 'team' : 'personal';
      const selectedTeamId = localStorage.getItem('selectedTeamId');
      
      let fetchedTasks: Task[] = [];
      if (viewMode === 'personal') {
        // 個人モード: 自分が作成したタスク または 所属チームのタスクで自分が担当者
        fetchedTasks = await this.taskService.getTasks({
          isDeleted: false,
          teamId: null,
          userId: user.uid,
          userTeamIds: this.userTeamIds
        });
      } else if (viewMode === 'team' && selectedTeamId) {
        // チームモード: 選択されたチームのタスクのみ
        fetchedTasks = await this.taskService.getTasks({
          isDeleted: false,
          teamId: selectedTeamId
        });
      }

      // canViewTaskで閲覧可能なタスクのみをフィルタリング
      const viewableTasks: Task[] = [];
      for (const task of fetchedTasks) {
        const canView = await this.taskService.canViewTask(task, user.uid);
        if (canView) {
          viewableTasks.push(task);
        }
      }

      // コメントがあるタスクのみを対象に、未読コメントがあるタスク数をカウント
      let unreadTaskCount = 0;
      for (const task of viewableTasks) {
        if (task.comments && task.comments.length > 0) {
          const unreadCount = await this.calculateUnreadCommentCount(task, user.uid);
          if (unreadCount > 0) {
            unreadTaskCount++;
          }
        }
      }

      // ユーザーが見れる全てのプロジェクトを取得（プロジェクト一覧と同じロジック）
      const projects = await this.projectService.getProjectsForUser(
        user.uid,
        viewMode === 'team' ? selectedTeamId : null,
        this.userTeamIds
      );

      // コメントがあるプロジェクトのみを対象に、未読コメントがあるプロジェクト数をカウント
      let unreadProjectCount = 0;
      for (const project of projects) {
        if (project.comments && project.comments.length > 0) {
          const unreadCount = await this.calculateUnreadCommentCountForProject(project, user.uid);
          if (unreadCount > 0) {
            unreadProjectCount++;
          }
        }
      }

      // タスク数とプロジェクト数を合計
      this.unreadCommentTaskCount = unreadTaskCount + unreadProjectCount;
    } catch (error) {
      console.error('Error loading unread comment task count:', error);
      this.unreadCommentTaskCount = 0;
    }
  }

  // 未読コメント数を計算（タスク用）
  private async calculateUnreadCommentCount(task: Task, userId: string): Promise<number> {
    if (!task.comments || task.comments.length === 0) {
      return 0;
    }

    try {
      const readStatusRef = doc(db, 'commentReadStatus', `${userId}_${task.id}`);
      const readStatusSnap = await getDoc(readStatusRef);
      
      if (!readStatusSnap.exists()) {
        // 既読状態が存在しない場合、全コメントを未読とする
        return task.comments.length;
      }

      const readStatus = readStatusSnap.data();
      const readCommentIds = new Set(readStatus?.['readCommentIds'] || []);
      
      // 未読コメント数を計算
      const unreadCount = task.comments.filter(comment => !readCommentIds.has(comment.id)).length;
      return unreadCount;
    } catch (error) {
      console.error('Error calculating unread comment count:', error);
      return 0;
    }
  }

  // 未読コメント数を計算（プロジェクト用）
  private async calculateUnreadCommentCountForProject(project: Project, userId: string): Promise<number> {
    if (!project.comments || project.comments.length === 0) {
      return 0;
    }

    try {
      const readStatusRef = doc(db, 'commentReadStatus', `${userId}_project_${project.id}`);
      const readStatusSnap = await getDoc(readStatusRef);
      
      if (!readStatusSnap.exists()) {
        // 既読状態が存在しない場合、全コメントを未読とする
        return project.comments.length;
      }

      const readStatus = readStatusSnap.data();
      const readCommentIds = new Set(readStatus?.['readCommentIds'] || []);
      
      // 未読コメント数を計算
      const unreadCount = project.comments.filter(comment => !readCommentIds.has(comment.id)).length;
      return unreadCount;
    } catch (error) {
      console.error('Error calculating unread comment count for project:', error);
      return 0;
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

  get isTeamInvitationPage(): boolean {
    return this.currentRoute.startsWith('/team-invitation');
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

      // チームタスクで担当者未割当の場合は作成者に通知、それ以外は担当者（または現在のユーザー）に通知
      const notificationUserId = (task.teamId && (!task.assigneeId || task.assigneeId === '')) 
        ? task.creatorId 
        : (task.assigneeId || user.uid);

      const notificationId = await this.notificationService.createNotification({
        userId: notificationUserId,
        type: NotificationType.TaskOverdue,
        title,
        message,
        taskId: task.id,
        projectId: task.projectId,
        checkType
      });
      
      if (notificationId) {
        console.log(`[日付チェック] ${checkType === 'startDate' ? '開始日超過' : '期限切れ'}通知を作成しました: ${notificationId} (タスク: ${task.title})`);
        
        // 通知作成成功時、dateCheckedAtを更新（1日1回のみ通知するため）
        // ただし、開始日チェックの場合、終了日チェックも必要かもしれないので、
        // 終了日チェックが必要な場合は更新しない
        if (checkType === 'startDate') {
          // 開始日チェックの場合、終了日チェックも必要か確認
          const checkResult = this.taskService.checkTaskDates(task);
          if (!checkResult.needsEndDateCheck) {
            // 終了日チェックが不要な場合のみ更新
            await this.taskService.markTaskDateChecked(task.id);
          }
          // 終了日チェックが必要な場合は更新しない（終了日チェックでも通知を作成するため）
        } else {
          // 終了日チェックの場合は更新
          await this.taskService.markTaskDateChecked(task.id);
        }
      } else {
        console.warn(`[日付チェック] ${checkType === 'startDate' ? '開始日超過' : '期限切れ'}通知の作成がスキップされました（通知設定で無効化されている可能性があります）(タスク: ${task.title})`);
      }
    } catch (error) {
      console.error(`Error creating ${checkType} notification:`, error);
    }
  }

  // プロジェクトの日付チェック通知を作成（必要に応じて）
  private async createProjectDateCheckNotificationIfNeeded(
    project: Project, 
    checkType: 'completion' | 'endDate'
  ): Promise<void> {
    const user = this.authService.currentUser;
    if (!user) return;

    try {
      const title = checkType === 'completion' 
        ? 'プロジェクトの完了率が100%になりました'
        : 'プロジェクトの期限が過ぎています';
      const message = checkType === 'completion'
        ? `プロジェクト「${project.name}」の完了率が100%になりました。完了にしますか？`
        : `プロジェクト「${project.name}」の期限が過ぎています。ステータスを変更するか、期限を延長してください。`;

      // チームプロジェクトで担当者未割当の場合は作成者に通知、それ以外は担当者（または現在のユーザー）に通知
      const notificationUserId = (project.teamId && (!project.assigneeId || project.assigneeId === '')) 
        ? project.ownerId 
        : (project.assigneeId || user.uid);

      const notificationId = await this.notificationService.createNotification({
        userId: notificationUserId,
        type: checkType === 'completion' ? NotificationType.ProjectCompleted : NotificationType.ProjectUpdated,
        title,
        message,
        projectId: project.id,
        checkType: checkType === 'completion' ? 'completion' : 'projectEndDate'
      });
      
      if (notificationId) {
        console.log(`[プロジェクト日付チェック] ${checkType === 'completion' ? '完了率100%' : '期限切れ'}通知を作成しました: ${notificationId} (プロジェクト: ${project.name}, 通知先: ${notificationUserId})`);
        
        // 通知作成成功時、dateCheckedAtを更新（1日1回のみ通知するため）
        await this.projectService.markProjectDateChecked(project.id);
      } else {
        console.warn(`[プロジェクト日付チェック] ${checkType === 'completion' ? '完了率100%' : '期限切れ'}通知の作成がスキップされました（通知設定で無効化されている可能性があります）(プロジェクト: ${project.name})`);
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
        let needsEndDateCheck = false;
        if (endTime === endTimeMax) {
          // 終了日の翌日の00:00:00と比較
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          needsEndDateCheck = (task.status === TaskStatus.NotStarted || task.status === TaskStatus.InProgress) &&
                              endDate.getTime() < tomorrow.getTime();
        } else {
          // 時刻も含めて比較
          needsEndDateCheck = (task.status === TaskStatus.NotStarted || task.status === TaskStatus.InProgress) &&
                              endDate.getTime() < now.getTime();
        }
        if (needsEndDateCheck) {
          shouldShowModal = true;
        }
      }

      if (!shouldShowModal) {
        // 日付が過ぎていない、またはステータスが既に変更されている場合は、すでに処理済みとして扱う
        alert('すでに処理済みです');
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

  // 通知からプロジェクト日付チェックモーダルを表示（通知クリック時に呼び出される）
  async showProjectDateCheckModalFromNotification(projectId: string, checkType: 'completion' | 'projectEndDate') {
    try {
      const project = await this.projectService.getProject(projectId);
      if (!project) {
        alert('プロジェクトが見つかりません');
        return;
      }

      // 通知からモーダルを表示する場合は、dateCheckedAtを無視して日付が過ぎているかだけをチェック
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      let shouldShowModal = false;
      
      if (checkType === 'completion') {
        // 完了率100%チェック: 完了率が100%で未完了
        if (project.completionRate === 100 && project.status !== ProjectStatus.Completed) {
          shouldShowModal = true;
        }
      } else if (checkType === 'projectEndDate') {
        // 終了日チェック: 未完了で終了日時を過ぎている
        const endDate = project.endDate.toDate();
        const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        const endTime = endDate.getHours() * 3600 + endDate.getMinutes() * 60 + endDate.getSeconds();
        const endTimeMax = 23 * 3600 + 59 * 60 + 59; // 23:59:59
        if (project.status !== ProjectStatus.Completed) {
          if (endTime === endTimeMax) {
            // 終了日の翌日の00:00:00と比較
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            if (endDateOnly < tomorrow) {
              shouldShowModal = true;
            }
          } else {
            // 時刻も含めて比較
            if (endDate.getTime() < now.getTime()) {
              shouldShowModal = true;
            }
          }
        }
      }

      if (!shouldShowModal) {
        // 日付が過ぎていない、またはステータスが既に変更されている場合は、すでに処理済みとして扱う
        alert('すでに処理済みです');
        return;
      }

      // まだチェックが必要な場合はモーダルを表示
      this.currentConfirmationProject = { project, type: checkType === 'completion' ? 'completion' : 'endDate' };
      if (checkType === 'completion') {
        this.showProjectCompletionConfirmation = true;
      } else {
        this.showProjectEndDateConfirmation = true;
      }
    } catch (error) {
      console.error('Error showing project date check modal from notification:', error);
      alert('プロジェクトの読み込みに失敗しました');
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

      // 既にモーダルが表示されている場合、処理中のタスクがある場合、または処理中フラグが立っている場合は、新しいチェックをスキップ
      if (this.showStatusConfirmation || this.currentConfirmationTask !== null || this.isProcessingTask) {
        console.log('[日付チェック] 既にモーダルが表示されているか、処理中のタスクがあるため、スキップします');
        return;
      }

      // 担当者が自分のタスク、またはチームタスクで担当者未割当で作成者が自分のタスクを取得
      const allTasks = await this.taskService.getTasks({
        isDeleted: false
      });

      // フィルタリング: 担当者が自分のタスク、またはチームタスクで担当者未割当で作成者が自分のタスク
      const filteredTasks = allTasks.filter(task => {
        // 担当者が自分のタスク
        if (task.assigneeId === user.uid) {
          return true;
        }
        // チームタスクで担当者未割当で作成者が自分のタスク
        if (task.teamId && (!task.assigneeId || task.assigneeId === '') && task.creatorId === user.uid) {
          return true;
        }
        return false;
      });
      
      console.log(`[日付チェック] 全タスク数: ${allTasks.length}, フィルタ後: ${filteredTasks.length}`);

      // チェックが必要なタスクに対して通知を作成（モーダル表示は通知から行う）
      let notificationCount = 0;
      
      for (const task of filteredTasks) {
        // 日付チェック（dateCheckedAtを考慮、1日1回のみ）
        const checkResult = this.taskService.checkTaskDates(task);
        console.log(`[日付チェック] タスク「${task.title}」: needsStartDateCheck=${checkResult.needsStartDateCheck}, needsEndDateCheck=${checkResult.needsEndDateCheck}, dateCheckedAt=${task.dateCheckedAt ? task.dateCheckedAt.toDate().toLocaleString('ja-JP') : '未設定'}`);
        
        if (checkResult.needsStartDateCheck) {
          // 通知作成のみ（モーダル表示は通知から行う）
          await this.createDateCheckNotificationIfNeeded(task, 'startDate');
          notificationCount++;
        }
        if (checkResult.needsEndDateCheck) {
          // 通知作成のみ（モーダル表示は通知から行う）
          // 開始日チェックと終了日チェックの両方が必要な場合、両方の通知を作成
          await this.createDateCheckNotificationIfNeeded(task, 'endDate');
          notificationCount++;
        }
      }

      console.log(`[日付チェック] 通知を作成したタスク数: ${notificationCount}`);
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

      // 既にモーダルが表示されている場合、処理中のプロジェクトがある場合、または処理中フラグが立っている場合は、新しいチェックをスキップ
      if (this.showProjectCompletionConfirmation || this.showProjectEndDateConfirmation || 
          this.currentConfirmationProject !== null || this.isProcessingProject) {
        console.log('[プロジェクト日付チェック] 既にモーダルが表示されているか、処理中のプロジェクトがあるため、スキップします');
        return;
      }

      // ユーザーが関連する全プロジェクトを取得
      const allProjects = await this.projectService.getProjectsForUser(user.uid);
      console.log(`[プロジェクト日付チェック] 全プロジェクト数: ${allProjects.length}`);

      // チェックが必要なプロジェクトに対して通知を作成（モーダル表示は通知から行う）
      let notificationCount = 0;
      
      for (const project of allProjects) {
        // 開始日チェック（自動で準備中→進行中に変更）
        await this.projectService.checkAndUpdateProjectStartDate(project);
        
        // 終了日経過チェック
        const now = new Date();
        const endDate = project.endDate.toDate();
        const isEndDatePassed = endDate.getTime() < now.getTime();
        
        // 担当者または作成者かチェック
        const isAssignee = project.assigneeId === user.uid;
        // 個人プロジェクトの場合はオーナー、チームプロジェクトで担当者未割当の場合は作成者もチェック対象
        const isCreator = project.ownerId === user.uid && 
                          (!project.teamId || !project.assigneeId || project.assigneeId === '');
        const canConfirm = isAssignee || isCreator;
        
        // 今日既にチェック済みか確認（日付のみで判断）
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let isAlreadyCheckedToday = false;
        if (project.dateCheckedAt) {
          const checkedDate = project.dateCheckedAt.toDate();
          const checkedDateOnly = new Date(checkedDate.getFullYear(), checkedDate.getMonth(), checkedDate.getDate());
          if (checkedDateOnly.getTime() === today.getTime()) {
            // 今日既にチェック済み
            isAlreadyCheckedToday = true;
          }
        }
        
        if (project.status !== ProjectStatus.Completed && canConfirm && !isAlreadyCheckedToday) {
          // 完了率100%で終了日経過の場合は終了日経過時の通知のみ（完了率100%チェックはスキップ）
          if (project.completionRate === 100 && isEndDatePassed) {
            // 通知作成のみ（モーダル表示は通知から行う）
            await this.createProjectDateCheckNotificationIfNeeded(project, 'endDate');
            notificationCount++;
          } else if (project.completionRate === 100 && !isEndDatePassed) {
            // 完了率100%で終了日未経過の場合のみ完了確認通知
            // 通知作成のみ（モーダル表示は通知から行う）
            await this.createProjectDateCheckNotificationIfNeeded(project, 'completion');
            notificationCount++;
          } else if (project.completionRate < 100 && isEndDatePassed) {
            // 完了率100%未満で終了日経過の場合
            // 通知作成のみ（モーダル表示は通知から行う）
            await this.createProjectDateCheckNotificationIfNeeded(project, 'endDate');
            notificationCount++;
          }
        }
      }

      console.log(`[プロジェクト日付チェック] 通知を作成したプロジェクト数: ${notificationCount}`);
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
          // 状態更新の完了を待つ
          await new Promise(resolve => setTimeout(resolve, 100)); // 少し待ってからタスクを再取得
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
      await this.processNextTask();
    } else {
      // 完了に変更した場合や無視など
      // app.componentは主にモーダル表示のみで、実際の再読み込みは各ページコンポーネントで行う
      // 次のタスクの確認に進む
      await this.processNextTask();
    }
  }

  // ステータス変更確認モーダルを閉じる
  async onConfirmationClosed() {
    // モーダルを閉じた時、dateCheckedAtを更新（念のため）
    // ただし、開始日チェックで進行中に変更した場合は、既に更新済みなのでスキップ
    if (this.currentConfirmationTask) {
      const task = this.currentConfirmationTask.task;
      const checkType = this.currentConfirmationTask.checkType;
      
      try {
        // 現在のタスクの状態を取得
        const currentTask = await this.taskService.getTask(task.id);
        if (currentTask) {
          // 終了日チェックの場合、または開始日チェックで完了/無視した場合は更新
          if (checkType === 'endDate') {
            await this.taskService.markTaskDateChecked(task.id);
          } else if (checkType === 'startDate') {
            // 開始日チェックの場合、現在のステータスを確認
            if (currentTask.status === TaskStatus.NotStarted) {
              // まだ未着手の場合は更新（無視した場合）
              await this.taskService.markTaskDateChecked(task.id);
            }
            // 進行中に変更した場合は更新しない（既に更新済み、または終了日チェックも必要）
          }
        }
      } catch (error) {
        console.error('Error updating dateCheckedAt on close:', error);
      }
    }
    await this.processNextTask();
  }

  // モーダルを閉じる（通知からのモーダル表示用）
  async processNextTask() {
    // 処理中フラグを立てる
    this.isProcessingTask = true;
    
    try {
      // 現在のタスクの状態更新が完了するまで少し待つ
      await new Promise(resolve => setTimeout(resolve, 200));

      // モーダルを閉じる（通知からのモーダル表示は1つずつなので、次のタスクはない）
      this.currentConfirmationTask = null;
      this.showStatusConfirmation = false;
    } finally {
      // 処理中フラグを下ろす
      this.isProcessingTask = false;
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
    await this.processNextTask();
  }

  // プロジェクト完了確認のアクション処理
  async onProjectCompletionAction(action: ProjectCompletionAction) {
    await this.processNextProject();
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
      await this.processNextProject();
    }
  }

  // プロジェクト確認モーダルを閉じる
  async onProjectConfirmationClosed() {
    // モーダルを閉じた時、dateCheckedAtを更新（念のため）
    if (this.currentConfirmationProject) {
      const project = this.currentConfirmationProject.project;
      const checkType = this.currentConfirmationProject.type;
      try {
        const currentProject = await this.projectService.getProject(project.id);
        if (currentProject) {
          if (checkType === 'endDate') {
            await this.projectService.markProjectDateChecked(project.id);
          } else if (checkType === 'completion') {
            if (currentProject.status !== ProjectStatus.Completed) {
              // まだ完了していない場合は更新（無視した場合）
              await this.projectService.markProjectDateChecked(project.id);
            }
            // 完了に変更した場合は更新しない（既に更新済み）
          }
        }
      } catch (error) {
        console.error('Error updating dateCheckedAt on close:', error);
      }
    }
    await this.processNextProject();
  }

  // モーダルを閉じる（通知からのモーダル表示用）
  async processNextProject() {
    // 処理中フラグを立てる
    this.isProcessingProject = true;
    
    try {
      // 現在のプロジェクトの状態更新が完了するまで少し待つ
      await new Promise(resolve => setTimeout(resolve, 200));

      // モーダルを閉じる（通知からのモーダル表示は1つずつなので、次のプロジェクトはない）
      this.currentConfirmationProject = null;
      this.showProjectCompletionConfirmation = false;
      this.showProjectEndDateConfirmation = false;
    } finally {
      // 処理中フラグを下ろす
      this.isProcessingProject = false;
    }
  }

  // FCMを初期化（通知許可をリクエストし、トークンを取得）
  private async initializeFcm(): Promise<void> {
    console.log('[FCM] initializeFcm() called');
    try {
      // 通知許可をリクエストし、トークンを取得
      const token = await this.fcmService.requestPermission();
      
      if (token) {
        // フォアグラウンドメッセージのリスナーを設定
        this.fcmService.setupForegroundMessageListener((payload) => {
          console.log('[FCM] Foreground message received:', payload);
          
          // 通知を表示
          const notificationTitle = payload.notification?.title || 'お知らせ';
          const notificationOptions: NotificationOptions = {
            body: payload.notification?.body || payload.data?.message || '',
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            data: payload.data || {}
          };
          
          // ブラウザの通知APIを使用して通知を表示
          if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification(notificationTitle, notificationOptions);
            
            // 通知クリック時の処理
            notification.onclick = (event) => {
              event.preventDefault();
              window.focus();
              
              // 通知のデータからURLを取得して遷移
              const url = payload.data?.url || '/home';
              if (url) {
                window.location.href = url;
              }
              
              notification.close();
            };
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
