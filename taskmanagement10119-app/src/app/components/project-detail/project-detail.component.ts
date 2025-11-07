import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Timestamp } from 'firebase/firestore';
import { ProjectService } from '../../services/project.service';
import { TaskService } from '../../services/task.service';
import { TeamService } from '../../services/team.service';
import { AuthService } from '../../services/auth.service';
import { StorageService } from '../../services/storage.service';
import { Project, ProjectRole, ProjectStatus } from '../../models/project.model';
import { Task } from '../../models/task.model';
import { Team, TeamMember } from '../../models/team.model';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './project-detail.component.html',
  styleUrl: './project-detail.component.css'
})
export class ProjectDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private projectService = inject(ProjectService);
  private taskService = inject(TaskService);

  project: Project | null = null;
  tasks: Task[] = [];
  isLoading = true;

  isOwner = false;
  // isAdmin = false; // 削除（チーム管理者判定に変更）
  canEdit = false;
  canManageMembers = false;
  isFromArchive = false; // アーカイブから遷移したかどうか
  userTeams: Team[] = [];
  showEditModal = false;
  
  teamMembers: TeamMember[] = []; // チームメンバー（プロジェクトにteamIdがある場合）
  selectedMemberId = '';
  selectedRole = ProjectRole.Member;
  showMemberModal = false;
  
  // 編集用のフォームデータ
  editFormData = {
    name: '',
    startDate: '',
    endDate: '',
    assigneeId: '',
    status: ProjectStatus.NotStarted
  };
  
  ProjectStatus = ProjectStatus; // テンプレートで使用するため
  
  // 編集用の担当者選択
  editTeamMembers: TeamMember[] = []; // 編集モーダル用のチームメンバー

  showDeleteModal = false;
  taskDeletionMode: 'all' | 'partial' | 'none' = 'none';
  selectedTaskIdsForDeletion: Set<string> = new Set();

  // ファイル関連
  selectedFiles: File[] = [];
  isUploadingFiles = false;

  ProjectRole = ProjectRole; // テンプレートで使用するため

  authService = inject(AuthService); // テンプレートで使用するためpublic
  private teamService = inject(TeamService);
  private storageService = inject(StorageService);

  async ngOnInit() {
    const projectId = this.route.snapshot.paramMap.get('id');
    if (projectId) {
      await this.loadProject(projectId);
      
      // 終了日延長のクエリパラメータをチェック
      const extendEndDate = this.route.snapshot.queryParamMap.get('extendEndDate');
      if (extendEndDate === 'true' && this.canEdit) {
        // プロジェクト読み込み後に編集モーダルを開く
        this.openEditModal();
      }
    }
  }

  async loadProject(projectId: string) {
    try {
      this.isLoading = true;
      this.project = await this.projectService.getProject(projectId);
      
      // クエリパラメーターから遷移元を確認
      const from = this.route.snapshot.queryParamMap.get('from');
      this.isFromArchive = from === 'archive';
      
      // プロジェクトに関連するタスクを読み込む
      if (this.project) {
        this.tasks = await this.taskService.getTasks({ 
          projectId: projectId,
          isDeleted: false 
        });
        
        // プロジェクトの完了率を再計算して最新の状態を反映
        await this.projectService.recalculateProjectCompletionRate(projectId);
        
        // 再計算後にプロジェクト情報を再取得
        this.project = await this.projectService.getProject(projectId);
        
        // プロジェクトが削除されているか確認
        const isDeleted = this.project?.isDeleted === true;
        
        // アーカイブから来た場合、またはプロジェクトが削除されている場合は編集・削除を無効化
        if (this.isFromArchive || isDeleted) {
          this.canEdit = false;
          this.canManageMembers = false;
        } else {
          // 権限チェック
          const user = this.authService.currentUser;
          if (user && this.project) {
            this.isOwner = this.project.ownerId === user.uid;
            const member = this.project.members?.find(m => m.userId === user.uid);
            // isAdmin は削除（チーム管理者判定に変更）
            this.canEdit = await this.projectService.canEditProject(projectId, user.uid);
            this.canManageMembers = await this.projectService.canManageMembers(projectId, user.uid);
            
            // チーム一覧を取得（メンバー管理用）
            if (this.canEdit) {
              this.userTeams = await this.teamService.getTeamsForUser(user.uid);
            }
            
            // チームメンバーを取得（プロジェクトにteamIdがある場合、メンバー管理用）
            if (this.project.teamId && this.canManageMembers) {
              try {
                const team = await this.teamService.getTeam(this.project.teamId);
                if (team) {
                  // 既存のプロジェクトメンバーを除外
                  const existingMemberIds = this.project.members?.map(m => m.userId) || [];
                  this.teamMembers = team.members.filter(m => !existingMemberIds.includes(m.userId));
                } else {
                  this.teamMembers = [];
                }
              } catch (error) {
                console.error('Error loading team members:', error);
                this.teamMembers = [];
              }
            } else {
              // プロジェクトにteamIdがない場合、または権限がない場合は空配列
              this.teamMembers = [];
            }
          }
        }
      }
      
      this.isLoading = false;
    } catch (error) {
      console.error('Error loading project:', error);
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

  formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  onDuplicate() {
    if (!this.project) return;

    // プロジェクト作成画面に遷移し、複製情報をクエリパラメータで渡す
    const queryParams: any = {
      duplicate: 'true',
      from: this.route.snapshot.queryParamMap.get('from') || 'project-detail'
    };

    // プロジェクト情報をクエリパラメータに追加
    queryParams.name = `${this.project.name} (複製)`;
    if (this.project.description) queryParams.description = this.project.description;
    
    // 日付をフォーマット（YYYY-MM-DD形式）
    const startDate = this.project.startDate.toDate();
    queryParams.startDate = this.formatDateForInput(startDate);
    
    const endDate = this.project.endDate.toDate();
    queryParams.endDate = this.formatDateForInput(endDate);
    
    // チーム情報も引き継ぐ
    if (this.project.teamId) {
      queryParams.teamId = this.project.teamId;
      queryParams.viewMode = 'team';
    } else {
      queryParams.viewMode = 'personal';
    }

    this.router.navigate(['/projects/create'], { queryParams });
  }

  getStatusLabel(status: string | ProjectStatus): string {
    const statusMap: { [key: string]: string } = {
      'not_started': '準備中',
      'in_progress': '進行中',
      'completed': '完了'
    };
    return statusMap[status as string] || status;
  }

  getPriorityLabel(priority: string): string {
    const priorityMap: { [key: string]: string } = {
      'important': '重要',
      'normal': '普通',
      'low': '低め',
      'none': 'なし'
    };
    return priorityMap[priority] || priority;
  }

  viewTask(taskId: string) {
    this.router.navigate(['/task', taskId]);
  }

  goBack() {
    // どこから来たかを確認して戻る
    const from = this.route.snapshot.queryParamMap.get('from');
    if (from === 'gantt') {
      this.router.navigate(['/gantt']);
    } else {
      this.router.navigate(['/projects']);
    }
  }

  createTask() {
    if (this.project) {
      this.router.navigate(['/task/create'], { 
        queryParams: { 
          projectId: this.project.id,
          from: 'project-detail'
        } 
      });
    }
  }

  async openEditModal() {
    // 最新のプロジェクト情報から編集データを設定
    if (this.project) {
      this.editFormData.name = this.project.name;
      this.editFormData.startDate = this.formatDateForInput(this.project.startDate.toDate());
      this.editFormData.endDate = this.formatDateForInput(this.project.endDate.toDate());
      this.editFormData.assigneeId = this.project.assigneeId || '';
      this.editFormData.status = this.project.status || ProjectStatus.NotStarted;
      
      // チームプロジェクトの場合、チームメンバーを読み込む
      if (this.project.teamId) {
        await this.loadEditTeamMembers();
      }
    }
    this.showEditModal = true;
  }

  async loadEditTeamMembers() {
    if (this.project?.teamId) {
      try {
        const team = await this.teamService.getTeam(this.project.teamId);
        if (team) {
          this.editTeamMembers = team.members;
        } else {
          this.editTeamMembers = [];
        }
      } catch (error) {
        console.error('Error loading team members for edit:', error);
        this.editTeamMembers = [];
      }
    } else {
      this.editTeamMembers = [];
      this.editFormData.assigneeId = '';
    }
  }

  closeEditModal() {
    this.showEditModal = false;
    if (this.project) {
      this.editFormData.name = this.project.name;
      this.editFormData.startDate = this.formatDateForInput(this.project.startDate.toDate());
      this.editFormData.endDate = this.formatDateForInput(this.project.endDate.toDate());
      this.editFormData.assigneeId = this.project.assigneeId || '';
      this.editFormData.status = this.project.status || ProjectStatus.NotStarted;
    }
    this.editTeamMembers = [];
  }

  async onUpdateProject() {
    if (!this.project || !this.canEdit) return;
    
    // バリデーション
    if (!this.editFormData.name.trim()) {
      alert('タイトルを入力してください');
      return;
    }
    
    if (!this.editFormData.startDate || !this.editFormData.endDate) {
      alert('開始日と終了日を入力してください');
      return;
    }
    
    const startDate = new Date(this.editFormData.startDate);
    const endDate = new Date(this.editFormData.endDate);
    if (startDate > endDate) {
      alert('開始日は終了日より前である必要があります');
      return;
    }
    
    try {
      this.isLoading = true;
      
      const updates: any = {
        name: this.editFormData.name.trim(),
        status: this.editFormData.status,
        startDate: Timestamp.fromDate(startDate),
        endDate: Timestamp.fromDate(endDate)
      };
      
      // 担当者情報を取得（チームプロジェクトの場合のみ）
      if (this.project.teamId && this.editFormData.assigneeId) {
        const selectedMember = this.editTeamMembers.find(m => m.userId === this.editFormData.assigneeId);
        if (selectedMember) {
          updates.assigneeId = selectedMember.userId;
          updates.assigneeName = selectedMember.userName;
          
          // 担当者がプロジェクトメンバーに含まれていない場合は追加
          const isMember = this.project.members?.some(m => m.userId === selectedMember.userId);
          if (!isMember) {
            // プロジェクトメンバーに追加
            await this.projectService.addMember(
              this.project.id,
              selectedMember.userId,
              selectedMember.userName,
              selectedMember.userEmail,
              ProjectRole.Member
            );
          }
        }
      } else if (this.project.teamId) {
        // 担当者が選択されていない場合は削除
        updates.assigneeId = undefined;
        updates.assigneeName = undefined;
      }
      
      await this.projectService.updateProject(this.project.id, updates);
      
      alert('プロジェクトを更新しました');
      await this.loadProject(this.project.id);
      this.closeEditModal();
    } catch (error: any) {
      alert('プロジェクトの更新に失敗しました: ' + error.message);
    } finally {
      this.isLoading = false;
    }
  }

  // メンバー追加
  async onAddMember() {
    if (!this.project || !this.selectedMemberId) return;
    
    const selectedMember = this.teamMembers.find(m => m.userId === this.selectedMemberId);
    if (!selectedMember) return;
    
    try {
      await this.projectService.addMember(
        this.project.id,
        selectedMember.userId,
        selectedMember.userName,
        selectedMember.userEmail,
        this.selectedRole
      );
      
      alert('メンバーを追加しました');
      await this.loadProject(this.project.id);
      this.selectedMemberId = '';
      this.selectedRole = ProjectRole.Member;
      this.showMemberModal = false;
    } catch (error: any) {
      alert('メンバーの追加に失敗しました: ' + error.message);
    }
  }

  // メンバー削除
  async onRemoveMember(userId: string) {
    if (!this.project) return;
    
    const member = this.project.members?.find(m => m.userId === userId);
    if (!member) return;
    
    if (!confirm(`「${member.userName}」をプロジェクトから削除しますか？`)) {
      return;
    }
    
    try {
      await this.projectService.removeMember(this.project.id, userId);
      alert('メンバーを削除しました');
      await this.loadProject(this.project.id);
    } catch (error: any) {
      alert('メンバーの削除に失敗しました: ' + error.message);
    }
  }

  // メンバーの役割変更
  async onUpdateMemberRole(userId: string, newRole: ProjectRole) {
    if (!this.project) return;
    
    try {
      await this.projectService.updateMemberRole(this.project.id, userId, newRole);
      alert('役割を変更しました');
      await this.loadProject(this.project.id);
    } catch (error: any) {
      alert('役割の変更に失敗しました: ' + error.message);
    }
  }

  // 役割のラベルを取得
  getRoleLabel(role: ProjectRole): string {
    return this.projectService.getRoleLabel(role);
  }

  openMemberModal() {
    this.showMemberModal = true;
  }

  closeMemberModal() {
    this.showMemberModal = false;
    this.selectedMemberId = '';
    this.selectedRole = ProjectRole.Member;
  }

  openDeleteModal() {
    // 最新のプロジェクト情報からタスクを再取得
    if (this.project) {
      this.loadProjectTasks(this.project.id);
    }
    this.taskDeletionMode = 'none';
    this.selectedTaskIdsForDeletion.clear();
    this.showDeleteModal = true;
  }

  closeDeleteModal() {
    this.showDeleteModal = false;
    this.taskDeletionMode = 'none';
    this.selectedTaskIdsForDeletion.clear();
  }

  async loadProjectTasks(projectId: string) {
    try {
      this.tasks = await this.taskService.getTasks({ 
        projectId: projectId,
        isDeleted: false 
      });
    } catch (error) {
      console.error('Error loading project tasks:', error);
    }
  }

  toggleTaskSelection(taskId: string) {
    if (this.selectedTaskIdsForDeletion.has(taskId)) {
      this.selectedTaskIdsForDeletion.delete(taskId);
    } else {
      this.selectedTaskIdsForDeletion.add(taskId);
    }
  }

  async onDeleteProject() {
    if (!this.project) return;
    
    // 一部削除モードの場合は選択チェック
    if (this.taskDeletionMode === 'partial' && this.selectedTaskIdsForDeletion.size === 0) {
      alert('削除するタスクを選択してください');
      return;
    }
    
    let confirmMessage = `プロジェクト「${this.project.name}」を削除しますか？\n\n`;
    if (this.taskDeletionMode === 'all') {
      confirmMessage += '配下のタスクもすべて削除されます。';
    } else if (this.taskDeletionMode === 'partial') {
      confirmMessage += `選択した${this.selectedTaskIdsForDeletion.size}件のタスクが削除され、残りはプロジェクト未所属になります。`;
    } else {
      confirmMessage += '配下のタスクはプロジェクト未所属になります。';
    }
    confirmMessage += '\n\nこの操作は取り消せません。';
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    try {
      const taskIdsToDelete = this.taskDeletionMode === 'partial' 
        ? Array.from(this.selectedTaskIdsForDeletion)
        : undefined;
      
      await this.projectService.deleteProject(
        this.project.id,
        this.taskDeletionMode,
        taskIdsToDelete
      );
      
      alert('プロジェクトを削除しました');
      this.router.navigate(['/projects']);
    } catch (error: any) {
      alert('プロジェクトの削除に失敗しました: ' + error.message);
    }
  }

  // ファイル関連メソッド
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFiles = Array.from(input.files);
    }
  }

  async uploadFiles(): Promise<void> {
    if (!this.project || this.selectedFiles.length === 0) return;

    try {
      this.isUploadingFiles = true;
      const projectId = this.project.id;
      type UploadResult = { id: string; name: string; url: string; uploadedAt: Timestamp };
      const uploadPromises: Promise<UploadResult>[] = this.selectedFiles.map((file: File) => {
        // @ts-ignore - StorageServiceの型推論の問題を回避
        return this.storageService.uploadProjectFile(file, projectId);
      });

      const uploadedFiles = await Promise.all(uploadPromises);
      const currentFiles = this.project.files || [];
      const updatedFiles = [...currentFiles, ...uploadedFiles];

      await this.projectService.updateProject(this.project.id, {
        files: updatedFiles
      });

      this.selectedFiles = [];
      await this.loadProject(this.project.id);
      alert('ファイルをアップロードしました');
    } catch (error: any) {
      alert('ファイルのアップロードに失敗しました: ' + error.message);
    } finally {
      this.isUploadingFiles = false;
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!this.project) return;

    try {
      if (!this.project.files) return;
      
      type FileType = { id: string; url: string; name: string; uploadedAt: Timestamp };
      const fileArray: FileType[] = this.project.files;
      const file = fileArray.find((f: FileType) => f.id === fileId);
      if (!file) return;

      if (confirm('このファイルを削除しますか？')) {
        // Storageからファイルを削除
        const fileUrl: string = file.url;
        // @ts-ignore - StorageServiceの型推論の問題を回避
        await this.storageService.deleteFile(fileUrl);

        // プロジェクトからファイル情報を削除
        const updatedFiles = this.project.files?.filter(f => f.id !== fileId) || [];
        await this.projectService.updateProject(this.project.id, {
          files: updatedFiles
        });

        await this.loadProject(this.project.id);
        alert('ファイルを削除しました');
      }
    } catch (error: any) {
      alert('ファイルの削除に失敗しました: ' + error.message);
    }
  }

  downloadFile(fileUrl: string, fileName: string): void {
    window.open(fileUrl, '_blank');
  }
}

