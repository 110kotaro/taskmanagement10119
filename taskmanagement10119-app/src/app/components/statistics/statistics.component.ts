import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { Chart, ChartConfiguration, ChartType, registerables } from 'chart.js';
import { AuthService } from '../../services/auth.service';
import { TaskService } from '../../services/task.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { Task, TaskStatus } from '../../models/task.model';
import { Project, ProjectStatus } from '../../models/project.model';
import { Team } from '../../models/team.model';

Chart.register(...registerables);

interface StatisticsData {
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  totalWorkTime: number; // 分
  delayedTasks: number;
}

interface ProjectStatistics {
  project: Project;
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  totalWorkTime: number; // 分
}

@Component({
  selector: 'app-statistics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './statistics.component.html',
  styleUrl: './statistics.component.css'
})
export class StatisticsComponent implements OnInit, AfterViewInit {
  @ViewChild('workTimeChart') chartCanvas!: ElementRef<HTMLCanvasElement>;
  
  private authService = inject(AuthService);
  private router = inject(Router);
  private location = inject(Location);
  private taskService = inject(TaskService);
  private projectService = inject(ProjectService);
  private teamService = inject(TeamService);

  timeRange: 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'last3Months' | 'custom' = 'thisWeek';
  filterPattern: 'endDate' | 'startDate' | 'overlap' = 'endDate'; // デフォルトは終了日基準
  
  // カスタム期間選択
  showCustomRangeModal = false;
  customStartDate: string = '';
  customEndDate: string = '';
  customRangeError: string = '';
  statistics: StatisticsData = {
    totalTasks: 0,
    completedTasks: 0,
    completionRate: 0,
    totalWorkTime: 0,
    delayedTasks: 0
  };
  projectStatistics: ProjectStatistics[] = [];
  isLoading = true;
  workTimeChart: Chart | null = null;
  dailyWorkTimeData: { date: string; seconds: number }[] = [];
  delayedTasksList: Task[] = [];
  showDelayedTasksDetails = false;

  // 個人/チーム切り替え状態（サイドバーから取得）
  viewMode: 'personal' | 'team' = 'personal';
  selectedTeamId: string | null = null;
  userTeamIds: string[] = [];
  userTeams: Team[] = [];

  async ngOnInit() {
    await this.loadUserTeams();
    
    // localStorageから初期状態を取得
    this.loadViewModeStateFromStorage();
    
    // 個人/チーム切り替えの変更を監視
    window.addEventListener('viewModeChanged', (event: any) => {
      if (event.detail) {
        this.viewMode = event.detail.viewMode;
        this.selectedTeamId = event.detail.selectedTeamId;
        this.userTeamIds = event.detail.userTeamIds || this.userTeamIds;
      }
      this.loadStatistics();
    });
    
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.loadStatistics();
      }
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

  ngAfterViewInit() {
    // グラフの初期化はデータロード後に実行
    
    // テーマ変更を監視してグラフを再描画
    const observer = new MutationObserver(() => {
      if (this.workTimeChart && this.dailyWorkTimeData.length > 0) {
        // テーマが変更されたらグラフを再描画
        setTimeout(() => this.updateChart(), 100);
      }
    });
    
    // data-theme属性の変更を監視
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }

