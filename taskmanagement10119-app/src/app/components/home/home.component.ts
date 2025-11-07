import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Timestamp } from 'firebase/firestore';
import { AuthService } from '../../services/auth.service';
import { TaskService } from '../../services/task.service';
import { TaskCategoryService } from '../../services/task-category.service';
import { NotificationService } from '../../services/notification.service';
import { TeamService } from '../../services/team.service';
import { TaskCategory } from '../../services/task-category.service';
import { Task } from '../../models/task.model';
import { Team } from '../../models/team.model';
import { NextTaskCandidatesComponent } from '../next-task-candidates/next-task-candidates.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, NextTaskCandidatesComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private taskService = inject(TaskService);
  private taskCategoryService = inject(TaskCategoryService);
  private notificationService = inject(NotificationService);
  private teamService = inject(TeamService);

  todayTasks: Task[] = [];
  weekTasks: Task[] = [];
  todayTaskCategories: TaskCategory[] = [];
  weekTaskCategories: TaskCategory[] = [];
  unreadCount = 0;
  isLoading = true;
  weekViewMode: 'calendar' | 'rolling' = 'calendar';
  
  // カテゴリーの展開状態を管理
  expandedCategories: { [key: string]: boolean } = {};
  
  // 次やるタスクモーダル
  showNextTaskCandidates = false;
  showNextTasks: boolean = true; // デフォルト値

  // 個人/チーム切り替え状態（カスタムイベントから取得）
  viewMode: 'personal' | 'team' = 'personal';
  selectedTeamId: string | null = null;
  userTeams: Team[] = [];
  userTeamIds: string[] = [];

  async ngOnInit() {
    console.log('HomeComponent initialized');
    console.log('Current user:', this.authService.currentUser);

    // ユーザーの設定を取得
    const user = this.authService.currentUser;
    if (user) {
      const userData = await this.authService.getUserData(user.uid);
      if (userData) {
        this.showNextTasks = userData.showNextTasks !== false; // 未設定の場合はtrue
      }
    }

    // ユーザーのチーム一覧を取得
    await this.loadUserTeams();

    // localStorageから初期状態を取得
    this.loadViewModeStateFromStorage();

    // 認証状態の変化を監視
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.loadTasks();
      } else {
        console.log('Waiting for authentication...');
      }
    });

    // 個人/チーム切り替えの変更を監視
    window.addEventListener('viewModeChanged', (event: any) => {
      if (event.detail) {
        this.viewMode = event.detail.viewMode;
        this.selectedTeamId = event.detail.selectedTeamId;
        this.userTeamIds = event.detail.userTeamIds || this.userTeamIds;
      }
      this.loadTasks();
    });
  }

  loadViewModeStateFromStorage() {
    // localStorageから状態を取得
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
      console.error('Error loading view mode state from storage:', error);
    }
  }

  async loadUserTeams() {
    try {
      const user = this.authService.currentUser;
      if (user) {
        this.userTeams = await this.teamService.getTeamsForUser(user.uid);
        this.userTeamIds = this.userTeams.map(team => team.id);
      }
    } catch (error) {
      console.error('Error loading teams:', error);
    }
  }


  async loadTasks() {
    console.log('loadTasks called');
    try {
      const user = this.authService.currentUser;
      console.log('User from auth service:', user);
      
      if (!user) {
        console.log('No user logged in');
        this.isLoading = false;
        // 認証状態の監視は app.component.ts で行うため、ここではリダイレクトしない
        return;
      }

      console.log('Loading tasks for user:', user.uid);
      
      // 個人/チームモードに応じてタスクを取得
      if (this.viewMode === 'personal') {
        // 個人モード: 自分が作成したタスク または 所属チームのタスクで自分が担当者
        this.todayTasks = await this.taskService.getTodayTasks(user.uid, null, this.userTeamIds);
        this.weekTasks = await this.taskService.getWeekTasks(user.uid, null, this.userTeamIds);
      } else if (this.viewMode === 'team' && this.selectedTeamId) {
        // チームタスク（teamIdが一致）
        this.todayTasks = await this.taskService.getTodayTasks(user.uid, this.selectedTeamId);
        this.weekTasks = await this.taskService.getWeekTasks(user.uid, this.selectedTeamId);
      } else {
        // フォールバック
        this.todayTasks = [];
        this.weekTasks = [];
      }
      
      // チーム名を設定（タスクにteamIdがあるがteamNameがない場合）
      await this.enrichTasksWithTeamNames(this.todayTasks);
      await this.enrichTasksWithTeamNames(this.weekTasks);
      
      // 今日のタスクをカテゴリに分類
      this.todayTaskCategories = this.taskCategoryService.categorizeTasks(this.todayTasks);
      
      // 今週のタスクをカテゴリに分類
      this.weekTaskCategories = this.taskCategoryService.categorizeWeekTasks(this.weekTasks, this.weekViewMode);
      
        // 未読通知数を取得
        this.unreadCount = await this.notificationService.getUnreadCount(
          user.uid,
          this.userTeamIds
        );
      
      // 繰り返しタスクのローリング生成をチェック
      await this.checkRecurringTasks(user.uid);
      
      // 全タスクも表示（デバッグ用）
      const allTasks = await this.taskService.getTasks({ 
        assigneeId: user.uid, 
        isDeleted: false 
      });
      console.log('All tasks (not deleted):', allTasks.length);
      console.log('All tasks details:', allTasks.map(t => ({ 
        title: t.title, 
        endDate: t.endDate.toDate().toLocaleDateString('ja-JP'),
        isDeleted: t.isDeleted 
      })));
      
      console.log('Today tasks:', this.todayTasks.length);
      console.log('Week tasks:', this.weekTasks.length);
      console.log('Today tasks details:', this.todayTasks);
      
      this.isLoading = false;
    } catch (error: any) {
      console.error('Error loading tasks:', error);
      console.error('Error details:', error.message);
      this.isLoading = false;
    }
  }


  async deleteTask(taskId: string) {
    if (!confirm('このタスクを削除しますか？')) {
      return;
    }

    try {
      await this.taskService.deleteTask(taskId);
      console.log('Task deleted, reloading...');
      alert('タスクを削除しました');
      await this.loadTasks();
      console.log('Tasks reloaded');
    } catch (error: any) {
      console.error('Error deleting task:', error);
      console.error('Error stack:', error.stack);
      alert('タスクの削除に失敗しました: ' + (error.message || '不明なエラー'));
    }
  }

  viewTaskDetail(taskId: string) {
    this.router.navigate(['/task', taskId]);
  }

  formatDate(timestamp: any): string {
    const date = timestamp.toDate();
    return date.toLocaleDateString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  getStatusLabel(status: string): string {
    const statusMap: { [key: string]: string } = {
      'not_started': '未着手',
      'in_progress': '進行中',
      'completed': '完了'
    };
    return statusMap[status] || status;
  }

  viewProjects() {
    this.router.navigate(['/projects']);
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

  async logout() {
    await this.authService.signOut();
  }

  openNextTaskCandidates() {
    this.showNextTaskCandidates = true;
  }

  closeNextTaskCandidates() {
    this.showNextTaskCandidates = false;
  }

  async enrichTasksWithTeamNames(tasks: Task[]) {
    for (const task of tasks) {
      if (task.teamId && !task.teamName) {
        const team = this.userTeams.find(t => t.id === task.teamId);
        if (team) {
          task.teamName = team.name;
        }
      }
    }
  }

  openCreateTaskModal() {
    // タスク作成ページに遷移（個人/チームモードを渡す）
    const queryParams: any = {};
    if (this.viewMode === 'team' && this.selectedTeamId) {
      queryParams['teamId'] = this.selectedTeamId;
      queryParams['viewMode'] = 'team';
    } else {
      queryParams['viewMode'] = 'personal';
    }
    this.router.navigate(['/task/create'], { queryParams });
  }

  async createTaskToday(title: string) {
    try {
      const user = this.authService.currentUser;
      if (!user) {
        alert('ユーザーがログインしていません');
        return;
      }

      console.log('Creating task with user:', user.uid);
      
      // 今日を期限とする
      const today = new Date();
      today.setHours(23, 59, 59, 999); // 今日の終わり
      
      const tomorrow = new Date(today);
      tomorrow.setHours(0, 0, 0, 0);

      const taskId = await this.taskService.createTask({
        title: title,
        description: 'タスクの説明を追加',
        assigneeId: user.uid,
        assigneeName: user.displayName || user.email || 'Unknown',
        status: 'not_started' as any,
        startDate: Timestamp.fromDate(today),
        endDate: Timestamp.fromDate(today),
        priority: 'normal' as any,
        taskType: 'normal' as any
      });

      console.log('Task created with ID:', taskId);
      alert('今日が期限のタスクを作成しました！');
      await this.loadTasks();
    } catch (error: any) {
      console.error('Error creating task:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      alert('タスクの作成に失敗しました: ' + (error.message || '不明なエラー'));
    }
  }

  async createTaskWeek(title: string) {
    await this.createTask(title);
  }

  toggleCategory(key: string) {
    // undefinedの場合はtrue（展開）として扱う
    const currentState = this.expandedCategories[key] ?? false;
    this.expandedCategories[key] = !currentState;
  }

  isCategoryExpanded(key: string): boolean {
    return this.expandedCategories[key] ?? false; // デフォルトで展開（undefinedの場合はtrue）
  }

  async createTask(title: string) {
    try {
      const user = this.authService.currentUser;
      if (!user) {
        alert('ユーザーがログインしていません');
        return;
      }

      console.log('Creating task with user:', user.uid);
      
      // 今日を開始日、1週間後を終了日として設定
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 7);

      console.log('Start date:', startDate, 'End date:', endDate);

      const taskId = await this.taskService.createTask({
        title: title,
        description: 'タスクの説明を追加',
        assigneeId: user.uid,
        assigneeName: user.displayName || user.email || 'Unknown',
        status: 'not_started' as any,
        startDate: Timestamp.fromDate(startDate),
        endDate: Timestamp.fromDate(endDate),
        priority: 'normal' as any,
        taskType: 'normal' as any
      });

      console.log('Task created with ID:', taskId);
      alert('タスクを作成しました！');
      await this.loadTasks();
    } catch (error: any) {
      console.error('Error creating task:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      alert('タスクの作成に失敗しました: ' + (error.message || '不明なエラー'));
    }
  }

  // 今週のタスク表示モードを切り替え
  toggleWeekViewMode() {
    this.weekViewMode = this.weekViewMode === 'calendar' ? 'rolling' : 'calendar';
    this.loadTasks();
  }

  // 今週のタスク表示モードのラベルを取得
  getWeekViewLabel(): string {
    return this.weekViewMode==='calendar'?'月曜日～日曜日':'今日から7日間';
  }

  // 繰り返しタスクのローリング生成をチェック
  async checkRecurringTasks(userId: string): Promise<void> {
    try {
      // 繰り返しタスクの親タスクを取得
      const allTasks = await this.taskService.getTasks({
        assigneeId: userId,
        isDeleted: false
      });

      // 親タスク（isRecurrenceParentがtrue）を抽出
      const parentTasks = allTasks.filter(task => task.isRecurrenceParent);

      // 各親タスクについてローリング生成をチェック
      for (const parentTask of parentTasks) {
        try {
          await this.taskService.checkAndGenerateNextRecurrenceTask(parentTask.id);
        } catch (error: any) {
          console.error(`Error checking recurrence for task ${parentTask.id}:`, error);
          // エラーが発生しても他のタスクのチェックは続行
        }
      }
    } catch (error: any) {
      console.error('Error checking recurring tasks:', error);
      // エラーが発生しても処理は続行
    }
  }
}

