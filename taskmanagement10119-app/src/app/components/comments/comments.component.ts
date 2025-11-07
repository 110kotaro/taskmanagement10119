import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Timestamp } from 'firebase/firestore';
import { AuthService } from '../../services/auth.service';
import { TaskService } from '../../services/task.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { Task, Comment, TaskStatus, PriorityLabel } from '../../models/task.model';
import { Project } from '../../models/project.model';

interface CommentWithTaskInfo extends Comment {
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  taskPriority: PriorityLabel;
  projectId?: string;
  projectName?: string;
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

  allComments: CommentWithTaskInfo[] = [];
  filteredComments: CommentWithTaskInfo[] = [];
  
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
  selectedUserId = 'all';
  selectedDateRange: 'all' | 'today' | 'week' | 'month' | 'custom' = 'all';
  customStartDate = '';
  customEndDate = '';
  selectedReadStatus: 'all' | 'read' | 'unread' = 'all';
  selectedTaskStatus: 'all' | 'not_started' | 'in_progress' | 'completed' = 'all';
  selectedPriority: 'all' | 'important' | 'normal' | 'low' | 'none' = 'all';
  hasMention = 'all'; // 'all' | 'yes' | 'no'
  
  // オプション用データ
  projects: Project[] = [];
  tasks: Task[] = [];
  teamMembers: Array<{ id: string; name: string }> = [];
  
  isLoading = false;

  // チーム情報
  userTeamIds: string[] = [];

  async ngOnInit() {
    await this.loadUserTeams();
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

  async loadData() {
    this.isLoading = true;
    try {
      const user = this.authService.currentUser;
      if (!user) {
        this.router.navigate(['/login']);
        return;
      }

      // ユーザーが見れる全てのタスクを取得（個人モードのロジック）
      // 自分が作成したタスク または 所属チームのタスクで自分が担当者
      this.tasks = await this.taskService.getTasks({
        isDeleted: false,
        teamId: null,
        userId: user.uid,
        userTeamIds: this.userTeamIds
      });

      // ユーザーが見れる全てのプロジェクトを取得（個人モードのロジック）
      this.projects = await this.projectService.getProjectsForUser(
        user.uid,
        null, // teamIdはnull（個人モード）
        this.userTeamIds
      );

      // チームメンバー一覧を取得（タスクの担当者と作成者から集約）
      const memberMap = new Map<string, string>();
      this.tasks.forEach(task => {
        if (task.assigneeId && task.assigneeName) {
          memberMap.set(task.assigneeId, task.assigneeName);
        }
        if (task.creatorId && task.creatorName) {
          memberMap.set(task.creatorId, task.creatorName);
        }
      });
      this.teamMembers = Array.from(memberMap.entries()).map(([id, name]) => ({ id, name }));

      // 全タスクからコメントを集約
      this.allComments = [];
      for (const task of this.tasks) {
        if (task.comments && task.comments.length > 0) {
          for (const comment of task.comments) {
            this.allComments.push({
              ...comment,
              taskId: task.id,
              taskTitle: task.title,
              taskStatus: task.status,
              taskPriority: task.priority,
              projectId: task.projectId,
              projectName: task.projectName
            });
          }
        }
      }

      // 日付順（新しい順）でソート
      this.allComments.sort((a, b) => {
        return b.createdAt.toMillis() - a.createdAt.toMillis();
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
    let filtered = [...this.allComments];

    // 検索キーワード
    if (this.searchKeyword.trim()) {
      const keyword = this.searchKeyword.toLowerCase();
      filtered = filtered.filter(comment => 
        comment.content.toLowerCase().includes(keyword) ||
        comment.userName.toLowerCase().includes(keyword) ||
        comment.taskTitle.toLowerCase().includes(keyword) ||
        (comment.projectName && comment.projectName.toLowerCase().includes(keyword))
      );
    }

    // プロジェクト（IDで判定に変更）
    if (this.selectedProjectId !== null) {
      filtered = filtered.filter(comment => comment.projectId === this.selectedProjectId);
    }

    // タスク（IDで判定に変更）
    if (this.selectedTaskId !== null) {
      filtered = filtered.filter(comment => comment.taskId === this.selectedTaskId);
    }

    // 投稿者
    if (this.selectedUserId !== 'all') {
      filtered = filtered.filter(comment => comment.userId === this.selectedUserId);
    }

    // 投稿日
    if (this.selectedDateRange !== 'all') {
      const now = new Date();
      let startDate: Date;
      
      if (this.selectedDateRange === 'today') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (this.selectedDateRange === 'week') {
        const dayOfWeek = now.getDay();
        const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // 月曜日
        startDate = new Date(now.getFullYear(), now.getMonth(), diff);
      } else if (this.selectedDateRange === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      } else { // custom
        if (this.customStartDate && this.customEndDate) {
          startDate = new Date(this.customStartDate);
          const endDate = new Date(this.customEndDate);
          endDate.setHours(23, 59, 59, 999);
          filtered = filtered.filter(comment => {
            const commentDate = comment.createdAt.toDate();
            return commentDate >= startDate && commentDate <= endDate;
          });
          this.filteredComments = filtered;
          return;
        }
        this.filteredComments = filtered;
        return;
      }

      const endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
      
      filtered = filtered.filter(comment => {
        const commentDate = comment.createdAt.toDate();
        return commentDate >= startDate && commentDate <= endDate;
      });
    }

    // 未読/既読（現時点では全コメントを既読として扱う）
    // TODO: 未読/既読の管理機能を追加する場合はここを実装

    // タスクステータス
    if (this.selectedTaskStatus !== 'all') {
      filtered = filtered.filter(comment => comment.taskStatus === this.selectedTaskStatus);
    }

    // 優先度
    if (this.selectedPriority !== 'all') {
      filtered = filtered.filter(comment => comment.taskPriority === this.selectedPriority);
    }

    // @メンション
    if (this.hasMention !== 'all') {
      if (this.hasMention === 'yes') {
        filtered = filtered.filter(comment => comment.content.includes('@'));
      } else {
        filtered = filtered.filter(comment => !comment.content.includes('@'));
      }
    }

    this.filteredComments = filtered;
  }

  onSearchChange() {
    this.applyFilters();
  }

  onFilterChange() {
    this.applyFilters();
  }

  viewTask(taskId: string) {
    this.router.navigate(['/task', taskId], { queryParams: { from: 'comments' } });
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

  getStatusLabel(status: TaskStatus): string {
    const statusMap: { [key: string]: string } = {
      'not_started': '未着手',
      'in_progress': '進行中',
      'completed': '完了',
      'overdue': '期限切れ'
    };
    return statusMap[status] || status;
  }

  getPriorityLabel(priority: PriorityLabel): string {
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
    this.router.navigate(['/home']);
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
    this.applyFilters();
  }

  selectProject(project: Project) {
    this.projectNameInput = project.name;
    this.selectedProjectId = project.id;
    this.showProjectSuggestions = false;
    this.applyFilters();
  }

  clearProjectFilter() {
    this.projectNameInput = '';
    this.selectedProjectId = null;
    this.filteredProjectSuggestions = [];
    this.showProjectSuggestions = false;
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
    this.applyFilters();
  }

  selectTask(task: Task) {
    this.taskNameInput = task.title;
    this.selectedTaskId = task.id;
    this.showTaskSuggestions = false;
    this.applyFilters();
  }

  clearTaskFilter() {
    this.taskNameInput = '';
    this.selectedTaskId = null;
    this.filteredTaskSuggestions = [];
    this.showTaskSuggestions = false;
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
}

