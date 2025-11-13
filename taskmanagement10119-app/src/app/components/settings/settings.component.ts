import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
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
  location = inject(Location);
  
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
    projectMemberAdded: true,
    projectMemberRemoved: true,
    taskOverdue: true,
    taskReminder: true,
    startDateOverdue: true,
    endDateOverdue: true,
    teamInvitation: true,
    teamLeave: true,
    teamPermissionChange: true
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
      this.notificationSettings.projectMemberAdded = value;
      this.notificationSettings.projectMemberRemoved = value;
      // WebPush通知の個別設定
      this.notificationSettings.projectCreatedWebPush = value;
      this.notificationSettings.projectUpdatedWebPush = value;
      this.notificationSettings.projectDeletedWebPush = value;
      this.notificationSettings.projectRestoredWebPush = value;
      this.notificationSettings.projectCompletedWebPush = value;
      this.notificationSettings.projectMemberAddedWebPush = value;
      this.notificationSettings.projectMemberRemovedWebPush = value;
    } else if (category === 'reminder') {
      // お知らせ通知の個別設定
      this.notificationSettings.taskReminder = value;
      // WebPush通知の個別設定
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
      // WebPush通知の個別設定
      this.notificationSettings.teamInvitationWebPush = value;
      this.notificationSettings.teamInvitationAcceptedWebPush = value;
      this.notificationSettings.teamInvitationRejectedWebPush = value;
      this.notificationSettings.teamLeaveWebPush = value;
      this.notificationSettings.teamPermissionChangeWebPush = value;
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
      this.notificationSettings.projectMemberAddedWebPush = value;
      this.notificationSettings.projectMemberRemovedWebPush = value;
    } else if (category === 'reminder') {
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
                 settingKey === 'projectCompletedWebPush' ||
                 settingKey === 'projectMemberAddedWebPush' || settingKey === 'projectMemberRemovedWebPush') {
        this.notificationSettings.projectWebPush = true;
      } else if (settingKey === 'taskReminderWebPush') {
        this.notificationSettings.reminderWebPush = true;
      } else if (settingKey === 'startDateOverdueWebPush' || settingKey === 'endDateOverdueWebPush') {
        this.notificationSettings.dateCheckWebPush = true;
      } else if (settingKey === 'teamInvitationWebPush' || settingKey === 'teamInvitationAcceptedWebPush' ||
                 settingKey === 'teamInvitationRejectedWebPush' || settingKey === 'teamLeaveWebPush' || 
                 settingKey === 'teamPermissionChangeWebPush') {
        this.notificationSettings.teamWebPush = true;
      }
    } else {
      // 個別設定がOFFになった場合、全ての個別設定がOFFならカテゴリ設定もOFFにする
      if (settingKey === 'taskCreatedWebPush' || settingKey === 'taskUpdatedWebPush' || 
          settingKey === 'taskDeletedWebPush' || settingKey === 'taskRestoredWebPush' || 
          settingKey === 'taskCompletedWebPush') {
        if (this.areAllTaskWebPushIndividualSettingsOff()) {
          this.notificationSettings.taskWebPush = false;
        }
      } else if (settingKey === 'projectCreatedWebPush' || settingKey === 'projectUpdatedWebPush' ||
                 settingKey === 'projectDeletedWebPush' || settingKey === 'projectRestoredWebPush' ||
                 settingKey === 'projectCompletedWebPush' ||
                 settingKey === 'projectMemberAddedWebPush' || settingKey === 'projectMemberRemovedWebPush') {
        if (this.areAllProjectWebPushIndividualSettingsOff()) {
          this.notificationSettings.projectWebPush = false;
        }
      } else if (settingKey === 'taskReminderWebPush') {
        if (this.areAllReminderWebPushIndividualSettingsOff()) {
          this.notificationSettings.reminderWebPush = false;
        }
      } else if (settingKey === 'startDateOverdueWebPush' || settingKey === 'endDateOverdueWebPush') {
        if (this.areAllDateCheckWebPushIndividualSettingsOff()) {
          this.notificationSettings.dateCheckWebPush = false;
        }
      } else if (settingKey === 'teamInvitationWebPush' || settingKey === 'teamInvitationAcceptedWebPush' ||
                 settingKey === 'teamInvitationRejectedWebPush' || settingKey === 'teamLeaveWebPush' || 
                 settingKey === 'teamPermissionChangeWebPush') {
        if (this.areAllTeamWebPushIndividualSettingsOff()) {
          this.notificationSettings.teamWebPush = false;
        }
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
                 settingKey === 'projectCompleted' ||
                 settingKey === 'projectMemberAdded' || settingKey === 'projectMemberRemoved') {
        this.notificationSettings.project = true;
      } else if (settingKey === 'taskReminder') {
        this.notificationSettings.reminder = true;
      } else if (settingKey === 'startDateOverdue' || settingKey === 'endDateOverdue') {
        this.notificationSettings.dateCheck = true;
      } else if (settingKey === 'teamInvitation' || settingKey === 'teamInvitationAccepted' || 
                 settingKey === 'teamInvitationRejected' || settingKey === 'teamLeave' || 
                 settingKey === 'teamPermissionChange') {
        this.notificationSettings.team = true;
      }
    } else {
      // 個別設定がOFFになった場合、全ての個別設定がOFFならカテゴリ設定もOFFにする
      if (settingKey === 'taskCreated' || settingKey === 'taskUpdated' || settingKey === 'taskDeleted' || 
          settingKey === 'taskRestored' || settingKey === 'taskCompleted') {
        if (this.areAllTaskIndividualSettingsOff()) {
          this.notificationSettings.task = false;
        }
      } else if (settingKey === 'projectCreated' || settingKey === 'projectUpdated' ||
                 settingKey === 'projectDeleted' || settingKey === 'projectRestored' ||
                 settingKey === 'projectCompleted' ||
                 settingKey === 'projectMemberAdded' || settingKey === 'projectMemberRemoved') {
        if (this.areAllProjectIndividualSettingsOff()) {
          this.notificationSettings.project = false;
        }
      } else if (settingKey === 'taskReminder') {
        if (this.areAllReminderIndividualSettingsOff()) {
          this.notificationSettings.reminder = false;
        }
      } else if (settingKey === 'startDateOverdue' || settingKey === 'endDateOverdue') {
        if (this.areAllDateCheckIndividualSettingsOff()) {
          this.notificationSettings.dateCheck = false;
        }
      } else if (settingKey === 'teamInvitation' || settingKey === 'teamInvitationAccepted' || 
                 settingKey === 'teamInvitationRejected' || settingKey === 'teamLeave' || 
                 settingKey === 'teamPermissionChange') {
        if (this.areAllTeamIndividualSettingsOff()) {
          this.notificationSettings.team = false;
        }
      }
    }
    await this.saveNotificationSettings();
  }

  async onNotificationCategoryChange(category: 'task' | 'project' | 'reminder' | 'team' | 'dateCheck', value: boolean) {
    // カテゴリ設定を更新する（WebPushと同じロジック）
    this.notificationSettings[category] = value;
    
    // カテゴリのチェックに連動して、お知らせ通知の個別設定も全てON/OFFにする
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
      this.notificationSettings.projectMemberAdded = value;
      this.notificationSettings.projectMemberRemoved = value;
    } else if (category === 'reminder') {
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
    }
    await this.saveNotificationSettings();
  }

  toggleCategory(category: string) {
    this.expandedCategories[category] = !this.expandedCategories[category];
  }

  // 各カテゴリの個別設定が全てOFFかどうかをチェックするヘルパーメソッド
  areAllTaskIndividualSettingsOff(): boolean {
    return !this.notificationSettings.taskCreated &&
           !this.notificationSettings.taskUpdated &&
           !this.notificationSettings.taskDeleted &&
           !this.notificationSettings.taskRestored &&
           !this.notificationSettings.taskCompleted;
  }

  areAllProjectIndividualSettingsOff(): boolean {
    return !this.notificationSettings.projectCreated &&
           !this.notificationSettings.projectUpdated &&
           !this.notificationSettings.projectDeleted &&
           !this.notificationSettings.projectRestored &&
           !this.notificationSettings.projectCompleted &&
           !this.notificationSettings.projectMemberAdded &&
           !this.notificationSettings.projectMemberRemoved;
  }

  areAllReminderIndividualSettingsOff(): boolean {
    return !this.notificationSettings.taskReminder;
  }

  areAllDateCheckIndividualSettingsOff(): boolean {
    return !this.notificationSettings.startDateOverdue &&
           !this.notificationSettings.endDateOverdue;
  }

  areAllTeamIndividualSettingsOff(): boolean {
    return !this.notificationSettings.teamInvitation &&
           !this.notificationSettings.teamInvitationAccepted &&
           !this.notificationSettings.teamInvitationRejected &&
           !this.notificationSettings.teamLeave &&
           !this.notificationSettings.teamPermissionChange;
  }

  // WebPush用のヘルパーメソッド
  areAllTaskWebPushIndividualSettingsOff(): boolean {
    return !this.notificationSettings.taskCreatedWebPush &&
           !this.notificationSettings.taskUpdatedWebPush &&
           !this.notificationSettings.taskDeletedWebPush &&
           !this.notificationSettings.taskRestoredWebPush &&
           !this.notificationSettings.taskCompletedWebPush;
  }

  areAllProjectWebPushIndividualSettingsOff(): boolean {
    return !this.notificationSettings.projectCreatedWebPush &&
           !this.notificationSettings.projectUpdatedWebPush &&
           !this.notificationSettings.projectDeletedWebPush &&
           !this.notificationSettings.projectRestoredWebPush &&
           !this.notificationSettings.projectCompletedWebPush &&
           !this.notificationSettings.projectMemberAddedWebPush &&
           !this.notificationSettings.projectMemberRemovedWebPush;
  }

  areAllReminderWebPushIndividualSettingsOff(): boolean {
    return !this.notificationSettings.taskReminderWebPush;
  }

  areAllDateCheckWebPushIndividualSettingsOff(): boolean {
    return !this.notificationSettings.startDateOverdueWebPush &&
           !this.notificationSettings.endDateOverdueWebPush;
  }

  areAllTeamWebPushIndividualSettingsOff(): boolean {
    return !this.notificationSettings.teamInvitationWebPush &&
           !this.notificationSettings.teamInvitationAcceptedWebPush &&
           !this.notificationSettings.teamInvitationRejectedWebPush &&
           !this.notificationSettings.teamLeaveWebPush &&
           !this.notificationSettings.teamPermissionChangeWebPush;
  }

  // カテゴリヘッダー用：お知らせ通知とWebPush通知の両方が全てOFFかどうかをチェック
  areAllTaskSettingsOff(): boolean {
    return this.areAllTaskIndividualSettingsOff() && 
           this.areAllTaskWebPushIndividualSettingsOff();
  }

  areAllProjectSettingsOff(): boolean {
    return this.areAllProjectIndividualSettingsOff() && 
           this.areAllProjectWebPushIndividualSettingsOff();
  }

  areAllReminderSettingsOff(): boolean {
    return this.areAllReminderIndividualSettingsOff() && 
           this.areAllReminderWebPushIndividualSettingsOff();
  }

  areAllDateCheckSettingsOff(): boolean {
    return this.areAllDateCheckIndividualSettingsOff() && 
           this.areAllDateCheckWebPushIndividualSettingsOff();
  }

  areAllTeamSettingsOff(): boolean {
    return this.areAllTeamIndividualSettingsOff() && 
           this.areAllTeamWebPushIndividualSettingsOff();
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
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/home']);
    }
  }
}

