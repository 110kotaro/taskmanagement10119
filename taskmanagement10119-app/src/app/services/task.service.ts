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

@Injectable({
  providedIn: 'root'
})
export class TaskService {
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);
  private projectService = inject(ProjectService);

  async createTask(taskData: Partial<Task>): Promise<string> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      // undefinedのフィールドを除外する
      const task: any = {
        title: taskData.title || '',
        assigneeId: taskData.assigneeId || '',
        assigneeName: taskData.assigneeName || '',
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
      if (taskData.customTaskType !== undefined) task.customTaskType = taskData.customTaskType;
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
    // 全ユーザーが全タスクを閲覧可能（後でフィルターや個人/チーム切り替えで対応）
    return true;
  }

  async canEditTask(task: Task, userId: string): Promise<boolean> {
    try {
      // 管理者は常に編集可能
      const user = await this.authService.getUser(userId);
      if (user?.role === UserRole.Admin) return true;
      
      // 作成者、担当者は編集可能
      return task.creatorId === userId || task.assigneeId === userId;
    } catch (error) {
      console.error('Error checking edit permission:', error);
      return false;
    }
  }

  async canDeleteTask(task: Task, userId: string): Promise<boolean> {
    try {
      // 管理者は常に削除可能
      const user = await this.authService.getUser(userId);
      if (user?.role === UserRole.Admin) return true;
      
      // 作成者のみ削除可能（担当者は削除不可）
      return task.creatorId === userId;
    } catch (error) {
      console.error('Error checking delete permission:', error);
      return false;
    }
  }

  async updateTask(taskId: string, updates: Partial<Task>, skipAutoComment: boolean = false): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      // 権限チェック（更新前のタスクを取得）
      const taskBeforeUpdate = await this.getTask(taskId);
      if (!taskBeforeUpdate) throw new Error('Task not found');
      
      if (!await this.canEditTask(taskBeforeUpdate, user.uid)) {
        throw new Error('このタスクを編集する権限がありません');
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
      const taskForNotification = { ...taskBeforeUpdate };
      if (updates.isDeleted === false && taskBeforeUpdate.isDeleted === false) {
        // 復元処理の場合、元の状態をtrueと仮定
        taskForNotification.isDeleted = true;
      }
      
      await this.sendTaskUpdatedNotifications(taskId, taskForNotification, updates);
      
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
      
      const taskRef = doc(db, 'tasks', taskId);
      await updateDoc(taskRef, {
        isDeleted: true,
        deletedAt: Timestamp.now(),
        statusBeforeDeletion: task.status // 削除前のステータスを保存
      });
      
      // 削除通知を送信
      await this.sendTaskDeletedNotifications(taskId, task);
      
      // プロジェクトに紐づいている場合は、プロジェクトの完了率を再計算
      if (projectId) {
        await this.projectService.recalculateProjectCompletionRate(projectId);
      }
    } catch (error: any) {
      console.error('Error deleting task:', error);
      throw new Error(error.message);
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
  }): Promise<Task[]> {
    try {
      const constraints: QueryConstraint[] = [];
      
      if (filters.status && filters.status.length > 0) {
        constraints.push(where('status', 'in', filters.status));
      }
      
      if (filters.assigneeId) {
        constraints.push(where('assigneeId', '==', filters.assigneeId));
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
          if (filters.userId && filters.userTeamIds && filters.userTeamIds.length > 0) {
            const userTeamIds = filters.userTeamIds; // 型チェック用に変数に保存
            filteredTasks = tasks.filter(task => {
              // 個人タスク（teamIdが未設定）で自分が作成者
              if (!task.teamId && task.creatorId === filters.userId) {
                return true;
              }
              // チームタスクで自分が担当者かつ所属チームに含まれる
              if (task.teamId && task.assigneeId === filters.userId && userTeamIds.includes(task.teamId)) {
                return true;
              }
              return false;
            });
          } else if (filters.userId) {
            // フォールバック: 自分が作成したタスクのみ（チーム未参加の場合）
            filteredTasks = tasks.filter(task => !task.teamId && task.creatorId === filters.userId);
          } else {
            // フォールバック: 個人タスク（teamIdが未設定）
            filteredTasks = tasks.filter(task => !task.teamId);
          }
        } else {
          // チームタスク（teamIdが一致）
          filteredTasks = tasks.filter(task => task.teamId === filters.teamId);
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
        filteredTasks = filteredTasks.filter(task => {
          // 個人タスク（teamIdが未設定）で自分が作成者
          if (!task.teamId && task.creatorId === userId) {
            return true;
          }
          // チームタスクで自分が担当者かつ所属チームに含まれる
          if (task.teamId && task.assigneeId === userId && userTeamIds.includes(task.teamId)) {
            return true;
          }
          return false;
        });
      } else if (teamId) {
        // チームタスク（teamIdが一致）
        filteredTasks = filteredTasks.filter(task => task.teamId === teamId);
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
        filteredTasks = dateFilteredTasks.filter(task => {
          // 個人タスク（teamIdが未設定）で自分が作成者
          if (!task.teamId && task.creatorId === userId) {
            return true;
          }
          // チームタスクで自分が担当者かつ所属チームに含まれる
          if (task.teamId && task.assigneeId === userId && userTeamIds.includes(task.teamId)) {
            return true;
          }
          return false;
        });
      } else if (teamId) {
        // チームタスク（teamIdが一致）
        filteredTasks = dateFilteredTasks.filter(task => task.teamId === teamId);
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

      // 担当者に通知
      if (task.assigneeId && task.assigneeId !== '' && task.assigneeId !== creator.uid) {
        await this.notificationService.createNotification({
          userId: task.assigneeId,
          type: NotificationType.TaskCreated,
          title: '新しいタスクが割り当てられました',
          message: `${creator.displayName || creator.email}が「${task.title}」というタスクをあなたに割り当てました`,
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
            // 作成者と担当者は既に通知済みなのでスキップ
            if (member.userId !== creator.uid && member.userId !== task.assigneeId) {
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
        // 担当者に通知（復元者と異なる場合）
        if (task.assigneeId && task.assigneeId !== '' && task.assigneeId !== updater.uid) {
          await this.notificationService.createNotification({
            userId: task.assigneeId,
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
              // 復元者と担当者はスキップ
              if (member.userId !== updater.uid && member.userId !== task.assigneeId) {
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
        // 完了時の通知（更新者が担当者と異なる場合、担当者に完了通知を送信）
        if (updates.status === TaskStatus.Completed && task.assigneeId && task.assigneeId !== '' && task.assigneeId !== updater.uid) {
          await this.notificationService.createNotification({
            userId: task.assigneeId,
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
          if (task.assigneeId && task.assigneeId !== '' && task.assigneeId !== updater.uid) {
            await this.notificationService.createNotification({
              userId: task.assigneeId,
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
                // 更新者と担当者はスキップ
                if (member.userId !== updater.uid && member.userId !== task.assigneeId) {
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
            // 更新者と担当者はスキップ
            if (member.userId !== updater.uid && member.userId !== task.assigneeId) {
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
        // プロジェクトに紐づいていない場合は、担当者に通知（更新者が担当者でない場合）
        if (task.assigneeId && task.assigneeId !== updater.uid) {
          await this.notificationService.createNotification({
            userId: task.assigneeId,
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

      // 担当者に通知（削除者と異なる場合）
      if (task.assigneeId && task.assigneeId !== '' && task.assigneeId !== deleter.uid) {
        await this.notificationService.createNotification({
          userId: task.assigneeId,
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
            // 削除者と担当者はスキップ
            if (member.userId !== deleter.uid && member.userId !== task.assigneeId) {
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
    const needsEndDateCheck = (task.status === TaskStatus.NotStarted || task.status === TaskStatus.InProgress) &&
                              (endTime === endTimeMax ? 
                                endDate.getTime() < today.getTime() : 
                                endDate.getTime() < now.getTime());
    
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
      if (originalTask.customTaskType !== undefined) duplicatedTask.customTaskType = originalTask.customTaskType;
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
          recurrenceEndDate: parentTask.recurrenceEndDate,
          parentTaskId: parentTask.id,
          recurrenceInstance: instanceNumber,
          isRecurrenceParent: false,
          files: [], // ファイルは複製しない
          isDeleted: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        // undefinedでないフィールドのみ追加
        if (parentTask.description !== undefined) recurringTask.description = parentTask.description;
        if (parentTask.projectId !== undefined) recurringTask.projectId = parentTask.projectId;
        if (parentTask.projectName !== undefined) recurringTask.projectName = parentTask.projectName;
        if (parentTask.customPriority !== undefined) recurringTask.customPriority = parentTask.customPriority;
        if (parentTask.customTaskType !== undefined) recurringTask.customTaskType = parentTask.customTaskType;
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
      await updateDoc(doc(db, 'tasks', parentTask.id), {
        isRecurrenceParent: true,
        recurrenceInstance: 0
      });

      return generatedTaskIds;
    } catch (error: any) {
      console.error('Error generating recurring tasks:', error);
      throw error;
    }
  }

  // ローリング生成：最初のタスクの終了日が過ぎたら、次のタスクを生成
  async checkAndGenerateNextRecurrenceTask(parentTaskId: string): Promise<void> {
    try {
      const parentTask = await this.getTask(parentTaskId);
      if (!parentTask || !parentTask.isRecurrenceParent || parentTask.recurrence === RecurrenceType.None) {
        return;
      }

      // 最後のタスク（最大のrecurrenceInstance）を取得
      const q = query(
        collection(db, 'tasks'),
        where('parentTaskId', '==', parentTaskId),
        where('isDeleted', '==', false),
        orderBy('recurrenceInstance', 'desc')
      );
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        // 子タスクがない場合は、親タスクを基準に生成
        const now = new Date();
        const parentEndDate = parentTask.endDate.toDate();
        if (parentEndDate <= now) {
          // 親タスクの終了日が過ぎているので、次のタスクを生成
          await this.generateNextRecurrenceInstance(parentTask, 0);
        }
        return;
      }

      // 最後のタスクを取得
      const lastTask = snapshot.docs[0].data() as Task;
      const lastEndDate = lastTask.endDate.toDate();
      const now = new Date();

      // 最後のタスクの終了日が過ぎているか、または過ぎそうな場合（1日前）
      const oneDayBefore = new Date(now);
      oneDayBefore.setDate(oneDayBefore.getDate() + 1);

      if (lastEndDate <= oneDayBefore) {
        // 繰り返し終了日をチェック
        const recurrenceEndDate = parentTask.recurrenceEndDate 
          ? parentTask.recurrenceEndDate.toDate()
          : null;
        
        if (recurrenceEndDate && lastEndDate >= recurrenceEndDate) {
          // 繰り返し終了日を超えているので生成しない
          return;
        }

        // 次のタスクを生成
        await this.generateNextRecurrenceInstance(parentTask, lastTask.recurrenceInstance || 0);
      }
    } catch (error: any) {
      console.error('Error checking and generating next recurrence task:', error);
    }
  }

  // 次の繰り返しインスタンスを1つ生成
  private async generateNextRecurrenceInstance(parentTask: Task, lastInstanceNumber: number): Promise<string> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

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
      const lastStartDate = lastTask.startDate.toDate();
      const lastEndDate = lastTask.endDate.toDate();
      const duration = lastEndDate.getTime() - lastStartDate.getTime();

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
        recurrenceEndDate: parentTask.recurrenceEndDate,
        parentTaskId: parentTask.id,
        recurrenceInstance: lastInstanceNumber + 1,
        isRecurrenceParent: false,
        files: [],
        isDeleted: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      if (parentTask.description !== undefined) newTask.description = parentTask.description;
      if (parentTask.projectId !== undefined) newTask.projectId = parentTask.projectId;
      if (parentTask.projectName !== undefined) newTask.projectName = parentTask.projectName;
      if (parentTask.customPriority !== undefined) newTask.customPriority = parentTask.customPriority;
      if (parentTask.customTaskType !== undefined) newTask.customTaskType = parentTask.customTaskType;
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
}

