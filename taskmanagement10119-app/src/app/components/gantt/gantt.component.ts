import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { TaskService } from '../../services/task.service';
import { ProjectService } from '../../services/project.service';
import { AuthService } from '../../services/auth.service';
import { TeamService } from '../../services/team.service';
import { Task } from '../../models/task.model';
import { Project } from '../../models/project.model';
import { Team } from '../../models/team.model';
import { Subscription } from 'rxjs';
import { Timestamp } from 'firebase/firestore';

interface GanttTask {
  task: Task;
  startDateIndex: number; // 開始日のインデックス
  durationDays: number;
  actualDurationDays?: number;
  isStartTruncated?: boolean;  // 左端が範囲外か
  isEndTruncated?: boolean;     // 右端が範囲外か
}

interface GanttProject {
  project: Project;
  startDateIndex: number; // 開始日のインデックス
  durationDays: number;
  actualDurationDays?: number;
  isStartTruncated?: boolean;  // 左端が範囲外か
  isEndTruncated?: boolean;     // 右端が範囲外か
}

@Component({
  selector: 'app-gantt',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './gantt.component.html',
  styleUrl: './gantt.component.css'
})
export class GanttComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private taskService = inject(TaskService);
  private projectService = inject(ProjectService);
  private authService = inject(AuthService);
  private teamService = inject(TeamService);

  ganttTasks: GanttTask[] = [];
  ganttProjects: GanttProject[] = [];
  allTasks: Task[] = [];
  allProjects: Project[] = [];
  dateRange: { start: Date; end: Date } | null = null;
  customDateRange: { start: Date; end: Date } | null = null;
  dateColumns: Date[] = [];
  viewMode: 'tasks' | 'projects' = 'tasks';
  isLoading = true;
  currentWeekStart: Date | null = null; // 現在表示中の週の開始日（月曜日）
  currentMonth: Date | null = null; // 現在表示中の月（1か月モード用）
  displayPeriod: 'week' | 'twoWeeks' | 'month' = 'twoWeeks'; //表示期間のモード
  private authSubscription?: Subscription;
  
  // 個人/チーム切り替え状態（サイドバーから取得）
  taskViewMode: 'personal' | 'team' = 'personal';
  selectedTeamId: string | null = null;
  userTeamIds: string[] = [];
  userTeams: Team[] = [];

  // フィルター設定（複数選択対応）
  statusFilters: Set<string> = new Set();
  priorityFilters: Set<string> = new Set();
  taskTypeFilters: Set<string> = new Set();
  overdueFilter: boolean = true; // 期限切れフィルター（独立）

  // プロジェクト用フィルター設定
  projectStatusFilters: Set<string> = new Set();

  // ソート設定
  sortBy: 'endDate' | 'priority' | 'title' | 'startDate' = 'endDate';
  sortOrder: 'asc' | 'desc' = 'asc';

  // プロジェクト用ソート設定
  projectSortBy: 'endDate' | 'createdAt' | 'name' = 'endDate';
  projectSortOrder: 'asc' | 'desc' = 'asc';

  // ドラッグ関連
  isDragging = false;
  dragType: 'start' | 'end' | 'move' | null = null;
  draggingTaskId: string | null = null;
  draggingProjectId: string | null = null; // プロジェクト用
  dragItemType: 'task' | 'project' | null = null; // ドラッグ中のアイテムタイプ
  dragStartX = 0;
  dragStartY = 0; // クリックとドラッグを区別するため
  dragStartDate: Date | null = null;
  dragStartEndDate: Date | null = null; // バー全体ドラッグ用
  showDateEditDialog = false;
  editingTaskId: string | null = null;
  editingProjectId: string | null = null; // プロジェクト用
  editingStartDate: Date | null = null;
  editingEndDate: Date | null = null;

  // ツールチップ用
  hoveredTask: GanttTask | null = null;
  hoveredProject: GanttProject | null = null;
  tooltipPosition: { x: number; y: number } = { x: 0, y: 0 };

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
    window.addEventListener('viewModeChanged', async (event: any) => {
      if (event.detail) {
        this.taskViewMode = event.detail.viewMode;
        this.selectedTeamId = event.detail.selectedTeamId;
        this.userTeamIds = event.detail.userTeamIds || this.userTeamIds;
      }
      // ビューモード変更時はフィルターを初期化
      this.initializeDefaultFilters();
      // チーム情報を再読み込みしてからデータを読み込む
      await this.loadUserTeams();
      this.loadData();
    });
    
    // 認証状態の変化を監視
    this.authSubscription = this.authService.currentUser$.subscribe(user => {
      if (user) {
        // ユーザーがログインしている場合はロード
        this.loadData();
      }
      // user が null でも何もしない（認証状態の初期化中の場合があるため）
    });
  }

  // フィルターのデフォルト値を設定（全て選択状態、完了済みを含む）
  initializeDefaultFilters() {
    // ステータスフィルター: 未着手、進行中、完了済み
    this.statusFilters = new Set(['not_started', 'in_progress', 'completed']);
    
    // 期限切れフィルター: デフォルトで有効
    this.overdueFilter = true;
    
    // 優先度フィルター: 重要、普通、低め、なし
    this.priorityFilters = new Set(['important', 'normal', 'low', 'none']);
    
    // タスクタイプフィルター: 通常、会議、定期、プロジェクト、その他
    this.taskTypeFilters = new Set(['normal', 'meeting', 'regular', 'project', 'other']);

    // プロジェクト用ステータスフィルター: 未開始、進行中、完了
    this.projectStatusFilters = new Set(['not_started', 'in_progress', 'completed']);
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

  // 現在のビューモードに対応するキーを取得
  private getFiltersStorageKey(): string {
    return `ganttFilters_${this.taskViewMode}`;
  }

  // フィルター状態をlocalStorageに保存
  saveFiltersToStorage() {
    try {
      const filters = {
        statusFilters: Array.from(this.statusFilters),
        priorityFilters: Array.from(this.priorityFilters),
        taskTypeFilters: Array.from(this.taskTypeFilters),
        overdueFilter: this.overdueFilter,
        projectStatusFilters: Array.from(this.projectStatusFilters),
        sortBy: this.sortBy,
        sortOrder: this.sortOrder
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
        this.statusFilters = new Set(filters.statusFilters || []);
        this.priorityFilters = new Set(filters.priorityFilters || []);
        this.taskTypeFilters = new Set(filters.taskTypeFilters || []);
        this.overdueFilter = filters.overdueFilter !== undefined ? filters.overdueFilter : true;
        this.projectStatusFilters = new Set(filters.projectStatusFilters || []);
        this.sortBy = filters.sortBy || 'endDate';
        this.sortOrder = filters.sortOrder || 'asc';
      }
    } catch (error) {
      console.error('Error loading filters from storage:', error);
    }
  }

  // フィルターが保存されているかチェック
  hasFiltersInStorage(): boolean {
    return localStorage.getItem(this.getFiltersStorageKey()) !== null;
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

  loadData() {
    // URL パラメータで表示モードを確認
    const mode = this.route.snapshot.queryParamMap.get('mode');
    if (mode === 'projects') {
      this.viewMode = 'projects';
      this.loadProjects();
    } else {
      this.viewMode = 'tasks';
      this.loadTasks();
    }
  }

  async loadTasks() {
    try {
      const user = this.authService.currentUser;
      if (!user) {
        // 認証状態の監視で処理されるので、ここでは何もしない
        return;
      }

      // 個人/チームモードに応じてタスクを取得
      if (this.taskViewMode === 'personal') {
        // 個人モード: 自分が作成したタスク または 所属チームのタスクで自分が担当者
        this.allTasks = await this.taskService.getTasks({
          isDeleted: false,
          teamId: null,
          userId: user.uid,
          userTeamIds: this.userTeamIds
        });
      } else if (this.taskViewMode === 'team' && this.selectedTeamId) {
        // チームタスク（teamIdが一致）
        this.allTasks = await this.taskService.getTasks({
          isDeleted: false,
          teamId: this.selectedTeamId
        });
      } else {
        this.allTasks = [];
      }

      // チーム名を設定
      for (const task of this.allTasks) {
        if (task.teamId && !task.teamName) {
          const team = this.userTeams.find(t => t.id === task.teamId);
          if (team) {
            task.teamName = team.name;
          }
        }
      }

      

      // 全期間（3か月前～3か月後）を設定（タスクフィルタリング用）
      const fullRange = this.getFullMonthRange();
      this.dateRange = fullRange;

      // 表示期間を設定
      this.setDisplayPeriod(this.displayPeriod);

      this.isLoading = false;
    } catch (error) {
      console.error('Error loading tasks:', error);
      this.isLoading = false;
    }
  }

  totalDays = 0; // 全期間の日数（計算用）

  generateDateColumnsAndRecalculate(skipSort: boolean = false) {
    if (!this.customDateRange) return;
    
    this.dateColumns = [];
    
    if (this.displayPeriod === 'month') {
      // 1か月モード: 週単位で生成
      const currentWeek = new Date(this.customDateRange.start);
      currentWeek.setHours(0, 0, 0, 0);
      
      const endDate = new Date(this.customDateRange.end);
      endDate.setHours(0, 0, 0, 0);
      
      const dateOnly = (date: Date) => {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      };
      
      const endDateOnly = dateOnly(endDate);
      
      // 各週の月曜日を追加
      while (dateOnly(currentWeek) <= endDateOnly) {
        this.dateColumns.push(new Date(currentWeek));
        currentWeek.setDate(currentWeek.getDate() + 7); // 1週間ずつ
      }
    } else {
      // 1週間、2週間モード: 日単位で生成（既存のロジック）
      const currentDate = new Date(this.customDateRange.start);
      currentDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date(this.customDateRange.end);
      endDate.setHours(0, 0, 0, 0);
      
      const dateOnly = (date: Date) => {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      };
      
      const endDateOnly = dateOnly(endDate);
      
      while (dateOnly(currentDate) <= endDateOnly) {
        this.dateColumns.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
    
    // ガントチャートの位置を計算
    this.recalculateGanttWithAllDates(this.dateColumns, skipSort);
  }

  recalculateGanttWithAllDates(allDateColumns: Date[], skipSort: boolean = false) {
    if (!this.customDateRange || !this.dateRange || allDateColumns.length === 0) return;

    // タスクの再計算
    if (this.viewMode === 'tasks') {
      const weekStart = new Date(this.customDateRange.start);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(this.customDateRange.end);
      weekEnd.setHours(23, 59, 59, 999);
      
      console.log('=== デバッグ情報 ===');
      console.log('全タスク数:', this.allTasks.length);
      console.log('表示週:', weekStart, '～', weekEnd);
      console.log('dateColumns数:', allDateColumns.length);
      
      const weekStartOnly = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
      const weekEndOnly = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
      
      // フィルタリング
      let filteredTasks = this.allTasks.filter(task => {
        // 現在表示している週（customDateRange）とタスクが重なっているかチェック
        const taskStart = task.startDate.toDate();
        const taskEnd = task.endDate.toDate();
        const taskStartOnly = new Date(taskStart.getFullYear(), taskStart.getMonth(), taskStart.getDate());
        const taskEndOnly = new Date(taskEnd.getFullYear(), taskEnd.getMonth(), taskEnd.getDate());

        // タスクの期間と週の期間が重なっているか（日付のみで比較）
        // タスクの開始日が週の終了日以前 かつ タスクの終了日が週の開始日以降
        const overlaps = taskStartOnly.getTime() <= weekEndOnly.getTime() && taskEndOnly.getTime() >= weekStartOnly.getTime();
        
        if (!overlaps) {
          console.log('除外されたタスク:', task.title, 
            '開始:', taskStartOnly, 
            '終了:', taskEndOnly,
            '週開始:', weekStartOnly,
            '週終了:', weekEndOnly);
        }
        
        return overlaps;
      });

      // ステータスフィルター（複数選択対応）
      if (this.statusFilters.size > 0) {
        filteredTasks = filteredTasks.filter(task => this.statusFilters.has(task.status));
      }

      // 期限切れフィルター（独立）
      if (!this.overdueFilter) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        filteredTasks = filteredTasks.filter(task => {
          const endDate = task.endDate.toDate();
          const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
          // 期限切れでないタスクのみ残す
          return endDateOnly >= today || task.status === 'completed';
        });
      }

      // 優先度フィルター（複数選択対応）
      if (this.priorityFilters.size > 0) {
        filteredTasks = filteredTasks.filter(task => this.priorityFilters.has(task.priority));
      }

      // タスクタイプフィルター（複数選択対応）
      if (this.taskTypeFilters.size > 0) {
        filteredTasks = filteredTasks.filter(task => {
          const taskType = task.taskType || 'normal';
          return this.taskTypeFilters.has(taskType);
        });
      }
      
      // ソート（skipSortがfalseの場合のみ）
      if (!skipSort) {
        filteredTasks.sort((a, b) => {
          let comparison = 0;

          switch (this.sortBy) {
            case 'endDate':
              comparison = a.endDate.toMillis() - b.endDate.toMillis();
              break;
            case 'startDate':
              comparison = a.startDate.toMillis() - b.startDate.toMillis();
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
          }

          return this.sortOrder === 'asc' ? comparison : -comparison;
        });
      } else {
        // ソートをスキップする場合、現在のganttTasksの順序を維持
        // ドラッグ中のタスクの順序を保持するため、既存のganttTasksの順序に基づいて並び替え
        const currentOrderMap = new Map<string, number>();
        this.ganttTasks.forEach((ganttTask, index) => {
          currentOrderMap.set(ganttTask.task.id, index);
        });
        
        filteredTasks.sort((a, b) => {
          const aIndex = currentOrderMap.get(a.id) ?? 999999;
          const bIndex = currentOrderMap.get(b.id) ?? 999999;
          return aIndex - bIndex;
        });
      }
      
      console.log('フィルタ後のタスク数:', filteredTasks.length);
      
      // マッピング
      this.ganttTasks = filteredTasks.map(task => {
          const taskStart = task.startDate.toDate();
          const taskEnd = task.endDate.toDate();
          const taskStartOnly = new Date(taskStart.getFullYear(), taskStart.getMonth(), taskStart.getDate());
          const taskEndOnly = new Date(taskEnd.getFullYear(), taskEnd.getMonth(), taskEnd.getDate());
          const weekStartOnly = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());

          // 実際のタスク期間（日数）
          const actualDurationDays = Math.ceil(
            (taskEndOnly.getTime() - taskStartOnly.getTime()) / (1000 * 60 * 60 * 24)
          ) + 1;
          
          // 表示範囲内での開始インデックスと終了インデックス
          let startIndex: number;
          let endIndex: number;
          
          if (this.displayPeriod === 'month') {
            // 週単位モード: タスクの開始日・終了日がどの週に含まれるかを判定
            startIndex = -1;
            endIndex = -1;
            
            // 各週をループして、タスクの開始日・終了日が含まれる週を探す
            for (let i = 0; i < allDateColumns.length; i++) {
              const weekStartDate = new Date(allDateColumns[i]);
              weekStartDate.setHours(0, 0, 0, 0);
              const weekEndDate = new Date(weekStartDate);
              weekEndDate.setDate(weekStartDate.getDate() + 6);
              weekEndDate.setHours(23, 59, 59, 999);
              const weekStartOnly = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate());
              const weekEndOnly = new Date(weekEndDate.getFullYear(), weekEndDate.getMonth(), weekEndDate.getDate());
              
              // タスクの開始日がこの週に含まれるか
              if (startIndex === -1 && taskStartOnly >= weekStartOnly && taskStartOnly <= weekEndOnly) {
                startIndex = i;
              }
              
              // タスクの終了日がこの週に含まれるか
              if (taskEndOnly >= weekStartOnly && taskEndOnly <= weekEndOnly) {
                endIndex = i;
              }
            }
            
            // 範囲外の場合は調整
            const rangeStartOnly = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
            const rangeEndOnly = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
            
            if (startIndex === -1) {
              // タスクが範囲より前の場合は最初の週
              startIndex = 0;
            }
            if (endIndex === -1) {
              // タスクが範囲より後の場合は最後の週
              endIndex = allDateColumns.length - 1;
            }
          } else {
            // 日単位モード（既存のロジック）
            const weekStartOnly = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
            
            startIndex = allDateColumns.findIndex(date => {
              const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
              if (taskStartOnly < weekStartOnly) {
                return dateOnly.getTime() === weekStartOnly.getTime();
              }
              return dateOnly.getTime() === taskStartOnly.getTime();
            });
            
            const weekEndOnly = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
            
            endIndex = allDateColumns.findIndex(date => {
              const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
              if (taskEndOnly > weekEndOnly) {
                return dateOnly.getTime() === weekEndOnly.getTime();
              }
              return dateOnly.getTime() === taskEndOnly.getTime();
            });
          }

          if (startIndex === -1) startIndex = 0;
          if (endIndex === -1) endIndex = allDateColumns.length - 1;

          // タスクが表示範囲外と繋がっているかを判定
          const isStartTruncated = taskStartOnly < weekStartOnly;
          const isEndTruncated = taskEndOnly > weekEndOnly;

          return {
            task,
            startDateIndex: startIndex,
            durationDays: endIndex - startIndex + 1,
            actualDurationDays: actualDurationDays,
            isStartTruncated: isStartTruncated,
            isEndTruncated: isEndTruncated
          };
        });
    } else {
      // プロジェクトの再計算
      const weekStart = new Date(this.customDateRange.start);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(this.customDateRange.end);
      weekEnd.setHours(23,59,59,999);
      
      const weekStartOnly = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
      const weekEndOnly = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
      
      // フィルタリング
      let filteredProjects = this.allProjects.filter(project => {
        // 現在表示している週（customDateRange）とプロジェクトが重なっているかチェック
        const projStart = project.startDate.toDate();
        const projEnd = project.endDate.toDate();
        const projStartOnly = new Date(projStart.getFullYear(), projStart.getMonth(), projStart.getDate());
        const projEndOnly = new Date(projEnd.getFullYear(), projEnd.getMonth(), projEnd.getDate());
        
        // プロジェクトの期間と週の期間が重なっているか
        const overlaps = projStartOnly <= weekEndOnly && projEndOnly >= weekStartOnly;
        
        if (!overlaps) {
          return false;
        }
        
        return true;
      });

      // ステータスフィルター（複数選択対応）
      if (this.projectStatusFilters.size > 0) {
        filteredProjects = filteredProjects.filter(project => this.projectStatusFilters.has(project.status));
      }

      // ソート（skipSortがfalseの場合のみ）
      if (!skipSort) {
        filteredProjects.sort((a, b) => {
          let comparison = 0;

          switch (this.projectSortBy) {
            case 'endDate':
              comparison = a.endDate.toMillis() - b.endDate.toMillis();
              break;
            case 'createdAt':
              // プロジェクトにcreatedAtがない場合は、startDateを使用
              comparison = a.startDate.toMillis() - b.startDate.toMillis();
              break;
            case 'name':
              comparison = a.name.localeCompare(b.name);
              break;
          }

          return this.projectSortOrder === 'asc' ? comparison : -comparison;
        });
      } else {
        // ソートをスキップする場合、現在のganttProjectsの順序を維持
        // ドラッグ中のプロジェクトの順序を保持するため、既存のganttProjectsの順序に基づいて並び替え
        const currentOrderMap = new Map<string, number>();
        this.ganttProjects.forEach((ganttProject, index) => {
          currentOrderMap.set(ganttProject.project.id, index);
        });
        
        filteredProjects.sort((a, b) => {
          const aIndex = currentOrderMap.get(a.id) ?? 999999;
          const bIndex = currentOrderMap.get(b.id) ?? 999999;
          return aIndex - bIndex;
        });
      }
      
      this.ganttProjects = filteredProjects
        .map(project => {
          const projStart = project.startDate.toDate();
          const projEnd = project.endDate.toDate();
          const projStartOnly = new Date(projStart.getFullYear(), projStart.getMonth(), projStart.getDate());
          const projEndOnly = new Date(projEnd.getFullYear(), projEnd.getMonth(), projEnd.getDate());
          
          // 表示範囲内での開始インデックスと終了インデックス
          let startIndex: number;
          let endIndex: number;
          
          if (this.displayPeriod === 'month') {
            // 週単位モード: プロジェクトの開始日・終了日がどの週に含まれるかを判定
            startIndex = -1;
            endIndex = -1;
            
            // 各週をループして、プロジェクトの開始日・終了日が含まれる週を探す
            for (let i = 0; i < allDateColumns.length; i++) {
              const weekStartDate = new Date(allDateColumns[i]);
              weekStartDate.setHours(0, 0, 0, 0);
              const weekEndDate = new Date(weekStartDate);
              weekEndDate.setDate(weekStartDate.getDate() + 6);
              weekEndDate.setHours(23, 59, 59, 999);
              const weekStartOnly = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate());
              const weekEndOnly = new Date(weekEndDate.getFullYear(), weekEndDate.getMonth(), weekEndDate.getDate());
              
              // プロジェクトの開始日がこの週に含まれるか
              if (startIndex === -1 && projStartOnly >= weekStartOnly && projStartOnly <= weekEndOnly) {
                startIndex = i;
              }
              
              // プロジェクトの終了日がこの週に含まれるか
              if (projEndOnly >= weekStartOnly && projEndOnly <= weekEndOnly) {
                endIndex = i;
              }
            }
            
            // 範囲外の場合は調整
            const rangeStartOnly = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
            const rangeEndOnly = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
            
            if (startIndex === -1) {
              // プロジェクトが範囲より前の場合は最初の週
              startIndex = 0;
            }
            if (endIndex === -1) {
              // プロジェクトが範囲より後の場合は最後の週
              endIndex = allDateColumns.length - 1;
            }
          } else {
            // 日単位モード（既存のロジック）
            const weekStartOnly = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
            
            startIndex = allDateColumns.findIndex(date => {
              const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
              if (projStartOnly < weekStartOnly) {
                return dateOnly.getTime() === weekStartOnly.getTime();
              }
              return dateOnly.getTime() === projStartOnly.getTime();
            });
            
            const weekEndOnly = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
            
            endIndex = allDateColumns.findIndex(date => {
              const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
              if (projEndOnly > weekEndOnly) {
                return dateOnly.getTime() === weekEndOnly.getTime();
              }
              return dateOnly.getTime() === projEndOnly.getTime();
            });
          }

          if (startIndex === -1) startIndex = 0;
          if (endIndex === -1) endIndex = allDateColumns.length - 1;

          // プロジェクトが表示範囲外と繋がっているかを判定
          const weekStartOnly = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
          const weekEndOnly = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
          const isStartTruncated = projStartOnly < weekStartOnly;
          const isEndTruncated = projEndOnly > weekEndOnly;

          // 実際のプロジェクト期間（日数）
          const actualDurationDays = Math.ceil(
            (projEndOnly.getTime() - projStartOnly.getTime()) / (1000 * 60 * 60 * 24)
          ) + 1;

          return {
            project,
            startDateIndex: startIndex,
            durationDays: endIndex - startIndex + 1,
            actualDurationDays: actualDurationDays,
            isStartTruncated: isStartTruncated,
            isEndTruncated: isEndTruncated
          };
        });
    }
  }

  recalculateGantt() {
    // 空の実装（generateDateColumnsAndRecalculateで処理）
  }

  getTotalDays(): number {
    if (!this.customDateRange) return 14;
    return Math.ceil((this.customDateRange.end.getTime() - this.customDateRange.start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  }

  formatDate(timestamp: any): string {
    const date = timestamp.toDate();
    return date.toLocaleDateString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  formatDateRange(date: Date): string {
    return date.toLocaleDateString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  // 今週（月～日）の範囲を計算
  getCurrentWeekRange(): { start: Date; end: Date } {
    const today=new Date();
    today.setHours(0,0,0,0);

    const dayOfWeek=today.getDay();
    const mondayOffset=dayOfWeek===0?-6:1 -dayOfWeek;
    const monday=new Date(today);
    monday.setDate(today.getDate()+mondayOffset);
    monday.setHours(0,0,0,0);
    const sunday=new Date(monday);
    sunday.setDate(monday.getDate()+6);
    sunday.setHours(23,59,59,999);
    return { start: monday, end: sunday };
  }

  // 3か月前～3か月後までの範囲を計算
  getFullMonthRange(): { start: Date; end: Date } {
    const today=new Date();
    today.setHours(0,0,0,0);

    const startDate=new Date(today);
    startDate.setMonth(today.getMonth()-3);
    startDate.setHours(0,0,0,0);
    const endDate=new Date(today);
    endDate.setMonth(today.getMonth()+3);
    endDate.setHours(23,59,59,999);
    return { start: startDate, end: endDate };
  }

  // 2週間範囲を計算（今日を含む週を左側に配置）
  getTwoWeeksRange(): { start: Date; end: Date } {
    const today=new Date();
    today.setHours(0,0,0,0);

    const dayOfWeek=today.getDay();
    const mondayOffset=dayOfWeek===0?-6:1 -dayOfWeek;
    const currentWeekStart=new Date(today);
    currentWeekStart.setDate(today.getDate()+mondayOffset);
    currentWeekStart.setHours(0,0,0,0);

    const endDate=new Date(currentWeekStart);
    endDate.setDate(currentWeekStart.getDate()+13);
    endDate.setHours(23,59,59,999);
    return { start: currentWeekStart, end: endDate };
  }

  // 1か月範囲を計算（指定した月を使用、指定なしの場合は今月）
  getOneMonthRange(baseDate?: Date): { start: Date; end: Date } {
    const referenceDate = baseDate || new Date();
    referenceDate.setHours(0, 0, 0, 0);
    
    // 月の最初の日を取得
    const startOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);

    // 月の最初の日が含まれる週の月曜日を計算
    const dayOfWeek = startOfMonth.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const startDate = new Date(startOfMonth);
    startDate.setDate(startOfMonth.getDate() + mondayOffset);
    startDate.setHours(0, 0, 0, 0);

    // 月の最後の日を取得
    const endOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0);
    endOfMonth.setHours(0, 0, 0, 0);

    const lastDayOfWeek = endOfMonth.getDay();
    const sundayOffset = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
    const endDate = new Date(endOfMonth);
    endDate.setDate(endOfMonth.getDate() + sundayOffset);
    endDate.setHours(23, 59, 59, 999);

    return { start: startDate, end: endDate };
  }


  formatMonthDay(date: Date): string {
    return date.toLocaleDateString('ja-JP', { 
      month: 'short', 
      day: 'numeric' 
    });
  }

  formatDay(date: Date): string {
    if (this.displayPeriod === 'month') {
      // 週単位表示: 週の範囲を表示
      return this.formatWeekRange(date);
    } else {
      // 日単位表示
      return date.toLocaleDateString('ja-JP', { 
        day: 'numeric' 
      });
    }
  }

  // 月のラベルを取得
  formatMonthLabel(date:Date): string {
    return date.toLocaleDateString('ja-JP', { 
      year: 'numeric', 
      month: 'long' 
    });
  }

  // その日付の上に月表示を表示するかどうか（1週間・2週間表示）
  shouldShowMonthLabel(date:Date, index:number): boolean {
    if(this.displayPeriod==='month') return false;

    // 最初の日付の場合は表示
    if(index===0) return true;

    // 前の日付と月が異なる場合は表示
    const prevDate=this.dateColumns[index-1];
    if(prevDate){
      return date.getMonth()!==prevDate.getMonth()||date.getFullYear()!==prevDate.getFullYear();
    }
    return false;
  }

  // 月の開始列と終了列を取得（列をまたぐためのスパンを計算）
  getMonthColumnSpan(index: number): { startCol: number; span: number } | null {
    if (this.displayPeriod === 'month') return null;
    if (!this.shouldShowMonthLabel(this.dateColumns[index], index)) return null;
    
    const date = this.dateColumns[index];
    const month = date.getMonth();
    const year = date.getFullYear();
    
    // 開始列（+2はタスクラベル列のため）
    const startCol = index + 2;
    
    // 次の月が始まる列を探す（終了列）
    let endIndex = index + 1;
    for (let i = index + 1; i < this.dateColumns.length; i++) {
      const nextDate = this.dateColumns[i];
      if (nextDate.getMonth() !== month || nextDate.getFullYear() !== year) {
        endIndex = i;
        break;
      }
      endIndex = i + 1;
    }
    
    // スパン（列数）を計算
    const span = endIndex - index;
    
    return { startCol, span };
  }

  // タスクヘッダーと日付ヘッダー行の行番号を取得
  getHeaderRow(): number {
  // 月表示行がある場合は行2、ない場合は行1
    return (this.displayPeriod === 'week' || this.displayPeriod === 'twoWeeks') ? 2 : 1;
  }

  // タスク行の行番号を計算
  getGridRow(index:number): number {
    // 月表示行がある場合は+3、ない場合は+2
    return (this.displayPeriod === 'week' || this.displayPeriod === 'twoWeeks') ? index + 3 : index + 2;
  }

  // 週範囲を表示（1か月モード用）
  formatWeekRange(weekStart: Date): string {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    
    // 同じ月の場合は "1/1 - 1/7"、異なる月の場合は "1/31 - 2/6" のような形式
    if (weekStart.getMonth() === weekEnd.getMonth()) {
      return `${weekStart.getMonth() + 1}/${weekStart.getDate()} - ${weekEnd.getDate()}`;
    } else {
      return `${weekStart.getMonth() + 1}/${weekStart.getDate()} - ${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`;
    }
  }

  formatDateFull(timestamp: any): string {
    const date = timestamp.toDate ? timestamp.toDate() : timestamp;
    return date.toLocaleDateString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      weekday: 'short'
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

  getStatusColor(status: string): string {
    const colorMap: { [key: string]: string } = {
      'not_started': '#2196F3',
      'in_progress': '#FF9800',
      'completed': '#4CAF50'
    };
    return colorMap[status] || '#9E9E9E';
  }

  getProjectColor(completionRate: number): string {
    // 完了率に応じてグラデーションで色を変える
    
    // 0-30%: 青 → ライトブルー
    if (completionRate <= 30) {
      const intensity = completionRate / 30;
      const r = Math.round(33 + (173 - 33) * intensity);
      const g = Math.round(150 + (216 - 150) * intensity);
      const b = Math.round(243);
      return `rgb(${r}, ${g}, ${b})`;
    }
    
    // 30-60%: ライトブルー → 黄
    if (completionRate <= 60) {
      const intensity = (completionRate - 30) / 30;
      const r = 173;
      const g = Math.round(216 - (50) * intensity);
      const b = Math.round(243 - (193) * intensity);
      return `rgb(${r}, ${g}, ${b})`;
    }
    
    // 60-85%: 黄 → オレンジ
    if (completionRate <= 85) {
      const intensity = (completionRate - 60) / 25;
      const r = Math.round(173 + (255 - 173) * intensity);
      const g = Math.round(166 - (38) * intensity);
      const b = 0;
      return `rgb(${r}, ${g}, ${b})`;
    }
    
    // 85-100%: オレンジ → 緑
    const intensity = (completionRate - 85) / 15;
    const r = Math.round(255 - (255 - 76) * intensity);
    const g = Math.round(128 + (175 - 128) * intensity);
    const b = Math.round(0 + (80) * intensity);
    return `rgb(${r}, ${g}, ${b})`;
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

  async loadProjects() {
    try {
      const user = this.authService.currentUser;
      if (!user) {
        // 認証状態の監視で処理されるので、ここでは何もしない
        return;
      }

      // 個人/チームモードに応じてプロジェクトを取得
      this.allProjects = await this.projectService.getProjectsForUser(
        user.uid,
        this.taskViewMode === 'team' ? this.selectedTeamId : null,
        this.userTeamIds
      );

      // チーム名を設定
      for (const project of this.allProjects) {
        if (project.teamId && !project.teamName) {
          const team = this.userTeams.find(t => t.id === project.teamId);
          if (team) {
            project.teamName = team.name;
          }
        }
      }

      if (this.allProjects.length === 0) {
        this.isLoading = false;
        return;
      }

      // 全期間（3か月前～3か月後）を設定（タスクフィルタリング用）
      const fullRange = this.getFullMonthRange();
      this.dateRange = fullRange;

      // 表示期間を設定
      this.setDisplayPeriod(this.displayPeriod);

      this.isLoading = false;
    } catch (error) {
      console.error('Error loading projects:', error);
      this.isLoading = false;
    }
  }

  formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  switchView(mode: 'tasks' | 'projects') {
    this.viewMode = mode;
    this.isLoading = true;
    
    if (mode === 'projects') {
      this.loadProjects();
    } else {
      this.loadTasks();
    }
  }

  viewTask(taskId: string) {
    // ドラッグ中はクリックイベントを無視
    if (this.isDragging) {
      return;
    }
    this.router.navigate(['/task', taskId], { queryParams: { from: 'gantt' } });
  }

  viewProject(projectId: string) {
    this.router.navigate(['/project', projectId], { queryParams: { from: 'gantt' } });
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/home']);
    }
  }

  // バー全体のドラッグ開始 - タスク用
  onBarDragStart(event: MouseEvent, taskId: string, currentStartDate: Date, currentEndDate: Date) {
    // ハンドルをクリックした場合はバー全体のドラッグを無視
    const target = event.target as HTMLElement;
    if (target.classList.contains('drag-handle')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
    this.dragType = 'move';
    this.dragItemType = 'task';
    this.draggingTaskId = taskId;
    this.draggingProjectId = null;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragStartDate = new Date(currentStartDate);
    this.dragStartEndDate = new Date(currentEndDate);
    
    document.addEventListener('mousemove', this.onDragMove);
    document.addEventListener('mouseup', this.onDragEnd);
  }

  // バー全体のドラッグ開始 - プロジェクト用
  onProjectBarDragStart(event: MouseEvent, projectId: string, currentStartDate: Date, currentEndDate: Date) {
    // ハンドルをクリックした場合はバー全体のドラッグを無視
    const target = event.target as HTMLElement;
    if (target.classList.contains('drag-handle')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
    this.dragType = 'move';
    this.dragItemType = 'project';
    this.draggingTaskId = null;
    this.draggingProjectId = projectId;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragStartDate = new Date(currentStartDate);
    this.dragStartEndDate = new Date(currentEndDate);
    
    document.addEventListener('mousemove', this.onDragMove);
    document.addEventListener('mouseup', this.onDragEnd);
  }

  // ドラッグ開始（左端）- タスク用
  onDragStart(event: MouseEvent, taskId: string, currentStartDate: Date) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
    this.dragType = 'start';
    this.dragItemType = 'task';
    this.draggingTaskId = taskId;
    this.draggingProjectId = null;
    this.dragStartX = event.clientX;
    this.dragStartDate = new Date(currentStartDate);
    
    document.addEventListener('mousemove', this.onDragMove);
    document.addEventListener('mouseup', this.onDragEnd);
  }

  // ドラッグ開始（右端）- タスク用
  onDragEndStart(event: MouseEvent, taskId: string, currentEndDate: Date) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
    this.dragType = 'end';
    this.dragItemType = 'task';
    this.draggingTaskId = taskId;
    this.draggingProjectId = null;
    this.dragStartX = event.clientX;
    this.dragStartDate = new Date(currentEndDate);
    
    document.addEventListener('mousemove', this.onDragMove);
    document.addEventListener('mouseup', this.onDragEnd);
  }

  // ドラッグ開始（左端）- プロジェクト用
  onProjectDragStart(event: MouseEvent, projectId: string, currentStartDate: Date) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
    this.dragType = 'start';
    this.dragItemType = 'project';
    this.draggingTaskId = null;
    this.draggingProjectId = projectId;
    this.dragStartX = event.clientX;
    this.dragStartDate = new Date(currentStartDate);
    
    document.addEventListener('mousemove', this.onDragMove);
    document.addEventListener('mouseup', this.onDragEnd);
  }

  // ドラッグ開始（右端）- プロジェクト用
  onProjectDragEndStart(event: MouseEvent, projectId: string, currentEndDate: Date) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
    this.dragType = 'end';
    this.dragItemType = 'project';
    this.draggingTaskId = null;
    this.draggingProjectId = projectId;
    this.dragStartX = event.clientX;
    this.dragStartDate = new Date(currentEndDate);
    
    document.addEventListener('mousemove', this.onDragMove);
    document.addEventListener('mouseup', this.onDragEnd);
  }

  // ドラッグ中
  onDragMove = (event: MouseEvent) => {
    if (!this.isDragging || !this.dragType || !this.dragStartDate || !this.customDateRange) return;
    if (!this.draggingTaskId && !this.draggingProjectId) return;

    const deltaX = event.clientX - this.dragStartX;
    
    // タスクまたはプロジェクトを取得
    let task: Task | undefined;
    let project: Project | undefined;
    
    if (this.dragItemType === 'task' && this.draggingTaskId) {
      task = this.allTasks.find(t => t.id === this.draggingTaskId);
      if (!task) return;
    } else if (this.dragItemType === 'project' && this.draggingProjectId) {
      project = this.allProjects.find(p => p.id === this.draggingProjectId);
      if (!project) return;
    } else {
      return;
    }

    // マウスの位置から日付列を計算
    const cellWidth = this.getCellWidth();
    if (!cellWidth) return;

    const deltaColumns = Math.round(deltaX / cellWidth);
    let newDate = new Date(this.dragStartDate);
    let newEndDate: Date | null = null;
    
    if (this.displayPeriod === 'month') {
      // 1か月表示の場合は週単位で移動
      newDate.setDate(this.dragStartDate.getDate() + (deltaColumns * 7));
      if (this.dragType === 'move' && this.dragStartEndDate) {
        newEndDate = new Date(this.dragStartEndDate);
        newEndDate.setDate(this.dragStartEndDate.getDate() + (deltaColumns * 7));
      }
    } else {
      // 日単位で移動
      newDate.setDate(this.dragStartDate.getDate() + deltaColumns);
      if (this.dragType === 'move' && this.dragStartEndDate) {
        newEndDate = new Date(this.dragStartEndDate);
        newEndDate.setDate(this.dragStartEndDate.getDate() + deltaColumns);
      }
    }

    // バー全体を移動する場合
    if (this.dragType === 'move' && newEndDate) {
      // 開始日と終了日の両方を同じ量だけ移動
      // 表示範囲外にも移動可能（制限なし）
      
      newDate.setHours(0, 0, 0, 0);
      newEndDate.setHours(23, 59, 59, 999);
      
      if (task) {
        task.startDate = Timestamp.fromDate(newDate);
        task.endDate = Timestamp.fromDate(newEndDate);
      } else if (project) {
        project.startDate = Timestamp.fromDate(newDate);
        project.endDate = Timestamp.fromDate(newEndDate);
      }
    } else {
      // 開始日または終了日のみを変更する場合（既存の処理）
      // 表示範囲内に制限
      if (newDate < this.customDateRange.start) {
        newDate.setTime(this.customDateRange.start.getTime());
      }
      if (newDate > this.customDateRange.end) {
        newDate.setTime(this.customDateRange.end.getTime());
      }

      if (this.dragType === 'start') {
        if (task) {
          const taskEndDate = task.endDate.toDate();
          // 日付のみで比較（時刻を無視して1日の期間を許可）
          const newDateOnly = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate());
          const endDateOnly = new Date(taskEndDate.getFullYear(), taskEndDate.getMonth(), taskEndDate.getDate());
          
          if (newDateOnly > endDateOnly) {
            // 終了日より後になる場合は、終了日と同じ日付にする（1日の期間を許可）
            newDate.setTime(endDateOnly.getTime());
          }
          newDate.setHours(0, 0, 0, 0);
          task.startDate = Timestamp.fromDate(newDate);
        } else if (project) {
          const projectEndDate = project.endDate.toDate();
          // 日付のみで比較（時刻を無視して1日の期間を許可）
          const newDateOnly = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate());
          const endDateOnly = new Date(projectEndDate.getFullYear(), projectEndDate.getMonth(), projectEndDate.getDate());
          
          if (newDateOnly > endDateOnly) {
            // 終了日より後になる場合は、終了日と同じ日付にする（1日の期間を許可）
            newDate.setTime(endDateOnly.getTime());
          }
          newDate.setHours(0, 0, 0, 0);
          project.startDate = Timestamp.fromDate(newDate);
        }
      } else {
        if (task) {
          const taskStartDate = task.startDate.toDate();
          // 日付のみで比較（時刻を無視して1日の期間を許可）
          const newDateOnly = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate());
          const startDateOnly = new Date(taskStartDate.getFullYear(), taskStartDate.getMonth(), taskStartDate.getDate());
          
          if (newDateOnly < startDateOnly) {
            // 開始日より前になる場合は、開始日と同じ日付にする（1日の期間を許可）
            newDate.setTime(startDateOnly.getTime());
          }
          newDate.setHours(23, 59, 59, 999);
          task.endDate = Timestamp.fromDate(newDate);
        } else if (project) {
          const projectStartDate = project.startDate.toDate();
          // 日付のみで比較（時刻を無視して1日の期間を許可）
          const newDateOnly = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate());
          const startDateOnly = new Date(projectStartDate.getFullYear(), projectStartDate.getMonth(), projectStartDate.getDate());
          
          if (newDateOnly < startDateOnly) {
            // 開始日より前になる場合は、開始日と同じ日付にする（1日の期間を許可）
            newDate.setTime(startDateOnly.getTime());
          }
          newDate.setHours(23, 59, 59, 999);
          project.endDate = Timestamp.fromDate(newDate);
        }
      }
    }

    // ガントチャートを再計算（ソートをスキップして順序を維持）
    this.generateDateColumnsAndRecalculate(true);
  };

  // ドラッグ終了
  onDragEnd = async (event?: MouseEvent) => {
    if (!this.isDragging || !this.dragType) {
      this.resetDragState();
      return;
    }
    if (!this.draggingTaskId && !this.draggingProjectId) {
      this.resetDragState();
      return;
    }

    // タスクまたはプロジェクトを取得
    let task: Task | undefined;
    let project: Project | undefined;
    
    if (this.dragItemType === 'task' && this.draggingTaskId) {
      task = this.allTasks.find(t => t.id === this.draggingTaskId);
      if (!task) {
        this.resetDragState();
        return;
      }
    } else if (this.dragItemType === 'project' && this.draggingProjectId) {
      project = this.allProjects.find(p => p.id === this.draggingProjectId);
      if (!project) {
        this.resetDragState();
        return;
      }
    } else {
      this.resetDragState();
      return;
    }

    // クリックとドラッグを区別（移動量が少ない場合はクリックとして扱う）
    const wasClick = event && 
      Math.abs(event.clientX - this.dragStartX) < 5 && 
      Math.abs(event.clientY - this.dragStartY) < 5;

    if (wasClick && this.dragType === 'move') {
      // クリックとして扱う場合は詳細を表示
      this.resetDragState();
      if (task) {
        this.viewTask(task.id);
      } else if (project) {
        this.viewProject(project.id);
      }
      return;
    }

    // 1か月表示の場合は詳細な日付設定ダイアログを表示（バー全体の移動でも同じ）
    if (this.displayPeriod === 'month') {
      if (task) {
        this.editingTaskId = task.id;
        this.editingProjectId = null;
        this.editingStartDate = task.startDate.toDate();
        this.editingEndDate = task.endDate.toDate();
      } else if (project) {
        this.editingTaskId = null;
        this.editingProjectId = project.id;
        this.editingStartDate = project.startDate.toDate();
        this.editingEndDate = project.endDate.toDate();
      }
      this.showDateEditDialog = true;
    } else {
      // 週/2週間表示の場合は直接保存
      if (task) {
        await this.saveTaskDates(task.id, task.startDate.toDate(), task.endDate.toDate());
      } else if (project) {
        await this.saveProjectDates(project.id, project.startDate.toDate(), project.endDate.toDate());
      }
    }

    this.resetDragState();
    
    // ドラッグ終了後にソートを含めて再計算
    this.generateDateColumnsAndRecalculate();
  };

  resetDragState() {
    this.isDragging = false;
    this.dragType = null;
    this.dragItemType = null;
    this.draggingTaskId = null;
    this.draggingProjectId = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartDate = null;
    this.dragStartEndDate = null;
    // ツールチップをリセット
    this.hoveredTask = null;
    this.hoveredProject = null;
    document.removeEventListener('mousemove', this.onDragMove);
    document.removeEventListener('mouseup', this.onDragEnd);
  }

  getCellWidth(): number | null {
    // セルの幅を計算（簡単な方法）
    const ganttWrapper = document.querySelector('.gantt-chart-wrapper');
    if (!ganttWrapper) return null;
    
    const dateColumns = document.querySelectorAll('.grid-date-column');
    if (dateColumns.length === 0) return null;
    
    const firstCell = dateColumns[0] as HTMLElement;
    return firstCell.offsetWidth;
  }

  async saveTaskDates(taskId: string, startDate: Date, endDate: Date) {
    try {
      const user = this.authService.currentUser;
      if (!user) {
        alert('ログインが必要です');
        return;
      }

      const task = this.allTasks.find(t => t.id === taskId);
      if (!task) {
        alert('タスクが見つかりません');
        return;
      }

      // 編集権限をチェック
      const canEdit = await this.taskService.canEditTask(task, user.uid);
      if (!canEdit) {
        alert('このタスクを編集する権限がありません');
        // データを再読み込みして元の状態に戻す
        await this.loadTasks();
        return;
      }

      // ガントチャートでのドラッグ変更時は自動コメントをスキップ（頻繁な変更のため）
      await this.taskService.updateTask(taskId, {
        startDate: Timestamp.fromDate(startDate),
        endDate: Timestamp.fromDate(endDate)
      }, true);
      
      // データを再読み込み
      await this.loadTasks();
    } catch (error: any) {
      console.error('Error updating task dates:', error);
      alert('タスクの期間更新に失敗しました: ' + error.message);
      // エラー時はデータを再読み込み
      await this.loadTasks();
    }
  }

  async saveProjectDates(projectId: string, startDate: Date, endDate: Date) {
    try {
      const user = this.authService.currentUser;
      if (!user) {
        alert('ログインが必要です');
        return;
      }

      const project = this.allProjects.find(p => p.id === projectId);
      if (!project) {
        alert('プロジェクトが見つかりません');
        return;
      }

      // 編集権限をチェック
      const canEdit = await this.projectService.canEditProject(project.id, user.uid);
      if (!canEdit) {
        alert('このプロジェクトを編集する権限がありません');
        // データを再読み込みして元の状態に戻す
        await this.loadProjects();
        return;
      }

      // ガントチャートでのドラッグ変更時は自動コメントをスキップ（頻繁な変更のため）
      await this.projectService.updateProject(projectId, {
        startDate: Timestamp.fromDate(startDate),
        endDate: Timestamp.fromDate(endDate)
      }, true);
      
      // データを再読み込み
      await this.loadProjects();
    } catch (error: any) {
      console.error('Error updating project dates:', error);
      alert('プロジェクトの期間更新に失敗しました: ' + error.message);
      // エラー時はデータを再読み込み
      await this.loadProjects();
    }
  }

  async confirmDateEdit() {
    if ((!this.editingTaskId && !this.editingProjectId) || !this.editingStartDate || !this.editingEndDate) return;

    // 日付のみで比較（時刻を無視して1日の期間を許可）
    const startDateOnly = new Date(this.editingStartDate.getFullYear(), this.editingStartDate.getMonth(), this.editingStartDate.getDate());
    const endDateOnly = new Date(this.editingEndDate.getFullYear(), this.editingEndDate.getMonth(), this.editingEndDate.getDate());
    
    // 開始日が終了日より後でないことを確認（同じ日付は許可）
    if (startDateOnly > endDateOnly) {
      alert('開始日は終了日より後にならないようにしてください');
      return;
    }

    // 日付を00:00:00に設定
    startDateOnly.setHours(0, 0, 0, 0);
    endDateOnly.setHours(23, 59, 59, 999);

    if (this.editingTaskId) {
      await this.saveTaskDates(this.editingTaskId, startDateOnly, endDateOnly);
    } else if (this.editingProjectId) {
      await this.saveProjectDates(this.editingProjectId, startDateOnly, endDateOnly);
    }
    
    this.showDateEditDialog = false;
    this.editingTaskId = null;
    this.editingProjectId = null;
    this.editingStartDate = null;
    this.editingEndDate = null;
  }

  cancelDateEdit() {
    // 変更をキャンセルして元に戻す
    this.showDateEditDialog = false;
    this.editingTaskId = null;
    this.editingProjectId = null;
    this.editingStartDate = null;
    this.editingEndDate = null;
    // データを再読み込みして元の状態に戻す
    if (this.viewMode === 'tasks') {
      this.loadTasks();
    } else {
      this.loadProjects();
    }
  }

  onStartDateChange(dateString: string) {
    if (dateString && this.editingStartDate) {
      this.editingStartDate = new Date(dateString + 'T00:00:00');
    }
  }

  onEndDateChange(dateString: string) {
    if (dateString && this.editingEndDate) {
      this.editingEndDate = new Date(dateString + 'T23:59:59');
    }
  }

  ngOnDestroy() {
    // ドラッグイベントリスナーをクリーンアップ
    this.resetDragState();
    this.authSubscription?.unsubscribe();
  }

  // CSS Grid 用のヘルパーメソッド

  // 指定した日付インデックスのセルにバーがあるか
  isBarInCell(dateIndex: number, item: GanttTask | GanttProject): boolean {
    return dateIndex >= item.startDateIndex && 
           dateIndex < item.startDateIndex + item.durationDays;
  }

  // 指定したセルでバーが開始するか
  isBarStart(dateIndex: number, item: GanttTask | GanttProject): boolean {
    return dateIndex === item.startDateIndex;
  }

  // 指定したセルでバーが終了するか
  isBarEnd(dateIndex: number, item: GanttTask | GanttProject): boolean {
    return dateIndex === item.startDateIndex + item.durationDays - 1;
  }

  // Grid の列定義を生成
  getGridTemplateColumns(): string {
    return `250px repeat(${this.dateColumns.length}, 1fr)`;
  }

  // 今日の日付を判定（週単位モードの場合は週の範囲内に今日が含まれるか）
  isToday(date: Date): boolean {
    const today = new Date();
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    if (this.displayPeriod === 'month') {
      // 週単位モード: 週の範囲内に今日が含まれるか
      const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const weekEndOnly = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
      
      return todayOnly >= weekStart && todayOnly <= weekEndOnly;
    } else {
      // 日単位モード: 日付が一致するか
      const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      return dateOnly.getTime() === todayOnly.getTime();
    }
  }

  // バーのグリッド列範囲を計算
  getBarGridColumn(item: GanttTask | GanttProject): string {
    const startCol = item.startDateIndex + 2;
    const endCol = startCol + item.durationDays;
    return `${startCol} / ${endCol}`;
  }

  // 表示期間を設定するメソッド
  setDisplayPeriod(period: 'week' | 'twoWeeks' | 'month', forceUseCurrentRange: boolean = false) {
    const oldPeriod = this.displayPeriod;
    this.displayPeriod = period;
    
    let range: { start: Date; end: Date };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // 現在の表示エリアに今日が含まれているかを判定
    const isTodayInRange = () => {
      if (!this.customDateRange) return true;
      const rangeStart = new Date(this.customDateRange.start);
      rangeStart.setHours(0, 0, 0, 0);
      const rangeStartOnly = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
      const rangeEnd = new Date(this.customDateRange.end);
      rangeEnd.setHours(23, 59, 59, 999);
      const rangeEndOnly = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
      return todayOnly >= rangeStartOnly && todayOnly <= rangeEndOnly;
    };

    // forceUseCurrentRange が true の場合は現在の範囲を維持
    // そうでない場合、今日が現在の表示範囲に含まれている場合、または初回表示の場合は今日を基準にする
    const shouldUseTodayAsReference = !forceUseCurrentRange && (isTodayInRange() || !this.customDateRange);
    
    if (period === 'week') {
      if(shouldUseTodayAsReference){
        range = this.getCurrentWeekRange();
        this.currentWeekStart = new Date(range.start);
      } else {
        if (this.currentWeekStart) {
        // 既存の週開始日を使用
          const weekEnd = new Date(this.currentWeekStart);
          weekEnd.setDate(this.currentWeekStart.getDate() + 6);
          weekEnd.setHours(23, 59, 59, 999);
          range = { start: new Date(this.currentWeekStart), end: weekEnd };
        } else {
          range = this.getCurrentWeekRange();
          this.currentWeekStart = new Date(range.start);
        }
      }
    } else if (period === 'twoWeeks') {
      if(shouldUseTodayAsReference){
        range = this.getTwoWeeksRange();
        this.currentWeekStart = new Date(range.start);
      } else {
        if (this.currentWeekStart) {
          // 既存の週開始日を基準に2週間
          const weekEnd = new Date(this.currentWeekStart);
          weekEnd.setDate(this.currentWeekStart.getDate() + 13);
          weekEnd.setHours(23, 59, 59, 999);
          range = { start: new Date(this.currentWeekStart), end: weekEnd };
        } else {
          range = this.getTwoWeeksRange();
          this.currentWeekStart = new Date(range.start);
        }
      }
    } else { // 'month'
      if(shouldUseTodayAsReference){
        this.currentMonth = null; //リセット
        range = this.getOneMonthRange(); // 引数なし = 今日を基準
        // 今日の月の1日を設定（range.startは前月を含む可能性があるため）
        const today = new Date();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        this.currentMonth = monthStart;
        this.currentWeekStart = new Date(range.start);
      } else {
        // forceUseCurrentRange = true の場合（前後ボタン操作）は、currentMonthを使う
        // forceUseCurrentRange = false の場合（表示モード切り替え）は、現在の表示範囲を基準にする
        if (forceUseCurrentRange && this.currentMonth) {
          // 前後ボタン操作: 更新されたcurrentMonthを使用
          range = this.getOneMonthRange(this.currentMonth);
        } else {
          // 表示モード切り替え: 現在の表示範囲の開始日を基準にする
          const baseDate = this.customDateRange ? this.customDateRange.start : new Date();
          range = this.getOneMonthRange(baseDate);
          // baseDateから実際の月の開始日を計算（range.startは前月を含む可能性があるため）
          const monthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
          this.currentMonth = monthStart;
        }
        this.currentWeekStart = new Date(range.start);
      }
    }
    
    this.customDateRange = {
      start: new Date(range.start),
      end: new Date(range.end)
    };
    
    this.generateDateColumnsAndRecalculate();
  }

  // 1週間前に移動
  moveWeekBackward() {
    if (!this.customDateRange) return;

    if(this.displayPeriod === 'month'){
      // 1か月前に移動
      if (this.currentMonth) {
        const prevMonth = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() - 1, 1);
        this.currentMonth = prevMonth;
      } else {
        const today = new Date();
        const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        this.currentMonth = prevMonth;
      }
      this.setDisplayPeriod('month', true); // forceUseCurrentRange = true で現在の範囲を維持
    } else if(this.displayPeriod === 'twoWeeks'){
      // 2週間前に移動
      const newStart = new Date(this.customDateRange.start);
      newStart.setDate(newStart.getDate() - 14);
      this.currentWeekStart = newStart;
      this.setDisplayPeriod('twoWeeks', true); // forceUseCurrentRange = true
    } else {
      // 1週間前に移動
      const newStart = new Date(this.customDateRange.start);
      newStart.setDate(newStart.getDate() - 7);
      this.currentWeekStart = newStart;
      this.setDisplayPeriod('week', true); // forceUseCurrentRange = true
    }
  }

  // 1週間後に移動
  moveWeekForward() {
    if (!this.customDateRange) return;
  
    if (this.displayPeriod === 'month') {
      // 1か月モード: 次の月に移動
      if (this.currentMonth) {
        const nextMonth = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() + 1, 1);
        this.currentMonth = nextMonth;
      } else {
        const today = new Date();
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        this.currentMonth = nextMonth;
      }
      this.setDisplayPeriod('month', true); // forceUseCurrentRange = true
    } else if (this.displayPeriod === 'twoWeeks') {
      // 2週間モード: 14日後へ移動
      const newStart = new Date(this.customDateRange.start);
      newStart.setDate(newStart.getDate() + 14);
      this.currentWeekStart = newStart;
      this.setDisplayPeriod('twoWeeks', true); // forceUseCurrentRange = true
    } else {
      // 1週間モード: 7日後へ移動
      const newStart = new Date(this.customDateRange.start);
      newStart.setDate(newStart.getDate() + 7);
      this.currentWeekStart = newStart;
      this.setDisplayPeriod('week', true); // forceUseCurrentRange = true
    }
  }

  // 今週に戻る
  moveToCurrentWeek() {
    if (this.displayPeriod === 'month') {
      // 今月に戻る
      // 今日の月を直接設定
      const today = new Date();
      const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      this.currentMonth = currentMonthStart;
      this.setDisplayPeriod('month', true);
    } else {
      // 今週に戻る
      const weekRange = this.getCurrentWeekRange();
      this.currentWeekStart = weekRange.start;
      this.setDisplayPeriod(this.displayPeriod);
    }
  }

  // 優先度ラベルを取得
  getPriorityLabel(priority: string): string {
    const priorityMap: { [key: string]: string } = {
      'important': '重要',
      'normal': '普通',
      'low': '低め',
      'none': 'なし',
      'custom': 'カスタム',
    };
    return priorityMap[priority] || priority;
  }

  // 進捗率を取得するメソッド
  getProgressPercentage(task: Task): number {
    if(task.progressManual) {
      return task.progress;
    }
    if(!task.subtasks || task.subtasks.length === 0) return 0;
    const completedCount = task.subtasks.filter(s => s.completed).length;
    return Math.round((completedCount / task.subtasks.length) * 100);
  }

  // 期間をフォーマットするメソッド
  formatTaskPeriod(task: Task): string {
    const start=task.startDate.toDate();
    const end=task.endDate.toDate();
    const startStr=this.formatDateForInput(start);
    const endStr=this.formatDateForInput(end);
    return `${startStr} 〜 ${endStr}`;
  }

  // ホバー開始時の処理
  onTaskHover(event: MouseEvent, gantttask: GanttTask) {
    this.hoveredTask = gantttask;
    
    // バーのDOM要素の位置を取得
    const barElement = event.currentTarget as HTMLElement;
    const rect = barElement.getBoundingClientRect();
    
    // バーの中央上にツールチップを配置
    this.tooltipPosition = {
      x: rect.left + rect.width / 2, // バーの中央
      y: rect.top - 10 // バーの上に少し余白
    };
  }

  // ホバー終了時の処理
  onTaskLeave() {
    this.hoveredTask = null;
  }

  // プロジェクトホバー開始時の処理
  onProjectHover(event: MouseEvent, ganttProject: GanttProject) {
    this.hoveredProject = ganttProject;
    
    // バーのDOM要素の位置を取得
    const barElement = event.currentTarget as HTMLElement;
    const rect = barElement.getBoundingClientRect();
    
    // バーの中央上にツールチップを配置
    this.tooltipPosition = {
      x: rect.left + rect.width / 2, // バーの中央
      y: rect.top - 10 // バーの上に少し余白
    };
  }

  // プロジェクトホバー終了時の処理
  onProjectLeave() {
    this.hoveredProject = null;
  }

  // プロジェクト期間のフォーマット
  formatProjectPeriod(project: Project): string {
    const start = project.startDate.toDate();
    const end = project.endDate.toDate();
    const startStr = this.formatDateForInput(start);
    const endStr = this.formatDateForInput(end);
    return `${startStr} 〜 ${endStr}`;
  }

  // フィルター変更（複数選択対応）
  onStatusFilterChange(status: string, checked: boolean) {
    if (checked) {
      this.statusFilters.add(status);
    } else {
      this.statusFilters.delete(status);
    }
    this.saveFiltersToStorage();
    this.generateDateColumnsAndRecalculate();
  }

  onPriorityFilterChange(priority: string, checked: boolean) {
    if (checked) {
      this.priorityFilters.add(priority);
    } else {
      this.priorityFilters.delete(priority);
    }
    this.saveFiltersToStorage();
    this.generateDateColumnsAndRecalculate();
  }

  onTaskTypeFilterChange(taskType: string, checked: boolean) {
    if (checked) {
      this.taskTypeFilters.add(taskType);
    } else {
      this.taskTypeFilters.delete(taskType);
    }
    this.saveFiltersToStorage();
    this.generateDateColumnsAndRecalculate();
  }

  // 期限切れフィルター変更
  onOverdueFilterChange(checked: boolean) {
    this.overdueFilter = checked;
    this.saveFiltersToStorage();
    this.generateDateColumnsAndRecalculate();
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

  // ソート変更
  onSortChange(newSortBy: 'endDate' | 'priority' | 'title' | 'startDate') {
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
    
    this.saveFiltersToStorage();
    this.generateDateColumnsAndRecalculate();
  }

  // 昇順/降順を切り替えるメソッド
  toggleSortOrder() {
    this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    this.saveFiltersToStorage();
    this.generateDateColumnsAndRecalculate();
  }

  // プロジェクト用ステータスフィルター変更
  onProjectStatusFilterChange(status: string, checked: boolean) {
    if (checked) {
      this.projectStatusFilters.add(status);
    } else {
      this.projectStatusFilters.delete(status);
    }
    this.saveFiltersToStorage();
    this.generateDateColumnsAndRecalculate();
  }

  // プロジェクト用ソート変更
  onProjectSortChange(newSortBy: 'endDate' | 'createdAt' | 'name') {
    // 変更前の値を保持
    const oldSortBy = this.projectSortBy;
    
    // 新しい値を設定
    this.projectSortBy = newSortBy;
    
    // 同じ項目なら順序を切り替え、異なる項目なら昇順にリセット
    if (oldSortBy === newSortBy) {
      this.projectSortOrder = this.projectSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this.projectSortOrder = 'asc';
    }
    
    this.generateDateColumnsAndRecalculate();
  }

  // プロジェクト用昇順/降順を切り替えるメソッド
  toggleProjectSortOrder() {
    this.projectSortOrder = this.projectSortOrder === 'asc' ? 'desc' : 'asc';
    this.generateDateColumnsAndRecalculate();
  }
    
}

