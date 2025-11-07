import { Component, OnInit, inject } from '@angular/core';
import{CommonModule} from '@angular/common';
import{FormsModule} from '@angular/forms';
import{Router} from '@angular/router';
import{TaskService} from '../../services/task.service';
import{TeamService} from '../../services/team.service';
import{AuthService} from '../../services/auth.service';
import{Task} from '../../models/task.model';
import{Team} from '../../models/team.model';

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './task-list.component.html',
  styleUrl: './task-list.component.css'
})
export class TaskListComponent implements OnInit {
  taskService = inject(TaskService);
  teamService = inject(TeamService);
  authService = inject(AuthService);
  router = inject(Router);

  tasks: Task[] = [];
  filteredTasks: Task[] = [];
  isLoading = true;
  
  // 個人/チーム切り替え
  taskViewMode: 'personal' | 'team' = 'personal';
  selectedTeamId: string | null = null;
  userTeams: Team[] = [];
  userTeamIds: string[] = [];
  
  // 表示モード設定
  viewMode: 'card' | 'table' = 'table'; // デフォルトはテーブル表示
  
  // フィルター設定
  statusFilter: 'all' | 'not_started' | 'in_progress' | 'completed' | 'overdue' = 'all';
  priorityFilter: 'all' | 'important' | 'normal' | 'low' | 'none' | 'custom' = 'all';
  taskTypeFilter: 'all' | 'normal' | 'meeting' | 'regular' | 'project' | 'other' = 'all';
  
  // 選択されたタスク（一括削除用）
  selectedTasks: Set<string> = new Set();
  
  // ソート設定
  sortBy: 'endDate' | 'createdAt' | 'priority' | 'title' | 'completedAt' = 'endDate';
  sortOrder: 'asc' | 'desc' = 'asc';
  
  // ステータス別グループ
  taskGroups: { [key: string]: Task[] } = {
    'not_started': [],
    'in_progress': [],
    'completed': [],
    'overdue': []
  };

  async ngOnInit() {
    await this.loadUserTeams();
    
    // localStorageから初期状態を取得
    this.loadViewModeStateFromStorage();

    // タスク一覧の表示モードをlocalStorageから取得
    this.loadTaskListViewModeFromStorage();
    
    // 個人/チーム切り替えの変更を監視
    window.addEventListener('viewModeChanged', (event: any) => {
      if (event.detail) {
        this.taskViewMode = event.detail.viewMode;
        this.selectedTeamId = event.detail.selectedTeamId;
        this.userTeamIds = event.detail.userTeamIds || this.userTeamIds;
      }
      this.loadTasks();
    });
    
    await this.loadTasks();
  }

  loadViewModeStateFromStorage() {
    // localStorageから状態を取得
    try {
      const savedViewMode = localStorage.getItem('viewMode');
      if (savedViewMode === 'personal' || savedViewMode === 'team') {
        this.taskViewMode = savedViewMode;
      }
      const savedTeamId = localStorage.getItem('selectedTeamId');
      if (savedTeamId) {
        this.selectedTeamId = savedTeamId;
      }
    } catch (error) {
      console.error('Error loading view mode state from storage:', error);
    }
  }

