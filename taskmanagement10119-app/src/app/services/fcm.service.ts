import { Injectable, inject } from '@angular/core';
import { getToken, onMessage, Messaging } from 'firebase/messaging';
import { messaging } from '../../firebase-config';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase-config';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class FcmService {
  private authService = inject(AuthService);
  private messaging: Messaging | null = messaging;

  /**
   * 通知許可をリクエストし、FCMトークンを取得
   */
  async requestPermission(): Promise<string | null> {
    if (!this.messaging) {
      console.warn('Firebase Messaging is not available');
      return null;
    }

    try {
      // 通知許可をリクエスト
      const permission = await Notification.requestPermission();
      
      if (permission !== 'granted') {
        console.warn('Notification permission denied');
        return null;
      }

      // VAPIDキー（Firebaseコンソールで取得）
      // 注意: 実際のプロジェクトでは環境変数から取得してください
      const vapidKey = 'BJG777vjnyPVyDfGd60Cw-2xhOm203bUTl__pUHqtCfoj1uSyStx4TB-bjJWIqtUWbPuGVwKjp7b-Vz5RhB8rKM'; // TODO: Firebaseコンソールから取得したVAPIDキーを設定
      
      // FCMトークンを取得
      const token = await getToken(this.messaging, { vapidKey });
      
      if (token) {
        // トークンをFirestoreに保存
        await this.saveTokenToFirestore(token);
        return token;
      } else {
        console.warn('No FCM token available');
        return null;
      }
    } catch (error: any) {
      console.error('Error getting FCM token:', error);
      return null;
    }
  }

  /**
   * FCMトークンをFirestoreに保存
   */
  private async saveTokenToFirestore(token: string): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) {
        console.warn('User not authenticated');
        return;
      }

      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        fcmToken: token,
        updatedAt: new Date() as any
      });
    } catch (error: any) {
      console.error('Error saving FCM token:', error);
    }
  }

  /**
   * フォアグラウンドメッセージのリスナーを設定
   */
  setupForegroundMessageListener(callback: (payload: any) => void): void {
    if (!this.messaging) {
      console.warn('Firebase Messaging is not available');
      return;
    }

    onMessage(this.messaging, (payload) => {
      callback(payload);
    });
  }

  /**
   * 現在のFCMトークンを取得（既に保存されている場合）
   */
  async getCurrentToken(): Promise<string | null> {
    if (!this.messaging) {
      return null;
    }

    try {
      const token = await getToken(this.messaging);
      return token || null;
    } catch (error: any) {
      console.error('Error getting current FCM token:', error);
      return null;
    }
  }

  /**
   * FCMトークンを削除（ログアウト時など）
   */
  async deleteToken(): Promise<void> {
    if (!this.messaging) {
      return;
    }

    try {
      const user = this.authService.currentUser;
      if (!user) {
        return;
      }

      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        fcmToken: null,
        updatedAt: new Date() as any
      });
    } catch (error: any) {
      console.error('Error deleting FCM token:', error);
    }
  }
}

