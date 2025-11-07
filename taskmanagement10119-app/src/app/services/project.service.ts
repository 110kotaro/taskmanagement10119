import { Injectable, inject, Injector } from '@angular/core';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  Timestamp,
  deleteField
} from 'firebase/firestore';
import { db } from '../../firebase-config';
import { Project, ProjectMember, ProjectRole, ProjectStatus } from '../models/project.model';
import { AuthService } from './auth.service';
import { TaskService } from './task.service';
import { NotificationService } from './notification.service';
import { NotificationType } from '../models/notification.model';
import { TeamService } from './team.service';
import { TeamRole } from '../models/team.model';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {
  private authService = inject(AuthService);
  private injector = inject(Injector); // 遅延注入用

  async createProject(projectData: Partial<Project>, teamId?: string, teamName?: string, assigneeId?: string, assigneeName?: string): Promise<string> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const project: Omit<Project, 'id'> = {
        name: projectData.name || '',
        description: projectData.description,
        ownerId: user.uid,
        ownerName: user.displayName || user.email || 'Unknown',
        assigneeId: assigneeId,        // 担当者ID（チームモード時のみ設定可能）
        assigneeName: assigneeName,    // 担当者名（チームモード時のみ設定可能）
        members: [{
          userId: user.uid,
          userName: user.displayName || user.email || 'Unknown',
          userEmail: user.email || '',
          role: ProjectRole.Member, // 作成者はメンバー（チーム管理者が権限を持つ）
          joinedAt: Timestamp.now()
        }],
        teamId: teamId,        // チームモード時のみ設定
        teamName: teamName,    // チームモード時のみ設定
        status: ProjectStatus.NotStarted, // デフォルトは準備中
        startDate: projectData.startDate || Timestamp.now(),
        endDate: projectData.endDate || Timestamp.now(),
        completionRate: 0,
        totalTasks: 0,
        completedTasks: 0,
        isDeleted: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      const docRef = await addDoc(collection(db, 'projects'), project);
      return docRef.id;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async getProject(projectId: string): Promise<Project | null> {
    try {
      const docRef = doc(db, 'projects', projectId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as Project;
      }
      return null;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');
      
      // 権限チェック
      if (!await this.canEditProject(projectId, user.uid)) {
        throw new Error('プロジェクトを編集する権限がありません');
      }
      
      const project = await this.getProject(projectId);
      if (!project) throw new Error('Project not found');
      
      // チーム変更のチェック
      if (updates.teamId !== undefined && updates.teamId !== project.teamId) {
        // プロジェクト管理者以上のみチーム変更可能
        if (!await this.canEditProject(projectId, user.uid)) {
          throw new Error('チームを変更する権限がありません（プロジェクト管理者以上が必要）');
        }
        
        // チーム変更の通知（全メンバーに、操作者を除外）
        if (project.members) {
          const notificationService = this.injector.get(NotificationService);
          for (const member of project.members) {
            // 操作者には通知を送らない
            if (member.userId !== user.uid) {
              await notificationService.createNotification({
                userId: member.userId,
                type: NotificationType.ProjectCreated, // または新しい通知タイプ
                title: 'プロジェクトのチームが変更されました',
                message: `プロジェクト「${project.name}」のチームが変更されました`,
                projectId: projectId
              });
            }
          }
        }
      }
      
      // undefinedの値を除外して、削除したいフィールドは deleteField を使う
      const cleanUpdates: any = {};
      
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'updatedAt') {
          // updatedAtは後で設定するのでスキップ
          continue;
        } else if (value === undefined) {
          // undefinedの場合は削除（FirestoreのFieldValue.delete()を使う）
          cleanUpdates[key] = deleteField();
        } else {
          cleanUpdates[key] = value;
        }
      }
      
      // updatedAtは常に含める
      cleanUpdates.updatedAt = Timestamp.now();
      
      const projectRef = doc(db, 'projects', projectId);
      await updateDoc(projectRef, cleanUpdates);
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // プロジェクトの編集権限をチェック（オーナーまたはチーム管理者）
  async canEditProject(projectId: string, userId: string): Promise<boolean> {
    try {
      const project = await this.getProject(projectId);
      if (!project) return false;
      
      // オーナーは編集可能
      if (this.hasOwnerPermissions(userId, project)) return true;
      
      // チーム管理者も編集可能（プロジェクトにteamIdがある場合）
      return await this.isTeamAdmin(project, userId);
    } catch (error) {
      return false;
    }
  }

  // オーナーの権限チェック（将来的にオーナー専用の権限を追加する場合に備えたヘルパーメソッド）
  private hasOwnerPermissions(userId: string, project: Project): boolean {
    return project.ownerId === userId;
  }

  // チーム管理者かどうかをチェック（プロジェクトにteamIdがある場合）
  private async isTeamAdmin(project: Project, userId: string): Promise<boolean> {
    try {
      // プロジェクトにteamIdがない場合はfalse
      if (!project.teamId) return false;
      
      // 遅延注入でTeamServiceを取得（循環依存を回避）
      const teamService = this.injector.get(TeamService);
      const team = await teamService.getTeam(project.teamId);
      
      if (!team) return false;
      
      // チームのメンバーを確認
      const member = team.members.find(m => m.userId === userId);
      if (!member) return false;
      
      // チーム管理者（Admin）またはチームオーナー（Owner）かチェック
      return member.role === TeamRole.Admin || member.role === TeamRole.Owner;
    } catch (error) {
      return false;
    }
  }

  // メンバー管理の権限チェック（オーナーまたはチーム管理者）
  async canManageMembers(projectId: string, userId: string): Promise<boolean> {
    try {
      const project = await this.getProject(projectId);
      if (!project) return false;
      
      // オーナーはメンバー管理可能
      if (this.hasOwnerPermissions(userId, project)) return true;
      
      // チーム管理者もメンバー管理可能（プロジェクトにteamIdがある場合）
      return await this.isTeamAdmin(project, userId);
    } catch (error) {
      return false;
    }
  }

  // メンバーを追加
  async addMember(
    projectId: string,
    userId: string,
    userName: string,
    userEmail: string,
    role: ProjectRole = ProjectRole.Member
  ): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');
      
      // 権限チェック（オーナーまたはプロジェクト管理者）
      if (!await this.canManageMembers(projectId, user.uid)) {
        throw new Error('メンバーを追加する権限がありません');
      }
      
      const project = await this.getProject(projectId);
      if (!project) throw new Error('Project not found');
      
      // 既にメンバーかチェック
      if (project.members?.some(m => m.userId === userId)) {
        throw new Error('このユーザーは既にメンバーです');
      }
      
      // メンバーを追加
      const newMember: ProjectMember = {
        userId,
        userName,
        userEmail,
        role,
        joinedAt: Timestamp.now()
      };
      
      const updatedMembers = [...(project.members || []), newMember];
      
      await this.updateProject(projectId, {
        members: updatedMembers
      });
      
      // 通知を送信（追加されるユーザーが操作者と異なる場合のみ）
      const notificationService = this.injector.get(NotificationService);
      if (userId !== user.uid) {
        await notificationService.createNotification({
          userId: userId,
          type: NotificationType.ProjectCreated,
          title: 'プロジェクトに追加されました',
          message: `プロジェクト「${project.name}」に追加されました`,
          projectId: projectId
        });
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // メンバーを削除
  async removeMember(projectId: string, userId: string): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');
      
      // 権限チェック（オーナーまたはプロジェクト管理者）
      if (!await this.canManageMembers(projectId, user.uid)) {
        throw new Error('メンバーを削除する権限がありません');
      }
      
      const project = await this.getProject(projectId);
      if (!project) throw new Error('Project not found');
      
      // オーナー自身は削除不可
      if (project.ownerId === userId) {
        throw new Error('オーナーは削除できません');
      }
      
      // 自分自身は削除不可（退会機能は別途実装）
      if (user.uid === userId) {
        throw new Error('自分自身を削除することはできません');
      }
      
      // メンバーを削除
      const updatedMembers = (project.members || []).filter(m => m.userId !== userId);
      
      await this.updateProject(projectId, {
        members: updatedMembers
      });
      
      // 通知を送信（削除されるユーザーが操作者と異なる場合のみ）
      const notificationService = this.injector.get(NotificationService);
      if (userId !== user.uid) {
        await notificationService.createNotification({
          userId: userId,
          type: NotificationType.ProjectCreated,
          title: 'プロジェクトから削除されました',
          message: `プロジェクト「${project.name}」から削除されました`,
          projectId: projectId
        });
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // メンバーの役割を変更
  async updateMemberRole(projectId: string, userId: string, newRole: ProjectRole): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');
      
      // 権限チェック（オーナーまたはチーム管理者）
      if (!await this.canManageMembers(projectId, user.uid)) {
        throw new Error('メンバーの役割を変更する権限がありません');
      }
      
      const project = await this.getProject(projectId);
      if (!project) throw new Error('Project not found');
      
      // オーナー自身の役割は変更不可
      if (project.ownerId === userId) {
        throw new Error('オーナーの役割は変更できません');
      }
      
      // メンバーの役割を更新
      const updatedMembers = (project.members || []).map(m => 
        m.userId === userId ? { ...m, role: newRole } : m
      );
      
      await this.updateProject(projectId, {
        members: updatedMembers
      });
      
      // 通知を送信（変更されるユーザーが操作者と異なる場合のみ）
      const member = project.members?.find(m => m.userId === userId);
      if (member && userId !== user.uid) {
        const notificationService = this.injector.get(NotificationService);
        await notificationService.createNotification({
          userId: userId,
          type: NotificationType.ProjectCreated,
          title: 'プロジェクトの役割が変更されました',
          message: `プロジェクト「${project.name}」の役割が「${this.getRoleLabel(newRole)}」に変更されました`,
          projectId: projectId
        });
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 役割のラベルを取得（ヘルパーメソッド）
  getRoleLabel(role: ProjectRole): string {
    const roleMap: { [key: string]: string } = {
      [ProjectRole.Owner]: 'オーナー',
      // [ProjectRole.Admin]: 'プロジェクト管理者', // 削除
      [ProjectRole.Member]: 'メンバー',
      [ProjectRole.Viewer]: '閲覧者'
    };
    return roleMap[role] || role;
  }

  async getProjectsForUser(userId: string, teamId: string | null = null, userTeamIds: string[] = []): Promise<Project[]> {
    try {
      // 全プロジェクトを取得
      const q = query(
        collection(db, 'projects'),
        where('isDeleted', '==', false)
      );
      
      const snapshot = await getDocs(q);
      let projects: Project[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Project));

      // 個人/チームモードに応じてフィルタリング
      if (teamId === null) {
        // 個人モード: 自分が作成したプロジェクト または 自分が所属しているプロジェクト
        projects = projects.filter(project => {
          // 自分がオーナー（作成者）のプロジェクト
          if (project.ownerId === userId) {
            return true;
          }
          // 自分がメンバーとして参加しているプロジェクト
          if (project.members && project.members.some(member => member.userId === userId)) {
            return true;
          }
          return false;
        });
      } else if (teamId) {
        // チームモード: 選択されたチームに関連するプロジェクト
        // 1. プロジェクトのteamIdが選択されたチームIDと一致する
        // 2. かつ、自分がオーナーまたはメンバーとして参加している
        projects = projects.filter(project => {
          // プロジェクトのteamIdが選択されたチームIDと一致するかチェック
          if (project.teamId !== teamId) {
            return false;
          }
          
          // 自分がオーナー（作成者）のプロジェクト
          if (project.ownerId === userId) {
            return true;
          }
          // 自分がメンバーとして参加しているプロジェクト
          if (project.members && project.members.some(member => member.userId === userId)) {
            return true;
          }
          return false;
        });
      }
      
      return projects;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // プロジェクトの完了率を再計算するメソッド
  async recalculateProjectCompletionRate(projectId: string): Promise<void> {
    try {
      // 遅延注入でTaskServiceを取得（循環依存を回避）
      const taskService = this.injector.get(TaskService);
      
      // プロジェクトに紐づく全タスクを取得
      const tasks = await taskService.getTasks({
        projectId: projectId,
        isDeleted: false
      });

      if (tasks.length === 0) {
        // タスクがない場合は0%
        await this.updateProject(projectId, {
          completionRate: 0,
          totalTasks: 0,
          completedTasks: 0
        });
        return;
      }

      // 完了タスクの数をカウント
      const completedTasks = tasks.filter(task => task.status === 'completed').length;
      
      // 完了率を計算（完了タスク数 / 全タスク数 × 100）
      const completionRate = tasks.length > 0
        ? Math.round((completedTasks / tasks.length) * 100)
        : 0;
      
      // プロジェクトを更新
      await this.updateProject(projectId, {
        completionRate: completionRate,
        totalTasks: tasks.length,
        completedTasks: completedTasks
      });
    } catch (error: any) {
      console.error('Error recalculating project completion rate:', error);
      throw new Error(error.message);
    }
  }

  // プロジェクトを削除（論理削除）
  async deleteProject(
    projectId: string,
    taskDeletionMode: 'all' | 'partial' | 'none',
    taskIdsToDelete?: string[]
  ): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');
      
      // 権限チェック（オーナーまたはチーム管理者）
      if (!await this.canEditProject(projectId, user.uid)) {
        throw new Error('プロジェクトを削除する権限がありません');
      }
      
      const project = await this.getProject(projectId);
      if (!project) throw new Error('Project not found');
      
      // 既に削除されているかチェック
      if (project.isDeleted) {
        throw new Error('このプロジェクトは既に削除されています');
      }
      
      // 遅延注入でTaskServiceを取得（循環依存を回避）
      const taskService = this.injector.get(TaskService);
      
      // プロジェクトに紐づく全タスクを取得
      const projectTasks = await taskService.getTasks({
        projectId: projectId,
        isDeleted: false
      });
      
      // 元々配下にあったタスクのIDを保存（復元時に使用）
      const originalTaskIds = projectTasks.map(task => task.id);
      
      // タスクの処理
      if (taskDeletionMode === 'all') {
        // すべて削除：全タスクを論理削除
        for (const task of projectTasks) {
          await taskService.deleteTask(task.id);
        }
      } else if (taskDeletionMode === 'partial' && taskIdsToDelete) {
        // 一部削除：選択されたタスクを削除、残りはprojectIdを削除
        for (const task of projectTasks) {
          if (taskIdsToDelete.includes(task.id)) {
            await taskService.deleteTask(task.id);
          } else {
            // projectIdとprojectNameを削除
            const taskRef = doc(db, 'tasks', task.id);
            await updateDoc(taskRef, {
              projectId: deleteField(),
              projectName: deleteField(),
              updatedAt: Timestamp.now()
            });
          }
        }
      } else if (taskDeletionMode === 'none') {
        // 削除しない：全タスクのprojectIdを削除
        for (const task of projectTasks) {
          const taskRef = doc(db, 'tasks', task.id);
          await updateDoc(taskRef, {
            projectId: deleteField(),
            projectName: deleteField(),
            updatedAt: Timestamp.now()
          });
        }
      }
      
      // プロジェクトを論理削除（元のタスクIDとステータスを保存）
      const projectRef = doc(db, 'projects', projectId);
      await updateDoc(projectRef, {
        isDeleted: true,
        deletedAt: Timestamp.now(),
        statusBeforeDeletion: project.status, // 削除前のステータスを保存
        originalTaskIds: originalTaskIds, // 元のタスクIDを保存
        updatedAt: Timestamp.now()
      });
      
      // 全メンバーに通知を送信（操作者を除外）
      if (project.members) {
        const notificationService = this.injector.get(NotificationService);
        for (const member of project.members) {
          // 操作者には通知を送らない
          if (member.userId !== user.uid) {
            await notificationService.createNotification({
              userId: member.userId,
              type: NotificationType.ProjectDeleted,
              title: 'プロジェクトが削除されました',
              message: `プロジェクト「${project.name}」が削除されました`,
              projectId: projectId
            });
          }
        }
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // プロジェクトを復元
  async restoreProject(
    projectId: string,
    taskRestoreMode: 'all' | 'partial' | 'none',
    taskIdsToRestore?: string[]
  ): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');
      
      // 権限チェック（オーナーまたはチーム管理者）
      const project = await this.getProject(projectId);
      if (!project) throw new Error('Project not found');
      
      if (!project.isDeleted) {
        throw new Error('このプロジェクトは削除されていません');
      }
      
      // 権限チェック（オーナーまたはチーム管理者）
      if (!await this.canEditProject(projectId, user.uid)) {
        throw new Error('プロジェクトを復元する権限がありません');
      }
      
      // 遅延注入でTaskServiceを取得（循環依存を回避）
      const taskService = this.injector.get(TaskService);
      
      // 元々このプロジェクトに属していたタスクを取得
      const originalTaskIds = project.originalTaskIds || [];
      
      if (originalTaskIds.length === 0) {
        // 元のタスクIDがない場合（古いデータなど）、プロジェクトのみ復元
        const restoreUpdates: any = {
          isDeleted: false,
          deletedAt: deleteField(),
          updatedAt: Timestamp.now()
        };
        
        // 削除前のステータスがあれば復元、なければ準備中に戻す
        if (project.statusBeforeDeletion) {
          restoreUpdates.status = project.statusBeforeDeletion;
          restoreUpdates.statusBeforeDeletion = deleteField();
        } else {
          restoreUpdates.status = ProjectStatus.NotStarted;
        }
        
        const projectRef = doc(db, 'projects', projectId);
        await updateDoc(projectRef, restoreUpdates);
        
        // 全メンバーに通知を送信（操作者を除外）
        if (project.members) {
          const notificationService = this.injector.get(NotificationService);
          for (const member of project.members) {
            // 操作者には通知を送らない
            if (member.userId !== user.uid) {
              await notificationService.createNotification({
                userId: member.userId,
                type: NotificationType.ProjectRestored,
                title: 'プロジェクトが復元されました',
                message: `プロジェクト「${project.name}」が復元されました`,
                projectId: projectId
              });
            }
          }
        }
        return;
      }
      
      // タスクを取得（削除されているものも含む）
      const allTasks: any[] = [];
      for (const taskId of originalTaskIds) {
        try {
          const task = await taskService.getTask(taskId);
          if (task) {
            allTasks.push(task);
          }
        } catch (error: any) {
          // タスクが見つからない場合はスキップ
          console.warn(`Task ${taskId} not found:`, error.message);
        }
      }
      
      // タスクの処理
      if (taskRestoreMode === 'all') {
        // すべて戻す：元々配下にあったタスクのprojectIdを復元
        for (const task of allTasks) {
          try {
            if (task.isDeleted) {
              // 削除されているタスクは先に復元
              await taskService.updateTask(task.id, {
                isDeleted: false,
                deletedAt: undefined,
                status: task.statusBeforeDeletion || 'not_started',
                statusBeforeDeletion: undefined,
                completedAt: task.statusBeforeDeletion === 'completed' ? task.completedAt : undefined
              }, true);
            }
            
            // projectIdを復元
            const taskRef = doc(db, 'tasks', task.id);
            await updateDoc(taskRef, {
              projectId: projectId,
              projectName: project.name,
              updatedAt: Timestamp.now()
            });
          } catch (error: any) {
            console.error(`Error restoring task ${task.id}:`, error);
            // タスクの復元に失敗しても続行
          }
        }
      } else if (taskRestoreMode === 'partial' && taskIdsToRestore) {
        // 一部戻す：選択されたタスクのprojectIdを復元
        for (const task of allTasks) {
          if (taskIdsToRestore.includes(task.id)) {
            try {
              if (task.isDeleted) {
                // 削除されているタスクは先に復元
                await taskService.updateTask(task.id, {
                  isDeleted: false,
                  deletedAt: undefined,
                  status: task.statusBeforeDeletion || 'not_started',
                  statusBeforeDeletion: undefined,
                  completedAt: task.statusBeforeDeletion === 'completed' ? task.completedAt : undefined
                }, true);
              }
              
              // projectIdを復元
              const taskRef = doc(db, 'tasks', task.id);
              await updateDoc(taskRef, {
                projectId: projectId,
                projectName: project.name,
                updatedAt: Timestamp.now()
              });
            } catch (error: any) {
              console.error(`Error restoring task ${task.id}:`, error);
              // タスクの復元に失敗しても続行
            }
          }
        }
      }
      // taskRestoreMode === 'none' の場合は何もしない
      
      // プロジェクトを復元
      const restoreUpdates: any = {
        isDeleted: false,
        deletedAt: deleteField(),
        originalTaskIds: deleteField(), // 復元後は不要なので削除
        updatedAt: Timestamp.now()
      };
      
      // 削除前のステータスがあれば復元、なければ準備中に戻す
      if (project.statusBeforeDeletion) {
        restoreUpdates.status = project.statusBeforeDeletion;
        restoreUpdates.statusBeforeDeletion = deleteField();
      } else {
        restoreUpdates.status = ProjectStatus.NotStarted;
      }
      
      const projectRef = doc(db, 'projects', projectId);
      await updateDoc(projectRef, restoreUpdates);
      
      // 全メンバーに通知を送信（操作者を除外）
      if (project.members) {
        const notificationService = this.injector.get(NotificationService);
        for (const member of project.members) {
          // 操作者には通知を送らない
          if (member.userId !== user.uid) {
            try {
              await notificationService.createNotification({
                userId: member.userId,
                type: NotificationType.ProjectRestored,
                title: 'プロジェクトが復元されました',
                message: `プロジェクト「${project.name}」が復元されました`,
                projectId: projectId
              });
            } catch (error: any) {
              console.error(`Error sending notification to ${member.userId}:`, error);
              // 通知の送信に失敗しても続行
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Error restoring project:', error);
      throw new Error(error.message || 'プロジェクトの復元に失敗しました');
    }
  }

  // プロジェクトの日付チェック（開始日経過時に自動で準備中→進行中に変更）
  checkProjectDates(project: Project): { needsStartDateCheck: boolean } {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // 今日既にチェック済みか確認（日付のみで判断）
    if (project.dateCheckedAt) {
      const checkedDate = project.dateCheckedAt.toDate();
      const checkedDateOnly = new Date(checkedDate.getFullYear(), checkedDate.getMonth(), checkedDate.getDate());
      if (checkedDateOnly.getTime() === today.getTime()) {
        // 今日既にチェック済み
        return { needsStartDateCheck: false };
      }
    }
    
    // 開始日時のチェック（準備中で開始日時を過ぎている）
    const startDate = project.startDate.toDate();
    const startTime = startDate.getHours() * 3600 + startDate.getMinutes() * 60 + startDate.getSeconds();
    const needsStartDateCheck = project.status === ProjectStatus.NotStarted && 
                                (startTime === 0 ? 
                                  startDate.getTime() < today.getTime() : 
                                  startDate.getTime() < now.getTime());
    
    return { needsStartDateCheck };
  }

  // プロジェクトの開始日チェックを実行（自動ステータス変更と通知送信）
  async checkAndUpdateProjectStartDate(project: Project): Promise<boolean> {
    try {
      const checkResult = this.checkProjectDates(project);
      
      if (checkResult.needsStartDateCheck) {
        // ステータスを進行中に変更
        await this.updateProject(project.id, {
          status: ProjectStatus.InProgress,
          dateCheckedAt: Timestamp.now()
        });
        
        // 全メンバーに通知を送信（操作者を除外）
        const user = this.authService.currentUser;
        if (project.members) {
          const notificationService = this.injector.get(NotificationService);
          for (const member of project.members) {
            // 操作者には通知を送らない
            if (!user || member.userId !== user.uid) {
              await notificationService.createNotification({
                userId: member.userId,
                type: NotificationType.ProjectUpdated,
                title: 'プロジェクトが進行中になりました',
                message: `プロジェクト「${project.name}」が開始日を過ぎたため、進行中に変更されました`,
                projectId: project.id
              });
            }
          }
        }
        
        return true; // ステータス変更が行われた
      }
      
      return false; // ステータス変更は不要
    } catch (error: any) {
      console.error('Error checking project start date:', error);
      return false;
    }
  }
}

