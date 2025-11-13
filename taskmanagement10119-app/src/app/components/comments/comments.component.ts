import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { Timestamp, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase-config';
import { AuthService } from '../../services/auth.service';
import { TaskService } from '../../services/task.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { Task, Comment, TaskStatus, PriorityLabel } from '../../models/task.model';
import { Project } from '../../models/project.model';

interface TaskWithComments {
  taskId?: string; // タスクの場合
  projectId?: string; // プロジェクトの場合（またはタスクが属するプロジェクト）
  projectName?: string; // プロジェクト名
  isProject: boolean; // プロジェクトかタスクか
  itemTitle: string; // タスクタイトルまたはプロジェクト名
  taskStatus?: TaskStatus; // タスクの場合のみ
  taskPriority?: PriorityLabel; // タスクの場合のみ
  latestComment: Comment | null;
  latestCommentPreview: string;
  unreadCount: number;
  totalCommentCount: number;
  hasMentionForCurrentUser: boolean;
  latestCommentDate: Timestamp | null;
  allComments: Comment[]; // 全コメント（検索用）
  matchingCommentCount?: number; // 検索キーワードに該当するコメント数
}

interface CommentReadStatus {
  userId: string;
  taskId: string;
  readCommentIds: string[];
  lastReadAt: Timestamp;
}

@Component({
  selector: 'app-comments',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comments.component.html',
  styleUrl: './comments.component.css'
})
export class CommentsComponent implements OnInit {
  private authService = inject(AuthService);
  private taskService = inject(TaskService);
  private projectService = inject(ProjectService);
  private teamService = inject(TeamService);
  private router = inject(Router);
  private location = inject(Location);

  tasksWithComments: TaskWithComments[] = [];
  filteredTasksWithComments: TaskWithComments[] = [];
  
  // 検索・フィルタ用
  searchKeyword = '';
  projectNameInput = '';
  taskNameInput = '';
  filteredProjectSuggestions: Project[] = [];
  filteredTaskSuggestions: Task[] = [];
  showProjectSuggestions = false;
  showTaskSuggestions = false;
  selectedProjectId: string | null = null;
  selectedTaskId: string | null = null;
  selectedReadStatus: 'all' | 'read' | 'unread' = 'all';
  selectedTaskStatus: 'all' | 'not_started' | 'in_progress' | 'completed' = 'all';
  selectedPriority: 'all' | 'important' | 'normal' | 'low' | 'none' = 'all';
  hasMention = 'all'; // 'all' | 'mentioned' | 'no'
  
  // オプション用データ
  projects: Project[] = [];
  tasks: Task[] = [];
  
  isLoading = false;

  // チーム情報
  userTeamIds: string[] = [];
  
  // 個人/チーム切り替え状態（サイドバーから取得）
  taskViewMode: 'personal' | 'team' = 'personal';
  selectedTeamId: string | null = null;

  async ngOnInit() {
    await this.loadUserTeams();
    
    // localStorageから初期状態を取得
    this.loadViewModeStateFromStorage();
    
    // 現在のビューモードに対応するフィルターを復元
    this.loadFiltersFromStorage();
    
    // フィルターが保存されていない場合のみデフォルト値を設定
    if (!this.hasFiltersInStorage()) {
      this.initializeDefaultFilters();
    }
    
    // 個人/チーム切り替えの変更を監視
    window.addEventListener('viewModeChanged', (event: any) => {
      if (event.detail) {
        this.taskViewMode = event.detail.viewMode;
        this.selectedTeamId = event.detail.selectedTeamId;
        this.userTeamIds = event.detail.userTeamIds || this.userTeamIds;
      }
      // ビューモード変更時はフィルターを初期化
      this.initializeDefaultFilters();
      this.loadData();
    });
    
    this.loadData();
  }

  async loadUserTeams() {
    try {
      const user = this.authService.currentUser;
      if (user) {
        const userTeams = await this.teamService.getTeamsForUser(user.uid);
        this.userTeamIds = userTeams.map(team => team.id);
      }
    } catch (error) {
      console.error('Error loading teams:', error);
    }
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

  // フィルターのデフォルト値を設定
  initializeDefaultFilters() {
    this.searchKeyword = '';
    this.projectNameInput = '';
    this.taskNameInput = '';
    this.selectedProjectId = null;
    this.selectedTaskId = null;
    this.selectedReadStatus = 'all';
    this.selectedTaskStatus = 'all';
    this.selectedPriority = 'all';
    this.hasMention = 'all';
  }

  // 現在のビューモードに対応するキーを取得
  private getFiltersStorageKey(): string {
    return `commentsFilters_${this.taskViewMode}`;
  }

  // フィルター状態をlocalStorageに保存
  saveFiltersToStorage() {
    try {
      const filters = {
        searchKeyword: this.searchKeyword,
        projectNameInput: this.projectNameInput,
        taskNameInput: this.taskNameInput,
        selectedProjectId: this.selectedProjectId,
        selectedTaskId: this.selectedTaskId,
        selectedReadStatus: this.selectedReadStatus,
        selectedTaskStatus: this.selectedTaskStatus,
        selectedPriority: this.selectedPriority,
        hasMention: this.hasMention
      };
      localStorage.setItem(this.getFiltersStorageKey(), JSON.stringify(filters));
    } catch (error) {
      console.error('Error saving filters to storage:', error);
    }
  }

  // localStorageからフィルター状態を復元
  loadFiltersFromStorage() {
    try {
      const saved = localStorage.getItem(this.getFiltersStorageKey());
      if (saved) {
        const filters = JSON.parse(saved);
        this.searchKeyword = filters.searchKeyword || '';
        this.projectNameInput = filters.projectNameInput || '';
        this.taskNameInput = filters.taskNameInput || '';
        this.selectedProjectId = filters.selectedProjectId || null;
        this.selectedTaskId = filters.selectedTaskId || null;
        this.selectedReadStatus = filters.selectedReadStatus || 'all';
        this.selectedTaskStatus = filters.selectedTaskStatus || 'all';
        this.selectedPriority = filters.selectedPriority || 'all';
        this.hasMention = filters.hasMention || 'all';
      }
    } catch (error) {
      console.error('Error loading filters from storage:', error);
    }
  }

  // フィルターが保存されているかチェック
  hasFiltersInStorage(): boolean {
    return localStorage.getItem(this.getFiltersStorageKey()) !== null;
  }

  // 既読状態を取得
  async getCommentReadStatus(taskId: string, userId: string): Promise<CommentReadStatus | null> {
    try {
      const readStatusRef = doc(db, 'commentReadStatus', `${userId}_${taskId}`);
      const readStatusSnap = await getDoc(readStatusRef);
      if (readStatusSnap.exists()) {
        return readStatusSnap.data() as CommentReadStatus;
      }
      return null;
    } catch (error) {
      console.error('Error getting comment read status:', error);
      return null;
    }
  }

  // 未読件数を計算（タスク用）
  async calculateUnreadCount(task: Task, userId: string): Promise<number> {
    if (!task.comments || task.comments.length === 0) {
      return 0;
    }

    const readStatus = await this.getCommentReadStatus(task.id, userId);
    if (!readStatus) {
      // 既読状態が存在しない場合、全コメントを未読とする
      return task.comments.length;
    }

    // 既読コメントIDのセットを作成
    const readCommentIds = new Set(readStatus.readCommentIds || []);
    
    // 未読コメント数を計算
    const unreadCount = task.comments.filter(comment => !readCommentIds.has(comment.id)).length;
    return unreadCount;
  }

  // 未読件数を計算（プロジェクト用）
  async calculateUnreadCountForProject(project: Project, userId: string): Promise<number> {
    if (!project.comments || project.comments.length === 0) {
      return 0;
    }

    const readStatus = await this.getCommentReadStatus(`project_${project.id}`, userId);
    if (!readStatus) {
      // 既読状態が存在しない場合、全コメントを未読とする
      return project.comments.length;
    }

    // 既読コメントIDのセットを作成
    const readCommentIds = new Set(readStatus.readCommentIds || []);
    
    // 未読コメント数を計算
    const unreadCount = project.comments.filter(comment => !readCommentIds.has(comment.id)).length;
    return unreadCount;
  }

  // @メンションのチェック（タスク用）
  checkMentionsForCurrentUser(task: Task, userId: string): boolean {
    if (!task.comments || task.comments.length === 0) {
      return false;
    }

    // タスク内の全コメントをチェック
    for (const comment of task.comments) {
      if (comment.mentionedUserIds && comment.mentionedUserIds.includes(userId)) {
        return true;
      }
    }
    return false;
  }

  // @メンションのチェック（プロジェクト用）
  checkMentionsForCurrentUserInProject(project: Project, userId: string): boolean {
    if (!project.comments || project.comments.length === 0) {
      return false;
    }

    // プロジェクト内の全コメントをチェック
    for (const comment of project.comments) {
      if (comment.mentionedUserIds && comment.mentionedUserIds.includes(userId)) {
        return true;
      }
    }
    return false;
  }

  // 最新コメントの抜粋を生成（50文字程度）
  generateCommentPreview(comment: Comment): string {
    const preview = comment.content.substring(0, 50);
    return comment.content.length > 50 ? preview + '...' : preview;
  }

  async loadData() {
    this.isLoading = true;
    try {
      const user = this.authService.currentUser;
      if (!user) {
        this.router.navigate(['/login']);
        return;
      }

      // 個人/チームモードに応じてタスクを取得（タスク一覧と同じロジック）
      let fetchedTasks: Task[] = [];
      if (this.taskViewMode === 'personal') {
        // 個人モード: 自分が作成したタスク または 所属チームのタスクで自分が担当者
        fetchedTasks = await this.taskService.getTasks({
          isDeleted: false,
          teamId: null,
          userId: user.uid,
          userTeamIds: this.userTeamIds
        });
      } else if (this.taskViewMode === 'team' && this.selectedTeamId) {
        // チームモード: 選択されたチームのタスクのみ
        fetchedTasks = await this.taskService.getTasks({
          isDeleted: false,
          teamId: this.selectedTeamId
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

      this.tasks = viewableTasks;

      // ユーザーが見れる全てのプロジェクトを取得（プロジェクト一覧と同じロジック）
      this.projects = await this.projectService.getProjectsForUser(
        user.uid,
        this.taskViewMode === 'team' ? this.selectedTeamId : null,
        this.userTeamIds
      );

      // コメントがあるタスクとプロジェクトを集約して表示
      this.tasksWithComments = [];
      
      // タスクのコメントを追加
      for (const task of this.tasks) {
        if (task.comments && task.comments.length > 0) {
          // コメントを日付順（新しい順）でソート
          const sortedComments = [...task.comments].sort((a, b) => 
            b.createdAt.toMillis() - a.createdAt.toMillis()
          );
          
          const latestComment = sortedComments[0];
          const unreadCount = await this.calculateUnreadCount(task, user.uid);
          const hasMention = this.checkMentionsForCurrentUser(task, user.uid);

          this.tasksWithComments.push({
            taskId: task.id,
            projectId: task.projectId,
            projectName: task.projectName,
            isProject: false,
            itemTitle: task.title,
            taskStatus: task.status,
            taskPriority: task.priority,
            latestComment: latestComment,
            latestCommentPreview: this.generateCommentPreview(latestComment),
            unreadCount: unreadCount,
            totalCommentCount: task.comments.length,
            hasMentionForCurrentUser: hasMention,
            latestCommentDate: latestComment.createdAt,
            allComments: task.comments
          });
        }
      }

      // プロジェクトのコメントを追加
      for (const project of this.projects) {
        if (project.comments && project.comments.length > 0) {
          // コメントを日付順（新しい順）でソート
          const sortedComments = [...project.comments].sort((a, b) => 
            b.createdAt.toMillis() - a.createdAt.toMillis()
          );
          
          const latestComment = sortedComments[0];
          const unreadCount = await this.calculateUnreadCountForProject(project, user.uid);
          const hasMention = this.checkMentionsForCurrentUserInProject(project, user.uid);

          this.tasksWithComments.push({
            projectId: project.id,
            isProject: true,
            itemTitle: project.name,
            latestComment: latestComment,
            latestCommentPreview: this.generateCommentPreview(latestComment),
            unreadCount: unreadCount,
            totalCommentCount: project.comments.length,
            hasMentionForCurrentUser: hasMention,
            latestCommentDate: latestComment.createdAt,
            allComments: project.comments
          });
        } else {
          // デバッグ用: コメントがないプロジェクトをログ出力
          console.log(`[Comments] Project "${project.name}" has no comments or comments is undefined`, {
            projectId: project.id,
            hasComments: !!project.comments,
            commentsLength: project.comments?.length || 0
          });
        }
      }
      
      // デバッグ用: プロジェクトのコメントが追加されたか確認
      console.log(`[Comments] Total projects with comments: ${this.tasksWithComments.filter(item => item.isProject).length}`);

      // 最新コメント日時順（新しい順）でソート
      this.tasksWithComments.sort((a, b) => {
        if (!a.latestCommentDate || !b.latestCommentDate) return 0;
        return b.latestCommentDate.toMillis() - a.latestCommentDate.toMillis();
      });

      this.applyFilters();
    } catch (error: any) {
      console.error('Error loading comments:', error);
      alert('コメントの読み込みに失敗しました: ' + error.message);
    } finally {
      this.isLoading = false;
    }
  }

  applyFilters() {
    let filtered = [...this.tasksWithComments];

    // コメント検索（タスク内の全コメントを検索）
    if (this.searchKeyword.trim()) {
      const keyword = this.searchKeyword.toLowerCase();
      filtered = filtered.map(taskItem => {
        const matchingComments = taskItem.allComments.filter(comment => 
          comment.content.toLowerCase().includes(keyword) ||
          comment.userName.toLowerCase().includes(keyword)
        );
        
        if (matchingComments.length > 0) {
          return {
            ...taskItem,
            matchingCommentCount: matchingComments.length
          };
        }
        return null;
      }).filter(item => item !== null) as TaskWithComments[];
    }

    // プロジェクトフィルター
    if (this.selectedProjectId !== null) {
      filtered = filtered.filter(taskItem => {
        // プロジェクト自体の場合、またはタスクが選択されたプロジェクトに属する場合
        return taskItem.projectId === this.selectedProjectId;
      });
    }

    // タスク名/プロジェクト名検索
    if (this.taskNameInput.trim()) {
      const keyword = this.taskNameInput.toLowerCase();
      filtered = filtered.filter(taskItem => 
        taskItem.itemTitle.toLowerCase().includes(keyword)
      );
    }

    // タスクIDフィルター（選択されたタスクのみ）
    if (this.selectedTaskId !== null) {
      filtered = filtered.filter(taskItem => taskItem.taskId === this.selectedTaskId);
    }

    // 未読/既読フィルター
    if (this.selectedReadStatus === 'unread') {
      // 1件でも未読があれば表示
      filtered = filtered.filter(taskItem => taskItem.unreadCount > 0);
    } else if (this.selectedReadStatus === 'read') {
      // 未読が0件（全て既読）のタスクのみ表示
      filtered = filtered.filter(taskItem => taskItem.unreadCount === 0);
    }

    // タスクステータスフィルター（タスクのみ）
    if (this.selectedTaskStatus !== 'all') {
      filtered = filtered.filter(taskItem => !taskItem.isProject && taskItem.taskStatus === this.selectedTaskStatus);
    }

    // 優先度フィルター（タスクのみ）
    if (this.selectedPriority !== 'all') {
      filtered = filtered.filter(taskItem => !taskItem.isProject && taskItem.taskPriority === this.selectedPriority);
    }

    // @メンションフィルター（タスク単位）
    if (this.hasMention === 'mentioned') {
      // 自分がメンションされたタスクのみ表示
      filtered = filtered.filter(taskItem => taskItem.hasMentionForCurrentUser);
    } else if (this.hasMention === 'no') {
      // メンションがないタスクのみ表示
      filtered = filtered.filter(taskItem => !taskItem.hasMentionForCurrentUser);
    }

    this.filteredTasksWithComments = filtered;
  }

  onSearchChange() {
    this.saveFiltersToStorage();
    this.applyFilters();
  }

  onFilterChange() {
    this.saveFiltersToStorage();
    this.applyFilters();
  }

  viewTask(taskId: string) {
    this.router.navigate(['/task', taskId], { queryParams: { from: 'comments' } });
  }

  viewProject(projectId: string) {
    this.router.navigate(['/project', projectId], { queryParams: { from: 'comments' } });
  }

  viewItem(item: TaskWithComments) {
    if (item.isProject && item.projectId) {
      this.viewProject(item.projectId);
    } else if (item.taskId) {
      this.viewTask(item.taskId);
    }
  }

  formatDateTime(timestamp: Timestamp): string {
    const date = timestamp.toDate();
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return '昨日 ' + date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
      return `${diffDays}日前 ` + date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString('ja-JP', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }

  getStatusLabel(status: TaskStatus | undefined): string {
    if (!status) return '';
    const statusMap: { [key: string]: string } = {
      'not_started': '未着手',
      'in_progress': '進行中',
      'completed': '完了',
      'overdue': '期限切れ'
    };
    return statusMap[status] || status;
  }

  getPriorityLabel(priority: PriorityLabel | undefined): string {
    if (!priority) return '';
    const priorityMap: { [key: string]: string } = {
      'important': '重要',
      'normal': '普通',
      'low': '低め',
      'none': 'なし',
      'custom': 'カスタム'
    };
    return priorityMap[priority] || priority;
  }

  getFilteredTasks(): Task[] {
    if (this.selectedProjectId === null) {
      return this.tasks;
    }
    return this.tasks.filter(task => task.projectId === this.selectedProjectId);
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/home']);
    }
  }

  onProjectNameInput() {
    if (this.projectNameInput.trim() === '') {
      this.filteredProjectSuggestions = [];
      this.selectedProjectId = null;
      this.showProjectSuggestions = false;
    } else {
      const keyword = this.projectNameInput.toLowerCase();
      this.filteredProjectSuggestions = this.projects.filter(project =>
        project.name.toLowerCase().includes(keyword)
      );
      this.showProjectSuggestions = this.filteredProjectSuggestions.length > 0;
    }
    this.saveFiltersToStorage();
    this.applyFilters();
  }

  selectProject(project: Project) {
    this.projectNameInput = project.name;
    this.selectedProjectId = project.id;
    this.showProjectSuggestions = false;
    this.saveFiltersToStorage();
    this.applyFilters();
  }

  clearProjectFilter() {
    this.projectNameInput = '';
    this.selectedProjectId = null;
    this.filteredProjectSuggestions = [];
    this.showProjectSuggestions = false;
    this.saveFiltersToStorage();
    this.applyFilters();
  }

  onTaskNameInput() {
    if (this.taskNameInput.trim() === '') {
      this.filteredTaskSuggestions = [];
      this.selectedTaskId = null;
      this.showTaskSuggestions = false;
    } else {
      const keyword = this.taskNameInput.toLowerCase();
      const tasksToFilter = this.selectedProjectId 
        ? this.tasks.filter(t => t.projectId === this.selectedProjectId)
        : this.tasks;
      this.filteredTaskSuggestions = tasksToFilter.filter(task =>
        task.title.toLowerCase().includes(keyword)
      );
      this.showTaskSuggestions = this.filteredTaskSuggestions.length > 0;
    }
    this.saveFiltersToStorage();
    this.applyFilters();
  }

  selectTask(task: Task) {
    this.taskNameInput = task.title;
    this.selectedTaskId = task.id;
    this.showTaskSuggestions = false;
    this.saveFiltersToStorage();
    this.applyFilters();
  }

  clearTaskFilter() {
    this.taskNameInput = '';
    this.selectedTaskId = null;
    this.filteredTaskSuggestions = [];
    this.showTaskSuggestions = false;
    this.saveFiltersToStorage();
    this.applyFilters();
  }

  hideProjectSuggestions() {
    setTimeout(() => {
      this.showProjectSuggestions = false;
    }, 200);
  }

  hideTaskSuggestions() {
    setTimeout(() => {
      this.showTaskSuggestions = false;
    }, 200);
  }

  onProjectNameChange(value: string) {
    this.projectNameInput = value;
    this.onProjectNameInput();
  }

  onTaskNameChange(value: string) {
    this.taskNameInput = value;
    this.onTaskNameInput();
  }

  // 検索キーワードをハイライト（HTML用）
  highlightKeyword(text: string, keyword: string): string {
    if (!keyword.trim()) return text;
    const regex = new RegExp(`(${keyword})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }
}