  // 日付範囲を計算
  calculateDateRange(): { rangeStart: Date; rangeEnd: Date } {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    let rangeStart: Date;
    let rangeEnd: Date;

    if (this.timeRange === 'thisWeek') {
      // 今週の開始（月曜日）と終了（日曜日）
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      rangeStart = new Date(now);
      rangeStart.setDate(now.getDate() + mondayOffset);
      rangeStart.setHours(0, 0, 0, 0);
      
      rangeEnd = new Date(rangeStart);
      rangeEnd.setDate(rangeStart.getDate() + 6);
      rangeEnd.setHours(23, 59, 59, 999);
    } else if (this.timeRange === 'lastWeek') {
      // 先週の開始（月曜日）と終了（日曜日）
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      rangeStart = new Date(now);
      rangeStart.setDate(now.getDate() + mondayOffset - 7);
      rangeStart.setHours(0, 0, 0, 0);
      
      rangeEnd = new Date(rangeStart);
      rangeEnd.setDate(rangeStart.getDate() + 6);
      rangeEnd.setHours(23, 59, 59, 999);
    } else if (this.timeRange === 'thisMonth') {
      // 今月の開始と終了
      rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
      rangeStart.setHours(0, 0, 0, 0);
      
      rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      rangeEnd.setHours(23, 59, 59, 999);
    } else if (this.timeRange === 'lastMonth') {
      // 先月の開始と終了
      rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      rangeStart.setHours(0, 0, 0, 0);
      
      rangeEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      rangeEnd.setHours(23, 59, 59, 999);
    } else if (this.timeRange === 'last3Months') {
      // 過去3か月の開始と終了
      rangeStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      rangeStart.setHours(0, 0, 0, 0);
      
      rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      rangeEnd.setHours(23, 59, 59, 999);
    } else if (this.timeRange === 'custom') {
      // カスタム期間
      if (this.customStartDate && this.customEndDate) {
        rangeStart = new Date(this.customStartDate);
        rangeStart.setHours(0, 0, 0, 0);
        
        rangeEnd = new Date(this.customEndDate);
        rangeEnd.setHours(23, 59, 59, 999);
      } else {
        // カスタム期間が設定されていない場合は今週をデフォルト
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        rangeStart = new Date(now);
        rangeStart.setDate(now.getDate() + mondayOffset);
        rangeStart.setHours(0, 0, 0, 0);
        
        rangeEnd = new Date(rangeStart);
        rangeEnd.setDate(rangeStart.getDate() + 6);
        rangeEnd.setHours(23, 59, 59, 999);
      }
    } else {
      // デフォルトは今週
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      rangeStart = new Date(now);
      rangeStart.setDate(now.getDate() + mondayOffset);
      rangeStart.setHours(0, 0, 0, 0);
      
      rangeEnd = new Date(rangeStart);
      rangeEnd.setDate(rangeStart.getDate() + 6);
      rangeEnd.setHours(23, 59, 59, 999);
    }

    return { rangeStart, rangeEnd };
  }

