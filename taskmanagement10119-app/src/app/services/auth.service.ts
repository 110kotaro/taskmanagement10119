import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  User as FirebaseUser,
  onAuthStateChanged,
  updateProfile
} from 'firebase/auth';
import { doc, setDoc, getDoc, collection, getDocs } from 'firebase/firestore';
import { auth, db } from '../../firebase-config';
import { User, NotificationPreferences } from '../models/user.model';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private router = inject(Router);
  private currentUserSubject = new BehaviorSubject<FirebaseUser | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor() {
    onAuthStateChanged(auth, (user) => {
      this.currentUserSubject.next(user);
    });
  }

  get currentUser(): FirebaseUser | null {
    return this.currentUserSubject.value;
  }

  async signUp(email: string, password: string, displayName: string): Promise<void> {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName });
      
      // Firestoreにユーザーデータを保存
      const userData: User = {
        id: userCredential.user.uid,
        email: userCredential.user.email || email,
        displayName,
        photoURL: userCredential.user.photoURL,
        role: 'user' as any,
        theme: 'light',
        notificationSettings: {
          task: true,
          project: true,
          reminder: true,
          team: true,
          dateCheck: true,
          // 個別設定もデフォルトで全てON
          taskCreated: true,
          taskUpdated: true,
          taskDeleted: true,
          taskRestored: true,
          taskCompleted: true,
          projectCreated: true,
          projectUpdated: true,
          projectDeleted: true,
          projectRestored: true,
          projectCompleted: true,
          taskOverdue: true,
          taskReminder: true,
          startDateOverdue: true,
          endDateOverdue: true,
          teamInvitation: true,
          teamLeave: true,
          teamPermissionChange: true,
          teamAdminAnnouncement: true,
          // WebPush通知のカテゴリ設定（デフォルトで全てON）
          taskWebPush: true,
          projectWebPush: true,
          reminderWebPush: true,
          teamWebPush: true,
          dateCheckWebPush: true,
          // WebPush通知の個別設定（デフォルトで全てON）
          taskCreatedWebPush: true,
          taskUpdatedWebPush: true,
          taskDeletedWebPush: true,
          taskRestoredWebPush: true,
          taskCompletedWebPush: true,
          projectCreatedWebPush: true,
          projectUpdatedWebPush: true,
          projectDeletedWebPush: true,
          projectRestoredWebPush: true,
          projectCompletedWebPush: true,
          taskOverdueWebPush: true,
          taskReminderWebPush: true,
          startDateOverdueWebPush: true,
          endDateOverdueWebPush: true,
          teamInvitationWebPush: true,
          teamInvitationAcceptedWebPush: true,
          teamInvitationRejectedWebPush: true,
          teamLeaveWebPush: true,
          teamPermissionChangeWebPush: true,
          teamAdminAnnouncementWebPush: true
        },
        showNextTasks: true, // デフォルトで次やるタスクを表示
        createdAt: new Date() as any,
        updatedAt: new Date() as any
      };
      
      await setDoc(doc(db, 'users', userCredential.user.uid), userData);
      
      await this.router.navigate(['/home']);
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      await this.router.navigate(['/home']);
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async signOut(): Promise<void> {
    try {
      await signOut(auth);
      await this.router.navigate(['/login']);
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async getUserData(uid: string): Promise<User | null> {
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const userData = docSnap.data() as any;
        
        // 既存のnotificationSettingsが古い形式（文字列）の場合は新しい形式に変換
        if (typeof userData.notificationSettings === 'string' || !userData.notificationSettings || typeof userData.notificationSettings !== 'object') {
          userData.notificationSettings = {
            task: true,
            project: true,
            reminder: true,
            team: true,
            dateCheck: true,
            taskCreated: true,
            taskUpdated: true,
            taskDeleted: true,
            taskRestored: true,
            taskCompleted: true,
            projectCreated: true,
            projectUpdated: true,
            taskOverdue: true,
            taskReminder: true,
            startDateOverdue: true,
            endDateOverdue: true,
            teamInvitation: true,
            teamLeave: true,
            teamPermissionChange: true,
            teamAdminAnnouncement: true,
            // WebPush通知のカテゴリ設定（デフォルトで全てON）
            taskWebPush: true,
            projectWebPush: true,
            reminderWebPush: true,
            teamWebPush: true,
            dateCheckWebPush: true,
            // WebPush通知の個別設定（デフォルトで全てON）
            taskCreatedWebPush: true,
            taskUpdatedWebPush: true,
            taskDeletedWebPush: true,
            taskRestoredWebPush: true,
            taskCompletedWebPush: true,
            projectCreatedWebPush: true,
            projectUpdatedWebPush: true,
            taskOverdueWebPush: true,
            taskReminderWebPush: true,
            startDateOverdueWebPush: true,
            endDateOverdueWebPush: true,
            teamInvitationWebPush: true,
            teamInvitationAcceptedWebPush: true,
            teamInvitationRejectedWebPush: true,
            teamLeaveWebPush: true,
            teamPermissionChangeWebPush: true,
            teamAdminAnnouncementWebPush: true
          };
        } else {
          // 個別設定が未定義の場合はデフォルトでtrueに設定
          const settings = userData.notificationSettings as any;
          // カテゴリ設定
          if (settings.task === undefined) settings.task = true;
          if (settings.project === undefined) settings.project = true;
          if (settings.reminder === undefined) settings.reminder = true;
          if (settings.team === undefined) settings.team = true;
          if (settings.dateCheck === undefined) settings.dateCheck = true;
          // 個別設定
          if (settings.taskCreated === undefined) settings.taskCreated = true;
          if (settings.taskUpdated === undefined) settings.taskUpdated = true;
          if (settings.taskDeleted === undefined) settings.taskDeleted = true;
          if (settings.taskRestored === undefined) settings.taskRestored = true;
          if (settings.taskCompleted === undefined) settings.taskCompleted = true;
          if (settings.projectCreated === undefined) settings.projectCreated = true;
          if (settings.projectUpdated === undefined) settings.projectUpdated = true;
          if (settings.projectDeleted === undefined) settings.projectDeleted = true;
          if (settings.projectRestored === undefined) settings.projectRestored = true;
          if (settings.projectCompleted === undefined) settings.projectCompleted = true;
          if (settings.taskOverdue === undefined) settings.taskOverdue = true;
          if (settings.taskReminder === undefined) settings.taskReminder = true;
          if (settings.startDateOverdue === undefined) settings.startDateOverdue = true;
          if (settings.endDateOverdue === undefined) settings.endDateOverdue = true;
          if (settings.teamInvitation === undefined) settings.teamInvitation = true;
          if (settings.teamLeave === undefined) settings.teamLeave = true;
          if (settings.teamPermissionChange === undefined) settings.teamPermissionChange = true;
          if (settings.teamAdminAnnouncement === undefined) settings.teamAdminAnnouncement = true;
          // WebPush通知のカテゴリ設定
          if (settings.taskWebPush === undefined) settings.taskWebPush = true;
          if (settings.projectWebPush === undefined) settings.projectWebPush = true;
          if (settings.reminderWebPush === undefined) settings.reminderWebPush = true;
          if (settings.teamWebPush === undefined) settings.teamWebPush = true;
          if (settings.dateCheckWebPush === undefined) settings.dateCheckWebPush = true;
          // WebPush通知の個別設定
          if (settings.taskCreatedWebPush === undefined) settings.taskCreatedWebPush = true;
          if (settings.taskUpdatedWebPush === undefined) settings.taskUpdatedWebPush = true;
          if (settings.taskDeletedWebPush === undefined) settings.taskDeletedWebPush = true;
          if (settings.taskRestoredWebPush === undefined) settings.taskRestoredWebPush = true;
          if (settings.taskCompletedWebPush === undefined) settings.taskCompletedWebPush = true;
          if (settings.projectCreatedWebPush === undefined) settings.projectCreatedWebPush = true;
          if (settings.projectUpdatedWebPush === undefined) settings.projectUpdatedWebPush = true;
          if (settings.projectDeletedWebPush === undefined) settings.projectDeletedWebPush = true;
          if (settings.projectRestoredWebPush === undefined) settings.projectRestoredWebPush = true;
          if (settings.projectCompletedWebPush === undefined) settings.projectCompletedWebPush = true;
          if (settings.taskOverdueWebPush === undefined) settings.taskOverdueWebPush = true;
          if (settings.taskReminderWebPush === undefined) settings.taskReminderWebPush = true;
          if (settings.startDateOverdueWebPush === undefined) settings.startDateOverdueWebPush = true;
          if (settings.endDateOverdueWebPush === undefined) settings.endDateOverdueWebPush = true;
          if (settings.teamInvitationWebPush === undefined) settings.teamInvitationWebPush = true;
          if (settings.teamInvitationAcceptedWebPush === undefined) settings.teamInvitationAcceptedWebPush = true;
          if (settings.teamInvitationRejectedWebPush === undefined) settings.teamInvitationRejectedWebPush = true;
          if (settings.teamLeaveWebPush === undefined) settings.teamLeaveWebPush = true;
          if (settings.teamPermissionChangeWebPush === undefined) settings.teamPermissionChangeWebPush = true;
          if (settings.teamAdminAnnouncementWebPush === undefined) settings.teamAdminAnnouncementWebPush = true;
        }
        
        return userData as User;
      }
      return null;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 全ユーザーリストを取得（担当者選択用）
  async getAllUsers(): Promise<User[]> {
    try {
      const usersSnapshot = await getDocs(collection(db, 'users'));
      return usersSnapshot.docs.map(doc => {
        const userData = doc.data() as any;
        
        // 既存のnotificationSettingsが古い形式（文字列）の場合は新しい形式に変換
        if (typeof userData.notificationSettings === 'string' || !userData.notificationSettings || typeof userData.notificationSettings !== 'object') {
          userData.notificationSettings = {
            task: true,
            project: true,
            reminder: true,
            team: true,
            dateCheck: true,
            taskCreated: true,
            taskUpdated: true,
            taskDeleted: true,
            taskRestored: true,
            taskCompleted: true,
            projectCreated: true,
            projectUpdated: true,
            taskOverdue: true,
            taskReminder: true,
            startDateOverdue: true,
            endDateOverdue: true,
            teamInvitation: true,
            teamLeave: true,
            teamPermissionChange: true,
            teamAdminAnnouncement: true,
            // WebPush通知のカテゴリ設定（デフォルトで全てON）
            taskWebPush: true,
            projectWebPush: true,
            reminderWebPush: true,
            teamWebPush: true,
            dateCheckWebPush: true,
            // WebPush通知の個別設定（デフォルトで全てON）
            taskCreatedWebPush: true,
            taskUpdatedWebPush: true,
            taskDeletedWebPush: true,
            taskRestoredWebPush: true,
            taskCompletedWebPush: true,
            projectCreatedWebPush: true,
            projectUpdatedWebPush: true,
            taskOverdueWebPush: true,
            taskReminderWebPush: true,
            startDateOverdueWebPush: true,
            endDateOverdueWebPush: true,
            teamInvitationWebPush: true,
            teamInvitationAcceptedWebPush: true,
            teamInvitationRejectedWebPush: true,
            teamLeaveWebPush: true,
            teamPermissionChangeWebPush: true,
            teamAdminAnnouncementWebPush: true
          };
        } else {
          // 個別設定が未定義の場合はデフォルトでtrueに設定
          const settings = userData.notificationSettings as any;
          // カテゴリ設定
          if (settings.task === undefined) settings.task = true;
          if (settings.project === undefined) settings.project = true;
          if (settings.reminder === undefined) settings.reminder = true;
          if (settings.team === undefined) settings.team = true;
          if (settings.dateCheck === undefined) settings.dateCheck = true;
          // 個別設定
          if (settings.taskCreated === undefined) settings.taskCreated = true;
          if (settings.taskUpdated === undefined) settings.taskUpdated = true;
          if (settings.taskDeleted === undefined) settings.taskDeleted = true;
          if (settings.taskRestored === undefined) settings.taskRestored = true;
          if (settings.taskCompleted === undefined) settings.taskCompleted = true;
          if (settings.projectCreated === undefined) settings.projectCreated = true;
          if (settings.projectUpdated === undefined) settings.projectUpdated = true;
          if (settings.projectDeleted === undefined) settings.projectDeleted = true;
          if (settings.projectRestored === undefined) settings.projectRestored = true;
          if (settings.projectCompleted === undefined) settings.projectCompleted = true;
          if (settings.taskOverdue === undefined) settings.taskOverdue = true;
          if (settings.taskReminder === undefined) settings.taskReminder = true;
          if (settings.startDateOverdue === undefined) settings.startDateOverdue = true;
          if (settings.endDateOverdue === undefined) settings.endDateOverdue = true;
          if (settings.teamInvitation === undefined) settings.teamInvitation = true;
          if (settings.teamLeave === undefined) settings.teamLeave = true;
          if (settings.teamPermissionChange === undefined) settings.teamPermissionChange = true;
          if (settings.teamAdminAnnouncement === undefined) settings.teamAdminAnnouncement = true;
          // WebPush通知のカテゴリ設定
          if (settings.taskWebPush === undefined) settings.taskWebPush = true;
          if (settings.projectWebPush === undefined) settings.projectWebPush = true;
          if (settings.reminderWebPush === undefined) settings.reminderWebPush = true;
          if (settings.teamWebPush === undefined) settings.teamWebPush = true;
          if (settings.dateCheckWebPush === undefined) settings.dateCheckWebPush = true;
          // WebPush通知の個別設定
          if (settings.taskCreatedWebPush === undefined) settings.taskCreatedWebPush = true;
          if (settings.taskUpdatedWebPush === undefined) settings.taskUpdatedWebPush = true;
          if (settings.taskDeletedWebPush === undefined) settings.taskDeletedWebPush = true;
          if (settings.taskRestoredWebPush === undefined) settings.taskRestoredWebPush = true;
          if (settings.taskCompletedWebPush === undefined) settings.taskCompletedWebPush = true;
          if (settings.projectCreatedWebPush === undefined) settings.projectCreatedWebPush = true;
          if (settings.projectUpdatedWebPush === undefined) settings.projectUpdatedWebPush = true;
          if (settings.projectDeletedWebPush === undefined) settings.projectDeletedWebPush = true;
          if (settings.projectRestoredWebPush === undefined) settings.projectRestoredWebPush = true;
          if (settings.projectCompletedWebPush === undefined) settings.projectCompletedWebPush = true;
          if (settings.taskOverdueWebPush === undefined) settings.taskOverdueWebPush = true;
          if (settings.taskReminderWebPush === undefined) settings.taskReminderWebPush = true;
          if (settings.startDateOverdueWebPush === undefined) settings.startDateOverdueWebPush = true;
          if (settings.endDateOverdueWebPush === undefined) settings.endDateOverdueWebPush = true;
          if (settings.teamInvitationWebPush === undefined) settings.teamInvitationWebPush = true;
          if (settings.teamInvitationAcceptedWebPush === undefined) settings.teamInvitationAcceptedWebPush = true;
          if (settings.teamInvitationRejectedWebPush === undefined) settings.teamInvitationRejectedWebPush = true;
          if (settings.teamLeaveWebPush === undefined) settings.teamLeaveWebPush = true;
          if (settings.teamPermissionChangeWebPush === undefined) settings.teamPermissionChangeWebPush = true;
          if (settings.teamAdminAnnouncementWebPush === undefined) settings.teamAdminAnnouncementWebPush = true;
        }

        return {
        id: doc.id,
          ...userData
        } as User;
      });
    } catch (error: any) {
      console.error('Error getting all users:', error);
      throw new Error(error.message);
    }
  }

  // ユーザー情報を取得（権限チェック用のエイリアス）
  async getUser(userId: string): Promise<User | null> {
    return this.getUserData(userId);
  }
}

