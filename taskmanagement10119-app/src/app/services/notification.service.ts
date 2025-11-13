import { Injectable, inject } from '@angular/core';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  deleteDoc,
  deleteField,
  writeBatch,
  Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase-config';
import { Notification, NotificationType, getNotificationCategory, getNotificationSettingKey } from '../models/notification.model';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private authService = inject(AuthService);

  async createNotification(notificationData: Partial<Notification>): Promise<string | null> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      // 通知を受信するユーザーを取得
      const targetUserId = notificationData.userId || user.uid;
      const targetUser = await this.authService.getUserData(targetUserId);
      
      // ユーザーの通知設定をチェック
      if (targetUser && notificationData.type) {
        // checkTypeを考慮してカテゴリと設定キーを取得
        const category = getNotificationCategory(
          notificationData.type as NotificationType,
          notificationData.checkType
        );
        const notificationSettings = targetUser.notificationSettings;
        
        // カテゴリ設定がfalseの場合は通知を作成しない
        if (!notificationSettings[category]) {
          console.log(`[通知] ユーザー ${targetUserId} の ${category} カテゴリの通知は無効化されています`);
          return null;
        }
        
        // 個別設定もチェック（checkTypeを考慮）
        const settingKey = getNotificationSettingKey(
          notificationData.type as NotificationType,
          notificationData.checkType
        );
        if (settingKey && notificationSettings[settingKey] === false) {
          console.log(`[通知] ユーザー ${targetUserId} の ${settingKey} 個別設定の通知は無効化されています`);
          return null;
        }
      }

      const notification: Omit<Notification, 'id'> = {
        userId: targetUserId,
        type: notificationData.type || 'task_reminder' as any,
        title: notificationData.title || '',
        message: notificationData.message || '',
        isRead: false,
        createdAt: Timestamp.now()
      };
      
      // undefinedのフィールドは追加しない（Firestoreではundefinedを保存できない）
      if (notificationData.taskId !== undefined) {
        notification.taskId = notificationData.taskId;
      }
      if (notificationData.projectId !== undefined) {
        notification.projectId = notificationData.projectId;
      }
      if (notificationData.teamId !== undefined) {
        notification.teamId = notificationData.teamId;
      }
      if (notificationData.invitationId !== undefined) {
        notification.invitationId = notificationData.invitationId;
      }
      if (notificationData.checkType !== undefined) {
        notification.checkType = notificationData.checkType;
      }

      const docRef = await addDoc(collection(db, 'notifications'), notification);
      return docRef.id;
    } catch (error: any) {
      console.error('Error creating notification:', error);
      console.error('Error details:', error.message);
      throw new Error(error.message);
    }
  }

  async getNotifications(userId: string, userTeamIds: string[] = [], includeDeleted: boolean = false): Promise<Notification[]> {
    try {
      let notifications: Notification[] = [];
      
      // 自分に関する通知を取得（isDeletedのフィルタリングはクライアント側で行う）
      const userQuery = query(
        collection(db, 'notifications'),
        where('userId', '==', userId)
      );
      
      const userSnapshot = await getDocs(userQuery);
      notifications.push(...userSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Notification)));
      
      // チームに所属している場合は、チームに関する通知も取得
      if (userTeamIds.length > 0) {
        // チームIDごとにクエリを実行（Firestoreのwhere('in')は最大10個まで）
        const teamIdChunks = [];
        for (let i = 0; i < userTeamIds.length; i += 10) {
          teamIdChunks.push(userTeamIds.slice(i, i + 10));
        }
        
        for (const chunk of teamIdChunks) {
          const teamQuery = query(
            collection(db, 'notifications'),
            where('teamId', 'in', chunk),
            where('userId', '==', userId)  // userIdもフィルタリング
          );
          
          const teamSnapshot = await getDocs(teamQuery);
          const teamNotifications = teamSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          } as Notification));
          
          // 重複を避ける（同じ通知IDが複数ある場合）
          teamNotifications.forEach(notification => {
            if (!notifications.find(n => n.id === notification.id)) {
              notifications.push(notification);
            }
          });
        }
      }
      
      // クライアント側でisDeletedのフィルタリング
      if (!includeDeleted) {
        notifications = notifications.filter(n => n.isDeleted !== true);
      }
      
      // クライアント側でソート
      notifications.sort((a, b) => {
        const aTime = a.createdAt?.toMillis() || 0;
        const bTime = b.createdAt?.toMillis() || 0;
        return bTime - aTime; // 降順
      });
      
      return notifications;
    } catch (error: any) {
      console.error('Error getting notifications:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      // エラーが発生しても空配列を返す（アプリがクラッシュしないように）
      return [];
    }
  }

  async markAsRead(notificationId: string): Promise<void> {
    try {
      const notificationRef = doc(db, 'notifications', notificationId);
      await updateDoc(notificationRef, {
        isRead: true,
        readAt: Timestamp.now()
      });
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async getUnreadCount(userId: string, userTeamIds: string[] = []): Promise<number> {
    try {
      const notifications = await this.getNotifications(userId, userTeamIds);
      return notifications.filter(n => !n.isRead).length;
    } catch (error) {
      return 0;
    }
  }

  // 通知を削除（論理削除）
  async deleteNotification(notificationId: string): Promise<void> {
    try {
      const notificationRef = doc(db, 'notifications', notificationId);
      await updateDoc(notificationRef, {
        isDeleted: true,
        deletedAt: Timestamp.now()
      });
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 通知を復元
  async restoreNotification(notificationId: string): Promise<void> {
    try {
      const notificationRef = doc(db, 'notifications', notificationId);
      await updateDoc(notificationRef, {
        isDeleted: deleteField(),
        deletedAt: deleteField()
      });
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 通知を完全削除
  async permanentlyDeleteNotification(notificationId: string): Promise<void> {
    try {
      const notificationRef = doc(db, 'notifications', notificationId);
      await deleteDoc(notificationRef);
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 複数の通知を一括既読にする
  async markAllAsRead(notificationIds: string[]): Promise<void> {
    try {
      const batch = writeBatch(db);
      const now = Timestamp.now();
      
      for (const notificationId of notificationIds) {
        const notificationRef = doc(db, 'notifications', notificationId);
        batch.update(notificationRef, {
          isRead: true,
          readAt: now
        });
      }
      
      await batch.commit();
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 複数の通知を一括削除（論理削除）
  async deleteAllNotifications(notificationIds: string[]): Promise<void> {
    try {
      const batch = writeBatch(db);
      const now = Timestamp.now();
      
      for (const notificationId of notificationIds) {
        const notificationRef = doc(db, 'notifications', notificationId);
        batch.update(notificationRef, {
          isDeleted: true,
          deletedAt: now
        });
      }
      
      await batch.commit();
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 複数の通知を一括復元
  async restoreAllNotifications(notificationIds: string[]): Promise<void> {
    try {
      const batch = writeBatch(db);
      
      for (const notificationId of notificationIds) {
        const notificationRef = doc(db, 'notifications', notificationId);
        batch.update(notificationRef, {
          isDeleted: deleteField(),
          deletedAt: deleteField()
        });
      }
      
      await batch.commit();
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 複数の通知を一括完全削除
  async permanentlyDeleteAllNotifications(notificationIds: string[]): Promise<void> {
    try {
      const batch = writeBatch(db);
      
      for (const notificationId of notificationIds) {
        const notificationRef = doc(db, 'notifications', notificationId);
        batch.delete(notificationRef);
      }
      
      await batch.commit();
    } catch (error: any) {
      throw new Error(error.message);
    }
  }
}

