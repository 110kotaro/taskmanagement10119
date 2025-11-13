import { Component, OnInit, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { Timestamp, doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase-config';
import { ProjectService } from '../../services/project.service';
import { TaskService } from '../../services/task.service';
import { TeamService } from '../../services/team.service';
import { AuthService } from '../../services/auth.service';
import { StorageService } from '../../services/storage.service';
import { NotificationService } from '../../services/notification.service';
import { Project, ProjectRole, ProjectStatus } from '../../models/project.model';
import { Task, Comment, TaskStatus } from '../../models/task.model';
import { Team, TeamMember, TeamRole } from '../../models/team.model';
import { NotificationType } from '../../models/notification.model';

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
  private location = inject(Location);
  private projectService = inject(ProjectService);
  private taskService = inject(TaskService);

  project: Project | null = null;
  tasks: Task[] = [];
  isLoading = true;

  isOwner = false;
  // isAdmin = false; // 削除（チーム管理者判定に変更）
  canEdit = false;
  canManageMembers = false;
  canCreateTask = false; // タスク作成権限
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
  private notificationService = inject(NotificationService);

  // コメント関連
  showCommentsTab = false;
  newCommentContent = '';
  unreadCommentCount = 0; // 未読コメント数
  readCommentIds: Set<string> = new Set(); // 既読コメントIDのセット
  mentionableUsers: { id: string; name: string; email: string }[] = [];
  showMentionSuggestions = false;
  mentionSuggestions: { id: string; name: string; email: string }[] = [];
  mentionSearchText = '';
  mentionCursorPosition = 0;
  @ViewChild('commentTextarea', { static: false }) commentTextarea?: ElementRef<HTMLTextAreaElement>;

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
        // コメント一覧から遷移した場合はコメントタブを開いて既読にする
        if (from === 'comments') {
          this.showCommentsTab = true;
          // コメントがある場合は既読にする
          if (this.project.comments && this.project.comments.length > 0) {
            this.markCommentsAsRead(projectId);
          }
        }
        
        // 未読コメント数を計算
        await this.loadUnreadCommentCount();
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
          this.canCreateTask = false;
        } else {
          // 権限チェック
          const user = this.authService.currentUser;
          if (user && this.project) {
            this.isOwner = this.project.ownerId === user.uid;
            const member = this.project.members?.find(m => m.userId === user.uid);
            // isAdmin は削除（チーム管理者判定に変更）
            this.canEdit = await this.projectService.canEditProject(projectId, user.uid);
            this.canManageMembers = await this.projectService.canManageMembers(projectId, user.uid);
            
            // タスク作成権限をチェック
            // 個人プロジェクトの場合は常に作成可能、チームプロジェクトの場合は権限チェック
            if (this.project.teamId) {
              // チームプロジェクトの場合
              const isProjectMember = this.project.members && this.project.members.some(m => m.userId === user.uid);
              const isProjectOwner = this.project.ownerId === user.uid;
              
              // チーム管理者かどうかをチェック
              let isTeamAdmin = false;
              try {
                const team = await this.teamService.getTeam(this.project.teamId);
                if (team) {
                  const teamMember = team.members.find(m => m.userId === user.uid);
                  isTeamAdmin = teamMember?.role === TeamRole.Admin || teamMember?.role === TeamRole.Owner || team.ownerId === user.uid;
                }
              } catch (error) {
                console.error('Error checking team admin:', error);
              }
              
              this.canCreateTask = isProjectMember || isProjectOwner || isTeamAdmin;
            } else {
              // 個人プロジェクトの場合は常に作成可能
              this.canCreateTask = true;
            }
            
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
      
      // メンション可能なユーザーリストを取得
      if (this.project) {
        await this.loadMentionableUsers();
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

  getTaskStatusLabel(status: string | TaskStatus): string {
    const statusMap: { [key: string]: string } = {
      'not_started': '未着手',
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
    if (window.history.length > 1) {
      this.location.back();
    } else {
      // 履歴がない場合はプロジェクト一覧に戻る
      this.router.navigate(['/projects']);
    }
  }

  createTask() {
    if (this.project) {
      const queryParams: any = { 
        projectId: this.project.id,
        from: 'project-detail'
      };
      
      // 個人/チームモードを判定（プロジェクトのteamIdから）
      if (this.project.teamId) {
        queryParams['teamId'] = this.project.teamId;
        queryParams['viewMode'] = 'team';
      } else {
        queryParams['viewMode'] = 'personal';
      }
      
      this.router.navigate(['/task/create'], { queryParams });
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
    if (endDate.getTime() < startDate.getTime()) {
      alert('終了日は開始日より後である必要があります');
      return;
    }
    
    try {
      this.isLoading = true;
      
      // ステータスが「完了」に変更される場合、確認ダイアログを表示
      if (this.editFormData.status === ProjectStatus.Completed && 
          this.project.status !== ProjectStatus.Completed) {
        // 未完了タスクのチェック
        const projectTasks = await this.taskService.getTasks({
          projectId: this.project.id,
          isDeleted: false
        });
        const incompleteTasks = projectTasks.filter(task => task.status !== TaskStatus.Completed);
        
        if (incompleteTasks.length > 0) {
          alert('未完了タスクが存在します。完了するか、削除してください。');
          this.isLoading = false;
          return;
        }
        
        if (!confirm('このプロジェクトを完了にしますか？')) {
          // キャンセルされた場合は処理を中断
          this.isLoading = false;
          return;
        }
      }
      
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
        ProjectRole.Member
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

  // コメント関連メソッド
  async loadMentionableUsers() {
    if (!this.project) return;
    
    try {
      // プロジェクトメンバーのみをメンション可能なユーザーとして設定
      if (this.project.members && this.project.members.length > 0) {
        this.mentionableUsers = this.project.members.map(member => ({
          id: member.userId,
          name: member.userName,
          email: member.userEmail
        }));
      } else {
        this.mentionableUsers = [];
      }
    } catch (error) {
      console.error('Error loading mentionable users:', error);
      this.mentionableUsers = [];
    }
  }

  // コメントからメンションをパースしてユーザーIDのリストを取得
  parseMentions(content: string): string[] {
    // @の後に続く文字列を取得（スペース、改行、@まで）- 全角・半角両方に対応
    const mentionRegex = /[@＠]([^\s@＠\n]+)/g;
    const matches = content.matchAll(mentionRegex);
    const mentionedUserIds: string[] = [];
    const userMap = new Map<string, string>();
    
    // メンション可能なユーザーをマップに追加（名前とメールで検索できるように）
    this.mentionableUsers.forEach(user => {
      // ユーザー名を正規化（小文字、スペース除去）
      const normalizedName = user.name.toLowerCase().replace(/\s+/g, '');
      userMap.set(normalizedName, user.id);
      userMap.set(user.name.toLowerCase(), user.id);
      userMap.set(user.email.toLowerCase(), user.id);
      // メールの@より前の部分も検索対象に
      const emailPrefix = user.email.split('@')[0].toLowerCase();
      userMap.set(emailPrefix, user.id);
    });

    for (const match of matches) {
      const mentionText = match[1].toLowerCase().replace(/\s+/g, '');
      const userId = userMap.get(mentionText);
      if (userId && !mentionedUserIds.includes(userId)) {
        mentionedUserIds.push(userId);
      }
    }

    return mentionedUserIds;
  }

  // @メンションオートコンプリート関連メソッド
  onCommentInput(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    const content = textarea.value;
    const cursorPosition = textarea.selectionStart;
    this.mentionCursorPosition = cursorPosition;

    // @の直後のテキストを取得（全角・半角両方に対応）
    const textBeforeCursor = content.substring(0, cursorPosition);
    const lastHalfAt = textBeforeCursor.lastIndexOf('@'); // 半角
    const lastFullAt = textBeforeCursor.lastIndexOf('＠'); // 全角
    const lastAtIndex = Math.max(lastHalfAt, lastFullAt);
    
    if (lastAtIndex !== -1) {
      // @の後にスペースや改行がない場合のみ候補を表示
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      if (!textAfterAt.match(/[\s\n]/)) {
        this.mentionSearchText = textAfterAt;
        this.updateMentionSuggestions();
        // mentionSuggestionsの長さで判定
        this.showMentionSuggestions = this.mentionSuggestions.length > 0 && this.mentionableUsers.length > 0;
        return;
      }
    }
    
    this.showMentionSuggestions = false;
  }

  updateMentionSuggestions() {
    if (!this.mentionSearchText) {
      this.mentionSuggestions = [...this.mentionableUsers];
    } else {
      const searchLower = this.mentionSearchText.toLowerCase();
      this.mentionSuggestions = this.mentionableUsers.filter(user =>
        user.name.toLowerCase().includes(searchLower) ||
        user.email.toLowerCase().includes(searchLower) ||
        user.email.split('@')[0].toLowerCase().includes(searchLower)
      );
    }
  }

  selectMention(user: { id: string; name: string; email: string }) {
    const textarea = this.commentTextarea?.nativeElement;
    if (!textarea) return;

    const content = textarea.value;
    const cursorPosition = this.mentionCursorPosition;
    const textBeforeCursor = content.substring(0, cursorPosition);
    // 全角・半角両方に対応
    const lastHalfAt = textBeforeCursor.lastIndexOf('@'); // 半角
    const lastFullAt = textBeforeCursor.lastIndexOf('＠'); // 全角
    const lastAtIndex = Math.max(lastHalfAt, lastFullAt);
    
    if (lastAtIndex !== -1) {
      const beforeAt = content.substring(0, lastAtIndex);
      const afterCursor = content.substring(cursorPosition);
      // 元の@記号（全角か半角か）を保持
      const atSymbol = lastHalfAt > lastFullAt ? '@' : '＠';
      const newContent = `${beforeAt}${atSymbol}${user.name} ${afterCursor}`;
      
      this.newCommentContent = newContent;
      this.showMentionSuggestions = false;
      
      // カーソル位置を調整
      setTimeout(() => {
        const newCursorPosition = lastAtIndex + user.name.length + 2; // @ + name + space
        textarea.setSelectionRange(newCursorPosition, newCursorPosition);
        textarea.focus();
      }, 0);
    }
  }

  hideMentionSuggestions() {
    setTimeout(() => {
      this.showMentionSuggestions = false;
    }, 200);
  }

  async addComment() {
    if (!this.project || !this.newCommentContent.trim()) return;

    const user = this.authService.currentUser;
    if (!user) return;

    try {
      const userName = user.displayName || user.email || 'Unknown';
      const mentionedUserIds = this.parseMentions(this.newCommentContent);

      const newComment: Comment = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
        userId: user.uid,
        userName: userName,
        content: this.newCommentContent.trim(),
        createdAt: Timestamp.now()
      };

      // mentionedUserIdsが空でない場合のみ追加
      if (mentionedUserIds.length > 0) {
        newComment.mentionedUserIds = mentionedUserIds;
      }

      const currentComments = this.project.comments || [];
      const updatedComments = [...currentComments, newComment];

      await this.projectService.updateProject(this.project.id, {
        comments: updatedComments
      }, true); // skipAutoComment = true（手動コメント追加のため）

      // メンションされたユーザーに通知を送信（コメント作成者を除く）
      if (mentionedUserIds.length > 0) {
        for (const mentionedUserId of mentionedUserIds) {
          if (mentionedUserId !== user.uid) {
            await this.notificationService.createNotification({
              userId: mentionedUserId,
              type: NotificationType.ProjectUpdated,
              title: 'プロジェクトでメンションされました',
              message: `${userName}がプロジェクト「${this.project.name}」のコメントでメンションしました`,
              projectId: this.project.id
            });
          }
        }
      }

      this.newCommentContent = '';
      await this.loadProject(this.project.id);
      // 未読コメント数を再計算（新規コメントは自分が追加したので既読扱い）
      await this.loadUnreadCommentCount();
      
      // サイドバーの未読コメント数を更新
      window.dispatchEvent(new CustomEvent('commentUpdated'));
    } catch (error: any) {
      alert('コメントの追加に失敗しました: ' + error.message);
    }
  }

  toggleCommentsTab() {
    this.showCommentsTab = !this.showCommentsTab;
    // コメントタブが開かれた時に既読にする
    if (this.showCommentsTab && this.project) {
      this.markCommentsAsRead(this.project.id);
      // 未読コメント数を再計算
      this.loadUnreadCommentCount();
    }
  }

  // 未読コメント数を読み込む
  async loadUnreadCommentCount() {
    const user = this.authService.currentUser;
    if (!user || !this.project) {
      this.unreadCommentCount = 0;
      this.readCommentIds = new Set();
      return;
    }

    try {
      // 既読状態を取得（プロジェクトの場合は`project_${projectId}`をキーとして使用）
      const readStatusRef = doc(db, 'commentReadStatus', `${user.uid}_project_${this.project.id}`);
      const readStatusSnap = await getDoc(readStatusRef);
      
      if (!readStatusSnap.exists()) {
        // 既読状態が存在しない場合、全コメントを未読とする
        this.readCommentIds = new Set();
        this.unreadCommentCount = this.project.comments?.length || 0;
        return;
      }

      const readStatus = readStatusSnap.data();
      this.readCommentIds = new Set(readStatus?.['readCommentIds'] || []);
      
      // 未読コメント数を計算
      if (!this.project.comments || this.project.comments.length === 0) {
        this.unreadCommentCount = 0;
      } else {
        this.unreadCommentCount = this.project.comments.filter(
          comment => !this.readCommentIds.has(comment.id)
        ).length;
      }
    } catch (error) {
      console.error('Error loading unread comment count:', error);
      this.unreadCommentCount = 0;
      this.readCommentIds = new Set();
    }
  }

  // コメントが未読かどうかを判定
  isCommentUnread(commentId: string): boolean {
    return !this.readCommentIds.has(commentId);
  }

  // コメントを既読にする
  async markCommentsAsRead(projectId: string) {
    const user = this.authService.currentUser;
    if (!user) return;
    
    const project = this.project;
    if (!project || !project.comments || project.comments.length === 0) return;
    
    try {
      // 現在のプロジェクトの全コメントIDを取得
      const allCommentIds = project.comments.map(c => c.id);
      
      // commentReadStatusを更新（プロジェクトの場合は`project_${projectId}`をキーとして使用）
      const readStatusRef = doc(db, 'commentReadStatus', `${user.uid}_project_${projectId}`);
      await setDoc(readStatusRef, {
        userId: user.uid,
        taskId: `project_${projectId}`,
        readCommentIds: allCommentIds,
        lastReadAt: Timestamp.now()
      }, { merge: true });
      
      // 既読IDセットを更新
      this.readCommentIds = new Set(allCommentIds);
      // 未読コメント数を再計算
      await this.loadUnreadCommentCount();
      
      // サイドバーの未読コメント数を更新
      window.dispatchEvent(new CustomEvent('commentUpdated'));
    } catch (error) {
      console.error('Error marking comments as read:', error);
    }
  }

  get sortedComments(): Comment[] {
    if (!this.project || !this.project.comments) return [];
    return [...this.project.comments].sort((a, b) => {
      return a.createdAt.toMillis() - b.createdAt.toMillis();
    });
  }

  formatDateTime(timestamp: Timestamp): string {
    const date = timestamp.toDate();
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

