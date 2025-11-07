import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ThemeService, ThemeMode } from '../../services/theme.service';
import { AuthService } from '../../services/auth.service';
import { NotificationPreferences } from '../../models/user.model';
import { Timestamp, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase-config';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css'
})
export class SettingsComponent implements OnInit {
  themeService = inject(ThemeService);
  authService = inject(AuthService);
  router = inject(Router);
  
  currentTheme: ThemeMode = 'light';
  notificationSettings: NotificationPreferences = {
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
    teamAdminAnnouncement: true
  };
  isLoading = false;
  showNextTasks: boolean = true; // デフォルト値
  expandedCategories: { [key: string]: boolean } = {
    task: false,
    project: false,
    reminder: false,
    team: false,
    dateCheck: false
  };

  async ngOnInit() {
    this.currentTheme = this.themeService.getCurrentTheme();
    this.themeService.currentTheme$.subscribe(theme => {
      this.currentTheme = theme;
    });

    // ユーザーの通知設定を取得
    const user = this.authService.currentUser;
    if (user) {
      const userData = await this.authService.getUserData(user.uid);
      if (userData) {
        if (userData.notificationSettings) {
          this.notificationSettings = userData.notificationSettings;
        }
        // その他の設定を取得
        this.showNextTasks = userData.showNextTasks !== false; // 未設定の場合はtrue
      }
    }
  }

  onThemeChange(theme: ThemeMode) {
    this.themeService.setTheme(theme);
  }

  async onNotificationSettingChange(category: 'task' | 'project' | 'reminder' | 'team' | 'dateCheck', value: boolean) {
    this.notificationSettings[category] = value;
    
    // WebPush通知のカテゴリ設定も一括でON/OFF
    const webPushCategoryKey = `${category}WebPush` as keyof NotificationPreferences;
    (this.notificationSettings as any)[webPushCategoryKey] = value;
    
    // カテゴリのチェックに連動して、カテゴリ内の個別設定も全てON/OFFにする
    if (category === 'task') {
      // お知らせ通知の個別設定
      this.notificationSettings.taskCreated = value;
      this.notificationSettings.taskUpdated = value;
      this.notificationSettings.taskDeleted = value;
      this.notificationSettings.taskRestored = value;
      this.notificationSettings.taskCompleted = value;
      // WebPush通知の個別設定
      this.notificationSettings.taskCreatedWebPush = value;
      this.notificationSettings.taskUpdatedWebPush = value;
      this.notificationSettings.taskDeletedWebPush = value;
      this.notificationSettings.taskRestoredWebPush = value;
      this.notificationSettings.taskCompletedWebPush = value;
    } else if (category === 'project') {
      // お知らせ通知の個別設定
      this.notificationSettings.projectCreated = value;
      this.notificationSettings.projectUpdated = value;
      this.notificationSettings.projectDeleted = value;
      this.notificationSettings.projectRestored = value;
      this.notificationSettings.projectCompleted = value;
      // WebPush通知の個別設定
      this.notificationSettings.projectCreatedWebPush = value;
      this.notificationSettings.projectUpdatedWebPush = value;
      this.notificationSettings.projectDeletedWebPush = value;
      this.notificationSettings.projectRestoredWebPush = value;
      this.notificationSettings.projectCompletedWebPush = value;
    } else if (category === 'reminder') {
      // お知らせ通知の個別設定
      this.notificationSettings.taskOverdue = value;
      this.notificationSettings.taskReminder = value;
      // WebPush通知の個別設定
      this.notificationSettings.taskOverdueWebPush = value;
      this.notificationSettings.taskReminderWebPush = value;
    } else if (category === 'dateCheck') {
      // お知らせ通知の個別設定
      this.notificationSettings.startDateOverdue = value;
      this.notificationSettings.endDateOverdue = value;
      // WebPush通知の個別設定
      this.notificationSettings.startDateOverdueWebPush = value;
      this.notificationSettings.endDateOverdueWebPush = value;
    } else if (category === 'team') {
      // お知らせ通知の個別設定
      this.notificationSettings.teamInvitation = value;
      this.notificationSettings.teamInvitationAccepted = value;
      this.notificationSettings.teamInvitationRejected = value;
      this.notificationSettings.teamLeave = value;
      this.notificationSettings.teamPermissionChange = value;
      this.notificationSettings.teamAdminAnnouncement = value;
      // WebPush通知の個別設定
      this.notificationSettings.teamInvitationWebPush = value;
      this.notificationSettings.teamInvitationAcceptedWebPush = value;
      this.notificationSettings.teamInvitationRejectedWebPush = value;
      this.notificationSettings.teamLeaveWebPush = value;
      this.notificationSettings.teamPermissionChangeWebPush = value;
      this.notificationSettings.teamAdminAnnouncementWebPush = value;
    }
    await this.saveNotificationSettings();
  }