  async loadStatistics() {
    try {
      const user = this.authService.currentUser;
      if (!user) {
        this.isLoading = false;
        return;
      }

      this.isLoading = true;

      // 日付範囲を計算
      const { rangeStart, rangeEnd } = this.calculateDateRange();

      // 個人/チームモードに応じてタスクを取得
      // 完了タスクは削除済みでも含めるため、削除済みの完了タスクも取得
      let allTasks: Task[] = [];
      
      if (this.viewMode === 'personal') {
        // 個人モード: 自分が作成したタスク または 所属チームのタスクで自分が担当者
        // 削除されていないタスクを取得
        const nonDeletedTasks = await this.taskService.getTasks({
          isDeleted: false,
          teamId: null,
          userId: user.uid,
          userTeamIds: this.userTeamIds
        });
        
        // 完了したタスクは削除済みでも含める
        const deletedCompletedTasks = await this.taskService.getTasks({
          status: [TaskStatus.Completed],
          isDeleted: true,
          teamId: null,
          userId: user.uid,
          userTeamIds: this.userTeamIds
        });
        
        allTasks = [...nonDeletedTasks, ...deletedCompletedTasks];
      } else if (this.viewMode === 'team' && this.selectedTeamId) {
        // チームタスク（teamIdが一致）
        const nonDeletedTasks = await this.taskService.getTasks({
          isDeleted: false,
          teamId: this.selectedTeamId
        });
        
        // 完了したタスクは削除済みでも含める
        const deletedCompletedTasks = await this.taskService.getTasks({
          status: [TaskStatus.Completed],
          isDeleted: true,
          teamId: this.selectedTeamId
        });
        
        allTasks = [...nonDeletedTasks, ...deletedCompletedTasks];
      }

      // 範囲内のタスクをフィルタリング
      // 未着手・進行中で削除されたタスクは除外
      const tasksInRange = allTasks.filter(task => {
        // 未着手・進行中で削除されたタスクは除外
        if (task.isDeleted && task.status !== TaskStatus.Completed) {
          return false;
        }
        
        // 完了タスクは完了日で判定
        if (task.status === TaskStatus.Completed && task.completedAt) {
          const completedAt = task.completedAt.toDate();
          const completedAtOnly = new Date(completedAt.getFullYear(), completedAt.getMonth(), completedAt.getDate());
          const rangeStartOnly = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
          const rangeEndOnly = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
          return completedAtOnly >= rangeStartOnly && completedAtOnly <= rangeEndOnly;
        }
        
        // 未完了タスクは選択されたパターンで判定
        const rangeStartOnly = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
        const rangeEndOnly = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
        
        if (this.filterPattern === 'endDate') {
          // 終了日基準：期限日が範囲内にあるか判定
          const endDate = task.endDate.toDate();
          const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
          return endDateOnly >= rangeStartOnly && endDateOnly <= rangeEndOnly;
        } else if (this.filterPattern === 'startDate') {
          // 開始日基準：開始日が範囲内にあるか判定
          const startDate = task.startDate.toDate();
          const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
          return startDateOnly >= rangeStartOnly && startDateOnly <= rangeEndOnly;
        } else {
          // 重複ベース：期間が重なっていれば含める（startDate <= rangeEnd && endDate >= rangeStart）
          const startDate = task.startDate.toDate();
          const endDate = task.endDate.toDate();
          const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
          const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
          return startDateOnly <= rangeEndOnly && endDateOnly >= rangeStartOnly;
        }
      });

      // 統計を計算
      this.statistics.totalTasks = tasksInRange.length;
      this.statistics.completedTasks = tasksInRange.filter(
        t => t.status === TaskStatus.Completed
      ).length;
      this.statistics.completionRate = this.statistics.totalTasks > 0
        ? Math.round((this.statistics.completedTasks / this.statistics.totalTasks) * 100)
        : 0;

      // 作業時間を計算（判定基準に左右されず、時間範囲のみで計算）
      const rangeStartOnly = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
      const rangeEndOnly = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
      
      this.statistics.totalWorkTime = allTasks
        .reduce((sum, task) => {
          const sessionsInRange = (task.workSessions || []).filter(session => {
            // 未完了のセッションは除外
            if (!session.endTime) return false;
            
            const sessionDate = session.endTime.toDate();
            const sessionDateOnly = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());
            
            // セッションの終了日が範囲内にあるか判定（判定基準とは関係なく）
            return sessionDateOnly >= rangeStartOnly && sessionDateOnly <= rangeEndOnly;
          });
          
          // 範囲内のセッションの実際の作業時間を合計
          const sessionTime = sessionsInRange.reduce((s, session) => s + (session.actualDuration || 0), 0);
          return sum + sessionTime;
        }, 0);

      // 遅延タスク（期限が過ぎているが未完了のタスク）
      this.delayedTasksList = tasksInRange.filter(task => {
        if (task.status === TaskStatus.Completed) {
          return false;
        }
        const endDate = task.endDate.toDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return endDate < today;
      });
      this.statistics.delayedTasks = this.delayedTasksList.length;

      // 個人/チームモードに応じてプロジェクトを取得
      // 完了プロジェクトは削除済みでも含める
      const nonDeletedProjects = await this.projectService.getProjectsForUser(
        user.uid,
        this.viewMode === 'team' ? this.selectedTeamId : null,
        this.userTeamIds
      );
      
      // 完了したプロジェクトは削除済みでも含める
      // 注: 現在は削除されていないプロジェクトのみで処理
      // 削除済みの完了プロジェクトも取得する場合は、ProjectServiceにメソッドを追加する必要がある
      const projects = nonDeletedProjects.filter(project => {
        // 未着手・進行中で削除されたプロジェクトは除外
        if (project.isDeleted && project.status !== ProjectStatus.Completed) {
          return false;
        }
        return true;
      });
      
      this.projectStatistics = projects.map(project => {
        const projectTasks = tasksInRange.filter(
          t => t.projectId === project.id
        );
        
        const completedProjectTasks = projectTasks.filter(
          t => t.status === TaskStatus.Completed
        );
        
        // プロジェクト別の作業時間（判定基準に左右されず、時間範囲のみで計算）
        const projectAllTasks = allTasks.filter(
          t => t.projectId === project.id
        );
        
        const totalWorkTime = projectAllTasks.reduce((sum, task) => {
          const sessionsInRange = (task.workSessions || []).filter(session => {
            // 未完了のセッションは除外
            if (!session.endTime) return false;
            
            const sessionDate = session.endTime.toDate();
            const sessionDateOnly = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());
            
            // セッションの終了日が範囲内にあるか判定（判定基準とは関係なく）
            return sessionDateOnly >= rangeStartOnly && sessionDateOnly <= rangeEndOnly;
          });
          
          // 範囲内のセッションの実際の作業時間を合計
          const sessionTime = sessionsInRange.reduce((s, session) => s + (session.actualDuration || 0), 0);
          return sum + sessionTime;
        }, 0);
        
        const completionRate = projectTasks.length > 0
          ? Math.round((completedProjectTasks.length / projectTasks.length) * 100)
          : 0;

        return {
          project,
          totalTasks: projectTasks.length,
          completedTasks: completedProjectTasks.length,
          completionRate,
          totalWorkTime
        };
      }).filter(ps => ps.totalTasks > 0); // タスクがあるプロジェクトのみ表示