  loadTaskListViewModeFromStorage() {
    // localStorageからタスク一覧の表示モードを取得
    try {
      const savedViewMode = localStorage.getItem('taskListViewMode');
      if (savedViewMode === 'card' || savedViewMode === 'table') {
        this.viewMode = savedViewMode;
      }
      // 保存されていない場合はデフォルトを使う
    } catch (error) {
      console.error('Error loading task list view mode from storage:', error);
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

  async loadTasks(){
    try{
      const user = this.authService.currentUser;
      if (!user) {
        this.isLoading = false;
        return;
      }

      // 個人/チームモードに応じてタスクを取得
      if (this.taskViewMode === 'personal') {
        // 個人モード: 自分が作成したタスク または 所属チームのタスクで自分が担当者
        this.tasks = await this.taskService.getTasks({
          isDeleted: false,
          teamId: null,
          userId: user.uid,
          userTeamIds: this.userTeamIds
        });
      } else if (this.taskViewMode === 'team' && this.selectedTeamId) {
        // チームタスク（teamIdが一致）
        this.tasks = await this.taskService.getTasks({
          isDeleted: false,
          teamId: this.selectedTeamId
        });
      } else {
        this.tasks = [];
      }

      // チーム名を設定
      await this.enrichTasksWithTeamNames(this.tasks);

      this.applyFiltersAndSort(); // フィルターとソートを適用
      this.groupTasksByStatus(); // グループ化
    }catch(error){
      console.error('タスクの読み込みに失敗しました:', error);
    }finally{
      this.isLoading = false;
    }
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

  
  // フィルターとソートを適用
  applyFiltersAndSort() {
    let filtered = [...this.tasks];

    // 完了済みタスクを除外
    filtered = filtered.filter(task => task.status !== 'completed');

    // ステータスフィルター
    if (this.statusFilter !== 'all') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (this.statusFilter === 'overdue') {
        filtered = filtered.filter(task => {
          const endDate = task.endDate.toDate();
          const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
          return endDateOnly < today && task.status !== 'completed';
        });
      } else {
        filtered = filtered.filter(task => task.status === this.statusFilter);
      }
    }

    // 優先度フィルター
    if (this.priorityFilter !== 'all') {
      filtered = filtered.filter(task => task.priority === this.priorityFilter);
    }

    // タスクタイプフィルター
    if (this.taskTypeFilter !== 'all') {
      filtered = filtered.filter(task => task.taskType === this.taskTypeFilter);
    }

    // ソート
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (this.sortBy) {
        case 'endDate':
          comparison = a.endDate.toMillis() - b.endDate.toMillis();
          break;
        case 'createdAt':
          comparison = a.createdAt.toMillis() - b.createdAt.toMillis();
          break;
        case 'priority':
          const priorityOrder = ['important', 'normal', 'low', 'none', 'custom'];
          const aPriority = priorityOrder.indexOf(a.priority) !== -1 ? priorityOrder.indexOf(a.priority) : 999;
          const bPriority = priorityOrder.indexOf(b.priority) !== -1 ? priorityOrder.indexOf(b.priority) : 999;
          comparison = aPriority - bPriority;
          break;
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'completedAt':
          // 完了日時でソート（完了日時がない場合は最後に）
          const aCompletedAt = a.completedAt?.toMillis() || 0;
          const bCompletedAt = b.completedAt?.toMillis() || 0;
          if (aCompletedAt === 0 && bCompletedAt === 0) return 0;
          if (aCompletedAt === 0) return 1; // aが完了日時なしなら後ろに
          if (bCompletedAt === 0) return -1; // bが完了日時なしなら後ろに
          comparison = aCompletedAt - bCompletedAt;
          break;
      }

      return this.sortOrder === 'asc' ? comparison : -comparison;
    });

    this.filteredTasks = filtered;
  }

  // ステータス別にグループ化
  groupTasksByStatus() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 初期化（完了済みを除外）
    this.taskGroups = {
      'not_started': [],
      'in_progress': [],
      'completed': [],
      'overdue': []
    };

