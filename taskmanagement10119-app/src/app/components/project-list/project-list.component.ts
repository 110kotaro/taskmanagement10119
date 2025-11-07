import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Timestamp } from 'firebase/firestore';
import { ProjectService } from '../../services/project.service';
import { AuthService } from '../../services/auth.service';
import { TeamService } from '../../services/team.service';
import { Project, ProjectStatus } from '../../models/project.model';
import { Team } from '../../models/team.model';

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './project-list.component.html',
  styleUrl: './project-list.component.css'
})
export class ProjectListComponent implements OnInit {
  private projectService = inject(ProjectService);
  private authService = inject(AuthService);
  private teamService = inject(TeamService);
  private router = inject(Router);

  projects: Project[] = [];
  isLoading = true;

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
      this.loadProjects();
    });
    
    await this.loadProjects();
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

  async loadProjects() {
    try {
      const user = this.authService.currentUser;
      if (!user) {
        this.isLoading = false;
        return;
      }

      // 個人/チームモードに応じてプロジェクトを取得
      this.projects = await this.projectService.getProjectsForUser(
        user.uid,
        this.viewMode === 'team' ? this.selectedTeamId : null,
        this.userTeamIds
      );
      
      // 各プロジェクトの完了率を再計算
      const recalculationPromises = this.projects.map(async (project) => {
        try {
          await this.projectService.recalculateProjectCompletionRate(project.id);
        } catch (error) {
          console.error(`Error recalculating completion rate for project ${project.id}:`, error);
        }
      });
      
      // すべての再計算が完了するまで待つ
      await Promise.all(recalculationPromises);
      
      // 再計算後にプロジェクト情報を再取得
      this.projects = await this.projectService.getProjectsForUser(
        user.uid,
        this.viewMode === 'team' ? this.selectedTeamId : null,
        this.userTeamIds
      );
      
      this.isLoading = false;
    } catch (error) {
      console.error('Error loading projects:', error);
      this.isLoading = false;
    }
  }

  formatDate(timestamp: any): string {
    const date = timestamp.toDate();
    return date.toLocaleDateString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  getStatusLabel(status: string | ProjectStatus): string {
    const statusMap: { [key: string]: string } = {
      'not_started': '準備中',
      'in_progress': '進行中',
      'completed': '完了'
    };
    return statusMap[status as string] || status;
  }

  openCreateModal() {
    // プロジェクト作成ページに遷移
    this.router.navigate(['/projects/create']);
  }


  viewProject(projectId: string) {
    this.router.navigate(['/project', projectId]);
  }

  goBack() {
    this.router.navigate(['/home']);
  }
}

