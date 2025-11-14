import { Injectable, inject } from '@angular/core';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
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
import { Notification, NotificationType, getNotificationCategory, getNotificationSettingKey, getWebPushCategoryKey, getWebPushSettingKey } from '../models/notification.model';
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
        
        // お知らせ通知のカテゴリ設定とWebPush通知のカテゴリ設定をチェック
        const categoryEnabled = notificationSettings[category] !== false;
        const webPushCategoryKey = getWebPushCategoryKey(category);
        const webPushCategoryEnabled = notificationSettings[webPushCategoryKey] !== false;
        
        // どちらか一方でも有効なら通知を作成する
        if (!categoryEnabled && !webPushCategoryEnabled) {
          console.log(`[通知] ユーザー ${targetUserId} の ${category} カテゴリの通知（お知らせ・WebPush両方）は無効化されています`);
          return null;
        }
        
        // 個別設定もチェック（checkTypeを考慮）
        const settingKey = getNotificationSettingKey(
          notificationData.type as NotificationType,
          notificationData.checkType
        );
        const webPushSettingKey = getWebPushSettingKey(
          notificationData.type as NotificationType,
          notificationData.checkType
        );
        
        // お知らせ通知の個別設定とWebPush通知の個別設定をチェック
        const settingEnabled = settingKey ? (notificationSettings[settingKey] !== false) : true;
        const webPushSettingEnabled = webPushSettingKey ? (notificationSettings[webPushSettingKey] !== false) : true;
        
        // どちらか一方でも有効なら通知を作成する
        if (!settingEnabled && !webPushSettingEnabled) {
          console.log(`[通知] ユーザー ${targetUserId} の ${settingKey || 'なし'} 個別設定の通知（お知らせ・WebPush両方）は無効化されています`);
          return null;
        }
        
        // お知らせ通知の設定がONかどうかを記録（お知らせ画面に表示するかどうか）
        const showInAppNotifications = categoryEnabled && settingEnabled;
        
        const notification: Omit<Notification, 'id'> = {
          userId: targetUserId,
          type: notificationData.type || 'task_reminder' as any,
          title: notificationData.title || '',
          message: notificationData.message || '',
          isRead: false,
          createdAt: Timestamp.now(),
          showInAppNotifications: showInAppNotifications
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
        
        // 通知作成時にイベントを発火（未読件数を即時更新するため）
        window.dispatchEvent(new CustomEvent('notificationCreated', {
          detail: { userId: targetUserId }
        }));
        
        return docRef.id;
      } else {
        // 通知設定がない場合、またはnotificationData.typeがない場合（後方互換性のため）
        const notification: Omit<Notification, 'id'> = {
          userId: targetUserId,
          type: notificationData.type || 'task_reminder' as any,
          title: notificationData.title || '',
          message: notificationData.message || '',
          isRead: false,
          createdAt: Timestamp.now(),
          showInAppNotifications: true // 設定がない場合は表示する（既存の動作を維持）
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
        
        // 通知作成時にイベントを発火（未読件数を即時更新するため）
        window.dispatchEvent(new CustomEvent('notificationCreated', {
          detail: { userId: targetUserId }
        }));
        
        return docRef.id;
      }
    } catch (error: any) {
      console.error('Error creating notification:', error);
      console.error('Error details:', error.message);
      throw new Error(error.message);
    }
  }

  // 既存の日付チェック通知を取得（重複チェック用）
  async getExistingDateCheckNotification(
    userId: string,
    taskId: string,
    checkType: 'startDate' | 'endDate'
  ): Promise<Notification | null> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const todayStart = Timestamp.fromDate(today);
      const tomorrowStart = Timestamp.fromDate(tomorrow);
      
      // 同じuserId、taskId、checkType、type（TaskOverdue）、今日作成された、削除されていない通知を検索
      const notificationQuery = query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        where('taskId', '==', taskId),
        where('checkType', '==', checkType),
        where('type', '==', NotificationType.TaskOverdue),
        where('createdAt', '>=', todayStart),
        where('createdAt', '<', tomorrowStart)
      );
      
      const snapshot = await getDocs(notificationQuery);
      
      // 削除されていない通知を探す
      for (const docSnap of snapshot.docs) {
        const notification = {
          id: docSnap.id,
          ...docSnap.data()
        } as Notification;
        
        if (notification.isDeleted !== true) {
          return notification;
        }
      }
      
      return null;
    } catch (error: any) {
      console.error('Error getting existing date check notification:', error);
      // エラーが発生した場合は、既存の通知がないとみなしてnullを返す（通知作成を許可）
      return null;
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
      // 通知情報を取得してuserIdを取得
      const notificationRef = doc(db, 'notifications', notificationId);
      const notificationSnap = await getDoc(notificationRef);
      
      if (!notificationSnap.exists()) {
        throw new Error('Notification not found');
      }
      
      const notificationData = notificationSnap.data();
      const userId = notificationData['userId'];
      
      await updateDoc(notificationRef, {
        isRead: true,
        readAt: Timestamp.now()
      });
      
      // 既読時にイベントを発火（未読件数を即時更新するため）
      window.dispatchEvent(new CustomEvent('notificationRead', {
        detail: { userId: userId }
      }));
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async getUnreadCount(userId: string, userTeamIds: string[] = []): Promise<number> {
    try {
      const notifications = await this.getNotifications(userId, userTeamIds);
      
      // 未読通知をフィルタリング
      // フラグがない通知（既存の通知）は全てカウント（後方互換性）
      // フラグがある通知は、showInAppNotificationsがtrueの場合のみカウント
      const unreadNotifications = notifications.filter(n => {
        // 既読の場合は除外
        if (n.isRead) {
          return false;
        }
        
        // showInAppNotificationsフィールドがない場合（既存の通知）は全てカウント
        if (n.showInAppNotifications === undefined) {
          return true;
        }
        // showInAppNotificationsがtrueの場合のみカウント
        return n.showInAppNotifications === true;
      });
      
      return unreadNotifications.length;
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
      if (notificationIds.length === 0) {
        return;
      }
      
      // 最初の通知からuserIdを取得
      const firstNotificationRef = doc(db, 'notifications', notificationIds[0]);
      const firstNotificationSnap = await getDoc(firstNotificationRef);
      let userId: string | null = null;
      
      if (firstNotificationSnap.exists()) {
        const notificationData = firstNotificationSnap.data();
        userId = notificationData['userId'] || null;
      }
      
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
      
      // 一括既読時にイベントを発火（未読件数を即時更新するため）
      if (userId) {
        window.dispatchEvent(new CustomEvent('notificationRead', {
          detail: { userId: userId }
        }));
      }
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