  async onWebPushCategoryChange(category: 'task' | 'project' | 'reminder' | 'team' | 'dateCheck', value: boolean) {
    // カテゴリのWebPush設定を更新
    const webPushCategoryKey = `${category}WebPush` as keyof NotificationPreferences;
    (this.notificationSettings as any)[webPushCategoryKey] = value;
    
    // カテゴリ内のすべてのWebPush個別設定も一括でON/OFF
    if (category === 'task') {
      this.notificationSettings.taskCreatedWebPush = value;
      this.notificationSettings.taskUpdatedWebPush = value;
      this.notificationSettings.taskDeletedWebPush = value;
      this.notificationSettings.taskRestoredWebPush = value;
      this.notificationSettings.taskCompletedWebPush = value;
    } else if (category === 'project') {
      this.notificationSettings.projectCreatedWebPush = value;
      this.notificationSettings.projectUpdatedWebPush = value;
      this.notificationSettings.projectDeletedWebPush = value;
      this.notificationSettings.projectRestoredWebPush = value;
      this.notificationSettings.projectCompletedWebPush = value;
    } else if (category === 'reminder') {
      this.notificationSettings.taskOverdueWebPush = value;
      this.notificationSettings.taskReminderWebPush = value;
    } else if (category === 'dateCheck') {
      this.notificationSettings.startDateOverdueWebPush = value;
      this.notificationSettings.endDateOverdueWebPush = value;
    } else if (category === 'team') {
      this.notificationSettings.teamInvitationWebPush = value;
      this.notificationSettings.teamInvitationAcceptedWebPush = value;
      this.notificationSettings.teamInvitationRejectedWebPush = value;
      this.notificationSettings.teamLeaveWebPush = value;
      this.notificationSettings.teamPermissionChangeWebPush = value;
      this.notificationSettings.teamAdminAnnouncementWebPush = value;
    }
    await this.saveNotificationSettings();
  }

  async onWebPushIndividualSettingChange(settingKey: keyof NotificationPreferences, value: boolean) {
    (this.notificationSettings as any)[settingKey] = value;
    // 個別設定がONの場合、そのカテゴリのWebPush設定もONにする
    if (value) {
      if (settingKey === 'taskCreatedWebPush' || settingKey === 'taskUpdatedWebPush' || 
          settingKey === 'taskDeletedWebPush' || settingKey === 'taskRestoredWebPush' || 
          settingKey === 'taskCompletedWebPush') {
        this.notificationSettings.taskWebPush = true;
      } else if (settingKey === 'projectCreatedWebPush' || settingKey === 'projectUpdatedWebPush' ||
                 settingKey === 'projectDeletedWebPush' || settingKey === 'projectRestoredWebPush' ||
                 settingKey === 'projectCompletedWebPush') {
        this.notificationSettings.projectWebPush = true;
      } else if (settingKey === 'taskOverdueWebPush' || settingKey === 'taskReminderWebPush') {
        this.notificationSettings.reminderWebPush = true;
      } else if (settingKey === 'startDateOverdueWebPush' || settingKey === 'endDateOverdueWebPush') {
        this.notificationSettings.dateCheckWebPush = true;
      } else if (settingKey === 'teamInvitationWebPush' || settingKey === 'teamInvitationAcceptedWebPush' ||
                 settingKey === 'teamInvitationRejectedWebPush' || settingKey === 'teamLeaveWebPush' || 
                 settingKey === 'teamPermissionChangeWebPush' || settingKey === 'teamAdminAnnouncementWebPush') {
        this.notificationSettings.teamWebPush = true;
      }
    }
    await this.saveNotificationSettings();
  }

