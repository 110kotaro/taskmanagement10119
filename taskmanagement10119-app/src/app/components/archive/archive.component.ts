import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { Timestamp } from 'firebase/firestore';
import { AuthService } from '../../services/auth.service';
import { TaskService } from '../../services/task.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { Task, TaskStatus } from '../../models/task.model';
import { Project, ProjectStatus } from '../../models/project.model';
import { Team } from '../../models/team.model';

type ArchiveItemType = 'task' | 'project';
type ArchiveFilter = 'all' | 'completed' | 'deleted';

interface ArchiveItem {
  type: ArchiveItemType;
  id: string;
  title: string;
  status?: TaskStatus | ProjectStatus;  // タスクまたはプロジェクトのステータス
  isDeleted: boolean;
  deletedAt?: Timestamp;
  completedAt?: Timestamp;
  assigneeId?: string;
  assigneeName?: string;
  creatorId?: string; // タスクの作成者ID
  ownerId?: string; // プロジェクトのオーナーID
  projectId?: string;
  projectName?: string;
  teamId?: string; // チームID
  teamName?: string; // チーム名
  createdAt: Timestamp;
  canPermanentlyDelete?: boolean; // 完全削除権限フラグ
}

@Component({
  selector: 'app-archive',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './archive.component.html',
  styleUrl: './archive.component.css'
})
export class ArchiveComponent implements OnInit {
  authService = inject(AuthService);
  private taskService = inject(TaskService);
  private projectService = inject(ProjectService);
  private teamService = inject(TeamService);
  private router = inject(Router);
  private location = inject(Location);

  archiveItems: ArchiveItem[] = [];
  filteredItems: ArchiveItem[] = [];
  
  // フィルター
  itemTypeFilter: 'all' | 'task' | 'project' = 'all';
  archiveFilter: ArchiveFilter = 'all';
  selectedAssigneeId = 'all';
  projectNameInput = '';
  filteredProjectSuggestions: Project[] = [];
  showProjectSuggestions = false;
  selectedProjectId: string | null = null;
  dateFilterType: 'deleted' | 'completed' = 'deleted';
  dateFilterStart = '';
  dateFilterEnd = '';
  dateFilterEnabled: boolean = false;
  sortOrder: 'asc' | 'desc' = 'desc';
  
  // 選択されたアイテム（一括操作用）
  selectedItems: Set<string> = new Set();
  
  // オプション用データ
  assignees: Array<{ id: string; name: string }> = [];
  projects: Project[] = [];
  
  isLoading = false;
  currentUserRole: 'admin' | 'user' | null = null;
  
  // 個人/チーム切り替え状態（サイドバーから取得）
  taskViewMode: 'personal' | 'team' = 'personal';
  selectedTeamId: string | null = null;
  userTeamIds: string[] = [];
  userTeams: Team[] = [];

  // プロジェクト復元用
  showRestoreProjectModal = false;
  restoringProject: ArchiveItem | null = null;
  taskRestoreMode: 'all' | 'partial' | 'none' = 'none';
  selectedTaskIdsForRestore: Set<string> = new Set();
  originalProjectTasks: Array<{ id: string; title: string; isDeleted: boolean }> = [];

