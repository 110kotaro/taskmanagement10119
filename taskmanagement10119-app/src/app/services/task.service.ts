import { Injectable, inject } from '@angular/core';
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
  orderBy,
  Timestamp,
  QueryConstraint,
  deleteField
} from 'firebase/firestore';
import { db } from '../../firebase-config';
import { Task, TaskStatus, RecurrenceType } from '../models/task.model';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { ProjectService } from './project.service';
import { NotificationType } from '../models/notification.model';
import { User, UserRole } from '../models/user.model';
import { TeamService } from './team.service';

@Injectable({
  providedIn: 'root'
})
export class TaskService {
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);
  private projectService = inject(ProjectService);
  private teamService = inject(TeamService);

  async createTask(taskData: Partial<Task>): Promise<string> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      // 個人タスクの場合、担当者を自動で作成者に設定
      let finalAssigneeId = taskData.assigneeId;
      let finalAssigneeName = taskData.assigneeName;
      if (!taskData.teamId) {
        finalAssigneeId = user.uid;
        finalAssigneeName = user.displayName || user.email || 'Unknown';
      }

      // undefinedのフィールドを除外する
      const task: any = {
        title: taskData.title || '',
        assigneeId: finalAssigneeId || '',
        assigneeName: finalAssigneeName || '',
        creatorId: user.uid,
        creatorName: user.displayName || user.email || 'Unknown',
        status: taskData.status || TaskStatus.NotStarted,
        startDate: taskData.startDate || Timestamp.now(),
        endDate: taskData.endDate || Timestamp.now(),
        priority: taskData.priority || 'normal' as any,
        taskType: taskData.taskType || 'normal' as any,
        files: taskData.files || [],
        subtasks: taskData.subtasks || [],
        progress: taskData.progress || 0,
        showProgress: taskData.showProgress !== undefined ? taskData.showProgress : true,
        progressManual: taskData.progressManual !== undefined ? taskData.progressManual : false,
        reminders: taskData.reminders || [],
        comments: taskData.comments || [],
        workSessions: taskData.workSessions || [],
        totalWorkTime: taskData.totalWorkTime || 0,
        recurrence: taskData.recurrence || RecurrenceType.None,
        isDeleted: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      // undefinedでないフィールドのみ追加
      if (taskData.description !== undefined) task.description = taskData.description;
      if (taskData.projectId !== undefined) task.projectId = taskData.projectId;
      if (taskData.projectName !== undefined) task.projectName = taskData.projectName;
      if (taskData.teamId !== undefined) task.teamId = taskData.teamId;
      if (taskData.teamName !== undefined) task.teamName = taskData.teamName;
      if (taskData.customPriority !== undefined) task.customPriority = taskData.customPriority;
      if (taskData.memo !== undefined) task.memo = taskData.memo;
      if (taskData.recurrenceEndDate !== undefined) task.recurrenceEndDate = taskData.recurrenceEndDate;

      const docRef = await addDoc(collection(db, 'tasks'), task);
      const taskId = docRef.id;

      // 通知を送信
      await this.sendTaskCreatedNotifications(taskId, task);

      // プロジェクトに紐づいている場合は、プロジェクトの完了率を再計算
      if (taskData.projectId) {
        await this.projectService.recalculateProjectCompletionRate(taskData.projectId);
      }

      return taskId;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async getTask(taskId: string): Promise<Task | null> {
    try {
      const docRef = doc(db, 'tasks', taskId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as Task;
      }
      return null;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 権限チェックメソッド
  async canViewTask(task: Task, userId: string): Promise<boolean> {
    try {
      // タスク作成者は常に閲覧可能
      if (task.creatorId === userId) return true;
      
      // チームタスクの場合のみ、担当者も閲覧可能
      if (task.teamId && task.assigneeId === userId) return true;
      
      // チームタスクの場合、チームメンバー全員が閲覧可能
      if (task.teamId) {
        const team = await this.teamService.getTeam(task.teamId);
        if (team) {
          const isOwner = team.ownerId === userId;
          const isMember = team.members.some(m => m.userId === userId);
          if (isOwner || isMember) return true;
        }
      }
      
      // プロジェクトタスクの場合、プロジェクトメンバーまたはチームメンバーも閲覧可能
      if (task.projectId) {
        const project = await this.projectService.getProject(task.projectId);
        if (project) {
          // プロジェクトオーナーは閲覧可能
          if (project.ownerId === userId) return true;
          // プロジェクトメンバーも閲覧可能
          if (project.members && project.members.some(m => m.userId === userId)) {
            return true;
          }
          // チームプロジェクトの場合、チームメンバー全員が閲覧可能
          if (project.teamId) {
            const team = await this.teamService.getTeam(project.teamId);
            if (team) {
              const isOwner = team.ownerId === userId;
              const isMember = team.members.some(m => m.userId === userId);
              if (isOwner || isMember) return true;
            }
          }
        }
      }
      
      // 個人タスクの場合、作成者のみ閲覧可能（既にチェック済み）
      return false;
    } catch (error) {
      console.error('Error checking view permission:', error);
      return false;
    }
  }

  async canEditTask(task: Task, userId: string): Promise<boolean> {
    try {
      // タスク作成者は編集可能
      if (task.creatorId === userId) return true;
      
      // チームタスクの場合のみ、担当者も編集可能
      if (task.teamId && task.assigneeId === userId) return true;
      
      // チームタスクの場合、チーム管理者（オーナー含む）も編集可能
      if (task.teamId) {
        const canEdit = await this.teamService.canEditTeam(task.teamId, userId);
        if (canEdit) return true;
      }
      
      // プロジェクトタスクの場合、タスク作成者・担当者・プロジェクトオーナー・プロジェクト担当者が編集可能
      if (task.projectId) {
        const project = await this.projectService.getProject(task.projectId);
        if (project) {
          // タスク担当者も編集可能
          if (task.assigneeId === userId) return true;
          // プロジェクトオーナーも編集可能
          if (project.ownerId === userId) return true;
          // プロジェクト担当者も編集可能
          if (project.assigneeId === userId) return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking edit permission:', error);
      return false;
    }
  }

  async canDeleteTask(task: Task, userId: string): Promise<boolean> {
    try {
      // タスク作成者は削除可能
      if (task.creatorId === userId) return true;
      
      // チームタスクの場合、チーム管理者（オーナー含む）も削除可能
      if (task.teamId) {
        const canEdit = await this.teamService.canEditTeam(task.teamId, userId);
        if (canEdit) return true;
      }
      
      // プロジェクトタスクの場合、プロジェクトオーナーも削除可能
      if (task.projectId) {
        const project = await this.projectService.getProject(task.projectId);
        if (project && project.ownerId === userId) return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking delete permission:', error);
      return false;
    }
  }

  async canRestoreTask(task: Task, userId: string): Promise<boolean> {
    // 復元権限は削除権限と同じ
    return await this.canDeleteTask(task, userId);
  }

  async canPermanentlyDeleteTask(task: Task, userId: string): Promise<boolean> {
    try {
      // 個人タスクの場合、作成者のみ完全削除可能
      if (!task.teamId) {
        return task.creatorId === userId;
      }
      
      // チームタスクの場合、チーム管理者のみ完全削除可能
      if (task.teamId) {
        const canEdit = await this.teamService.canEditTeam(task.teamId, userId);
        if (canEdit) return true;
      }
      
      // プロジェクトタスクの場合、プロジェクトオーナーも完全削除可能
      if (task.projectId) {
        const project = await this.projectService.getProject(task.projectId);
        if (project && project.ownerId === userId) return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking permanently delete permission:', error);
      return false;
    }
  }

  async updateTask(taskId: string, updates: Partial<Task>, skipAutoComment: boolean = false, skipNotification: boolean = false): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      // 権限チェック（更新前のタスクを取得）
      const taskBeforeUpdate = await this.getTask(taskId);
      if (!taskBeforeUpdate) throw new Error('Task not found');
      
      // コメントのみの更新の場合は閲覧権限で許可、それ以外は編集権限が必要
      // updatedAtなどを除外して判定
      const updateKeys = Object.keys(updates).filter(key => key !== 'updatedAt');
      const isCommentOnlyUpdate = updateKeys.length === 1 && updates.comments !== undefined;
      if (isCommentOnlyUpdate) {
        if (!await this.canViewTask(taskBeforeUpdate, user.uid)) {
          throw new Error('このタスクを閲覧する権限がありません');
        }
      } else {
        if (!await this.canEditTask(taskBeforeUpdate, user.uid)) {
          throw new Error('このタスクを編集する権限がありません');
        }
      }

      // ステータスが変更される場合、dateCheckedAtをリセット
      // これにより、誤ってステータスを戻した場合も再度チェックされる
      if (updates.status !== undefined && taskBeforeUpdate.status !== updates.status) {
        // ステータスが変更された場合、dateCheckedAtをリセット
        // undefinedにすることで、後でcleanUpdatesの処理でdeleteField()に変換される
        updates.dateCheckedAt = undefined;
      }

      // 個人タスクの場合、担当者を自動で作成者に設定（変更を無視）
      if (!taskBeforeUpdate.teamId && updates.assigneeId !== undefined) {
        updates.assigneeId = taskBeforeUpdate.creatorId;
        // assigneeNameも更新
        const creatorUser = await this.authService.getUser(taskBeforeUpdate.creatorId);
        updates.assigneeName = creatorUser?.displayName || creatorUser?.email || 'Unknown';
      }

      // 復元権限チェック（isDeletedがfalseに変更される場合）
      if (updates.isDeleted === false && taskBeforeUpdate.isDeleted === true) {
        if (!await this.canRestoreTask(taskBeforeUpdate, user.uid)) {
          throw new Error('このタスクを復元する権限がありません');
        }
      }

      const taskRef = doc(db, 'tasks', taskId);
      
      // undefinedの値を除外して、削除したいフィールドは deleteField を使う
      const cleanUpdates: any = {};
      
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'updatedAt' || key === 'comments') {
          // updatedAtは後で設定するのでスキップ
          // commentsは後で自動追加するのでスキップ
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
      
      // 自動コメント追加（skipAutoCommentがfalseの場合のみ）
      if (!skipAutoComment) {
        const currentTask = await this.getTask(taskId);
        if (currentTask) {
          const user = this.authService.currentUser;
          if (user) {
            const userName = user.displayName || user.email || 'Unknown';
            const existingComments = currentTask.comments || [];
            
            // ステータス変更のコメント
            let statusComment = '';
            if (updates.status && updates.status !== currentTask.status) {
              const statusLabels: { [key: string]: string } = {
                'not_started': '未着手',
                'in_progress': '進行中',
                'completed': '完了',
                'overdue': '期限超過'
              };
              statusComment = `ステータスを${statusLabels[updates.status] || updates.status}に変更しました`;
            }
            
            // 終了日変更のコメント
            let endDateComment = '';
            if (updates.endDate && currentTask.endDate) {
              const oldDate = currentTask.endDate.toDate();
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
          }
        }
      } else if (updates.comments) {
        // skipAutoCommentがtrueでも、明示的にcommentsが更新されている場合はそれを使用
        cleanUpdates.comments = updates.comments;
      }
      
      await updateDoc(taskRef, cleanUpdates);

      // 更新後のタスクを取得して確認
      const taskAfterUpdate = await this.getTask(taskId);

      // 更新通知を送信（更新前のタスク情報を使用してステータス変更を判定）
      // 復元処理の場合、taskBeforeUpdate.isDeletedを一時的にtrueに設定
      // （Firestoreから取得した時点で既にfalseになっている可能性があるため）
      if (!skipNotification) {
        const taskForNotification = { ...taskBeforeUpdate };
        if (updates.isDeleted === false && taskBeforeUpdate.isDeleted === false) {
          // 復元処理の場合、元の状態をtrueと仮定
          taskForNotification.isDeleted = true;
        }
        
        await this.sendTaskUpdatedNotifications(taskId, taskForNotification, updates);
      }
      
      // プロジェクトに紐づいている場合は、プロジェクトの完了率を再計算
      const updatedTask = await this.getTask(taskId);
      if (updatedTask && updatedTask.projectId) {
        await this.projectService.recalculateProjectCompletionRate(updatedTask.projectId);
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      // 削除前にプロジェクトIDを取得
      const task = await this.getTask(taskId);
      if (!task) throw new Error('Task not found');
      
      // 権限チェック
      if (!await this.canDeleteTask(task, user.uid)) {
        throw new Error('このタスクを削除する権限がありません');
      }
      
      const projectId = task.projectId;
      
      // 親タスクの場合は子タスクを完全削除
      if (task.isRecurrenceParent) {
        await this.permanentlyDeleteChildTasks(taskId);
      }
      
      const taskRef = doc(db, 'tasks', taskId);
      await updateDoc(taskRef, {
        isDeleted: true,
        deletedAt: Timestamp.now(),
        statusBeforeDeletion: task.status // 削除前のステータスを保存
      });
      
      // タスク削除自体は成功したので、通知と再計算のエラーは別途処理
      try {
        // 削除通知を送信
        await this.sendTaskDeletedNotifications(taskId, task);
      } catch (notificationError: any) {
        console.error('Error sending task deleted notifications:', notificationError);
        // 通知エラーはタスク削除の失敗として扱わない
      }
      
      try {
        // プロジェクトに紐づいている場合は、プロジェクトの完了率を再計算
        if (projectId) {
          await this.projectService.recalculateProjectCompletionRate(projectId);
        }
      } catch (recalcError: any) {
        console.error('Error recalculating project completion rate:', recalcError);
        // 再計算エラーはタスク削除の失敗として扱わない
      }
    } catch (error: any) {
      console.error('Error deleting task:', error);
      // エラーメッセージがない場合のフォールバック
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      throw new Error(errorMessage);
    }
  }

  async getTasks(filters: {
    status?: TaskStatus[];
    assigneeId?: string;
    projectId?: string;
    teamId?: string | null;
    isDeleted?: boolean;
    userId?: string; // 個人モード時のユーザーID
    userTeamIds?: string[]; // 個人モード時の所属チームIDリスト
    creatorId?: string; // 作成者ID
  }): Promise<Task[]> {
    try {
      const constraints: QueryConstraint[] = [];
      
      if (filters.status && filters.status.length > 0) {
        constraints.push(where('status', 'in', filters.status));
      }
      
      if (filters.assigneeId) {
        constraints.push(where('assigneeId', '==', filters.assigneeId));
      }
      
      if (filters.creatorId) {
        constraints.push(where('creatorId', '==', filters.creatorId));
      }
      
      if (filters.projectId) {
        constraints.push(where('projectId', '==', filters.projectId));
      }

      // teamIdフィルタリング（nullの場合は個人タスク、値がある場合はチームタスク）
      // 注意: Firestoreではnullのフィールドは存在しないため、クライアント側でフィルタリング
      
      if (filters.isDeleted !== undefined) {
        constraints.push(where('isDeleted', '==', filters.isDeleted));
      }

      // orderBy を削除（インデックス不要にする）
      const q = query(collection(db, 'tasks'), ...constraints);
      const querySnapshot = await getDocs(q);
      
      const tasks = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Task));
      
      // teamIdフィルタリング（クライアント側）
      let filteredTasks = tasks;
      if (filters.teamId !== undefined) {
        if (filters.teamId === null) {
          // 個人モード: 自分が作成したタスク または 所属チームのタスクで自分が担当者
          // または チームプロジェクトタスクで、プロジェクト閲覧可能かつ自分が担当/作成するタスク
          if (filters.userId && filters.userTeamIds && filters.userTeamIds.length > 0) {
            const userTeamIds = filters.userTeamIds; // 型チェック用に変数に保存
            
            // プロジェクト閲覧可能なプロジェクトIDのセットを作成
            // 1. プロジェクトの担当者が自分（担当者がいない場合は作成者）
            // 2. プロジェクト内に自分が担当するタスクがある
            // 3. プロジェクト内に自分が作成したタスクで担当者がいないものがある
            const viewableProjectIds = new Set<string>();
            
            // プロジェクトタスクを抽出
            const projectTasks = tasks.filter(task => task.projectId);
            const uniqueProjectIds = new Set<string>();
            for (const task of projectTasks) {
              if (task.projectId) {
                uniqueProjectIds.add(task.projectId);
              }
            }
            
            // 各プロジェクトの閲覧権限をチェック
            for (const projectId of uniqueProjectIds) {
              try {
                const project = await this.projectService.getProject(projectId);
                if (!project) continue;
                
                // プロジェクトの担当者が自分（担当者がいない場合は作成者）
                const projectAssigneeId = project.assigneeId || project.ownerId;
                if (projectAssigneeId === filters.userId) {
                  viewableProjectIds.add(projectId);
                  continue;
                }
                
                // プロジェクト内に自分が担当するタスクがある
                const assignedTasks = projectTasks.filter(
                  task => task.projectId === projectId && task.assigneeId === filters.userId
                );
                if (assignedTasks.length > 0) {
                  viewableProjectIds.add(projectId);
                  continue;
                }
                
                // プロジェクト内に自分が作成したタスクで担当者がいないものがある
                const createdTasksWithoutAssignee = projectTasks.filter(
                  task => task.projectId === projectId && 
                          !task.assigneeId && 
                          task.creatorId === filters.userId
                );
                if (createdTasksWithoutAssignee.length > 0) {
                  viewableProjectIds.add(projectId);
                }
              } catch (error) {
                console.error(`Error checking project ${projectId}:`, error);
              }
            }
            
            filteredTasks = tasks.filter(task => {
              // 個人タスク（teamIdが未設定）で自分が作成者
              if (!task.teamId && task.creatorId === filters.userId) {
                return true;
              }
              // チームタスクで自分が担当者（担当者がいない場合は作成者）かつ所属チームに含まれる
              if (task.teamId && userTeamIds.includes(task.teamId)) {
                if (task.assigneeId === filters.userId) {
                  return true;
                }
                if (!task.assigneeId && task.creatorId === filters.userId) {
                  return true;
                }
              }
              // チームプロジェクトタスクで、プロジェクト閲覧可能かつ自分が担当/作成するタスク
              if (task.projectId && viewableProjectIds.has(task.projectId)) {
                // 自分が担当者（担当者がいない場合は作成者）のタスクのみを表示
                if (task.assigneeId === filters.userId) {
                  return true;
                }
                if (!task.assigneeId && task.creatorId === filters.userId) {
                  return true;
                }
              }
              return false;
            });
          } else if (filters.userId) {
            // フォールバック: 自分が作成したタスクのみ（チーム未参加の場合）
            // プロジェクト閲覧可能なプロジェクト内のタスクも含める
            const viewableProjectIds = new Set<string>();
            
            // プロジェクトタスクを抽出
            const projectTasks = tasks.filter(task => task.projectId);
            const uniqueProjectIds = new Set<string>();
            for (const task of projectTasks) {
              if (task.projectId) {
                uniqueProjectIds.add(task.projectId);
              }
            }
            
            // 各プロジェクトの閲覧権限をチェック
            for (const projectId of uniqueProjectIds) {
              try {
                const project = await this.projectService.getProject(projectId);
                if (!project) continue;
                
                // プロジェクトの担当者が自分（担当者がいない場合は作成者）
                const projectAssigneeId = project.assigneeId || project.ownerId;
                if (projectAssigneeId === filters.userId) {
                  viewableProjectIds.add(projectId);
                  continue;
                }
                
                // プロジェクト内に自分が担当するタスクがある
                const assignedTasks = projectTasks.filter(
                  task => task.projectId === projectId && task.assigneeId === filters.userId
                );
                if (assignedTasks.length > 0) {
                  viewableProjectIds.add(projectId);
                  continue;
                }
                
                // プロジェクト内に自分が作成したタスクで担当者がいないものがある
                const createdTasksWithoutAssignee = projectTasks.filter(
                  task => task.projectId === projectId && 
                          !task.assigneeId && 
                          task.creatorId === filters.userId
                );
                if (createdTasksWithoutAssignee.length > 0) {
                  viewableProjectIds.add(projectId);
                }
              } catch (error) {
                console.error(`Error checking project ${projectId}:`, error);
              }
            }
            
            filteredTasks = tasks.filter(task => {
              // 個人タスク（teamIdが未設定）で自分が作成者
              if (!task.teamId && task.creatorId === filters.userId) {
                return true;
              }
              // チームプロジェクトタスクで、プロジェクト閲覧可能かつ自分が担当/作成するタスク
              if (task.projectId && viewableProjectIds.has(task.projectId)) {
                // 自分が担当者（担当者がいない場合は作成者）のタスクのみを表示
                if (task.assigneeId === filters.userId) {
                  return true;
                }
                if (!task.assigneeId && task.creatorId === filters.userId) {
                  return true;
                }
              }
              return false;
            });
          } else {
            // フォールバック: 個人タスク（teamIdが未設定）
            filteredTasks = tasks.filter(task => !task.teamId);
          }
        } else {
          // チームモード: チームタスク（teamIdが一致）またはチームプロジェクトタスク
          const filteredTasksResult: Task[] = [];
          for (const task of tasks) {
            let shouldInclude = false;
            // チームタスク（teamIdが一致）
            if (task.teamId === filters.teamId) {
              shouldInclude = true;
            } else if (task.projectId) {
              // プロジェクトタスクの場合、プロジェクトのteamIdをチェック
              const project = await this.projectService.getProject(task.projectId);
              if (project && project.teamId === filters.teamId) {
                shouldInclude = true;
              }
            }
            if (shouldInclude) {
              filteredTasksResult.push(task);
            }
          }
          filteredTasks = filteredTasksResult;
        }
      }

      // クライアント側でソート
      const sortedTasks = filteredTasks.sort((a, b) => {
        const aDate = a.endDate.toDate().getTime();
        const bDate = b.endDate.toDate().getTime();
        return aDate - bDate;
      });

      return sortedTasks;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async getTodayTasks(userId: string, teamId: string | null = null, userTeamIds: string[] = []): Promise<Task[]> {
    try {
      // 全タスクを取得（閲覧権限チェックなし）
      // 後でフィルターや個人/チーム切り替えで対応予定
      const q = query(
        collection(db, 'tasks'),
        where('isDeleted', '==', false)
      );
      
      const querySnapshot = await getDocs(q);
      console.log('Total tasks fetched:', querySnapshot.docs.length);
      
      const tasks = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Task));
      
      // クライアント側でフィルタリング（今日以降が期限）
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      let filteredTasks = tasks.filter(task => {
        const endDate = task.endDate.toDate();
        const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        // 今日以降が期限 または 今日完了したタスク
        /*const hasValidDueDate = endDateOnly >= today;*/
        
        if (task.status === 'completed' && task.completedAt) {
          const completedAt = task.completedAt.toDate();
          const completedAtOnly = new Date(completedAt.getFullYear(), completedAt.getMonth(), completedAt.getDate());
          return completedAtOnly.getTime() === today.getTime();
        }
        
        /*return hasValidDueDate;*/
        return task.status!=='completed';
      });

      // teamIdフィルタリング
      if (teamId === null) {
        // 個人モード: 自分が作成したタスク または 所属チームのタスクで自分が担当者
        // または チームプロジェクトタスクで、プロジェクト閲覧可能かつ自分が担当/作成するタスク
        if (userId && userTeamIds && userTeamIds.length > 0) {
          const userTeamIdsArray = userTeamIds; // 型チェック用に変数に保存
          
          // プロジェクト閲覧可能なプロジェクトIDのセットを作成
          // 1. プロジェクトの担当者が自分（担当者がいない場合は作成者）
          // 2. プロジェクト内に自分が担当するタスクがある
          // 3. プロジェクト内に自分が作成したタスクで担当者がいないものがある
          const viewableProjectIds = new Set<string>();
          
          // プロジェクトタスクを抽出
          const projectTasks = filteredTasks.filter(task => task.projectId);
          const uniqueProjectIds = new Set<string>();
          for (const task of projectTasks) {
            if (task.projectId) {
              uniqueProjectIds.add(task.projectId);
            }
          }
          
          // 各プロジェクトの閲覧権限をチェック
          for (const projectId of uniqueProjectIds) {
            try {
              const project = await this.projectService.getProject(projectId);
              if (!project) continue;
              
              // プロジェクトの担当者が自分（担当者がいない場合は作成者）
              const projectAssigneeId = project.assigneeId || project.ownerId;
              if (projectAssigneeId === userId) {
                viewableProjectIds.add(projectId);
                continue;
              }
              
              // プロジェクト内に自分が担当するタスクがある
              const assignedTasks = projectTasks.filter(
                task => task.projectId === projectId && task.assigneeId === userId
              );
              if (assignedTasks.length > 0) {
                viewableProjectIds.add(projectId);
                continue;
              }
              
              // プロジェクト内に自分が作成したタスクで担当者がいないものがある
              const createdTasksWithoutAssignee = projectTasks.filter(
                task => task.projectId === projectId && 
                        !task.assigneeId && 
                        task.creatorId === userId
              );
              if (createdTasksWithoutAssignee.length > 0) {
                viewableProjectIds.add(projectId);
              }
            } catch (error) {
              console.error(`Error checking project ${projectId}:`, error);
            }
          }
          
          filteredTasks = filteredTasks.filter(task => {
            // 個人タスク（teamIdが未設定）で自分が作成者
            if (!task.teamId && task.creatorId === userId) {
              return true;
            }
            // チームタスクで自分が担当者（担当者がいない場合は作成者）かつ所属チームに含まれる
            if (task.teamId && userTeamIdsArray.includes(task.teamId)) {
              if (task.assigneeId === userId) {
                return true;
              }
              if (!task.assigneeId && task.creatorId === userId) {
                return true;
              }
            }
            // チームプロジェクトタスクで、プロジェクト閲覧可能かつ自分が担当/作成するタスク
            if (task.projectId && viewableProjectIds.has(task.projectId)) {
              // 自分が担当者（担当者がいない場合は作成者）のタスクのみを表示
              if (task.assigneeId === userId) {
                return true;
              }
              if (!task.assigneeId && task.creatorId === userId) {
                return true;
              }
            }
            return false;
          });
        } else if (userId) {
          // フォールバック: 自分が作成したタスクのみ（チーム未参加の場合）
          // プロジェクト閲覧可能なプロジェクト内のタスクも含める
          const viewableProjectIds = new Set<string>();
          
          // プロジェクトタスクを抽出
          const projectTasks = filteredTasks.filter(task => task.projectId);
          const uniqueProjectIds = new Set<string>();
          for (const task of projectTasks) {
            if (task.projectId) {
              uniqueProjectIds.add(task.projectId);
            }
          }
          
          // 各プロジェクトの閲覧権限をチェック
          for (const projectId of uniqueProjectIds) {
            try {
              const project = await this.projectService.getProject(projectId);
              if (!project) continue;
              
              // プロジェクトの担当者が自分（担当者がいない場合は作成者）
              const projectAssigneeId = project.assigneeId || project.ownerId;
              if (projectAssigneeId === userId) {
                viewableProjectIds.add(projectId);
                continue;
              }
              
              // プロジェクト内に自分が担当するタスクがある
              const assignedTasks = projectTasks.filter(
                task => task.projectId === projectId && task.assigneeId === userId
              );
              if (assignedTasks.length > 0) {
                viewableProjectIds.add(projectId);
                continue;
              }
              
              // プロジェクト内に自分が作成したタスクで担当者がいないものがある
              const createdTasksWithoutAssignee = projectTasks.filter(
                task => task.projectId === projectId && 
                        !task.assigneeId && 
                        task.creatorId === userId
              );
              if (createdTasksWithoutAssignee.length > 0) {
                viewableProjectIds.add(projectId);
              }
            } catch (error) {
              console.error(`Error checking project ${projectId}:`, error);
            }
          }
          
          filteredTasks = filteredTasks.filter(task => {
            // 個人タスク（teamIdが未設定）で自分が作成者
            if (!task.teamId && task.creatorId === userId) {
              return true;
            }
            // チームプロジェクトタスクで、プロジェクト閲覧可能かつ自分が担当/作成するタスク
            if (task.projectId && viewableProjectIds.has(task.projectId)) {
              // 自分が担当者（担当者がいない場合は作成者）のタスクのみを表示
              if (task.assigneeId === userId) {
                return true;
              }
              if (!task.assigneeId && task.creatorId === userId) {
                return true;
              }
            }
            return false;
          });
        }
      } else if (teamId) {
        // チームモード: チームタスク（teamIdが一致）またはチームプロジェクトタスク
        const filteredTasksResult: Task[] = [];
        for (const task of filteredTasks) {
          let shouldInclude = false;
          // チームタスク（teamIdが一致）
          if (task.teamId === teamId) {
            shouldInclude = true;
          } else if (task.projectId) {
            // プロジェクトタスクの場合、プロジェクトのteamIdをチェック
            const project = await this.projectService.getProject(task.projectId);
            if (project && project.teamId === teamId) {
              shouldInclude = true;
            }
          }
          if (shouldInclude) {
            filteredTasksResult.push(task);
          }
        }
        filteredTasks = filteredTasksResult;
      }
      
      console.log('Filtered today tasks (on or after today):', filteredTasks.length);
      return filteredTasks;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async getWeekTasks(userId: string, teamId: string | null = null, userTeamIds: string[] = []): Promise<Task[]> {
    try {
      // 全タスクを取得（閲覧権限チェックなし）
      // 後でフィルターや個人/チーム切り替えで対応予定
      const q = query(
        collection(db, 'tasks'),
        where('isDeleted', '==', false)
      );
      
      const querySnapshot = await getDocs(q);
      console.log('Week tasks fetched:', querySnapshot.docs.length);
      
      const tasks = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Task));
      
      // クライアント側でフィルタリング
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      //今週の開始と終了
      const dayOfWeek = today.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; //月曜日を基準に調整
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() + mondayOffset);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6); // 6日後（今週の終わり）
      weekEnd.setHours(23, 59, 59, 999); // その日の終わりまで含める
      
      // まず日付フィルタリング
      let dateFilteredTasks = tasks.filter(task => {
        //完了したタスクはcompletedAtで判定
        if (task.status === 'completed' && task.completedAt) {
          const completedAt = task.completedAt.toDate();
          const completedAtOnly = new Date(completedAt.getFullYear(), completedAt.getMonth(), completedAt.getDate());
          return completedAtOnly >= weekStart && completedAtOnly <= weekEnd;
        }

        if(task.status==='in_progress'){
          return true;
        }

        //未完了のタスクはendDateで判定
        return task.status!=='completed';
      });

      // 次にteamIdフィルタリング
      let filteredTasks = dateFilteredTasks;
      if (teamId === null) {
        // 個人モード: 自分が作成したタスク または 所属チームのタスクで自分が担当者
        // または チームプロジェクトタスクで、プロジェクト閲覧可能かつ自分が担当/作成するタスク
        if (userId && userTeamIds && userTeamIds.length > 0) {
          const userTeamIdsArray = userTeamIds; // 型チェック用に変数に保存
          
          // プロジェクト閲覧可能なプロジェクトIDのセットを作成
          // 1. プロジェクトの担当者が自分（担当者がいない場合は作成者）
          // 2. プロジェクト内に自分が担当するタスクがある
          // 3. プロジェクト内に自分が作成したタスクで担当者がいないものがある
          const viewableProjectIds = new Set<string>();
          
          // プロジェクトタスクを抽出
          const projectTasks = dateFilteredTasks.filter(task => task.projectId);
          const uniqueProjectIds = new Set<string>();
          for (const task of projectTasks) {
            if (task.projectId) {
              uniqueProjectIds.add(task.projectId);
            }
          }
          
          // 各プロジェクトの閲覧権限をチェック
          for (const projectId of uniqueProjectIds) {
            try {
              const project = await this.projectService.getProject(projectId);
              if (!project) continue;
              
              // プロジェクトの担当者が自分（担当者がいない場合は作成者）
              const projectAssigneeId = project.assigneeId || project.ownerId;
              if (projectAssigneeId === userId) {
                viewableProjectIds.add(projectId);
                continue;
              }
              
              // プロジェクト内に自分が担当するタスクがある
              const assignedTasks = projectTasks.filter(
                task => task.projectId === projectId && task.assigneeId === userId
              );
              if (assignedTasks.length > 0) {
                viewableProjectIds.add(projectId);
                continue;
              }
              
              // プロジェクト内に自分が作成したタスクで担当者がいないものがある
              const createdTasksWithoutAssignee = projectTasks.filter(
                task => task.projectId === projectId && 
                        !task.assigneeId && 
                        task.creatorId === userId
              );
              if (createdTasksWithoutAssignee.length > 0) {
                viewableProjectIds.add(projectId);
              }
            } catch (error) {
              console.error(`Error checking project ${projectId}:`, error);
            }
          }
          
          filteredTasks = dateFilteredTasks.filter(task => {
            // 個人タスク（teamIdが未設定）で自分が作成者
            if (!task.teamId && task.creatorId === userId) {
              return true;
            }
            // チームタスクで自分が担当者（担当者がいない場合は作成者）かつ所属チームに含まれる
            if (task.teamId && userTeamIdsArray.includes(task.teamId)) {
              if (task.assigneeId === userId) {
                return true;
              }
              if (!task.assigneeId && task.creatorId === userId) {
                return true;
              }
            }
            // チームプロジェクトタスクで、プロジェクト閲覧可能かつ自分が担当/作成するタスク
            if (task.projectId && viewableProjectIds.has(task.projectId)) {
              // 自分が担当者（担当者がいない場合は作成者）のタスクのみを表示
              if (task.assigneeId === userId) {
                return true;
              }
              if (!task.assigneeId && task.creatorId === userId) {
                return true;
              }
            }
            return false;
          });
        } else if (userId) {
          // フォールバック: 自分が作成したタスクのみ（チーム未参加の場合）
          // プロジェクト閲覧可能なプロジェクト内のタスクも含める
          const viewableProjectIds = new Set<string>();
          
          // プロジェクトタスクを抽出
          const projectTasks = dateFilteredTasks.filter(task => task.projectId);
          const uniqueProjectIds = new Set<string>();
          for (const task of projectTasks) {
            if (task.projectId) {
              uniqueProjectIds.add(task.projectId);
            }
          }
          
          // 各プロジェクトの閲覧権限をチェック
          for (const projectId of uniqueProjectIds) {
            try {
              const project = await this.projectService.getProject(projectId);
              if (!project) continue;
              
              // プロジェクトの担当者が自分（担当者がいない場合は作成者）
              const projectAssigneeId = project.assigneeId || project.ownerId;
              if (projectAssigneeId === userId) {
                viewableProjectIds.add(projectId);
                continue;
              }
              
              // プロジェクト内に自分が担当するタスクがある
              const assignedTasks = projectTasks.filter(
                task => task.projectId === projectId && task.assigneeId === userId
              );
              if (assignedTasks.length > 0) {
                viewableProjectIds.add(projectId);
                continue;
              }
              
              // プロジェクト内に自分が作成したタスクで担当者がいないものがある
              const createdTasksWithoutAssignee = projectTasks.filter(
                task => task.projectId === projectId && 
                        !task.assigneeId && 
                        task.creatorId === userId
              );
              if (createdTasksWithoutAssignee.length > 0) {
                viewableProjectIds.add(projectId);
              }
            } catch (error) {
              console.error(`Error checking project ${projectId}:`, error);
            }
          }
          
          filteredTasks = dateFilteredTasks.filter(task => {
            // 個人タスク（teamIdが未設定）で自分が作成者
            if (!task.teamId && task.creatorId === userId) {
              return true;
            }
            // チームプロジェクトタスクで、プロジェクト閲覧可能かつ自分が担当/作成するタスク
            if (task.projectId && viewableProjectIds.has(task.projectId)) {
              // 自分が担当者（担当者がいない場合は作成者）のタスクのみを表示
              if (task.assigneeId === userId) {
                return true;
              }
              if (!task.assigneeId && task.creatorId === userId) {
                return true;
              }
            }
            return false;
          });
        }
      } else if (teamId) {
        // チームモード: チームタスク（teamIdが一致）またはチームプロジェクトタスク
        const filteredTasksResult: Task[] = [];
        for (const task of dateFilteredTasks) {
          let shouldInclude = false;
          // チームタスク（teamIdが一致）
          if (task.teamId === teamId) {
            shouldInclude = true;
          } else if (task.projectId) {
            // プロジェクトタスクの場合、プロジェクトのteamIdをチェック
            const project = await this.projectService.getProject(task.projectId);
            if (project && project.teamId === teamId) {
              shouldInclude = true;
            }
          }
          if (shouldInclude) {
            filteredTasksResult.push(task);
          }
        }
        filteredTasks = filteredTasksResult;
      }
      
      console.log('Filtered week tasks:', filteredTasks.length);
      return filteredTasks;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 通知送信メソッド
  private async sendTaskCreatedNotifications(taskId: string, task: any): Promise<void> {
    try {
      const creator = this.authService.currentUser;
      if (!creator) return;

      // 担当者に通知（チームタスクで担当者が未割当の場合は作成者に通知）
      const notificationUserId = (task.teamId && (!task.assigneeId || task.assigneeId === '')) 
        ? task.creatorId 
        : task.assigneeId;
      
      if (notificationUserId && notificationUserId !== '' && notificationUserId !== creator.uid) {
        await this.notificationService.createNotification({
          userId: notificationUserId,
          type: NotificationType.TaskCreated,
          title: '新しいタスクが割り当てられました',
          message: `${creator.displayName || creator.email}が、新しいタスク「${task.title}」をあなたに割り当てました`,
          taskId: taskId,
          projectId: task.projectId
        });
      }

      // プロジェクトに紐づいている場合は、プロジェクトメンバーに通知
      if (task.projectId) {
        const project = await this.projectService.getProject(task.projectId);
        if (project) {
          const projectMembers = project.members || [];
          for (const member of projectMembers) {
            // 作成者と担当者（チームタスクで担当者未割当の場合は作成者）は既に通知済みなのでスキップ
            const assigneeOrCreatorId = (task.teamId && (!task.assigneeId || task.assigneeId === '')) 
              ? task.creatorId 
              : task.assigneeId;
            if (member.userId !== creator.uid && member.userId !== assigneeOrCreatorId) {
              await this.notificationService.createNotification({
                userId: member.userId,
                type: NotificationType.TaskCreated,
                title: 'プロジェクトに新しいタスクが追加されました',
                message: `${creator.displayName || creator.email}がプロジェクト「${project.name}」に「${task.title}」というタスクを追加しました`,
                taskId: taskId,
                projectId: task.projectId
              });
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Error sending task created notifications:', error);
      // 通知エラーは非同期なので、タスク作成は成功として扱う
    }
  }

  private async sendTaskUpdatedNotifications(taskId: string, task: Task, updates: Partial<Task>): Promise<void> {
    try {
      const updater = this.authService.currentUser;
      if (!updater) return;

      // 復元チェック条件を確認

      // 復元時の通知（isDeletedがfalseに変更された場合）
      if (updates.isDeleted === false && task.isDeleted === true) {
        // 復元通知を送信
        // 担当者に通知（チームタスクで担当者が未割当の場合は作成者に通知）
        const notificationUserId = (task.teamId && (!task.assigneeId || task.assigneeId === '')) 
          ? task.creatorId 
          : task.assigneeId;
        
        if (notificationUserId && notificationUserId !== '' && notificationUserId !== updater.uid) {
          await this.notificationService.createNotification({
            userId: notificationUserId,
            type: NotificationType.TaskRestored,
            title: 'タスクが復元されました',
            message: `${updater.displayName || updater.email}が「${task.title}」を復元しました`,
            taskId: taskId,
            projectId: task.projectId
          });
        }

        // プロジェクトに紐づいている場合は、プロジェクトメンバーにも通知（復元者と担当者は除く）
        if (task.projectId) {
          const project = await this.projectService.getProject(task.projectId);
          if (project) {
            const projectMembers = project.members || [];
            for (const member of projectMembers) {
              // 復元者と担当者（チームタスクで担当者未割当の場合は作成者）はスキップ
              const assigneeOrCreatorId = (task.teamId && (!task.assigneeId || task.assigneeId === '')) 
                ? task.creatorId 
                : task.assigneeId;
              if (member.userId !== updater.uid && member.userId !== assigneeOrCreatorId) {
                await this.notificationService.createNotification({
                  userId: member.userId,
                  type: NotificationType.TaskRestored,
                  title: 'タスクが復元されました',
                  message: `${updater.displayName || updater.email}が「${task.title}」を復元しました`,
                  taskId: taskId,
                  projectId: task.projectId
                });
              }
            }
          }
        }
        // 復元時は他の通知をスキップ
        // 復元通知を送信しました。他の通知をスキップします
        return;
      } else {
        // 復元チェック条件が満たされませんでした。通常の更新通知を処理します
      }

      // 担当者変更の場合、新旧の担当者に通知
      if (updates.assigneeId !== undefined && updates.assigneeId !== task.assigneeId) {
        // 新しい担当者に通知
        if (updates.assigneeId && updates.assigneeId !== '' && updates.assigneeId !== updater.uid) {
          await this.notificationService.createNotification({
            userId: updates.assigneeId,
            type: NotificationType.TaskUpdated,
            title: 'タスクが割り当てられました',
            message: `${updater.displayName || updater.email}が「${task.title}」をあなたに割り当てました`,
            taskId: taskId,
            projectId: task.projectId
          });
        }
        // 元の担当者に通知（担当者が変更された場合）
        if (task.assigneeId && task.assigneeId !== '' && task.assigneeId !== updater.uid && task.assigneeId !== updates.assigneeId) {
          await this.notificationService.createNotification({
            userId: task.assigneeId,
            type: NotificationType.TaskUpdated,
            title: 'タスクの担当者が変更されました',
            message: `${updater.displayName || updater.email}が「${task.title}」の担当者を変更しました`,
            taskId: taskId,
            projectId: task.projectId
          });
        }
      }

      // ステータス変更の場合、担当者に通知
      if (updates.status && updates.status !== task.status) {
        // チームタスクで担当者が未割当の場合は作成者に通知
        const notificationUserId = (task.teamId && (!task.assigneeId || task.assigneeId === '')) 
          ? task.creatorId 
          : task.assigneeId;
        
        // 完了時の通知（更新者が担当者と異なる場合、担当者に完了通知を送信）
        if (updates.status === TaskStatus.Completed && notificationUserId && notificationUserId !== '' && notificationUserId !== updater.uid) {
          await this.notificationService.createNotification({
            userId: notificationUserId,
            type: NotificationType.TaskCompleted,
            title: 'タスクが完了しました',
            message: `${updater.displayName || updater.email}が「${task.title}」を完了しました`,
            taskId: taskId,
            projectId: task.projectId
          });
        }
        // その他のステータス変更の場合
        else if (updates.status !== TaskStatus.Completed) {
          // 担当者が設定されていて、更新者と異なる場合
          if (notificationUserId && notificationUserId !== '' && notificationUserId !== updater.uid) {
            await this.notificationService.createNotification({
              userId: notificationUserId,
              type: NotificationType.TaskUpdated,
              title: 'タスクのステータスが変更されました',
              message: `${updater.displayName || updater.email}が「${task.title}」のステータスを変更しました`,
              taskId: taskId,
              projectId: task.projectId
            });
          }
          
          // プロジェクトに紐づいている場合は、プロジェクトメンバーにも通知（更新者と担当者は除く）
          if (task.projectId) {
            const project = await this.projectService.getProject(task.projectId);
            if (project) {
              const projectMembers = project.members || [];
              for (const member of projectMembers) {
                // 更新者と担当者（チームタスクで担当者未割当の場合は作成者）はスキップ
                if (member.userId !== updater.uid && member.userId !== notificationUserId) {
                  await this.notificationService.createNotification({
                    userId: member.userId,
                    type: NotificationType.TaskUpdated,
                    title: 'タスクのステータスが変更されました',
                    message: `${updater.displayName || updater.email}が「${task.title}」のステータスを変更しました`,
                    taskId: taskId,
                    projectId: task.projectId
                  });
                }
              }
            }
          }
        }
      }

      // プロジェクトに紐づいている場合は、プロジェクトメンバーに通知（作成者と担当者は除く）
      // ステータス変更の場合は既に通知済みなのでスキップ
      if (task.projectId && !updates.status) {
        const project = await this.projectService.getProject(task.projectId);
        if (project) {
          const projectMembers = project.members || [];
          for (const member of projectMembers) {
            // 更新者と担当者（チームタスクで担当者未割当の場合は作成者）はスキップ
            const assigneeOrCreatorId = (task.teamId && (!task.assigneeId || task.assigneeId === '')) 
              ? task.creatorId 
              : task.assigneeId;
            if (member.userId !== updater.uid && member.userId !== assigneeOrCreatorId) {
              await this.notificationService.createNotification({
                userId: member.userId,
                type: NotificationType.TaskUpdated,
                title: 'タスクが更新されました',
                message: `${updater.displayName || updater.email}が「${task.title}」を更新しました`,
                taskId: taskId,
                projectId: task.projectId
              });
            }
          }
        }
      } else if (!updates.status) {
        // プロジェクトに紐づいていない場合は、担当者に通知（チームタスクで担当者が未割当の場合は作成者に通知）
        const notificationUserId = (task.teamId && (!task.assigneeId || task.assigneeId === '')) 
          ? task.creatorId 
          : task.assigneeId;
        
        if (notificationUserId && notificationUserId !== '' && notificationUserId !== updater.uid) {
          await this.notificationService.createNotification({
            userId: notificationUserId,
            type: NotificationType.TaskUpdated,
            title: 'タスクが更新されました',
            message: `${updater.displayName || updater.email}が「${task.title}」を更新しました`,
            taskId: taskId,
            projectId: task.projectId
          });
        }
      }
    } catch (error: any) {
      console.error('Error sending task updated notifications:', error);
      // 通知エラーは非同期なので、タスク更新は成功として扱う
    }
  }

  private async sendTaskDeletedNotifications(taskId: string, task: Task): Promise<void> {
    try {
      const deleter = this.authService.currentUser;
      if (!deleter) return;

      // 担当者に通知（チームタスクで担当者が未割当の場合は作成者に通知）
      const notificationUserId = (task.teamId && (!task.assigneeId || task.assigneeId === '')) 
        ? task.creatorId 
        : task.assigneeId;
      
      if (notificationUserId && notificationUserId !== '' && notificationUserId !== deleter.uid) {
        await this.notificationService.createNotification({
          userId: notificationUserId,
          type: NotificationType.TaskDeleted,
          title: 'タスクが削除されました',
          message: `${deleter.displayName || deleter.email}が「${task.title}」を削除しました`,
          taskId: taskId,
          projectId: task.projectId
        });
      }

      // プロジェクトに紐づいている場合は、プロジェクトメンバーにも通知（削除者と担当者は除く）
      if (task.projectId) {
        const project = await this.projectService.getProject(task.projectId);
        if (project) {
          const projectMembers = project.members || [];
          for (const member of projectMembers) {
            // 削除者と担当者（チームタスクで担当者未割当の場合は作成者）はスキップ
            const assigneeOrCreatorId = (task.teamId && (!task.assigneeId || task.assigneeId === '')) 
              ? task.creatorId 
              : task.assigneeId;
            if (member.userId !== deleter.uid && member.userId !== assigneeOrCreatorId) {
              await this.notificationService.createNotification({
                userId: member.userId,
                type: NotificationType.TaskDeleted,
                title: 'タスクが削除されました',
                message: `${deleter.displayName || deleter.email}が「${task.title}」を削除しました`,
                taskId: taskId,
                projectId: task.projectId
              });
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Error sending task deleted notifications:', error);
      // 通知エラーは非同期なので、タスク削除は成功として扱う
    }
  }

  // 日付チェックが必要なタスクを取得
  checkTaskDates(task: Task): { needsStartDateCheck: boolean; needsEndDateCheck: boolean } {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // 今日既にチェック済みか確認（日付のみで判断）
    if (task.dateCheckedAt) {
      const checkedDate = task.dateCheckedAt.toDate();
      const checkedDateOnly = new Date(checkedDate.getFullYear(), checkedDate.getMonth(), checkedDate.getDate());
      if (checkedDateOnly.getTime() === today.getTime()) {
        // 今日既にチェック済み
        return { needsStartDateCheck: false, needsEndDateCheck: false };
      }
    }
    
    // 時間設定を基準に判断（時間が設定されている場合はその時間を考慮）
    const startDate = task.startDate.toDate();
    const endDate = task.endDate.toDate();
    
    // 開始日時のチェック（未着手で開始日時を過ぎている）
    // 時間が00:00:00の場合は日付のみで判断、それ以外は時間も考慮
    const startTime = startDate.getHours() * 3600 + startDate.getMinutes() * 60 + startDate.getSeconds();
    const needsStartDateCheck = task.status === TaskStatus.NotStarted && 
                                (startTime === 0 ? 
                                  startDate.getTime() < today.getTime() : 
                                  startDate.getTime() < now.getTime());
    
    // 終了日時のチェック（未着手または進行中で終了日時を過ぎている）
    // 時間が23:59:59の場合は日付のみで判断、それ以外は時間も考慮
    const endTime = endDate.getHours() * 3600 + endDate.getMinutes() * 60 + endDate.getSeconds();
    const endTimeMax = 23 * 3600 + 59 * 60 + 59; // 23:59:59
    let needsEndDateCheck = false;
    if (endTime === endTimeMax) {
      // 終了日の翌日の00:00:00と比較
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      needsEndDateCheck = (task.status === TaskStatus.NotStarted || task.status === TaskStatus.InProgress) &&
                          endDate.getTime() < tomorrow.getTime();
    } else {
      // 時刻も含めて比較
      needsEndDateCheck = (task.status === TaskStatus.NotStarted || task.status === TaskStatus.InProgress) &&
                          endDate.getTime() < now.getTime();
    }
    
    return { needsStartDateCheck, needsEndDateCheck };
  }

  // 日付チェック済みフラグを更新
  async markTaskDateChecked(taskId: string): Promise<void> {
    try {
      const taskRef = doc(db, 'tasks', taskId);
      await updateDoc(taskRef, {
        dateCheckedAt: Timestamp.now()
      });
    } catch (error: any) {
      console.error('Error marking task date checked:', error);
    }
  }

  async duplicateTask(taskId: string): Promise<string> {
    try {
      const originalTask = await this.getTask(taskId);
      if (!originalTask) {
        throw new Error('Task not found');
      }

      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      // タスクを複製（一部のフィールドは新しくする）
      const duplicatedTask: any = {
        title: `${originalTask.title} (複製)`,
        assigneeId: originalTask.assigneeId || '',
        assigneeName: originalTask.assigneeName || '',
        creatorId: user.uid,
        creatorName: user.displayName || user.email || 'Unknown',
        status: TaskStatus.NotStarted, // 複製時は未着手にする
        startDate: originalTask.startDate,
        endDate: originalTask.endDate,
        priority: originalTask.priority || 'normal',
        taskType: originalTask.taskType || 'normal',
        subtasks: (originalTask.subtasks || []).map(subtask => {
          const newSubtask: any = {
            id: subtask.id,
            title: subtask.title,
            completed: false // サブタスクは未完了にする
          };
          if (subtask.assigneeId) newSubtask.assigneeId = subtask.assigneeId;
          if (subtask.assigneeName) newSubtask.assigneeName = subtask.assigneeName;
          return newSubtask;
        }),
        progress: 0, // 進捗は0にリセット
        reminders: (originalTask.reminders || []).map(reminder => {
          const newReminder: any = {
            id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
            sent: false // リマインダーは未送信にする
          };
          if (reminder.type) newReminder.type = reminder.type;
          if (reminder.amount !== undefined) newReminder.amount = reminder.amount;
          if (reminder.unit) newReminder.unit = reminder.unit;
          if (reminder.scheduledAt) newReminder.scheduledAt = reminder.scheduledAt;
          return newReminder;
        }),
        comments: [], // コメントは複製しない
        workSessions: [], // 作業セッションは複製しない
        totalWorkTime: 0, // 作業時間はリセット
        recurrence: originalTask.recurrence || RecurrenceType.None,
        files: [], // ファイルは複製しない（ストレージのURLが別になるため）
        isDeleted: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      // undefinedでないフィールドのみ追加
      if (originalTask.description !== undefined) duplicatedTask.description = originalTask.description;
      if (originalTask.projectId !== undefined) duplicatedTask.projectId = originalTask.projectId;
      if (originalTask.projectName !== undefined) duplicatedTask.projectName = originalTask.projectName;
      if (originalTask.customPriority !== undefined) duplicatedTask.customPriority = originalTask.customPriority;
      if (originalTask.memo !== undefined) duplicatedTask.memo = originalTask.memo;
      if (originalTask.recurrenceEndDate !== undefined) duplicatedTask.recurrenceEndDate = originalTask.recurrenceEndDate;

      const docRef = await addDoc(collection(db, 'tasks'), duplicatedTask);
      const newTaskId = docRef.id;

      // 通知を送信
      await this.sendTaskCreatedNotifications(newTaskId, duplicatedTask);

      return newTaskId;
    } catch (error: any) {
      console.error('Error duplicating task:', error);
      throw new Error(error.message || 'Failed to duplicate task');
    }
  }

  // 最大生成期間を取得（月数）
  private getMaxRecurrencePeriod(recurrenceType: RecurrenceType): number {
    switch (recurrenceType) {
      case RecurrenceType.Daily:
      case RecurrenceType.Weekly:
        return 3; // 3か月
      case RecurrenceType.Biweekly:
        return 6; // 6か月
      case RecurrenceType.Monthly:
        return 12; // 1年
      case RecurrenceType.Yearly:
        return 36; // 3年
      default:
        return 0;
    }
  }

  // 繰り返しタスクを生成
  async generateRecurringTasks(parentTask: Task): Promise<string[]> {
    try {
      if (parentTask.recurrence === RecurrenceType.None) {
        return [];
      }

      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const startDate = parentTask.startDate.toDate();
      const endDate = parentTask.endDate.toDate();
      const duration = endDate.getTime() - startDate.getTime(); // タスクの期間（ミリ秒）

      // 現在日時を取得（今日の0時0分0秒）
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      // 繰り返し終了日を決定
      let recurrenceEndDate: Date;
      const maxPeriod = this.getMaxRecurrencePeriod(parentTask.recurrence);
      const maxEndDate = new Date(startDate);
      maxEndDate.setMonth(maxEndDate.getMonth() + maxPeriod);

      if (parentTask.recurrenceEndDate) {
        recurrenceEndDate = parentTask.recurrenceEndDate.toDate();
        // 最大期間を超えているかチェック（日付レベルで比較）
        const recurrenceEndDateOnly = new Date(recurrenceEndDate.getFullYear(), recurrenceEndDate.getMonth(), recurrenceEndDate.getDate());
        const maxEndDateOnly = new Date(maxEndDate.getFullYear(), maxEndDate.getMonth(), maxEndDate.getDate());
        if (recurrenceEndDateOnly > maxEndDateOnly) {
          throw new Error(`繰り返し終了日が最大生成期間（${maxPeriod}か月）を超えています。`);
        }
      } else {
        // 繰り返し終了日が未設定の場合は最大期間で生成
        recurrenceEndDate = maxEndDate;
      }

      // 繰り返し終了日が未設定の場合は、親タスクには保存しない（ローリング生成を有効にするため）
      // ただし、子タスク生成の計算にはrecurrenceEndDate（最大期間）を使用する
      let finalRecurrenceEndDate: Timestamp | undefined = parentTask.recurrenceEndDate;
      // parentTask.recurrenceEndDateが未設定の場合は、finalRecurrenceEndDateもundefinedのまま

      const generatedTaskIds: string[] = [];
      let currentStartDate = new Date(startDate);
      let instanceNumber = 1; // 最初のタスクは親なので、次から1

      // 最初の日付を1回進める（親タスクと同じ日付をスキップ）
      switch (parentTask.recurrence) {
        case RecurrenceType.Daily:
          currentStartDate.setDate(currentStartDate.getDate() + 1);
          break;
        case RecurrenceType.Weekly:
          currentStartDate.setDate(currentStartDate.getDate() + 7);
          break;
        case RecurrenceType.Biweekly:
          currentStartDate.setDate(currentStartDate.getDate() + 14);
          break;
        case RecurrenceType.Monthly:
          const nextMonth = new Date(currentStartDate);
          nextMonth.setMonth(nextMonth.getMonth() + 1);
          if (nextMonth.getDate() !== currentStartDate.getDate()) {
            nextMonth.setDate(0);
          }
          currentStartDate = nextMonth;
          break;
        case RecurrenceType.Yearly:
          currentStartDate.setFullYear(currentStartDate.getFullYear() + 1);
          if (currentStartDate.getMonth() === 1 && currentStartDate.getDate() === 29) {
            const year = currentStartDate.getFullYear();
            const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
            if (!isLeapYear) {
              currentStartDate.setDate(28);
            }
          }
          break;
      }

      // 日付計算ループ
      while (currentStartDate <= recurrenceEndDate) {
        const currentEndDate = new Date(currentStartDate.getTime() + duration);
        const currentStartDateOnly = new Date(currentStartDate.getFullYear(), currentStartDate.getMonth(), currentStartDate.getDate());

        // 現在日時より後のタスクのみを生成
        if (currentStartDateOnly < now) {
          // 現在日時より前の場合はスキップして次の日付へ
          switch (parentTask.recurrence) {
            case RecurrenceType.Daily:
              currentStartDate.setDate(currentStartDate.getDate() + 1);
              break;
            case RecurrenceType.Weekly:
              currentStartDate.setDate(currentStartDate.getDate() + 7);
              break;
            case RecurrenceType.Biweekly:
              currentStartDate.setDate(currentStartDate.getDate() + 14);
              break;
            case RecurrenceType.Monthly:
              const nextMonth = new Date(currentStartDate);
              nextMonth.setMonth(nextMonth.getMonth() + 1);
              if (nextMonth.getDate() !== currentStartDate.getDate()) {
                nextMonth.setDate(0);
              }
              currentStartDate = nextMonth;
              break;
            case RecurrenceType.Yearly:
              currentStartDate.setFullYear(currentStartDate.getFullYear() + 1);
              if (currentStartDate.getMonth() === 1 && currentStartDate.getDate() === 29) {
                const year = currentStartDate.getFullYear();
                const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
                if (!isLeapYear) {
                  currentStartDate.setDate(28);
                }
              }
              break;
          }
          instanceNumber++;
          continue;
        }

        // 繰り返し終了日を超えないようにチェック
        if (currentStartDate > recurrenceEndDate) {
          break;
        }

        // 次のタスクを作成
        const recurringTask: any = {
          title: parentTask.title,
          assigneeId: parentTask.assigneeId || '',
          assigneeName: parentTask.assigneeName || '',
          creatorId: parentTask.creatorId,
          creatorName: parentTask.creatorName,
          status: TaskStatus.NotStarted,
          startDate: Timestamp.fromDate(new Date(currentStartDate)),
          endDate: Timestamp.fromDate(new Date(currentEndDate)),
          priority: parentTask.priority,
          taskType: parentTask.taskType,
          subtasks: (parentTask.subtasks || []).map(subtask => ({
            ...subtask,
            completed: false // サブタスクは未完了にする
          })),
          progress: 0,
          showProgress: parentTask.showProgress !== undefined ? parentTask.showProgress : true,
          progressManual: false,
          reminders: (parentTask.reminders || []).map(reminder => ({
            ...reminder,
            id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
            sent: false // リマインダーは未送信にする
          })),
          comments: [],
          workSessions: [],
          totalWorkTime: 0,
          recurrence: parentTask.recurrence,
          parentTaskId: parentTask.id,
          recurrenceInstance: instanceNumber,
          isRecurrenceParent: false,
          files: [], // ファイルは複製しない
          isDeleted: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        // undefinedでないフィールドのみ追加
        if (finalRecurrenceEndDate !== undefined) recurringTask.recurrenceEndDate = finalRecurrenceEndDate;
        if (parentTask.description !== undefined) recurringTask.description = parentTask.description;
        if (parentTask.projectId !== undefined) recurringTask.projectId = parentTask.projectId;
        if (parentTask.projectName !== undefined) recurringTask.projectName = parentTask.projectName;
        if (parentTask.teamId !== undefined) recurringTask.teamId = parentTask.teamId;
        if (parentTask.teamName !== undefined) recurringTask.teamName = parentTask.teamName;
        if (parentTask.customPriority !== undefined) recurringTask.customPriority = parentTask.customPriority;
        if (parentTask.memo !== undefined) recurringTask.memo = parentTask.memo;

        const docRef = await addDoc(collection(db, 'tasks'), recurringTask);
        generatedTaskIds.push(docRef.id);

        // 通知を送信（親タスクと同じ通知ロジック）
        await this.sendTaskCreatedNotifications(docRef.id, recurringTask);

        // 次の日付を計算
        switch (parentTask.recurrence) {
          case RecurrenceType.Daily:
            currentStartDate.setDate(currentStartDate.getDate() + 1);
            break;
          case RecurrenceType.Weekly:
            currentStartDate.setDate(currentStartDate.getDate() + 7);
            break;
          case RecurrenceType.Biweekly:
            currentStartDate.setDate(currentStartDate.getDate() + 14);
            break;
          case RecurrenceType.Monthly:
            // 月末の場合は調整（例: 1/31 → 2/28 → 3/31）
            const nextMonth = new Date(currentStartDate);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            // 同じ日付が存在しない場合は、月末に調整
            if (nextMonth.getDate() !== currentStartDate.getDate()) {
              nextMonth.setDate(0); // 前月の最終日
            }
            currentStartDate = nextMonth;
            break;
          case RecurrenceType.Yearly:
            currentStartDate.setFullYear(currentStartDate.getFullYear() + 1);
            // うるう年対応（2/29の場合）
            if (currentStartDate.getMonth() === 1 && currentStartDate.getDate() === 29) {
              const year = currentStartDate.getFullYear();
              const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
              if (!isLeapYear) {
                currentStartDate.setDate(28); // うるう年でない場合は2/28に
              }
            }
            break;
        }

        instanceNumber++;
      }

      // 親タスクを更新（isRecurrenceParentとrecurrenceInstanceを設定）
      const updateData: any = {
        isRecurrenceParent: true,
        recurrenceInstance: 0
      };
      // 繰り返し終了日が設定されている場合のみ親タスクに保存（未設定の場合はローリング生成を有効にするため）
      if (finalRecurrenceEndDate !== undefined) {
        updateData.recurrenceEndDate = finalRecurrenceEndDate;
      } else {
        // 未設定の場合は明示的に削除（既存の値がある場合に備えて）
        updateData.recurrenceEndDate = deleteField();
      }
      await updateDoc(doc(db, 'tasks', parentTask.id), updateData);

      return generatedTaskIds;
    } catch (error: any) {
      console.error('Error generating recurring tasks:', error);
      throw error;
    }
  }

  // ローリング生成：各タスクの終了日が過ぎたら、最後のタスクの次の期間に新しいタスクを1つ追加
  async checkAndGenerateNextRecurrenceTask(parentTaskId: string): Promise<void> {
    try {
      console.log(`[ローリング生成] チェック開始: parentTaskId=${parentTaskId}`);
      const parentTask = await this.getTask(parentTaskId);
      if (!parentTask || !parentTask.isRecurrenceParent || parentTask.recurrence === RecurrenceType.None) {
        console.log(`[ローリング生成] スキップ: parentTask存在=${!!parentTask}, isRecurrenceParent=${parentTask?.isRecurrenceParent}, recurrence=${parentTask?.recurrence}`);
        return;
      }

      // 繰り返し終了日が設定されている場合はローリング生成しない
      if (parentTask.recurrenceEndDate) {
        console.log(`[ローリング生成] スキップ: 繰り返し終了日が設定されています (${parentTask.recurrenceEndDate.toDate().toLocaleString('ja-JP')})`);
        return;
      }

      // 親タスクと全ての子タスクを取得（インデックスエラーを避けるため、orderByは使わず取得後にソート）
      const q = query(
        collection(db, 'tasks'),
        where('parentTaskId', '==', parentTaskId),
        where('isDeleted', '==', false)
      );
      const snapshot = await getDocs(q);

      // 子タスクがない場合は不要（終了日未定の場合のみローリング生成するため、初回生成時に子タスクが作成される）
      if (snapshot.empty) {
        console.log(`[ローリング生成] スキップ: 子タスクがありません`);
        return;
      }

      console.log(`[ローリング生成] 子タスク数: ${snapshot.docs.length}`);

      const now = new Date();
      const allTasks: Task[] = [];

      // 親タスクを最初に追加（recurrenceInstanceは0または未設定）
      allTasks.push(parentTask);
      console.log(`[ローリング生成] 親タスク: ${parentTask.title}, 終了日=${parentTask.endDate.toDate().toLocaleString('ja-JP')}`);

      // 子タスクを追加してソート
      const childTasks: Task[] = [];
      snapshot.docs.forEach(doc => {
        const childTask = { id: doc.id, ...doc.data() } as Task;
        childTasks.push(childTask);
      });
      
      // recurrenceInstanceでソート（未設定の場合は0として扱う）
      childTasks.sort((a, b) => {
        const aInstance = a.recurrenceInstance || 0;
        const bInstance = b.recurrenceInstance || 0;
        return aInstance - bInstance;
      });
      
      // ソート済みの子タスクをallTasksに追加
      childTasks.forEach(childTask => {
        allTasks.push(childTask);
        console.log(`[ローリング生成] 子タスク: ${childTask.title}, recurrenceInstance=${childTask.recurrenceInstance}, 終了日=${childTask.endDate.toDate().toLocaleString('ja-JP')}`);
      });

      console.log(`[ローリング生成] 現在時刻: ${now.toLocaleString('ja-JP')}`);

      // 親タスクから順番に、終了日が過ぎたタスクを探す
      for (const task of allTasks) {
        const taskEndDate = task.endDate.toDate();
        console.log(`[ローリング生成] チェック: タスク=${task.title}, 終了日=${taskEndDate.toLocaleString('ja-JP')}, 過ぎている=${taskEndDate <= now}`);
        if (taskEndDate <= now) {
          // 終了日が過ぎたタスクが見つかった
          console.log(`[ローリング生成] 終了日が過ぎたタスクが見つかりました: ${task.title}`);
          // 既に取得した子タスクから、recurrenceInstanceが最大のタスクを取得
          // childTasksは既にrecurrenceInstanceでソートされているので、最後の要素が最大
          if (childTasks.length === 0) {
            // 子タスクがない場合は親タスクを基準にする
            console.log(`[ローリング生成] 子タスクがないため、親タスクを基準に生成`);
            await this.generateNextRecurrenceInstance(parentTask, 0);
          } else {
            // 最後の子タスクの次の期間に新しいタスクを1つ追加
            const lastChildTask = childTasks[childTasks.length - 1];
            console.log(`[ローリング生成] 最後の子タスク: recurrenceInstance=${lastChildTask.recurrenceInstance}, 終了日=${lastChildTask.endDate.toDate().toLocaleString('ja-JP')}`);
            await this.generateNextRecurrenceInstance(parentTask, lastChildTask.recurrenceInstance || 0);
          }
          console.log(`[ローリング生成] 新しいタスクを生成しました`);
          // 1つ追加したら終了（各タスクの終了日が過ぎるたびに1つずつ追加）
          return;
        }
      }
      console.log(`[ローリング生成] 終了日が過ぎたタスクが見つかりませんでした`);
    } catch (error: any) {
      console.error('[ローリング生成] Error checking and generating next recurrence task:', error);
    }
  }

  // 次の繰り返しインスタンスを1つ生成
  private async generateNextRecurrenceInstance(parentTask: Task, lastInstanceNumber: number): Promise<string> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      let lastStartDate: Date;
      let lastEndDate: Date;
      let duration: number;

      // lastInstanceNumberが0の場合は親タスクを基準にする
      if (lastInstanceNumber === 0) {
        lastStartDate = parentTask.startDate.toDate();
        lastEndDate = parentTask.endDate.toDate();
        duration = lastEndDate.getTime() - lastStartDate.getTime();
      } else {
        // 最後のタスクを取得して日付を計算
        const q = query(
          collection(db, 'tasks'),
          where('parentTaskId', '==', parentTask.id),
          where('recurrenceInstance', '==', lastInstanceNumber),
          where('isDeleted', '==', false)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
          throw new Error('Last task not found');
        }

        const lastTask = snapshot.docs[0].data() as Task;
        lastStartDate = lastTask.startDate.toDate();
        lastEndDate = lastTask.endDate.toDate();
        duration = lastEndDate.getTime() - lastStartDate.getTime();
      }

      // 次の日付を計算
      const nextStartDate = new Date(lastStartDate);
      switch (parentTask.recurrence) {
        case RecurrenceType.Daily:
          nextStartDate.setDate(nextStartDate.getDate() + 1);
          break;
        case RecurrenceType.Weekly:
          nextStartDate.setDate(nextStartDate.getDate() + 7);
          break;
        case RecurrenceType.Biweekly:
          nextStartDate.setDate(nextStartDate.getDate() + 14);
          break;
        case RecurrenceType.Monthly:
          const nextMonth = new Date(nextStartDate);
          nextMonth.setMonth(nextMonth.getMonth() + 1);
          if (nextMonth.getDate() !== nextStartDate.getDate()) {
            nextMonth.setDate(0);
          }
          nextStartDate.setTime(nextMonth.getTime());
          break;
        case RecurrenceType.Yearly:
          nextStartDate.setFullYear(nextStartDate.getFullYear() + 1);
          if (nextStartDate.getMonth() === 1 && nextStartDate.getDate() === 29) {
            const year = nextStartDate.getFullYear();
            const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
            if (!isLeapYear) {
              nextStartDate.setDate(28);
            }
          }
          break;
      }

      const nextEndDate = new Date(nextStartDate.getTime() + duration);

      // 繰り返し終了日をチェック
      if (parentTask.recurrenceEndDate) {
        const recurrenceEndDate = parentTask.recurrenceEndDate.toDate();
        if (nextStartDate > recurrenceEndDate) {
          throw new Error('Recurrence end date exceeded');
        }
      }

      // 新しいタスクを作成
      const newTask: any = {
        title: parentTask.title,
        assigneeId: parentTask.assigneeId || '',
        assigneeName: parentTask.assigneeName || '',
        creatorId: parentTask.creatorId,
        creatorName: parentTask.creatorName,
        status: TaskStatus.NotStarted,
        startDate: Timestamp.fromDate(nextStartDate),
        endDate: Timestamp.fromDate(nextEndDate),
        priority: parentTask.priority,
        taskType: parentTask.taskType,
        subtasks: (parentTask.subtasks || []).map(subtask => ({
          ...subtask,
          completed: false
        })),
        progress: 0,
        showProgress: parentTask.showProgress !== undefined ? parentTask.showProgress : true,
        progressManual: false,
        reminders: (parentTask.reminders || []).map(reminder => ({
          ...reminder,
          id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
          sent: false
        })),
        comments: [],
        workSessions: [],
        totalWorkTime: 0,
        recurrence: parentTask.recurrence,
        parentTaskId: parentTask.id,
        recurrenceInstance: lastInstanceNumber + 1,
        isRecurrenceParent: false,
        files: [],
        isDeleted: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      if (parentTask.recurrenceEndDate !== undefined) newTask.recurrenceEndDate = parentTask.recurrenceEndDate;
      if (parentTask.description !== undefined) newTask.description = parentTask.description;
      if (parentTask.projectId !== undefined) newTask.projectId = parentTask.projectId;
      if (parentTask.projectName !== undefined) newTask.projectName = parentTask.projectName;
      if (parentTask.teamId !== undefined) newTask.teamId = parentTask.teamId;
      if (parentTask.teamName !== undefined) newTask.teamName = parentTask.teamName;
      if (parentTask.customPriority !== undefined) newTask.customPriority = parentTask.customPriority;
      if (parentTask.memo !== undefined) newTask.memo = parentTask.memo;

      const docRef = await addDoc(collection(db, 'tasks'), newTask);
      await this.sendTaskCreatedNotifications(docRef.id, newTask);

      return docRef.id;
    } catch (error: any) {
      console.error('Error generating next recurrence instance:', error);
      throw error;
    }
  }

  // 次やるタスク候補を取得（ユーザーが行うタスクを3件返す）
  async getNextTaskCandidates(userId: string): Promise<Task[]> {
    try {
      // 削除されていないタスクを取得
      const allTasks = await this.getTasks({ isDeleted: false });
      
      // ユーザーが行うタスクをフィルタリング
      // 条件：担当者が自分のタスク、または担当者なしで作成者が自分のタスク
      const userTasks = allTasks.filter(task => {
        // 完了済み・削除済みは除外
        if (task.status === TaskStatus.Completed || task.isDeleted) {
          return false;
        }
        
        // 担当者が自分のタスク
        if (task.assigneeId && task.assigneeId === userId) {
          return true;
        }
        
        // 担当者なしで作成者が自分のタスク
        if ((!task.assigneeId || task.assigneeId === '') && task.creatorId === userId) {
          return true;
        }
        
        return false;
      });

      // 優先度スコアを計算してソート
      const now = new Date();
      const tasksWithScore = userTasks.map(task => {
        let score = 0;
        
        // 重要度スコア（3倍）
        const priorityScores: { [key: string]: number } = {
          'important': 10,
          'normal': 5,
          'low': 2,
          'none': 1,
          'custom': 5
        };
        score += (priorityScores[task.priority] || 1) * 3;
        
        // 期限の近さスコア（2倍）
        const endDate = task.endDate.toDate();
        const daysUntilEnd = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilEnd < 0) {
          // 期限切れは高優先度
          score += 20 * 2;
        } else if (daysUntilEnd <= 1) {
          // 今日または明日
          score += 15 * 2;
        } else if (daysUntilEnd <= 3) {
          // 3日以内
          score += 10 * 2;
        } else if (daysUntilEnd <= 7) {
          // 1週間以内
          score += 5 * 2;
        } else {
          // それ以降
          score += 1 * 2;
        }
        
        // プロジェクト関連度スコア（1.5倍）
        // 同じプロジェクトのタスクが多い場合は少し優先度を上げる
        if (task.projectId) {
          const projectTasks = userTasks.filter(t => t.projectId === task.projectId);
          if (projectTasks.length > 1) {
            score += 3 * 1.5;
          }
        }
        
        // 担当者関連度スコア（1倍）
        // 担当者が設定されている場合は少し優先度を上げる
        if (task.assigneeId && task.assigneeId !== '') {
          score += 2 * 1;
        }
        
        // ステータススコア（進行中は少し優先度を上げる）
        if (task.status === TaskStatus.InProgress) {
          score += 5;
        }
        
        return { task, score };
      });
      
      // スコアで降順ソート
      tasksWithScore.sort((a, b) => b.score - a.score);
      
      // 上位3件を返す
      return tasksWithScore.slice(0, 3).map(item => item.task);
    } catch (error: any) {
      console.error('Error getting next task candidates:', error);
      return [];
    }
  }

  // 繰り返し設定変更時に削除されるタスクの件数を計算
  async calculateTasksToDeleteOnRecurrenceChange(
    taskId: string,
    newRecurrence: RecurrenceType,
    newRecurrenceEndDate: Timestamp | undefined,
    oldRecurrence: RecurrenceType,
    oldRecurrenceEndDate: Timestamp | undefined
  ): Promise<number> {
    try {
      const task = await this.getTask(taskId);
      if (!task) return 0;

      // 親タスクの場合、子タスクを取得
      const q = query(
        collection(db, 'tasks'),
        where('parentTaskId', '==', taskId),
        where('isDeleted', '==', false)
      );
      const snapshot = await getDocs(q);
      const childTasks = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Task));

      const now = new Date();
      now.setHours(0, 0, 0, 0);

      let deleteCount = 0;

      // ①繰り返しあり→なし: 現在以降の未着手タスクを完全削除
      if (oldRecurrence !== RecurrenceType.None && newRecurrence === RecurrenceType.None) {
        deleteCount = childTasks.filter(child => {
          // 親タスク自身を除外（parentTaskIdが自分自身に設定されている場合があるため）
          if (child.id === taskId) return false;
          if (child.status === TaskStatus.Completed) return false;
          const endDate = child.endDate.toDate();
          endDate.setHours(0, 0, 0, 0);
          return endDate >= now;
        }).length;
      }
      // ③繰り返し周期変更: 現在以降の未着手タスクを完全削除
      else if (oldRecurrence !== RecurrenceType.None && newRecurrence !== RecurrenceType.None && 
               oldRecurrence !== newRecurrence) {
        deleteCount = childTasks.filter(child => {
          // 親タスク自身を除外（parentTaskIdが自分自身に設定されている場合があるため）
          if (child.id === taskId) return false;
          if (child.status === TaskStatus.Completed) return false;
          const endDate = child.endDate.toDate();
          endDate.setHours(0, 0, 0, 0);
          return endDate >= now;
        }).length;
      }
      // ④繰り返し終了日変更: 範囲外のタスクを完全削除
      else if (oldRecurrence !== RecurrenceType.None && newRecurrence === oldRecurrence && 
               newRecurrenceEndDate && oldRecurrenceEndDate) {
        const newEndDate = newRecurrenceEndDate.toDate();
        newEndDate.setHours(23, 59, 59, 999);
        
        deleteCount = childTasks.filter(child => {
          // 親タスク自身を除外（parentTaskIdが自分自身に設定されている場合があるため）
          if (child.id === taskId) return false;
          const childEndDate = child.endDate.toDate();
          childEndDate.setHours(23, 59, 59, 999);
          return childEndDate > newEndDate;
        }).length;
      }

      return deleteCount;
    } catch (error: any) {
      console.error('Error calculating tasks to delete:', error);
      return 0;
    }
  }

  // 繰り返し設定変更を処理するメソッド
  async updateTaskWithRecurrenceChange(
    taskId: string,
    updates: Partial<Task>,
    oldRecurrence: RecurrenceType,
    oldRecurrenceEndDate: Timestamp | undefined,
    newRecurrence: RecurrenceType,
    newRecurrenceEndDate: Timestamp | undefined
  ): Promise<void> {
    try {
      const task = await this.getTask(taskId);
      if (!task) throw new Error('Task not found');

      // 通常の更新処理
      await this.updateTask(taskId, updates);

      // 繰り返し設定の変更を処理
      // ①繰り返しあり→なし
      if (oldRecurrence !== RecurrenceType.None && newRecurrence === RecurrenceType.None) {
        await this.handleRecurrenceRemoved(taskId);
      }
      // ②繰り返しなし→あり
      else if (oldRecurrence === RecurrenceType.None && newRecurrence !== RecurrenceType.None) {
        await this.handleRecurrenceAdded(taskId, newRecurrence, newRecurrenceEndDate);
      }
      // ③繰り返し周期変更
      else if (oldRecurrence !== RecurrenceType.None && newRecurrence !== RecurrenceType.None && 
               oldRecurrence !== newRecurrence) {
        await this.handleRecurrencePeriodChanged(taskId, newRecurrence, newRecurrenceEndDate);
      }
      // ④繰り返し終了日変更
      else if (oldRecurrence !== RecurrenceType.None && newRecurrence === oldRecurrence && 
               newRecurrenceEndDate && oldRecurrenceEndDate &&
               newRecurrenceEndDate.toMillis() !== oldRecurrenceEndDate.toMillis()) {
        await this.handleRecurrenceEndDateChanged(taskId, newRecurrenceEndDate);
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 繰り返しあり→なしの処理
  private async handleRecurrenceRemoved(taskId: string): Promise<void> {
    const q = query(
      collection(db, 'tasks'),
      where('parentTaskId', '==', taskId),
      where('isDeleted', '==', false)
    );
    const snapshot = await getDocs(q);
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const doc of snapshot.docs) {
      const childTask = { id: doc.id, ...doc.data() } as Task;
      
      // 親タスク自身を除外（parentTaskIdが自分自身に設定されている場合があるため）
      if (childTask.id === taskId) {
        continue;
      }
      
      // 現在以降の未着手タスクを完全削除
      if (childTask.status !== TaskStatus.Completed) {
        const endDate = childTask.endDate.toDate();
        endDate.setHours(0, 0, 0, 0);
        if (endDate >= now) {
          await deleteDoc(doc.ref);
        }
      }
    }

    // 親タスクの繰り返し設定をクリア
    await updateDoc(doc(db, 'tasks', taskId), {
      recurrence: RecurrenceType.None,
      recurrenceEndDate: deleteField(),
      parentTaskId: deleteField(),
      recurrenceInstance: deleteField(),
      isRecurrenceParent: false
    });
  }

  // 繰り返しなし→ありの処理
  private async handleRecurrenceAdded(
    taskId: string,
    newRecurrence: RecurrenceType,
    newRecurrenceEndDate: Timestamp | undefined
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) return;

    // 親タスクとして設定
    const updateData: any = {
      recurrence: newRecurrence,
      parentTaskId: taskId,
      recurrenceInstance: 0,
      isRecurrenceParent: true
    };
    if (newRecurrenceEndDate !== undefined) {
      updateData.recurrenceEndDate = newRecurrenceEndDate;
    } else {
      updateData.recurrenceEndDate = deleteField();
    }
    await updateDoc(doc(db, 'tasks', taskId), updateData);

    // 以降のタスクを自動生成（親タスクを基準に）
    const updatedTask = await this.getTask(taskId);
    if (updatedTask) {
      await this.generateRecurrenceTasksFromParent(updatedTask);
    }
  }

  // 親タスクを基準に繰り返しタスクを生成（繰り返しなしから繰り返しありに変更した場合用）
  private async generateRecurrenceTasksFromParent(parentTask: Task): Promise<void> {
    try {
      if (parentTask.recurrence === RecurrenceType.None) {
        return;
      }

      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const startDate = parentTask.startDate.toDate();
      const endDate = parentTask.endDate.toDate();
      const duration = endDate.getTime() - startDate.getTime(); // タスクの期間（ミリ秒）

      // 現在日時を取得（今日の0時0分0秒）
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      // 繰り返し終了日を決定
      let recurrenceEndDate: Date;
      const maxPeriod = this.getMaxRecurrencePeriod(parentTask.recurrence);
      const maxEndDate = new Date(startDate);
      maxEndDate.setMonth(maxEndDate.getMonth() + maxPeriod);

      if (parentTask.recurrenceEndDate) {
        recurrenceEndDate = parentTask.recurrenceEndDate.toDate();
        // 最大期間を超えているかチェック（日付レベルで比較）
        const recurrenceEndDateOnly = new Date(recurrenceEndDate.getFullYear(), recurrenceEndDate.getMonth(), recurrenceEndDate.getDate());
        const maxEndDateOnly = new Date(maxEndDate.getFullYear(), maxEndDate.getMonth(), maxEndDate.getDate());
        if (recurrenceEndDateOnly > maxEndDateOnly) {
          throw new Error(`繰り返し終了日が最大生成期間（${maxPeriod}か月）を超えています。`);
        }
      } else {
        // 繰り返し終了日が未設定の場合は最大期間で生成
        recurrenceEndDate = maxEndDate;
      }

      const generatedTaskIds: string[] = [];
      // 親タスクの開始日から次のタスクを生成（親タスクと同じ日付をスキップ）
      let currentStartDate = new Date(startDate);
      let instanceNumber = 1; // 最初のタスクは親なので、次から1

      // 最初の日付を1回進める（親タスクと同じ日付をスキップ）
      switch (parentTask.recurrence) {
        case RecurrenceType.Daily:
          currentStartDate.setDate(currentStartDate.getDate() + 1);
          break;
        case RecurrenceType.Weekly:
          currentStartDate.setDate(currentStartDate.getDate() + 7);
          break;
        case RecurrenceType.Biweekly:
          currentStartDate.setDate(currentStartDate.getDate() + 14);
          break;
        case RecurrenceType.Monthly:
          const nextMonth = new Date(currentStartDate);
          nextMonth.setMonth(nextMonth.getMonth() + 1);
          if (nextMonth.getDate() !== currentStartDate.getDate()) {
            nextMonth.setDate(0);
          }
          currentStartDate = nextMonth;
          break;
        case RecurrenceType.Yearly:
          currentStartDate.setFullYear(currentStartDate.getFullYear() + 1);
          if (currentStartDate.getMonth() === 1 && currentStartDate.getDate() === 29) {
            const year = currentStartDate.getFullYear();
            const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
            if (!isLeapYear) {
              currentStartDate.setDate(28);
            }
          }
          break;
      }

      // 日付計算ループ（タスク作成時と同じロジック）
      while (currentStartDate <= recurrenceEndDate) {
        const currentEndDate = new Date(currentStartDate.getTime() + duration);
        const currentStartDateOnly = new Date(currentStartDate.getFullYear(), currentStartDate.getMonth(), currentStartDate.getDate());

        // 現在日時より後のタスクのみを生成
        if (currentStartDateOnly < now) {
          // 現在日時より前の場合はスキップして次の日付へ
          switch (parentTask.recurrence) {
            case RecurrenceType.Daily:
              currentStartDate.setDate(currentStartDate.getDate() + 1);
              break;
            case RecurrenceType.Weekly:
              currentStartDate.setDate(currentStartDate.getDate() + 7);
              break;
            case RecurrenceType.Biweekly:
              currentStartDate.setDate(currentStartDate.getDate() + 14);
              break;
            case RecurrenceType.Monthly:
              const nextMonth = new Date(currentStartDate);
              nextMonth.setMonth(nextMonth.getMonth() + 1);
              if (nextMonth.getDate() !== currentStartDate.getDate()) {
                nextMonth.setDate(0);
              }
              currentStartDate = nextMonth;
              break;
            case RecurrenceType.Yearly:
              currentStartDate.setFullYear(currentStartDate.getFullYear() + 1);
              if (currentStartDate.getMonth() === 1 && currentStartDate.getDate() === 29) {
                const year = currentStartDate.getFullYear();
                const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
                if (!isLeapYear) {
                  currentStartDate.setDate(28);
                }
              }
              break;
          }
          instanceNumber++;
          continue;
        }

        // 繰り返し終了日を超えないようにチェック
        if (currentStartDate > recurrenceEndDate) {
          break;
        }

        // 次のタスクを作成
        const recurringTask: any = {
          title: parentTask.title,
          assigneeId: parentTask.assigneeId || '',
          assigneeName: parentTask.assigneeName || '',
          creatorId: parentTask.creatorId,
          creatorName: parentTask.creatorName,
          status: TaskStatus.NotStarted,
          startDate: Timestamp.fromDate(new Date(currentStartDate)),
          endDate: Timestamp.fromDate(new Date(currentEndDate)),
          priority: parentTask.priority,
          taskType: parentTask.taskType,
          subtasks: (parentTask.subtasks || []).map(subtask => ({
            ...subtask,
            completed: false // サブタスクは未完了にする
          })),
          progress: 0,
          showProgress: parentTask.showProgress !== undefined ? parentTask.showProgress : true,
          progressManual: false,
          reminders: (parentTask.reminders || []).map(reminder => ({
            ...reminder,
            id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
            sent: false // リマインダーは未送信にする
          })),
          comments: [],
          workSessions: [],
          totalWorkTime: 0,
          recurrence: parentTask.recurrence,
          parentTaskId: parentTask.id,
          recurrenceInstance: instanceNumber,
          isRecurrenceParent: false,
          files: [], // ファイルは複製しない
          isDeleted: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        // undefinedでないフィールドのみ追加
        if (parentTask.recurrenceEndDate !== undefined) recurringTask.recurrenceEndDate = parentTask.recurrenceEndDate;
        if (parentTask.description !== undefined) recurringTask.description = parentTask.description;
        if (parentTask.projectId !== undefined) recurringTask.projectId = parentTask.projectId;
        if (parentTask.projectName !== undefined) recurringTask.projectName = parentTask.projectName;
        if (parentTask.teamId !== undefined) recurringTask.teamId = parentTask.teamId;
        if (parentTask.teamName !== undefined) recurringTask.teamName = parentTask.teamName;
        if (parentTask.customPriority !== undefined) recurringTask.customPriority = parentTask.customPriority;
        if (parentTask.memo !== undefined) recurringTask.memo = parentTask.memo;

        const docRef = await addDoc(collection(db, 'tasks'), recurringTask);
        generatedTaskIds.push(docRef.id);

        // 通知を送信（親タスクと同じ通知ロジック）
        await this.sendTaskCreatedNotifications(docRef.id, recurringTask);

        // 次の日付を計算
        switch (parentTask.recurrence) {
          case RecurrenceType.Daily:
            currentStartDate.setDate(currentStartDate.getDate() + 1);
            break;
          case RecurrenceType.Weekly:
            currentStartDate.setDate(currentStartDate.getDate() + 7);
            break;
          case RecurrenceType.Biweekly:
            currentStartDate.setDate(currentStartDate.getDate() + 14);
            break;
          case RecurrenceType.Monthly:
            // 月末の場合は調整（例: 1/31 → 2/28 → 3/31）
            const nextMonth = new Date(currentStartDate);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            // 同じ日付が存在しない場合は、月末に調整
            if (nextMonth.getDate() !== currentStartDate.getDate()) {
              nextMonth.setDate(0); // 前月の最終日
            }
            currentStartDate = nextMonth;
            break;
          case RecurrenceType.Yearly:
            currentStartDate.setFullYear(currentStartDate.getFullYear() + 1);
            // うるう年対応（2/29の場合）
            if (currentStartDate.getMonth() === 1 && currentStartDate.getDate() === 29) {
              const year = currentStartDate.getFullYear();
              const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
              if (!isLeapYear) {
                currentStartDate.setDate(28); // うるう年でない場合は2/28に
              }
            }
            break;
        }

        instanceNumber++;
      }

      return;
    } catch (error: any) {
      console.error('Error generating recurrence tasks from parent:', error);
      throw error;
    }
  }

  // 繰り返し周期変更の処理
  private async handleRecurrencePeriodChanged(
    taskId: string,
    newRecurrence: RecurrenceType,
    newRecurrenceEndDate: Timestamp | undefined
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) return;

    // 現在以降の未着手タスクを完全削除
    const q = query(
      collection(db, 'tasks'),
      where('parentTaskId', '==', taskId),
      where('isDeleted', '==', false)
    );
    const snapshot = await getDocs(q);
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const doc of snapshot.docs) {
      const childTask = { id: doc.id, ...doc.data() } as Task;
      
      // 親タスク自身を除外（parentTaskIdが自分自身に設定されている場合があるため）
      if (childTask.id === taskId) {
        continue;
      }
      
      if (childTask.status !== TaskStatus.Completed) {
        const endDate = childTask.endDate.toDate();
        endDate.setHours(0, 0, 0, 0);
        if (endDate >= now) {
          await deleteDoc(doc.ref);
        }
      }
    }

    // 親タスクの繰り返し設定を更新
    const updateData: any = {
      recurrence: newRecurrence
    };
    if (newRecurrenceEndDate !== undefined) {
      updateData.recurrenceEndDate = newRecurrenceEndDate;
    } else {
      updateData.recurrenceEndDate = deleteField();
    }
    await updateDoc(doc(db, 'tasks', taskId), updateData);

    // 以降のタスクを自動生成（新しい間隔で複数のタスクを生成）
    const updatedTask = await this.getTask(taskId);
    if (updatedTask) {
      await this.generateRecurrenceTasksFromParent(updatedTask);
    }
  }

  // 繰り返し終了日変更の処理
  private async handleRecurrenceEndDateChanged(
    taskId: string,
    newRecurrenceEndDate: Timestamp
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) return;

    // 範囲外のタスクを完全削除
    const q = query(
      collection(db, 'tasks'),
      where('parentTaskId', '==', taskId),
      where('isDeleted', '==', false)
    );
    const snapshot = await getDocs(q);
    const newEndDate = newRecurrenceEndDate.toDate();
    newEndDate.setHours(23, 59, 59, 999);

    for (const doc of snapshot.docs) {
      const childTask = { id: doc.id, ...doc.data() } as Task;
      
      // 親タスク自身を除外（parentTaskIdが自分自身に設定されている場合があるため）
      if (childTask.id === taskId) {
        continue;
      }
      
      const childEndDate = childTask.endDate.toDate();
      childEndDate.setHours(23, 59, 59, 999);
      if (childEndDate > newEndDate) {
        await deleteDoc(doc.ref);
      }
    }

    // 親タスクの繰り返し終了日を更新
    await updateDoc(doc(db, 'tasks', taskId), {
      recurrenceEndDate: newRecurrenceEndDate
    });
  }

  // 親タスク削除時の処理（子タスクを完全削除）
  async permanentlyDeleteChildTasks(parentTaskId: string): Promise<void> {
    try {
      const q = query(
        collection(db, 'tasks'),
        where('parentTaskId', '==', parentTaskId),
        where('isDeleted', '==', false)
      );
      const snapshot = await getDocs(q);

      for (const doc of snapshot.docs) {
        await deleteDoc(doc.ref);
      }
    } catch (error: any) {
      console.error('Error permanently deleting child tasks:', error);
      throw new Error('子タスクの削除に失敗しました: ' + error.message);
    }
  }

  // 今日以降の繰り返しタスクの数を取得
  async getFutureRecurrenceTasksCount(parentTaskId: string): Promise<number> {
    try {
      const q = query(
        collection(db, 'tasks'),
        where('parentTaskId', '==', parentTaskId),
        where('isDeleted', '==', false)
      );
      const snapshot = await getDocs(q);
      
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      let count = 0;
      for (const doc of snapshot.docs) {
        const childTask = { id: doc.id, ...doc.data() } as Task;
        const endDate = childTask.endDate.toDate();
        endDate.setHours(0, 0, 0, 0);
        if (endDate >= now) {
          count++;
        }
      }
      return count;
    } catch (error: any) {
      console.error('Error getting future recurrence tasks count:', error);
      return 0;
    }
  }
}

