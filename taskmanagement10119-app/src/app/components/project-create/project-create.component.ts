import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Timestamp } from 'firebase/firestore';
import { AuthService } from '../../services/auth.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { Team, TeamMember } from '../../models/team.model';

@Component({
  selector: 'app-project-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './project-create.component.html',
  styleUrl: './project-create.component.css'
})
export class ProjectCreateComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private authService = inject(AuthService);
  private projectService = inject(ProjectService);
  private fb = inject(FormBuilder);

  createForm: FormGroup;
  isCreating = false;

  // 個人/チーム切り替え状態（サイドバーから取得）
  viewMode: 'personal' | 'team' = 'personal';
  selectedTeamId: string | null = null;
  userTeams: Team[] = [];
  
  // 担当者選択用
  teamMembers: TeamMember[] = [];
  selectedAssigneeId: string = '';

  private teamService = inject(TeamService);

  constructor() {
    this.createForm = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      startDate: ['', Validators.required],
      endDate: ['', Validators.required],
      assigneeId: ['']
    });

    // デフォルト値（今日と3ヶ月後）
    const today = new Date();
    const threeMonthsLater = new Date();
    threeMonthsLater.setMonth(today.getMonth() + 3);

    this.createForm.patchValue({
      startDate: this.formatDateForInput(today),
      endDate: this.formatDateForInput(threeMonthsLater)
    });
  }

  async ngOnInit() {
    await this.loadUserTeams();
    
    // localStorageから初期状態を取得
    this.loadViewModeStateFromStorage();
    
    // チームメンバーを読み込む（viewModeとselectedTeamIdが設定された後）
    await this.loadTeamMembers();
    
    // 個人/チーム切り替えの変更を監視
    window.addEventListener('viewModeChanged', (event: any) => {
      if (event.detail) {
        this.viewMode = event.detail.viewMode;
        this.selectedTeamId = event.detail.selectedTeamId;
      }
      this.loadTeamMembers();
    });
    
    // クエリパラメータから複製情報を取得
    const queryParams = this.route.snapshot.queryParamMap;
    
    if (queryParams.get('duplicate') === 'true') {
      this.loadDuplicateData(queryParams);
      // 複製データ読み込み後にもチームメンバーを読み込む
      await this.loadTeamMembers();
    }
  }

  loadDuplicateData(queryParams: any) {
    const formData: any = {};

    if (queryParams.get('name')) formData.name = queryParams.get('name');
    if (queryParams.get('description')) formData.description = queryParams.get('description');
    if (queryParams.get('startDate')) formData.startDate = queryParams.get('startDate');
    if (queryParams.get('endDate')) formData.endDate = queryParams.get('endDate');
    
    // チーム情報
    const viewModeParam = queryParams.get('viewMode');
    const teamIdParam = queryParams.get('teamId');
    if (viewModeParam === 'team' && teamIdParam) {
      this.viewMode = 'team';
      this.selectedTeamId = teamIdParam;
    } else if (viewModeParam === 'personal') {
      this.viewMode = 'personal';
      this.selectedTeamId = null;
    }

    this.createForm.patchValue(formData);
  }

  loadViewModeStateFromStorage() {
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
        
        // チームモードで選択中のチームがない場合は最初のチームを選択
        if (this.viewMode === 'team' && !this.selectedTeamId && this.userTeams.length > 0) {
          this.selectedTeamId = this.userTeams[0].id;
        }
      }
    } catch (error) {
      console.error('Error loading teams:', error);
    }
  }

  async loadTeamMembers() {
    if (this.viewMode === 'team' && this.selectedTeamId) {
      try {
        const team = await this.teamService.getTeam(this.selectedTeamId);
        if (team) {
          this.teamMembers = team.members;
        } else {
          this.teamMembers = [];
        }
      } catch (error) {
        console.error('Error loading team members:', error);
        this.teamMembers = [];
      }
    } else {
      this.teamMembers = [];
    }
  }

  onTeamChange() {
    this.loadTeamMembers();
    this.selectedAssigneeId = '';
    this.createForm.patchValue({ assigneeId: '' });
  }

  formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async onCreate() {
    if (!this.createForm.valid) {
      alert('必須項目を入力してください');
      return;
    }

    try {
      this.isCreating = true;
      const formValue = this.createForm.value;
      
      // 日付のバリデーション
      const startDate = new Date(formValue.startDate);
      const endDate = new Date(formValue.endDate);
      if (endDate.getTime() < startDate.getTime()) {
        alert('終了日は開始日より後である必要があります');
        this.isCreating = false;
        return;
      }
      
      // チームモード時のみチーム情報を設定
      let teamId: string | undefined = undefined;
      let teamName: string | undefined = undefined;
      let assigneeId: string | undefined = undefined;
      let assigneeName: string | undefined = undefined;
      
      if (this.viewMode === 'team' && this.selectedTeamId) {
        const selectedTeam = this.userTeams.find(t => t.id === this.selectedTeamId);
        if (selectedTeam) {
          teamId = selectedTeam.id;
          teamName = selectedTeam.name;
        }
        
        // 担当者が選択されている場合
        if (formValue.assigneeId) {
          const selectedMember = this.teamMembers.find(m => m.userId === formValue.assigneeId);
          if (selectedMember) {
            assigneeId = selectedMember.userId;
            assigneeName = selectedMember.userName;
          }
        }
      }
      
      const projectId = await this.projectService.createProject({
        name: formValue.name,
        description: formValue.description,
        startDate: Timestamp.fromDate(new Date(formValue.startDate)),
        endDate: Timestamp.fromDate(new Date(formValue.endDate))
      }, teamId, teamName, assigneeId, assigneeName);

      alert('プロジェクトを作成しました！');
      this.router.navigate(['/project', projectId]);
    } catch (error: any) {
      alert('プロジェクトの作成に失敗しました: ' + error.message);
    } finally {
      this.isCreating = false;
    }
  }

  getUserTeamName(teamId: string | null): string {
    if (!teamId) return '';
    const team = this.userTeams.find(t => t.id === teamId);
    return team?.name || '';
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      // 履歴がない場合はプロジェクト一覧に戻る
      this.router.navigate(['/projects']);
    }
  }
}

