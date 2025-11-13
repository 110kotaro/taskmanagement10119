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

      const project: any = {
        name: projectData.name || '',
        description: projectData.description,
        ownerId: user.uid,
        ownerName: user.displayName || user.email || 'Unknown',
        members: [{
          userId: user.uid,
          userName: user.displayName || user.email || 'Unknown',
          userEmail: user.email || '',
          role: ProjectRole.Member, // 作成者はメンバー（チーム管理者が権限を持つ）
          joinedAt: Timestamp.now()
        }],
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

      // 担当者IDと担当者名は、undefinedでない場合のみ追加（Firestoreはundefinedを許可しない）
      if (assigneeId !== undefined) {
        project.assigneeId = assigneeId;
      }
      if (assigneeName !== undefined) {
        project.assigneeName = assigneeName;
      }

      // チームIDとチーム名は、undefinedでない場合のみ追加（Firestoreはundefinedを許可しない）
      if (teamId !== undefined) {
        project.teamId = teamId;
      }
      if (teamName !== undefined) {
        project.teamName = teamName;
      }

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

  async updateProject(projectId: string, updates: Partial<Project>, skipAutoComment: boolean = false): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');
      
      const project = await this.getProject(projectId);
      if (!project) throw new Error('Project not found');
      
      // コメントのみの更新の場合は閲覧権限で許可、それ以外は編集権限が必要
      // updatedAtなどを除外して判定
      const updateKeys = Object.keys(updates).filter(key => key !== 'updatedAt');
      const isCommentOnlyUpdate = updateKeys.length === 1 && updates.comments !== undefined;
      if (isCommentOnlyUpdate) {
        if (!await this.canViewProject(projectId, user.uid)) {
          throw new Error('プロジェクトを閲覧する権限がありません');
        }
      } else {
        if (!await this.canEditProject(projectId, user.uid)) {
          throw new Error('プロジェクトを編集する権限がありません');
        }
      }
      
      // ステータスが変更される場合、dateCheckedAtをリセット
      // これにより、誤ってステータスを戻した場合も再度チェックされる
      if (updates.status !== undefined && project.status !== updates.status) {
        // ステータスが変更された場合、dateCheckedAtをリセット
        // undefinedにすることで、後でcleanUpdatesの処理でdeleteField()に変換される
        updates.dateCheckedAt = undefined;
        
        // ステータスが「完了」に変更された場合、配下のタスクIDを保存（復元時に使用）
        if (updates.status === ProjectStatus.Completed) {
          // 既にoriginalTaskIdsが存在する場合は保持、存在しない場合のみ保存
          if (!project.originalTaskIds || project.originalTaskIds.length === 0) {
            const taskService = this.injector.get(TaskService);
            // プロジェクトに紐づく全タスクを取得
            const projectTasks = await taskService.getTasks({
              projectId: projectId,
              isDeleted: false
            });
            // 元々配下にあったタスクのIDを保存（復元時に使用）
            const originalTaskIds = projectTasks.map(task => task.id);
            updates.originalTaskIds = originalTaskIds;
          }
        }
      }
      
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
      
      // 担当者変更のチェック
      if (updates.assigneeId !== undefined && updates.assigneeId !== project.assigneeId) {
        const notificationService = this.injector.get(NotificationService);
        const updaterName = user.displayName || user.email || 'Unknown';
        
        // 新しい担当者に通知（操作者と異なる場合）
        if (updates.assigneeId && updates.assigneeId !== '' && updates.assigneeId !== user.uid) {
          await notificationService.createNotification({
            userId: updates.assigneeId,
            type: NotificationType.ProjectUpdated,
            title: 'プロジェクトの担当者になりました',
            message: `${updaterName}がプロジェクト「${project.name}」の担当者にあなたを設定しました`,
            projectId: projectId
          });
        }
        
        // 元の担当者に通知（操作者と異なり、新しい担当者とも異なる場合）
        if (project.assigneeId && project.assigneeId !== '' && project.assigneeId !== user.uid && project.assigneeId !== updates.assigneeId) {
          await notificationService.createNotification({
            userId: project.assigneeId,
            type: NotificationType.ProjectUpdated,
            title: 'プロジェクトの担当者が変更されました',
            message: `${updaterName}がプロジェクト「${project.name}」の担当者を変更しました`,
            projectId: projectId
          });
        }
        
        // プロジェクトメンバー全員に通知（操作者、新旧の担当者を除外）
        if (project.members) {
          for (const member of project.members) {
            // 操作者、新しい担当者、元の担当者はスキップ
            if (member.userId !== user.uid && 
                member.userId !== updates.assigneeId && 
                member.userId !== project.assigneeId) {
              await notificationService.createNotification({
                userId: member.userId,
                type: NotificationType.ProjectUpdated,
                title: 'プロジェクトの担当者が変更されました',
                message: `${updaterName}がプロジェクト「${project.name}」の担当者を変更しました`,
                projectId: projectId
              });
            }
          }
        }
      }
      
      // undefinedの値を除外して、削除したいフィールドは deleteField を使う
      const cleanUpdates: any = {};
      
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'updatedAt' || key === 'comments') {
          // updatedAtは後で設定するのでスキップ
          // commentsは後で自動追加または明示的に設定するのでスキップ
          continue;
        } else if (value === undefined) {
          // undefinedの場合は削除（FirestoreのFieldValue.delete()を使う）
          cleanUpdates[key] = deleteField();
        } else {
          cleanUpdates[key] = value;
        }
      }
      
      // 自動コメント追加（skipAutoCommentがfalseの場合のみ）
      if (!skipAutoComment) {
        const existingComments = project.comments || [];
        const userName = user.displayName || user.email || 'Unknown';
        
        // ステータス変更のコメント
        let statusComment = '';
        if (updates.status && updates.status !== project.status) {
          const statusLabels: { [key: string]: string } = {
            'not_started': '準備中',
            'in_progress': '進行中',
            'completed': '完了'
          };
          statusComment = `ステータスを${statusLabels[updates.status] || updates.status}に変更しました`;
        }
        
        // 終了日変更のコメント
        let endDateComment = '';
        if (updates.endDate && project.endDate) {
          const oldDate = project.endDate.toDate();
          let newDate: Date;
          if (updates.endDate && typeof (updates.endDate as any).toDate === 'function') {
            // Timestamp型の場合
            newDate = (updates.endDate as any).toDate();
          } else if (updates.endDate instanceof Date) {
            // Date型の場合
            newDate = updates.endDate;
          } else {
            // その他の場合（文字列や数値など）
            newDate = new Date(updates.endDate as any);
          }
          if (oldDate.getTime() !== newDate.getTime()) {
            const formatDate = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
            endDateComment = `終了日を${formatDate(oldDate)}から${formatDate(newDate)}に変更しました`;
          }
        }
        
        // 通常の編集コメント（ステータスや終了日以外の変更）
        let editComment = '';
        if (!statusComment && !endDateComment) {
          editComment = `${userName}が編集しました`;
        }
        
        // 既に同じ内容のコメントがある場合は追加しない（連続編集を防ぐ）
        const recentComment = existingComments.length > 0 
          ? existingComments[existingComments.length - 1]
          : null;
        
        // 直近のコメントが同じ内容で、同じユーザーかつ1分以内の場合はスキップ
        const commentText = statusComment || endDateComment || editComment;
        const shouldAddComment = !recentComment || 
          recentComment.content !== commentText ||
          recentComment.userId !== user.uid ||
          (Timestamp.now().toMillis() - recentComment.createdAt.toMillis()) > 60000; // 1分以上前
        
        if (shouldAddComment && commentText) {
          const newComment: any = {
            id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
            userId: user.uid,
            userName: userName,
            content: commentText,
            createdAt: Timestamp.now()
          };
          
          cleanUpdates.comments = [...existingComments, newComment];
        }
      } else if (updates.comments) {
        // skipAutoCommentがtrueでも、明示的にcommentsが更新されている場合はそれを使用
        cleanUpdates.comments = updates.comments;
      }
      
      // updatedAtは常に含める
      cleanUpdates.updatedAt = Timestamp.now();
      
      const projectRef = doc(db, 'projects', projectId);
      await updateDoc(projectRef, cleanUpdates);
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // プロジェクトの閲覧権限をチェック（オーナー、メンバー、またはチームメンバー）
  async canViewProject(projectId: string, userId: string, teamId: string | null = null): Promise<boolean> {
    try {
      const project = await this.getProject(projectId);
      if (!project) return false;
      
      // 個人モードの場合のみ新しい条件を適用
      if (teamId === null) {
        // 自分が担当者のプロジェクト（担当者がいない場合は作成者の）
        const projectAssigneeId = project.assigneeId || project.ownerId;
        if (projectAssigneeId === userId) {
          return true;
        }
        
        // 自分が担当者のタスクがあるプロジェクト（担当者がいない場合は作成者の）
        const taskService = this.injector.get(TaskService);
        const assignedTasks = await taskService.getTasks({
          projectId: projectId,
          isDeleted: false,
          assigneeId: userId
        });
        if (assignedTasks.length > 0) {
          return true;
        }
        
        // 自分が作成したタスクで担当者がいないものがプロジェクト内にある場合
        const createdTasksWithoutAssignee = await taskService.getTasks({
          projectId: projectId,
          isDeleted: false,
          creatorId: userId
        });
        const tasksWithoutAssignee = createdTasksWithoutAssignee.filter(task => !task.assigneeId);
        if (tasksWithoutAssignee.length > 0) {
          return true;
        }
        
        return false;
      }
      
      // チームモードの場合は従来の条件を適用
      // オーナーは閲覧可能
      if (this.hasOwnerPermissions(userId, project)) return true;
      
      // プロジェクトメンバーは閲覧可能
      if (project.members && project.members.some(m => m.userId === userId)) {
        return true;
      }
      
      // チームプロジェクトの場合、チームメンバー全員が閲覧可能
      if (project.teamId) {
        const teamService = this.injector.get(TeamService);
        const team = await teamService.getTeam(project.teamId);
        if (team) {
          const isOwner = team.ownerId === userId;
          const isMember = team.members.some(m => m.userId === userId);
          if (isOwner || isMember) return true;
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  // プロジェクトの編集権限をチェック（オーナー、担当者、またはチーム管理者）
  async canEditProject(projectId: string, userId: string): Promise<boolean> {
    try {
      const project = await this.getProject(projectId);
      if (!project) return false;
      
      // オーナーは編集可能
      if (this.hasOwnerPermissions(userId, project)) return true;
      
      // 担当者も編集可能
      if (project.assigneeId === userId) return true;
      
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

  // メンバー管理の権限チェック（オーナー、担当者、またはチーム管理者）
  async canManageMembers(projectId: string, userId: string): Promise<boolean> {
    try {
      const project = await this.getProject(projectId);
      if (!project) return false;
      
      // オーナーはメンバー管理可能
      if (this.hasOwnerPermissions(userId, project)) return true;
      
      // 担当者もメンバー管理可能
      if (project.assigneeId === userId) return true;
      
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
      }, true); // skipAutoComment = true（メンバー追加は自動コメントなし）
      
      // 通知を送信（追加されるユーザーが操作者と異なる場合のみ）
      const notificationService = this.injector.get(NotificationService);
      if (userId !== user.uid) {
        // 追加されるメンバーへの個人向け通知
        await notificationService.createNotification({
          userId: userId,
          type: NotificationType.ProjectMemberAdded,
          title: 'プロジェクトに追加されました',
          message: `プロジェクト「${project.name}」に追加されました`,
          projectId: projectId
        });
      }
      
      // プロジェクト全員に通知（追加されるメンバーと操作した人を除く）
      const currentUserId = user.uid; // 操作した人のIDを変数に保存
      const allProjectMembers = [
        ...(project.members || []),
        ...(project.ownerId && !project.members?.some(m => m.userId === project.ownerId) 
          ? [{ userId: project.ownerId }] 
          : [])
      ];
      
      for (const member of allProjectMembers) {
        // 追加されるメンバーと操作した人を除く
        if (member.userId === userId || member.userId === currentUserId) {
          continue;
        }
        
        // プロジェクト向けの通知
        await notificationService.createNotification({
          userId: member.userId,
          type: NotificationType.ProjectMemberAdded,
          title: 'プロジェクトメンバーが追加されました',
          message: `${user.displayName || user.email}が${userName}をプロジェクト「${project.name}」に追加しました`,
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
      
      const projectUpdates: any = {
        members: updatedMembers
      };
      
      // プロジェクトの担当者が削除されるユーザーの場合、未割当にする
      // updateProjectのcleanUpdatesがundefinedをdeleteField()に変換してくれる
      if (project.assigneeId === userId) {
        projectUpdates.assigneeId = undefined;
        projectUpdates.assigneeName = undefined;
      }
      
      // 削除されるメンバーの情報を取得（通知で使用するため）
      const deletedMember = project.members?.find(m => m.userId === userId);
      
      // updateProject呼び出し（自動コメントをスキップ）
      await this.updateProject(projectId, projectUpdates, true); // skipAutoComment = true
      
      // プロジェクトのタスクで削除されるユーザーが担当者の場合、未割当にする
      const tasksQuery = query(
        collection(db, 'tasks'),
        where('projectId', '==', projectId),
        where('assigneeId', '==', userId),
        where('isDeleted', '==', false)
      );
      const tasksSnapshot = await getDocs(tasksQuery);
      
      for (const taskDoc of tasksSnapshot.docs) {
        // 直接updateDocを使う場合はdeleteField()を使う必要がある
        await updateDoc(doc(db, 'tasks', taskDoc.id), {
          assigneeId: deleteField(),
          assigneeName: deleteField()
        });
      }
      
      // 通知を送信（削除されるユーザーが操作者と異なる場合のみ）
      const notificationService = this.injector.get(NotificationService);
      if (userId !== user.uid) {
        // 削除されるメンバーへの個人向け通知
        await notificationService.createNotification({
          userId: userId,
          type: NotificationType.ProjectMemberRemoved,
          title: 'プロジェクトから削除されました',
          message: `プロジェクト「${project.name}」から削除されました`,
          projectId: projectId
        });
      }
      
      // プロジェクト全員に通知（削除されるメンバーと操作した人を除く）
      const currentUserId = user.uid; // 操作した人のIDを変数に保存
      const allProjectMembers = [
        ...(project.members || []),
        ...(project.ownerId && !project.members?.some(m => m.userId === project.ownerId) 
          ? [{ userId: project.ownerId }] 
          : [])
      ];
      
      for (const member of allProjectMembers) {
        // 削除されるメンバーと操作した人を除く
        if (member.userId === userId || member.userId === currentUserId) {
          continue;
        }
        
        // プロジェクト向けの通知
        await notificationService.createNotification({
          userId: member.userId,
          type: NotificationType.ProjectMemberRemoved,
          title: 'プロジェクトメンバーが削除されました',
          message: `${user.displayName || user.email}が${deletedMember?.userName || 'メンバー'}をプロジェクト「${project.name}」から削除しました`,
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
      }, true); // skipAutoComment = true（メンバー権限変更は自動コメントなし）
      
      // 通知を送信（変更されるユーザーが操作者と異なる場合のみ）
      const member = project.members?.find(m => m.userId === userId);
      if (member && userId !== user.uid) {
        const notificationService = this.injector.get(NotificationService);
        await notificationService.createNotification({
          userId: userId,
          type: NotificationType.ProjectMemberRoleChanged,
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
        // 個人モード: 自分が担当者のプロジェクト（担当者がいない場合は作成者の）
        // または 自分が担当者のタスクがあるプロジェクト（担当者がいない場合は作成者の）
        const taskService = this.injector.get(TaskService);
        
        // 自分が担当しているタスクを取得
        const assignedTasks = await taskService.getTasks({
          isDeleted: false,
          assigneeId: userId
        });
        
        // 自分が作成したタスクで担当者がいないものを取得
        const createdTasksWithoutAssignee = await taskService.getTasks({
          isDeleted: false,
          creatorId: userId
        });
        const tasksWithoutAssignee = createdTasksWithoutAssignee.filter(task => !task.assigneeId);
        
        // 担当タスクまたは作成者で担当者がいないタスクがあるプロジェクトIDのセットを作成
        const projectIdsWithRelevantTasks = new Set<string>();
        for (const task of [...assignedTasks, ...tasksWithoutAssignee]) {
          if (task.projectId) {
            projectIdsWithRelevantTasks.add(task.projectId);
          }
        }
        
        projects = projects.filter(project => {
          // 自分が担当者のプロジェクト（担当者がいない場合は作成者の）
          const projectAssigneeId = project.assigneeId || project.ownerId;
          if (projectAssigneeId === userId) {
            return true;
          }
          // 自分が担当者のタスクがあるプロジェクト（担当者がいない場合は作成者の）
          if (projectIdsWithRelevantTasks.has(project.id)) {
            return true;
          }
          return false;
        });
      } else if (teamId) {
        // チームモード: 選択されたチームに関連するプロジェクト
        // チームメンバー全員が閲覧可能
        projects = projects.filter(project => {
          // プロジェクトのteamIdが選択されたチームIDと一致するかチェック
          return project.teamId === teamId;
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
        }, true);
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
      }, true);
    } catch (error: any) {
      console.error('Error recalculating project completion rate:', error);
      // エラーをログに記録するが、throwしない（タスク削除自体は成功として扱う）
      // エラーメッセージがない場合のフォールバック
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      console.error('Error details:', errorMessage);
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
      
      // 完了したプロジェクトの復元（削除されていないが完了状態）
      const isCompletedProject = !project.isDeleted && project.status === ProjectStatus.Completed;
      
      if (!project.isDeleted && !isCompletedProject) {
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
      
      if (originalTaskIds.length === 0 && !isCompletedProject) {
        // 削除されたプロジェクトで、元のタスクIDがない場合（古いデータなど）、プロジェクトのみ復元
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
      
      // 完了したプロジェクトで、originalTaskIdsがない場合は、現在のプロジェクトに紐づくタスクを取得
      let tasksToRestore: any[] = [];
      if (isCompletedProject && originalTaskIds.length === 0) {
        // 現在のプロジェクトに紐づくタスクを取得
        const currentTasks = await taskService.getTasks({
          projectId: projectId,
          isDeleted: false
        });
        tasksToRestore = currentTasks;
      } else {
        // タスクを取得（削除されているものも含む）
        for (const taskId of originalTaskIds) {
          try {
            const task = await taskService.getTask(taskId);
            if (task) {
              tasksToRestore.push(task);
            }
          } catch (error: any) {
            // タスクが見つからない場合はスキップ
            console.warn(`Task ${taskId} not found:`, error.message);
          }
        }
      }
      
      // タスクの処理
      if (taskRestoreMode === 'all') {
        // すべて戻す：元々配下にあったタスクのprojectIdを復元
        for (const task of tasksToRestore) {
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
        for (const task of tasksToRestore) {
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
        updatedAt: Timestamp.now()
      };
      
      if (isCompletedProject) {
        // 完了したプロジェクトの復元：ステータスを変更（削除前のステータスがあればそれに、なければ進行中）
        if (project.statusBeforeDeletion) {
          restoreUpdates.status = project.statusBeforeDeletion;
          restoreUpdates.statusBeforeDeletion = deleteField();
        } else {
          restoreUpdates.status = ProjectStatus.InProgress;
        }
        // originalTaskIdsは保持（完了時に保存されたもの）
      } else {
        // 削除されたプロジェクトの復元
        restoreUpdates.isDeleted = false;
        restoreUpdates.deletedAt = deleteField();
        restoreUpdates.originalTaskIds = deleteField(); // 復元後は不要なので削除
        
        // 削除前のステータスがあれば復元、なければ準備中に戻す
        if (project.statusBeforeDeletion) {
          restoreUpdates.status = project.statusBeforeDeletion;
          restoreUpdates.statusBeforeDeletion = deleteField();
        } else {
          restoreUpdates.status = ProjectStatus.NotStarted;
        }
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
                                  startDate.getTime() <= today.getTime() : 
                                  startDate.getTime() < now.getTime());
    
    return { needsStartDateCheck };
  }

  // プロジェクトの開始日チェックを実行（自動ステータス変更と通知送信）
  async checkAndUpdateProjectStartDate(project: Project, isAutomatic: boolean = true): Promise<boolean> {
    try {
      const checkResult = this.checkProjectDates(project);
      
      if (checkResult.needsStartDateCheck) {
        // ステータスを進行中に変更
        await this.updateProject(project.id, {
          status: ProjectStatus.InProgress,
          dateCheckedAt: Timestamp.now()
        });
        
        // 全メンバーに通知を送信
        if (project.members) {
          const notificationService = this.injector.get(NotificationService);
          const user = this.authService.currentUser;
          
          for (const member of project.members) {
            // 自動処理の場合は全メンバーに通知を送る
            // 手動更新の場合は操作者を除外
            if (isAutomatic || !user || member.userId !== user.uid) {
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

  // プロジェクトの日付チェック済みフラグを更新
  async markProjectDateChecked(projectId: string): Promise<void> {
    try {
      const projectRef = doc(db, 'projects', projectId);
      await updateDoc(projectRef, {
        dateCheckedAt: Timestamp.now()
      });
    } catch (error: any) {
      console.error('Error marking project date checked:', error);
    }
  }
}