      // 日別作業時間データを集計
      // 統計期間が1か月を超える場合は週単位、それ以外は日単位
      const daysDiff = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      if (daysDiff > 31) {
        this.dailyWorkTimeData = this.calculateWeeklyWorkTime(allTasks, rangeStart, rangeEnd);
      } else {
        this.dailyWorkTimeData = this.calculateDailyWorkTime(allTasks, rangeStart, rangeEnd);
      }

      this.isLoading = false;
      
      // グラフを更新
      setTimeout(() => this.updateChart(), 100);
    } catch (error: any) {
      console.error('Error loading statistics:', error);
      this.isLoading = false;
    }
  }

  calculateDailyWorkTime(tasks: Task[], rangeStart: Date, rangeEnd: Date): { date: string; seconds: number }[] {
    const rangeStartOnly = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
    const rangeEndOnly = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
    
    // 日付マップを作成
    const dailyMap = new Map<string, number>();
    
    // 範囲内のすべての日付を初期化
    const currentDate = new Date(rangeStartOnly);
    while (currentDate <= rangeEndOnly) {
      const dateKey = this.formatDateKey(currentDate);
      dailyMap.set(dateKey, 0);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // すべてのタスクの作業セッションを処理
    tasks.forEach(task => {
      (task.workSessions || []).forEach(session => {
        if (!session.endTime) return;
        
        const sessionDate = session.endTime.toDate();
        const sessionDateOnly = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());
        
        // 範囲内のセッションのみを集計
        if (sessionDateOnly >= rangeStartOnly && sessionDateOnly <= rangeEndOnly) {
          const dateKey = this.formatDateKey(sessionDateOnly);
          const currentSeconds = dailyMap.get(dateKey) || 0;
          dailyMap.set(dateKey, currentSeconds + (session.actualDuration || 0));
        }
      });
    });
    
    // 日付順にソートして配列に変換
    return Array.from(dailyMap.entries())
      .map(([date, seconds]) => ({ date, seconds }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  calculateWeeklyWorkTime(tasks: Task[], rangeStart: Date, rangeEnd: Date): { date: string; seconds: number }[] {
    const rangeStartOnly = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
    const rangeEndOnly = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
    
    // 週マップを作成（週の開始日（月曜日）をキーとする）
    const weeklyMap = new Map<string, number>();
    
    // 範囲内のすべての週を初期化
    const currentDate = new Date(rangeStartOnly);
    while (currentDate <= rangeEndOnly) {
      // 週の開始日（月曜日）を計算
      const dayOfWeek = currentDate.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const weekStart = new Date(currentDate);
      weekStart.setDate(currentDate.getDate() + mondayOffset);
      weekStart.setHours(0, 0, 0, 0);
      
      const weekKey = this.formatDateKey(weekStart);
      if (!weeklyMap.has(weekKey)) {
        weeklyMap.set(weekKey, 0);
      }
      
      currentDate.setDate(currentDate.getDate() + 7);
    }
    
    // すべてのタスクの作業セッションを処理
    tasks.forEach(task => {
      (task.workSessions || []).forEach(session => {
        if (!session.endTime) return;
        
        const sessionDate = session.endTime.toDate();
        const sessionDateOnly = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());
        
        // 範囲内のセッションのみを集計
        if (sessionDateOnly >= rangeStartOnly && sessionDateOnly <= rangeEndOnly) {
          // セッションが属する週の開始日（月曜日）を計算
          const dayOfWeek = sessionDateOnly.getDay();
          const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
          const weekStart = new Date(sessionDateOnly);
          weekStart.setDate(sessionDateOnly.getDate() + mondayOffset);
          weekStart.setHours(0, 0, 0, 0);
          
          const weekKey = this.formatDateKey(weekStart);
          const currentSeconds = weeklyMap.get(weekKey) || 0;
          weeklyMap.set(weekKey, currentSeconds + (session.actualDuration || 0));
        }
      });
    });
    
    // 日付順にソートして配列に変換
    return Array.from(weeklyMap.entries())
      .map(([date, seconds]) => ({ date, seconds }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  formatDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatDateLabel(dateKey: string): string {
    const date = new Date(dateKey + 'T00:00:00');
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    // 統計期間が1か月を超える場合は週単位のラベルを返す
    const { rangeStart, rangeEnd } = this.calculateDateRange();
    const daysDiff = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    if (daysDiff > 31) {
      // 週単位のラベル（週の開始日のみ表示）
      return `${month}/${day}`;
    } else {
      // 日単位のラベル
      return `${month}/${day}`;
    }
  }

  updateChart() {
    if (!this.chartCanvas) return;
    
    // 既存のグラフを破棄
    if (this.workTimeChart) {
      this.workTimeChart.destroy();
    }
    
    // CSS変数から色を取得
    const root = document.documentElement;
    const primaryColor = getComputedStyle(root).getPropertyValue('--color-primary').trim() || '#667eea';
    const textColor = getComputedStyle(root).getPropertyValue('--color-text').trim() || '#333333';
    const textSecondaryColor = getComputedStyle(root).getPropertyValue('--color-text-secondary').trim() || '#666666';
    const borderColor = getComputedStyle(root).getPropertyValue('--color-border').trim() || '#e0e0e0';
    
    // プライマリカラーをRGBに変換（rgba用）
    const primaryRgb = this.hexToRgb(primaryColor) || { r: 102, g: 126, b: 234 };
    const primaryRgba = `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.1)`;
    
    const labels = this.dailyWorkTimeData.map(d => this.formatDateLabel(d.date));
    // 秒を分に変換（29秒以下は切り捨て、30秒以上は切り上げ）
    const data = this.dailyWorkTimeData.map(d => {
      const remainder = d.seconds % 60;
      return Math.floor(d.seconds / 60) + (remainder >= 30 ? 1 : 0);
    });
    
    const config: ChartConfiguration = {
      type: 'line' as ChartType,
      data: {
        labels: labels,
        datasets: [{
          label: '作業時間（分）',
          data: data,
          borderColor: primaryColor,
          backgroundColor: primaryRgba,
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: textColor
            }
          },
          title: {
            display: true,
            text: '作業時間の推移',
            color: textColor
          }
        },
        scales: {
          x: {
            ticks: {
              color: textSecondaryColor
            },
            grid: {
              color: borderColor
            }
          },
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 30, // 30分ごとに目盛り
              color: textSecondaryColor,
              callback: function(value: any) {
                // 常に整数に丸めて表示
                const intValue = Math.round(value);
                return intValue + '分';
              }
            },
            grid: {
              color: borderColor
            }
          }
        }
      }
    };
    
    this.workTimeChart = new Chart(this.chartCanvas.nativeElement, config);
  }

  // ヘックスカラーをRGBに変換するヘルパーメソッド
  hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    // #を削除
    const cleanHex = hex.replace('#', '');
    
    // 3桁の場合は6桁に変換
    const fullHex = cleanHex.length === 3 
      ? cleanHex.split('').map(char => char + char).join('')
      : cleanHex;
    
    const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  switchTimeRange(range: 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'last3Months' | 'custom') {
    this.timeRange = range;
    if (range === 'custom') {
      this.openCustomRangeModal();
    } else {
      this.loadStatistics();
    }
  }

  openCustomRangeModal() {
    // カスタム期間のデフォルト値を設定（過去30日間）
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 29);
    
    this.customEndDate = this.formatDateForInput(endDate);
    this.customStartDate = this.formatDateForInput(startDate);
    this.customRangeError = '';
    this.showCustomRangeModal = true;
  }

  closeCustomRangeModal() {
    this.showCustomRangeModal = false;
    this.customRangeError = '';
  }

  formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async applyCustomRange() {
    if (!this.customStartDate || !this.customEndDate) {
      this.customRangeError = '開始日と終了日を入力してください';
      return;
    }

    const startDate = new Date(this.customStartDate);
    const endDate = new Date(this.customEndDate);

    if (startDate > endDate) {
      this.customRangeError = '開始日は終了日より前である必要があります';
      return;
    }

    // 最長92日間の制限
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (daysDiff > 92) {
      this.customRangeError = 'カスタム期間は最長92日間までです';
      return;
    }

    this.closeCustomRangeModal();
    await this.loadStatistics();
  }

  getTimeRangeLabel(): string {
    switch (this.timeRange) {
      case 'thisWeek':
        return '今週';
      case 'lastWeek':
        return '先週';
      case 'thisMonth':
        return '今月';
      case 'lastMonth':
        return '先月';
      case 'last3Months':
        return '過去3か月';
      case 'custom':
        if (this.customStartDate && this.customEndDate) {
          const start = new Date(this.customStartDate);
          const end = new Date(this.customEndDate);
          return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
        }
        return 'カスタム';
      default:
        return '今週';
    }
  }

  getDateRangeLabel(): string {
    const { rangeStart, rangeEnd } = this.calculateDateRange();
    const startStr = `${rangeStart.getFullYear()}年${rangeStart.getMonth() + 1}月${rangeStart.getDate()}日`;
    const endStr = `${rangeEnd.getFullYear()}年${rangeEnd.getMonth() + 1}月${rangeEnd.getDate()}日`;
    return `${startStr} ～ ${endStr}`;
  }

  switchFilterPattern(pattern: 'endDate' | 'startDate' | 'overlap') {
    this.filterPattern = pattern;
    this.loadStatistics();
  }

  getFilterPatternLabel(): string {
    switch (this.filterPattern) {
      case 'endDate':
        return '期限日基準';
      case 'startDate':
        return '開始日基準';
      case 'overlap':
        return '重複ベース';
      default:
        return '期限日基準';
    }
  }

  formatTime(seconds: number): string {
    // 秒を分に変換（29秒以下は切り捨て、30秒以上は切り上げ）
    const remainder = seconds % 60;
    const minutes = Math.floor(seconds / 60) + (remainder >= 30 ? 1 : 0);
    
    if (minutes < 60) {
      return `${minutes}分`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}時間${mins}分` : `${hours}時間`;
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/home']);
    }
  }


  toggleDelayedTasksDetails() {
    this.showDelayedTasksDetails = !this.showDelayedTasksDetails;
  }

  viewTaskDetail(taskId: string) {
    this.router.navigate(['/task', taskId], { queryParams: { from: 'statistics' } });
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
}

