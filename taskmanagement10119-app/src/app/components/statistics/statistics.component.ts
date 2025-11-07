import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Chart, ChartConfiguration, ChartType, registerables } from 'chart.js';
import { AuthService } from '../../services/auth.service';
import { TaskService } from '../../services/task.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { Task, TaskStatus } from '../../models/task.model';
import { Project } from '../../models/project.model';
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
  imports: [CommonModule],
  templateUrl: './statistics.component.html',
  styleUrl: './statistics.component.css'
})
export class StatisticsComponent implements OnInit, AfterViewInit {
  @ViewChild('workTimeChart') chartCanvas!: ElementRef<HTMLCanvasElement>;
  
  private authService = inject(AuthService);
  private router = inject(Router);
  private taskService = inject(TaskService);
  private projectService = inject(ProjectService);
  private teamService = inject(TeamService);

  timeRange: 'week' | 'month' = 'week';
  filterPattern: 'endDate' | 'startDate' | 'overlap' = 'endDate'; // デフォルトは終了日基準
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
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      let rangeStart: Date;
      let rangeEnd: Date;

      if (this.timeRange === 'week') {
        // 今週の開始（月曜日）と終了（日曜日）
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        rangeStart = new Date(now);
        rangeStart.setDate(now.getDate() + mondayOffset);
        rangeStart.setHours(0, 0, 0, 0);
        
        rangeEnd = new Date(rangeStart);
        rangeEnd.setDate(rangeStart.getDate() + 6);
        rangeEnd.setHours(23, 59, 59, 999);
      } else {
        // 今月の開始と終了
        rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
        rangeStart.setHours(0, 0, 0, 0);
        
        rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        rangeEnd.setHours(23, 59, 59, 999);
      }

      // 個人/チームモードに応じてタスクを取得
      let allTasks: Task[];
      if (this.viewMode === 'personal') {
        // 個人モード: 自分が作成したタスク または 所属チームのタスクで自分が担当者
        allTasks = await this.taskService.getTasks({
          isDeleted: false,
          teamId: null,
          userId: user.uid,
          userTeamIds: this.userTeamIds
        });
      } else if (this.viewMode === 'team' && this.selectedTeamId) {
        // チームタスク（teamIdが一致）
        allTasks = await this.taskService.getTasks({
          isDeleted: false,
          teamId: this.selectedTeamId
        });
      } else {
        allTasks = [];
      }

      // 範囲内のタスクをフィルタリング
      const tasksInRange = allTasks.filter(task => {
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
      const projects = await this.projectService.getProjectsForUser(
        user.uid,
        this.viewMode === 'team' ? this.selectedTeamId : null,
        this.userTeamIds
      );
      
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
      this.dailyWorkTimeData = this.calculateDailyWorkTime(allTasks, rangeStart, rangeEnd);

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
    return `${month}/${day}`;
  }

  updateChart() {
    if (!this.chartCanvas) return;
    
    // 既存のグラフを破棄
    if (this.workTimeChart) {
      this.workTimeChart.destroy();
    }
    
    const labels = this.dailyWorkTimeData.map(d => this.formatDateLabel(d.date));
    const data = this.dailyWorkTimeData.map(d => Math.ceil(d.seconds / 60)); // 秒を分に変換して切り上げ
    
    const config: ChartConfiguration = {
      type: 'line' as ChartType,
      data: {
        labels: labels,
        datasets: [{
          label: '作業時間（分）',
          data: data,
          borderColor: 'rgb(33, 150, 243)',
          backgroundColor: 'rgba(33, 150, 243, 0.1)',
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
            position: 'top'
          },
          title: {
            display: true,
            text: '作業時間の推移'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 30, // 30分ごとに目盛り
              callback: function(value: any) {
                // 常に整数に丸めて表示
                const intValue = Math.round(value);
                return intValue + '分';
              }
            }
          }
        }
      }
    };
    
    this.workTimeChart = new Chart(this.chartCanvas.nativeElement, config);
  }

  switchTimeRange(range: 'week' | 'month') {
    this.timeRange = range;
    this.loadStatistics();
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
    // 秒を分に変換して切り上げ
    const minutes = Math.ceil(seconds / 60);
    
    if (minutes < 60) {
      return `${minutes}分`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}時間${mins}分` : `${hours}時間`;
  }

  goBack() {
    this.router.navigate(['/home']);
  }

  getTimeRangeLabel(): string {
    return this.timeRange === 'week' ? '今週' : '今月';
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