  async ngOnInit() {
    await this.loadUserTeams();
    await this.checkUserPermissions();
    
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
      this.loadArchiveData();
    });
    
    this.loadArchiveData();
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
    this.itemTypeFilter = 'all';
    this.archiveFilter = 'all';
    this.selectedAssigneeId = 'all';
    this.selectedProjectId = null;
    this.projectNameInput = '';
    this.dateFilterType = 'deleted';
    this.dateFilterStart = '';
    this.dateFilterEnd = '';
    this.dateFilterEnabled = false;
    this.sortOrder = 'desc';
  }

  // 現在のビューモードに対応するキーを取得
  private getFiltersStorageKey(): string {
    return `archiveFilters_${this.taskViewMode}`;
  }

  // フィルター状態をlocalStorageに保存
  saveFiltersToStorage() {
    try {
      const filters = {
        itemTypeFilter: this.itemTypeFilter,
        archiveFilter: this.archiveFilter,
        selectedAssigneeId: this.selectedAssigneeId,
        selectedProjectId: this.selectedProjectId,
        projectNameInput: this.projectNameInput,
        dateFilterType: this.dateFilterType,
        dateFilterStart: this.dateFilterStart,
        dateFilterEnd: this.dateFilterEnd,
        dateFilterEnabled: this.dateFilterEnabled,
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
        this.itemTypeFilter = filters.itemTypeFilter || 'all';
        this.archiveFilter = filters.archiveFilter || 'all';
        this.selectedAssigneeId = filters.selectedAssigneeId || 'all';
        this.selectedProjectId = filters.selectedProjectId || null;
        this.projectNameInput = filters.projectNameInput || '';
        this.dateFilterType = filters.dateFilterType || 'deleted';
        this.dateFilterStart = filters.dateFilterStart || '';
        this.dateFilterEnd = filters.dateFilterEnd || '';
        this.dateFilterEnabled = filters.dateFilterEnabled || false;
        this.sortOrder = filters.sortOrder || 'desc';
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

  async checkUserPermissions() {
    const user = this.authService.currentUser;
    if (!user) {
      this.router.navigate(['/login']);
      return;
    }
    
    const userDoc = await this.authService.getUser(user.uid);
    this.currentUserRole = userDoc?.role || 'user';
  }

  async loadArchiveData() {
    this.isLoading = true;
    try {
      const user = this.authService.currentUser;
      if (!user) {
        this.router.navigate(['/login']);
        return;
      }

      // ユーザーの権限を確認
      const userDoc = await this.authService.getUser(user.uid);
      const isAdmin = userDoc?.role === 'admin';

      // 個人/チームモードに応じて削除済みタスクを取得
      let allDeletedTasks: Task[];
      if (this.taskViewMode === 'personal') {
        // 個人モード: 自分が作成したタスク または 所属チームのタスクで自分が担当者
        allDeletedTasks = await this.taskService.getTasks({ 
          isDeleted: true,
          teamId: null,
          userId: user.uid,
          userTeamIds: this.userTeamIds
        });
      } else if (this.taskViewMode === 'team' && this.selectedTeamId) {
        // チームタスク（teamIdが一致）
        allDeletedTasks = await this.taskService.getTasks({ 
          isDeleted: true,
          teamId: this.selectedTeamId
        });
      } else {
        allDeletedTasks = [];
      }
      
      console.log('[アーカイブ] 削除済みタスク取得:', {
        count: allDeletedTasks.length,
        taskIds: allDeletedTasks.map(t => ({ id: t.id, title: t.title, isDeleted: t.isDeleted }))
      });
      
      // 管理者は全タスク、それ以外は条件に応じてフィルタリング
      let deletedTasks: Task[];
      if (isAdmin) {
        deletedTasks = allDeletedTasks;
      } else {
        // チームモードの場合
        if (this.taskViewMode === 'team' && this.selectedTeamId) {
          deletedTasks = [];
          for (const task of allDeletedTasks) {
            let shouldInclude = false;
            // チームタスクの場合、チームメンバー全員が見える
            if (task.teamId === this.selectedTeamId) {
              shouldInclude = true;
            }
            // チームプロジェクトタスクの場合、プロジェクトのteamIdをチェック
            else if (task.projectId) {
              const project = await this.projectService.getProject(task.projectId);
              if (project && project.teamId === this.selectedTeamId) {
                shouldInclude = true;
              }
            }
            // 個人タスクの場合、作成者または担当者のみ
            if (!shouldInclude) {
              shouldInclude = task.creatorId === user.uid || task.assigneeId === user.uid;
            }
            if (shouldInclude) {
              deletedTasks.push(task);
            }
          }
        } else {
          // 個人モードの場合、作成者または担当者のみ
          deletedTasks = allDeletedTasks.filter(task => 
            task.creatorId === user.uid || task.assigneeId === user.uid
          );
        }
      }
      
      // チーム名を設定
      for (const task of deletedTasks) {
        if (task.teamId && !task.teamName) {
          const team = this.userTeams.find(t => t.id === task.teamId);
          if (team) {
            task.teamName = team.name;
          }
        }
      }
      
      console.log('[アーカイブ] フィルタリング後の削除済みタスク:', {
        count: deletedTasks.length,
        taskIds: deletedTasks.map(t => ({ id: t.id, title: t.title, isDeleted: t.isDeleted }))
      });
      
      // 個人/チームモードに応じて完了済みタスクを取得（削除されていないもの）
      let allCompletedTasks: Task[];
      if (this.taskViewMode === 'personal') {
        // 個人モード: 自分が作成したタスク または 所属チームのタスクで自分が担当者
        allCompletedTasks = await this.taskService.getTasks({ 
          status: [TaskStatus.Completed],
          isDeleted: false,
          teamId: null,
          userId: user.uid,
          userTeamIds: this.userTeamIds
        });
      } else if (this.taskViewMode === 'team' && this.selectedTeamId) {
        // チームタスク（teamIdが一致）
        allCompletedTasks = await this.taskService.getTasks({ 
          status: [TaskStatus.Completed],
          isDeleted: false,
          teamId: this.selectedTeamId
        });
      } else {
        allCompletedTasks = [];
      }
      
      // 管理者は全タスク、それ以外は条件に応じてフィルタリング
      let completedTasks: Task[];
      if (isAdmin) {
        completedTasks = allCompletedTasks;
      } else {
        // チームモードの場合
        if (this.taskViewMode === 'team' && this.selectedTeamId) {
          completedTasks = [];
          for (const task of allCompletedTasks) {
            let shouldInclude = false;
            // チームタスクの場合、チームメンバー全員が見える
            if (task.teamId === this.selectedTeamId) {
              shouldInclude = true;
            }
            // チームプロジェクトタスクの場合、プロジェクトのteamIdをチェック
            else if (task.projectId) {
              const project = await this.projectService.getProject(task.projectId);
              if (project && project.teamId === this.selectedTeamId) {
                shouldInclude = true;
              }
            }
            // 個人タスクの場合、作成者または担当者のみ
            if (!shouldInclude) {
              shouldInclude = task.creatorId === user.uid || task.assigneeId === user.uid;
            }
            if (shouldInclude) {
              completedTasks.push(task);
            }
          }
        } else {
          // 個人モードの場合、作成者または担当者のみ
          completedTasks = allCompletedTasks.filter(task => 
            task.creatorId === user.uid || task.assigneeId === user.uid
          );
        }
      }
      
      // チーム名を設定
      for (const task of completedTasks) {
        if (task.teamId && !task.teamName) {
          const team = this.userTeams.find(t => t.id === task.teamId);
          if (team) {
            task.teamName = team.name;
          }
        }
      }

      const archiveTasks: ArchiveItem[] = [];

      // 削除済みタスク
      deletedTasks.forEach(task => {
        archiveTasks.push({
          type: 'task',
          id: task.id,
          title: task.title,
          status: task.status,
          isDeleted: true,
          deletedAt: task.deletedAt,
          completedAt: task.completedAt,
          assigneeId: task.assigneeId,
          assigneeName: task.assigneeName,
          creatorId: task.creatorId,
          projectId: task.projectId,
          projectName: task.projectName,
          teamId: task.teamId,
          teamName: task.teamName,
          createdAt: task.createdAt
        });
      });

      // 完了済みタスク（削除されていない）
      completedTasks
        .filter(task => task.status === 'completed')
        .forEach(task => {
          archiveTasks.push({
            type: 'task',
            id: task.id,
            title: task.title,
            status: task.status,
            isDeleted: false,
            deletedAt: task.deletedAt,
            completedAt: task.completedAt,
            assigneeId: task.assigneeId,
            assigneeName: task.assigneeName,
            creatorId: task.creatorId,
            projectId: task.projectId,
            projectName: task.projectName,
            teamId: task.teamId,
            teamName: task.teamName,
            createdAt: task.createdAt
          });
        });

      // プロジェクトを取得（削除済みを含む）
      // 個人/チームモードに応じて取得
      const allProjects = await this.getArchivedProjects(
        user.uid,
        isAdmin,
        this.taskViewMode === 'team' ? this.selectedTeamId : null,
        this.userTeamIds
      );
      // 削除済みプロジェクトと完了したプロジェクトをアーカイブに含める
      const archiveProjects: ArchiveItem[] = allProjects
        .filter(project => project.isDeleted === true || project.status === ProjectStatus.Completed)  // 削除済みまたは完了済み
        .map(project => ({
          type: 'project',
          id: project.id,
          title: project.name,
          status: project.status,  // プロジェクトのステータスを追加
          isDeleted: project.isDeleted,
          deletedAt: project.deletedAt,
          completedAt: project.status === ProjectStatus.Completed ? project.dateCheckedAt : undefined,  // 完了日時（dateCheckedAtを使用）
          assigneeId: project.assigneeId,  // 担当者IDを追加
          assigneeName: project.assigneeName,  // 担当者名を追加
          ownerId: project.ownerId,
          teamId: project.teamId,  // チームIDを追加
          teamName: project.teamName,  // チーム名を追加
          createdAt: project.createdAt
        }));

      this.archiveItems = [...archiveTasks, ...archiveProjects].sort((a, b) => {
        const dateA = (a.deletedAt || a.completedAt || a.createdAt)?.toMillis() || 0;
        const dateB = (b.deletedAt || b.completedAt || b.createdAt)?.toMillis() || 0;
        return dateB - dateA; // 新しい順
      });

      // 各アイテムに対して完全削除権限をチェックしてフラグを設定
      for (const item of this.archiveItems) {
        item.canPermanentlyDelete = await this.canPermanentlyDeleteItem(item);
      }

      // 担当者とプロジェクトのリストを作成
      const assigneeMap = new Map<string, string>();
      // タスクの担当者を追加
      archiveTasks.forEach(item => {
        if (item.assigneeId && item.assigneeName) {
          assigneeMap.set(item.assigneeId, item.assigneeName);
        }
      });
      // プロジェクトの担当者も追加
      archiveProjects.forEach(item => {
        if (item.assigneeId && item.assigneeName) {
          assigneeMap.set(item.assigneeId, item.assigneeName);
        }
      });
      this.assignees = Array.from(assigneeMap.entries()).map(([id, name]) => ({ id, name }));

      // プロジェクトリスト（アクティブなもの）
      // 個人/チームモードに応じてプロジェクトを取得
      this.projects = await this.projectService.getProjectsForUser(
        user.uid,
        this.taskViewMode === 'team' ? this.selectedTeamId : null,
        this.userTeamIds
      );

      this.applyFilters();
    } catch (error: any) {
      console.error('Error loading archive data:', error);
      alert('アーカイブデータの読み込みに失敗しました: ' + error.message);
    } finally {
      this.isLoading = false;
    }
  }

  async getArchivedProjects(
    userId: string,
    isAdmin: boolean = false,
    teamId: string | null = null,
    userTeamIds: string[] = []
  ): Promise<Project[]> {
    try {
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const { db } = await import('../../../firebase-config');
      
      // 全プロジェクトを取得
      const q = query(collection(db, 'projects'));
      const snapshot = await getDocs(q);
      let projects = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Project));
      
      // 管理者の場合は全プロジェクト、それ以外は個人/チームモードでフィルタリング
      if (!isAdmin) {
        if (teamId === null) {
          // 個人モード: 自分がオーナーまたはメンバーのプロジェクト
          projects = projects.filter(project => 
            project.ownerId === userId ||
            (project.members && project.members.some(member => member.userId === userId))
          );
        } else if (teamId) {
          // チームモード: 現時点では個人モードと同じ（将来、プロジェクトにteamIdを追加する場合の拡張ポイント）
          projects = projects.filter(project => 
            project.ownerId === userId ||
            (project.members && project.members.some(member => member.userId === userId))
          );
        }
      }
      
      return projects;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  applyFilters() {
    let filtered = [...this.archiveItems];

    // アイテムタイプ（タスク/プロジェクト）
    if (this.itemTypeFilter !== 'all') {
      filtered = filtered.filter(item => item.type === this.itemTypeFilter);
    }

    // アーカイブフィルター（完了済み/削除済み）
    if (this.archiveFilter === 'completed') {
      filtered = filtered.filter(item => 
        item.status === 'completed' || (item.type === 'task' && item.completedAt)
      );
    } else if (this.archiveFilter === 'deleted') {
      filtered = filtered.filter(item => item.isDeleted);
    }

    // 担当者
    if (this.selectedAssigneeId !== 'all') {
      filtered = filtered.filter(item => item.assigneeId === this.selectedAssigneeId);
    }

    // プロジェクト（IDで判定に変更）
    if (this.selectedProjectId !== null) {
      filtered = filtered.filter(item => {
        // タスクの場合：そのプロジェクトに属するタスクを表示
        if (item.type === 'task') {
          return item.projectId === this.selectedProjectId;
        }
        // プロジェクトの場合：選択されたプロジェクト自体を表示
        if (item.type === 'project') {
          return item.id === this.selectedProjectId;
        }
        return false;
      });
    }

    // 日付フィルター（有効な場合のみ）
    if (this.dateFilterEnabled && this.dateFilterStart && this.dateFilterEnd) {
      const startDate = new Date(this.dateFilterStart);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(this.dateFilterEnd);
      endDate.setHours(23, 59, 59, 999);

      filtered = filtered.filter(item => {
        let targetDate: Date | null = null;
        
        if (this.dateFilterType === 'deleted' && item.deletedAt) {
          targetDate = item.deletedAt.toDate();
        } else if (this.dateFilterType === 'completed' && item.completedAt) {
          targetDate = item.completedAt.toDate();
        }

        if (!targetDate) return false;
        return targetDate >= startDate && targetDate <= endDate;
      });
    }

    // ソート適用
    filtered.sort((a, b) => {
      const dateA = (a.deletedAt || a.completedAt || a.createdAt)?.toMillis() || 0;
      const dateB = (b.deletedAt || b.completedAt || b.createdAt)?.toMillis() || 0;
      return this.sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });

    this.filteredItems = filtered;
  }

  toggleSortOrder() {
    this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    this.saveFiltersToStorage();
    this.applyFilters();
  }

  // 選択されたアイテムの中に完全削除権限があるものがあるかチェック（同期版）
  get hasPermanentlyDeletePermissionForSelectedItemsSync(): boolean {
    if (this.selectedItems.size === 0) return false;
    
    // 選択されたアイテムの中に1つでも完全削除権限があるものがあればtrue
    for (const itemId of this.selectedItems) {
      const item = this.archiveItems.find(i => i.id === itemId);
      if (item && item.canPermanentlyDelete) {
        return true;
      }
    }
    
    return false;
  }

  toggleItemSelection(itemId: string) {
    if (this.selectedItems.has(itemId)) {
      this.selectedItems.delete(itemId);
    } else {
      this.selectedItems.add(itemId);
    }
  }

  toggleAllItems() {
    if (this.selectedItems.size === this.filteredItems.length && this.filteredItems.length > 0) {
      this.selectedItems.clear();
    } else {
      this.selectedItems.clear();
      this.filteredItems.forEach(item => this.selectedItems.add(item.id));
    }
  }

  async restoreSelectedItems() {
    if (this.selectedItems.size === 0) {
      alert('復元する項目が選択されていません');
      return;
    }

    if (!confirm(`選択した${this.selectedItems.size}件の項目を復元しますか？`)) {
      return;
    }

    try {
      const user = this.authService.currentUser;
      if (!user) {
        alert('ログインが必要です');
        return;
      }

      const userDoc = await this.authService.getUser(user.uid);
      const isAdmin = userDoc?.role === 'admin';

      const itemIds = Array.from(this.selectedItems);
      let successCount = 0;
      let failCount = 0;

      for (const itemId of itemIds) {
        const item = this.archiveItems.find(i => i.id === itemId);
        if (!item) continue;

        // 権限チェック
        if (item.type === 'task') {
          const isCreator = item.creatorId === user.uid;
          if (!isAdmin && !isCreator) {
            failCount++;
            continue;
          }
        } else {
          const isOwner = item.ownerId === user.uid;
          if (!isAdmin && !isOwner) {
            failCount++;
            continue;
          }
        }

        // 復元処理
        try {
          if (item.type === 'task') {
            console.log('[復元] 一括復元開始:', {
              taskId: itemId,
              taskTitle: item.title,
              updates: { isDeleted: false, deletedAt: undefined }
            });
            
            // 復元前のタスク状態を確認
            const taskBefore = await this.taskService.getTask(itemId);
            console.log('[復元] 復元前のタスク状態:', {
              taskId: itemId,
              isDeleted: taskBefore?.isDeleted,
              deletedAt: taskBefore?.deletedAt,
              status: taskBefore?.status,
              statusBeforeDeletion: taskBefore?.statusBeforeDeletion
            });
            
            // 復元時の更新内容を決定
            const restoreUpdates: any = {
              isDeleted: false,
              deletedAt: undefined
            };
            
            // 削除前のステータスがあれば復元、なければ未着手に戻す
            if (taskBefore?.statusBeforeDeletion) {
              restoreUpdates.status = taskBefore.statusBeforeDeletion;
              // ステータスがcompletedでない場合は、completedAtも削除
              if (taskBefore.statusBeforeDeletion !== TaskStatus.Completed) {
                restoreUpdates.completedAt = undefined;
              }
            } else {
              // 削除前のステータスが保存されていない場合は未着手に戻す
              restoreUpdates.status = TaskStatus.NotStarted;
              restoreUpdates.completedAt = undefined;
            }
            
            // statusBeforeDeletionフィールドも削除
            restoreUpdates.statusBeforeDeletion = undefined;
            
            await this.taskService.updateTask(itemId, restoreUpdates, true);
            
            // 復元後のタスク状態を確認
            const taskAfter = await this.taskService.getTask(itemId);
            console.log('[復元] 復元後のタスク状態:', {
              taskId: itemId,
              isDeleted: taskAfter?.isDeleted,
              deletedAt: taskAfter?.deletedAt,
              status: taskAfter?.status
            });
            
            // Firestoreの更新が反映されるまで少し待機
            await new Promise(resolve => setTimeout(resolve, 500));
          } else {
            await this.projectService.updateProject(itemId, {
              isDeleted: false,
              deletedAt: undefined
            });
            
            // Firestoreの更新が反映されるまで少し待機
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          successCount++;
        } catch (error) {
          console.error(`Error restoring item ${itemId}:`, error);
          failCount++;
        }
      }

      this.selectedItems.clear();
      if (failCount > 0) {
        alert(`${successCount}件を復元しました。${failCount}件は権限不足のため復元できませんでした。`);
      } else {
        alert(`${successCount}件を復元しました`);
      }
      await this.loadArchiveData();
    } catch (error: any) {
      console.error('Error restoring items:', error);
      alert('復元に失敗しました: ' + error.message);
    }
  }

  // 選択されたアイテムの中に完全削除権限があるものがあるかチェック
  async hasPermanentlyDeletePermissionForSelectedItems(): Promise<boolean> {
    const user = this.authService.currentUser;
    if (!user) return false;

    // 選択されたアイテムの中に1つでも完全削除権限があるものがあればtrue
    for (const itemId of this.selectedItems) {
      const item = this.archiveItems.find(i => i.id === itemId);
      if (!item) continue;
      
      const canDelete = await this.canPermanentlyDeleteItem(item);
      if (canDelete) return true;
    }
    
    return false;
  }

  async permanentlyDeleteSelectedItems() {
    if (this.selectedItems.size === 0) {
      alert('削除する項目が選択されていません');
      return;
    }

    if (!confirm(`選択した${this.selectedItems.size}件の項目を完全に削除しますか？\nこの操作は元に戻せません。`)) {
      return;
    }

    try {
      const user = this.authService.currentUser;
      if (!user) {
        alert('ログインが必要です');
        return;
      }

      const { doc, deleteDoc } = await import('firebase/firestore');
      const { db } = await import('../../../firebase-config');

      const itemIds = Array.from(this.selectedItems);
      let successCount = 0;
      let failCount = 0;

      for (const itemId of itemIds) {
        const item = this.archiveItems.find(i => i.id === itemId);
        if (!item) continue;

        // 権限チェック
        const canDelete = await this.canPermanentlyDeleteItem(item);
        if (!canDelete) {
          failCount++;
          continue;
        }

        try {
          if (item.type === 'task') {
            await deleteDoc(doc(db, 'tasks', itemId));
          } else {
            await deleteDoc(doc(db, 'projects', itemId));
          }
          successCount++;
        } catch (error) {
          console.error(`Error deleting item ${itemId}:`, error);
          failCount++;
        }
      }

      this.selectedItems.clear();
      if (failCount > 0) {
        alert(`${successCount}件を完全削除しました。${failCount}件は権限不足のため削除できませんでした。`);
      } else {
        alert(`${successCount}件を完全削除しました`);
      }
      await this.loadArchiveData();
    } catch (error: any) {
      console.error('Error permanently deleting items:', error);
      alert('削除に失敗しました: ' + error.message);
    }
  }

  onFilterChange() {
    this.applyFilters();
    this.saveFiltersToStorage();
  }

  async restoreItem(item: ArchiveItem) {
    if (item.type === 'project') {
      // プロジェクト復元時：タスクの扱いを選択するモーダルを表示
      this.restoringProject = item;
      await this.loadOriginalProjectTasks(item.id);
      this.taskRestoreMode = 'none';
      this.selectedTaskIdsForRestore.clear();
      this.showRestoreProjectModal = true;
      return;
    }
    
    // タスク復元時：元のプロジェクトに戻すか確認
    if (!confirm(`「${item.title}」を復元しますか？`)) {
      return;
    }

    try {
      const user = this.authService.currentUser;
      if (!user) {
        alert('ログインが必要です');
        return;
      }

      // 権限チェック（管理者または作成者のみ可能）
      const userDoc = await this.authService.getUser(user.uid);
      const isAdmin = userDoc?.role === 'admin';
      
      const isCreator = item.creatorId === user.uid;
      if (!isAdmin && !isCreator) {
        alert('復元する権限がありません（管理者または作成者のみ可能）');
        return;
      }
      
      // タスクを取得して元のプロジェクトIDを確認
      const task = await this.taskService.getTask(item.id);
      if (!task) {
        alert('タスクが見つかりません');
        return;
      }
      
      // 元のプロジェクトがあるか確認（projectIdが設定されている場合）
      // プロジェクト削除時にprojectIdが削除されているため、元のプロジェクトを探す必要がある
      // 削除されたプロジェクトのoriginalTaskIdsにこのタスクIDが含まれているか確認
      let originalProject = null;
      if (task.projectId) {
        // まだprojectIdが設定されている場合（削除されていない）
        originalProject = await this.projectService.getProject(task.projectId);
      } else {
        // projectIdが削除されている場合、削除されたプロジェクトを探す
        // 全プロジェクト（削除されたものも含む）を取得してoriginalTaskIdsを確認
        try {
          const { collection, query, getDocs } = await import('firebase/firestore');
          const { db } = await import('../../../firebase-config');
          
          const q = query(collection(db, 'projects'));
          const snapshot = await getDocs(q);
          const allProjects = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          } as any));
          
          // ユーザーがオーナーまたはメンバーのプロジェクトをフィルタリング
          const userProjects = allProjects.filter((proj: any) => 
            proj.ownerId === user.uid || 
            (proj.members && proj.members.some((member: any) => member.userId === user.uid))
          );
          
          // originalTaskIdsにこのタスクIDが含まれているプロジェクトを探す
          for (const proj of userProjects) {
            if (proj.originalTaskIds && proj.originalTaskIds.includes(task.id)) {
              originalProject = proj;
              break;
            }
          }
        } catch (error) {
          console.error('Error searching for original project:', error);
        }
      }
      
      // 復元時の更新内容を決定
      const restoreUpdates: any = {
        isDeleted: false,
        deletedAt: undefined
      };
      
      // 削除前のステータスがあれば復元、なければ未着手に戻す
      if (task.statusBeforeDeletion) {
        restoreUpdates.status = task.statusBeforeDeletion;
        // ステータスがcompletedでない場合は、completedAtも削除
        if (task.statusBeforeDeletion !== TaskStatus.Completed) {
          restoreUpdates.completedAt = undefined;
        }
      } else {
        // 削除前のステータスが保存されていない場合は未着手に戻す
        restoreUpdates.status = TaskStatus.NotStarted;
        restoreUpdates.completedAt = undefined;
      }
      
      // statusBeforeDeletionフィールドも削除
      restoreUpdates.statusBeforeDeletion = undefined;
      
      // 元のプロジェクトがあるか確認
      if (originalProject) {
        if (originalProject.isDeleted) {
          // 元のプロジェクトが削除されている場合
          alert('元のプロジェクト「' + originalProject.name + '」は削除されています。プロジェクト未所属で復元します。');
          // プロジェクト未所属で復元
          await this.taskService.updateTask(item.id, restoreUpdates, true);
        } else {
          // 元のプロジェクトが存在する場合、そのプロジェクトの配下に戻すか確認
          const restoreToProject = confirm(
            `元のプロジェクト「${originalProject.name}」の配下に戻しますか？\n` +
            `「いいえ」を選択すると、プロジェクト未所属で復元されます。`
          );
          
          if (restoreToProject) {
            // プロジェクトの配下に戻す
            restoreUpdates.projectId = originalProject.id;
            restoreUpdates.projectName = originalProject.name;
            await this.taskService.updateTask(item.id, restoreUpdates, true);
          } else {
            // プロジェクト未所属で復元
            await this.taskService.updateTask(item.id, restoreUpdates, true);
          }
        }
      } else {
        // 元のプロジェクトが見つからない場合
        alert('元のプロジェクトが見つかりません。プロジェクト未所属で復元します。');
        await this.taskService.updateTask(item.id, restoreUpdates, true);
      }
      
      alert('復元しました');
      await this.loadArchiveData();
    } catch (error: any) {
      console.error('Error restoring item:', error);
      alert('復元に失敗しました: ' + error.message);
    }
  }

  async loadOriginalProjectTasks(projectId: string) {
    try {
      const project = await this.projectService.getProject(projectId);
      if (!project || !project.originalTaskIds) {
        this.originalProjectTasks = [];
        return;
      }
      
      // 元々このプロジェクトに属していたタスクを取得
      const allTasks: any[] = [];
      for (const taskId of project.originalTaskIds) {
        try {
          const task = await this.taskService.getTask(taskId);
          if (task) {
            allTasks.push(task);
          }
        } catch (error) {
          // タスクが見つからない場合はスキップ
          console.warn(`Task ${taskId} not found`);
        }
      }
      
      this.originalProjectTasks = allTasks.map(task => ({
        id: task.id,
        title: task.title,
        isDeleted: task.isDeleted || false
      }));
    } catch (error) {
      console.error('Error loading original project tasks:', error);
      this.originalProjectTasks = [];
    }
  }

  async onRestoreProject() {
    if (!this.restoringProject) return;
    
    // 一部戻すモードの場合は選択チェック
    if (this.taskRestoreMode === 'partial' && this.selectedTaskIdsForRestore.size === 0) {
      alert('戻すタスクを選択してください');
      return;
    }
    
    let confirmMessage = `プロジェクト「${this.restoringProject.title}」を復元しますか？\n\n`;
    if (this.taskRestoreMode === 'all') {
      confirmMessage += `元々配下にあった${this.originalProjectTasks.length}件のタスクもすべてプロジェクトに戻します。`;
    } else if (this.taskRestoreMode === 'partial') {
      confirmMessage += `選択した${this.selectedTaskIdsForRestore.size}件のタスクをプロジェクトに戻します。`;
    } else {
      confirmMessage += 'タスクはプロジェクトに戻しません。';
    }
    
    // 削除されているタスクがあるか確認
    const deletedTasks = this.originalProjectTasks.filter(t => t.isDeleted);
    if (deletedTasks.length > 0 && (this.taskRestoreMode === 'all' || 
        (this.taskRestoreMode === 'partial' && deletedTasks.some(t => this.selectedTaskIdsForRestore.has(t.id))))) {
      const restoreDeleted = confirm(
        confirmMessage + `\n\n削除されているタスクが${deletedTasks.length}件あります。これらも復元しますか？`
      );
      if (!restoreDeleted) {
        return;
      }
    } else {
      if (!confirm(confirmMessage)) {
        return;
      }
    }
    
    try {
      const taskIdsToRestore = this.taskRestoreMode === 'partial' 
        ? Array.from(this.selectedTaskIdsForRestore)
        : undefined;
      
      await this.projectService.restoreProject(
        this.restoringProject.id,
        this.taskRestoreMode,
        taskIdsToRestore
      );
      
      alert('プロジェクトを復元しました');
      this.showRestoreProjectModal = false;
      this.restoringProject = null;
      await this.loadArchiveData();
    } catch (error: any) {
      alert('プロジェクトの復元に失敗しました: ' + error.message);
    }
  }

  closeRestoreProjectModal() {
    this.showRestoreProjectModal = false;
    this.restoringProject = null;
    this.taskRestoreMode = 'none';
    this.selectedTaskIdsForRestore.clear();
    this.originalProjectTasks = [];
  }

  toggleTaskRestoreSelection(taskId: string) {
    if (this.selectedTaskIdsForRestore.has(taskId)) {
      this.selectedTaskIdsForRestore.delete(taskId);
    } else {
      this.selectedTaskIdsForRestore.add(taskId);
    }
  }

  // 完全削除権限をチェック
  async canPermanentlyDeleteItem(item: ArchiveItem): Promise<boolean> {
    const user = this.authService.currentUser;
    if (!user) return false;

    const userDoc = await this.authService.getUser(user.uid);
    const isAdmin = userDoc?.role === 'admin';

    // 管理者は常に完全削除可能
    if (isAdmin) return true;

    if (item.type === 'task') {
      // タスクの場合：task.service.tsのcanPermanentlyDeleteTaskと同じロジック
      // 個人タスクの場合、作成者のみ完全削除可能
      if (!item.teamId) {
        return item.creatorId === user.uid;
      }
      
      // チームタスクの場合、チーム管理者のみ完全削除可能
      if (item.teamId) {
        const canEdit = await this.teamService.canEditTeam(item.teamId, user.uid);
        if (canEdit) return true;
      }
      
      // プロジェクトタスクの場合、プロジェクトオーナーも完全削除可能
      if (item.projectId) {
        const project = await this.projectService.getProject(item.projectId);
        if (project && project.ownerId === user.uid) return true;
      }
    } else {
      // プロジェクトの場合
      // チーム配下のプロジェクト（teamIdがある）: チーム管理者のみ完全削除可能
      if (item.teamId) {
        const canEdit = await this.teamService.canEditTeam(item.teamId, user.uid);
        if (canEdit) return true;
      }
      
      // 個人プロジェクト（teamIdがない）: 作成者（オーナー）のみ完全削除可能
      return item.ownerId === user.uid;
    }

    return false;
  }

  async permanentlyDeleteItem(item: ArchiveItem) {
    if (!confirm(`「${item.title}」を完全に削除しますか？\nこの操作は元に戻せません。`)) {
      return;
    }

    try {
      const user = this.authService.currentUser;
      if (!user) {
        alert('ログインが必要です');
        return;
      }

      // 権限チェック
      const canDelete = await this.canPermanentlyDeleteItem(item);
      if (!canDelete) {
        alert('完全削除する権限がありません');
        return;
      }

      if (item.type === 'task') {
        const { doc, deleteDoc } = await import('firebase/firestore');
        const { db } = await import('../../../firebase-config');
        await deleteDoc(doc(db, 'tasks', item.id));
      } else {
        const { doc, deleteDoc } = await import('firebase/firestore');
        const { db } = await import('../../../firebase-config');
        await deleteDoc(doc(db, 'projects', item.id));
      }
      
      alert('完全に削除しました');
      await this.loadArchiveData();
    } catch (error: any) {
      console.error('Error permanently deleting item:', error);
      alert('削除に失敗しました: ' + error.message);
    }
  }

  viewItem(item: ArchiveItem) {
    if (item.type === 'task') {
      this.router.navigate(['/task', item.id], { queryParams: { from: 'archive' } });
    } else {
      this.router.navigate(['/project', item.id], { queryParams: { from: 'archive' } });
    }
  }

  formatDateTime(timestamp?: Timestamp): string {
    if (!timestamp) return '-';
    const date = timestamp.toDate();
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getStatusLabel(status?: TaskStatus | ProjectStatus): string {
    if (!status) return '-';
    const statusMap: { [key: string]: string } = {
      'not_started': '未着手',
      'in_progress': '進行中',
      'completed': '完了',
      'overdue': '期限切れ'
    };
    return statusMap[status] || status;
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

  onProjectNameChange(value: string) {
    this.projectNameInput = value;
    this.onProjectNameInput();
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

  hideProjectSuggestions() {
    setTimeout(() => {
      this.showProjectSuggestions = false;
    }, 200);
  }
}