    // フィルター済みタスクをグループ化（完了済みは除外）
    this.filteredTasks
      .filter(task => task.status !== 'completed')
      .forEach(task => {
      const endDate = task.endDate.toDate();
      const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      
      // 期限切れ判定
      if (endDateOnly < today && task.status !== 'completed') {
        this.taskGroups['overdue'].push(task);
      } else {
        // ステータス別に分類
        if (task.status in this.taskGroups) {
          this.taskGroups[task.status].push(task);
        }
      }
    });
  }
  
  // グループのタイトル取得
  getGroupTitle(status: string): string {
    const titles: { [key: string]: string } = {
      'not_started': '未着手',
      'in_progress': '進行中',
      'completed': '完了済み',
      'overdue': '期限切れ'
    };
    return titles[status] || status;
  }
  
  // グループの色取得
  getGroupColor(status: string): string {
    const colors: { [key: string]: string } = {
      'not_started': '#2196F3',
      'in_progress': '#FF9800',
      'completed': '#4CAF50',
      'overdue': '#F44336'
    };
    return colors[status] || '#666';
  }

  // 開始日を過ぎている未着手タスクかどうか判定
  isOverdueStartDate(task: Task): boolean {
    if (task.status !== 'not_started') return false;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const startDate = task.startDate.toDate();
    const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    
    return startDateOnly < today;
  }

  viewTaskDetail(taskId:string){
    this.router.navigate(['/task',taskId], { queryParams: { from: 'task-list' } });
  }

  async deleteTask(taskId:string){
    if(confirm('このタスクを削除しますか？')){
      try{
        await this.taskService.deleteTask(taskId);
        await this.loadTasks();
      }catch(error){
        console.error('タスクの削除に失敗しました:',error);
      }
    }
  }

  getStatusLabel(status:string):string{
    const statusMap:Record<string,string>={
      'not_started':'未着手',
      'in_progress':'進行中',
      'completed':'完了'
    };
    return statusMap[status] || status;
  }

  formatDate(timestamp:any):string{
    if(!timestamp) return '';
    const date=timestamp.toDate() ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('ja-JP',{
      year:'numeric',
      month:'long',
      day:'numeric'
    });
  }

  goBack(){
    this.router.navigate(['/home']);
  }

  openCreateTaskModal() {
    // タスク作成ページに遷移
    this.router.navigate(['/task/create'],{ queryParams: { from: 'task-list' } });
  }

  // フィルター変更
  onStatusFilterChange(status: 'all' | 'not_started' | 'in_progress' | 'completed' | 'overdue') {
    this.statusFilter = status;
    this.selectedTasks.clear(); // フィルター変更時に選択をクリア
    this.applyFiltersAndSort();
    this.groupTasksByStatus();
  }

  onPriorityFilterChange(priority: 'all' | 'important' | 'normal' | 'low' | 'none' | 'custom') {
    this.priorityFilter = priority;
    this.selectedTasks.clear(); // フィルター変更時に選択をクリア
    this.applyFiltersAndSort();
    this.groupTasksByStatus();
  }

  // ソート変更
  onSortChange(newSortBy: 'endDate' | 'createdAt' | 'priority' | 'title' | 'completedAt') {
    // 変更前の値を保持
    const oldSortBy = this.sortBy;
    
    // 新しい値を設定
    this.sortBy = newSortBy;
    
    // 同じ項目なら順序を切り替え、異なる項目なら昇順にリセット
    if (oldSortBy === newSortBy) {
      this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortOrder = 'asc';
    }
    
    this.applyFiltersAndSort();
    this.groupTasksByStatus();
  }

  // 昇順/降順を切り替えるメソッド
  toggleSortOrder() {
    this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    this.applyFiltersAndSort();
    this.groupTasksByStatus();
  }

  getPriorityLabel(priority: string): string {
    const priorityMap: { [key: string]: string } = {
      'important': '重要',
      'normal': '普通',
      'low': '低め',
      'none': 'なし',
      'custom': 'カスタム'
    };
    return priorityMap[priority] || priority;
  }

  switchViewMode(mode: 'card' | 'table') {
    this.viewMode = mode;
    // localStorageに保存
    try{
      localStorage.setItem('taskListViewMode', mode);
    }catch(error){
      console.error('Error saving task list view mode to storage:', error);
    }
  }

  formatWorkTime(seconds: number): string {
    if (!seconds || seconds === 0) return '0分';
    const minutes = Math.ceil(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}時間${mins}分`;
    }
    return `${mins}分`;
  }

  getAssigneeName(task: Task): string {
    return task.assigneeName || '未設定';
  }

  // タスクタイプフィルター変更
  onTaskTypeFilterChange(taskType: 'all' | 'normal' | 'meeting' | 'regular' | 'project' | 'other') {
    this.taskTypeFilter = taskType;
    this.applyFiltersAndSort();
    this.groupTasksByStatus();
    // フィルター変更時に選択をクリア
    this.selectedTasks.clear();
  }

  // タスクタイプラベルの取得
  getTaskTypeLabel(taskType: string): string {
    const typeMap: { [key: string]: string } = {
      'normal': '通常',
      'meeting': '会議',
      'regular': '定期',
      'project': 'プロジェクト',
      'other': 'その他'
    };
    return typeMap[taskType] || taskType;
  }

  // タスク選択の切り替え
  toggleTaskSelection(taskId: string) {
    if (this.selectedTasks.has(taskId)) {
      this.selectedTasks.delete(taskId);
    } else {
      this.selectedTasks.add(taskId);
    }
  }

  // 全選択/全解除
  toggleAllTasks() {
    if (this.selectedTasks.size === this.filteredTasks.length && this.filteredTasks.length > 0) {
      this.selectedTasks.clear();
    } else {
      this.selectedTasks.clear();
      this.filteredTasks.forEach(task => this.selectedTasks.add(task.id));
    }
  }

  // 選択されたタスクを一括削除
  async deleteSelectedTasks() {
    if (this.selectedTasks.size === 0) {
      alert('削除するタスクが選択されていません');
      return;
    }
    
    if (!confirm(`選択した${this.selectedTasks.size}件のタスクを削除しますか？`)) {
      return;
    }
    
    try {
      const taskIds = Array.from(this.selectedTasks);
      for (const taskId of taskIds) {
        await this.taskService.deleteTask(taskId);
      }
      this.selectedTasks.clear();
      await this.loadTasks();
      alert('タスクを削除しました');
    } catch (error) {
      console.error('タスクの削除に失敗しました:', error);
      alert('タスクの削除に失敗しました');
    }
  }
}