  async onIndividualSettingChange(settingKey: keyof NotificationPreferences, value: boolean) {
    (this.notificationSettings as any)[settingKey] = value;
    // 個別設定がONの場合、そのカテゴリもONにする
    if (value) {
      if (settingKey === 'taskCreated' || settingKey === 'taskUpdated' || settingKey === 'taskDeleted' || 
          settingKey === 'taskRestored' || settingKey === 'taskCompleted') {
        this.notificationSettings.task = true;
      } else if (settingKey === 'projectCreated' || settingKey === 'projectUpdated' ||
                 settingKey === 'projectDeleted' || settingKey === 'projectRestored' ||
                 settingKey === 'projectCompleted') {
        this.notificationSettings.project = true;
      } else if (settingKey === 'taskOverdue' || settingKey === 'taskReminder') {
        this.notificationSettings.reminder = true;
      } else if (settingKey === 'startDateOverdue' || settingKey === 'endDateOverdue') {
        this.notificationSettings.dateCheck = true;
      } else if (settingKey === 'teamInvitation' || settingKey === 'teamInvitationAccepted' || 
                 settingKey === 'teamInvitationRejected' || settingKey === 'teamLeave' || 
                 settingKey === 'teamPermissionChange' || settingKey === 'teamAdminAnnouncement') {
        this.notificationSettings.team = true;
      }
    }
    await this.saveNotificationSettings();
  }

  async onNotificationCategoryChange(category: 'task' | 'project' | 'reminder' | 'team' | 'dateCheck', value: boolean) {
    // カテゴリのチェックに連動して、お知らせ通知の個別設定のみを全てON/OFFにする
    // カテゴリ設定（notificationSettings[category]）は変更しない
    
    // カテゴリのチェックに連動して、お知らせ通知の個別設定のみを全てON/OFFにする
    if (category === 'task') {
      this.notificationSettings.taskCreated = value;
      this.notificationSettings.taskUpdated = value;
      this.notificationSettings.taskDeleted = value;
      this.notificationSettings.taskRestored = value;
      this.notificationSettings.taskCompleted = value;
    } else if (category === 'project') {
      this.notificationSettings.projectCreated = value;
      this.notificationSettings.projectUpdated = value;
      this.notificationSettings.projectDeleted = value;
      this.notificationSettings.projectRestored = value;
      this.notificationSettings.projectCompleted = value;
    } else if (category === 'reminder') {
      this.notificationSettings.taskOverdue = value;
      this.notificationSettings.taskReminder = value;
    } else if (category === 'dateCheck') {
      this.notificationSettings.startDateOverdue = value;
      this.notificationSettings.endDateOverdue = value;
    } else if (category === 'team') {
      this.notificationSettings.teamInvitation = value;
      this.notificationSettings.teamInvitationAccepted = value;
      this.notificationSettings.teamInvitationRejected = value;
      this.notificationSettings.teamLeave = value;
      this.notificationSettings.teamPermissionChange = value;
      this.notificationSettings.teamAdminAnnouncement = value;
    }
    await this.saveNotificationSettings();
  }

  toggleCategory(category: string) {
    this.expandedCategories[category] = !this.expandedCategories[category];
  }

  async saveNotificationSettings() {
    const user = this.authService.currentUser;
    if (!user) return;

    this.isLoading = true;
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        notificationSettings: this.notificationSettings,
        updatedAt: Timestamp.now()
      });
    } catch (error: any) {
      console.error('Error saving notification settings:', error);
      alert('通知設定の保存に失敗しました: ' + error.message);
    } finally {
      this.isLoading = false;
    }
  }

  async onShowNextTasksChange(value: boolean) {
    this.showNextTasks = value;
    await this.saveOtherSettings();
  }

  async saveOtherSettings() {
    const user = this.authService.currentUser;
    if (!user) return;

    this.isLoading = true;
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        showNextTasks: this.showNextTasks,
        updatedAt: Timestamp.now()
      });
    } catch (error: any) {
      console.error('Error saving other settings:', error);
      alert('設定の保存に失敗しました');
    } finally {
      this.isLoading = false;
    }
  }

  goBack() {
    this.router.navigate(['/home']);
  }
}

