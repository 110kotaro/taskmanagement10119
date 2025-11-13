import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../firebase-config';
import { NotificationService } from '../../services/notification.service';
import { AuthService } from '../../services/auth.service';
import { TeamService } from '../../services/team.service';
import { Notification, NotificationType } from '../../models/notification.model';
import { TeamInvitation } from '../../models/team-invitation.model';
import { NextTaskCandidatesComponent } from '../next-task-candidates/next-task-candidates.component';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, NextTaskCandidatesComponent],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.css'
})
export class NotificationsComponent implements OnInit {
  private notificationService = inject(NotificationService);
  private authService = inject(AuthService);
  private teamService = inject(TeamService);
  private router = inject(Router);
  private location = inject(Location);

  notifications: Notification[] = [];
  isLoading = true;
  showNextTaskCandidates = false;
  invitationMap: { [key: string]: TeamInvitation } = {}; // invitationId -> TeamInvitation

  // チーム情報
  userTeamIds: string[] = [];
  
  // フィルター
  filterType: 'all' | 'read' | 'unread' | 'trash' = 'all';
  showDeleted = false;

  async ngOnInit() {
    await this.loadUserTeams();
    this.loadNotifications();
  }

  async loadUserTeams() {
    try {
      const user = this.authService.currentUser;
      if (user) {
        const userTeams = await this.teamService.getTeamsForUser(user.uid);
        this.userTeamIds = userTeams.map(team => team.id);
      }
    } catch (error) {
      console.error('Error loading teams:', error);
    }
  }

  async loadNotifications() {
    try {
      const user = this.authService.currentUser;
      if (user) {
        // ゴミ箱表示の場合は削除済みも含める
        this.showDeleted = this.filterType === 'trash';
        
        // チームに所属している場合はuserTeamIdsを渡す（自分に関する通知 + チームに関する通知）
        // チームに所属していない場合は空配列（自分に関する通知のみ）
        this.notifications = await this.notificationService.getNotifications(
          user.uid,
          this.userTeamIds,
          this.showDeleted
        );
        
        console.log('[通知] 取得した通知数:', this.notifications.length);
        console.log('[通知] フィルタータイプ:', this.filterType);
        console.log('[通知] フィルター後の通知数:', this.filteredNotifications.length);
        
        // チーム招待通知の場合は招待情報を取得
        const teamInvitationNotifications = this.notifications.filter(
          n => n.type === NotificationType.TeamInvitation && n.invitationId
        );
        
        for (const notification of teamInvitationNotifications) {
          if (notification.invitationId) {
            try {
              // 招待IDから招待情報を取得
              const invitationRef = doc(db, 'teamInvitations', notification.invitationId);
              const invitationSnap = await getDoc(invitationRef);
              if (invitationSnap.exists()) {
                this.invitationMap[notification.invitationId] = {
                  id: invitationSnap.id,
                  ...invitationSnap.data()
                } as TeamInvitation;
              }
            } catch (error) {
              console.error('Error loading invitation:', error);
            }
          }
        }
      }
      this.isLoading = false;
    } catch (error) {
      console.error('Error loading notifications:', error);
      this.isLoading = false;
    }
  }

  async markAsRead(notification: Notification) {
    // TeamInvitationの場合はクリックで読み取りマークしない（参加/拒否ボタンで処理）
    if (notification.type === NotificationType.TeamInvitation) {
      return;
    }

    // TaskOverdue通知でcheckTypeがある場合、日付チェックモーダルを表示
    if (notification.type === NotificationType.TaskOverdue && notification.checkType && notification.taskId) {
      // カスタムイベントでAppComponentに通知
      window.dispatchEvent(new CustomEvent('showDateCheckModal', {
        detail: {
          taskId: notification.taskId,
          checkType: notification.checkType
        }
      }));
      // 通知を読み取り済みにする
      if (!notification.isRead) {
        await this.notificationService.markAsRead(notification.id);
        notification.isRead = true;
      }
      return;
    }

    // ProjectCompleted/ProjectUpdated通知でcheckTypeがある場合、プロジェクト日付チェックモーダルを表示
    if ((notification.type === NotificationType.ProjectCompleted || notification.type === NotificationType.ProjectUpdated) 
        && notification.checkType && notification.projectId) {
      // カスタムイベントでAppComponentに通知
      window.dispatchEvent(new CustomEvent('showProjectDateCheckModal', {
        detail: {
          projectId: notification.projectId,
          checkType: notification.checkType
        }
      }));
      // 通知を読み取り済みにする
      if (!notification.isRead) {
        await this.notificationService.markAsRead(notification.id);
        notification.isRead = true;
      }
      return;
    }

    if (!notification.isRead) {
      await this.notificationService.markAsRead(notification.id);
      notification.isRead = true;
    }
    
    // TaskCompleted通知をクリックした場合、次やるタスクを確認するかダイアログを表示
    if (notification.type === NotificationType.TaskCompleted) {
      // ユーザーの設定を確認
      const user = this.authService.currentUser;
      if (user) {
        const userData = await this.authService.getUserData(user.uid);
        const showNextTasks = userData?.showNextTasks !== false; // デフォルトはtrue
        
        if (showNextTasks) {
          const shouldShowNextTasks = confirm('次やるタスクを確認しますか？');
          if (shouldShowNextTasks) {
            this.showNextTaskCandidates = true;
          }
        }
      }
    }
  }

  async acceptInvitation(notification: Notification) {
    if (!notification.invitationId) {
      alert('招待IDが見つかりません');
      return;
    }

    try {
      await this.teamService.acceptInvitation(notification.invitationId);
      alert('チームに参加しました！');

       // 招待情報を更新（ステータスをacceptedに）
    if (this.invitationMap[notification.invitationId]) {
      this.invitationMap[notification.invitationId].status = 'accepted';
      this.invitationMap[notification.invitationId].acceptedAt = Timestamp.now() as any;
    }
      
      // 通知を読み取り済みにする
      if (!notification.isRead) {
        await this.notificationService.markAsRead(notification.id);
        notification.isRead = true;
      }

      // チーム詳細ページに遷移（一旦コメントアウト）
      // if (notification.teamId) {
      //   this.router.navigate(['/team', notification.teamId]);
      // } else {
      //   await this.loadNotifications();
      // }
      
      // 通知一覧を再読み込み
      await this.loadNotifications();
    } catch (error: any) {
      alert('招待の承認に失敗しました: ' + error.message);
    }
  }

  async rejectInvitation(notification: Notification) {
    if (!notification.invitationId) {
      alert('招待IDが見つかりません');
      return;
    }

    if (!confirm('この招待を拒否しますか？')) {
      return;
    }

    try {
      await this.teamService.rejectInvitation(notification.invitationId);
      alert('招待を拒否しました');

       // 招待情報を更新（ステータスをrejectedに）
    if (this.invitationMap[notification.invitationId]) {
      this.invitationMap[notification.invitationId].status = 'rejected';
      this.invitationMap[notification.invitationId].rejectedAt = Timestamp.now() as any;
    }
      
      // 通知を読み取り済みにする
      if (!notification.isRead) {
        await this.notificationService.markAsRead(notification.id);
        notification.isRead = true;
      }

      await this.loadNotifications();
    } catch (error: any) {
      alert('招待の拒否に失敗しました: ' + error.message);
    }
  }
  
  closeNextTaskCandidates() {
    this.showNextTaskCandidates = false;
  }

  getStatusText(type: string): string {
    const statusMap: { [key: string]: string } = {
      'task_created': 'タスク作成',
      'task_updated': 'タスク更新',
      'task_deleted': 'タスク削除',
      'task_restored': 'タスク復元',
      'task_completed': 'タスク完了',
      'task_overdue': 'タスク期限切れ',
      'task_reminder': 'リマインダー',
      'project_created': 'プロジェクト作成',
      'project_updated': 'プロジェクト更新',
      'project_deleted': 'プロジェクト削除',
      'project_restored': 'プロジェクト復元',
      'project_completed': 'プロジェクト完了',
      'project_member_added': 'プロジェクトメンバー追加',
      'project_member_removed': 'プロジェクトメンバー削除',
      'project_member_role_changed': 'プロジェクトメンバー権限変更',
      'team_invitation': 'チーム招待',
      'team_leave': 'チーム退会',
      'team_invitation_accepted': 'チーム招待承認',
      'team_invitation_rejected': 'チーム招待拒否',
      'team_permission_change': 'チーム権限変更',
      'team_admin_announcement': 'チームお知らせ'
    };
    return statusMap[type] || type;
  }

  formatDate(timestamp: any): string {
    const date = timestamp.toDate();
    return date.toLocaleDateString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/home']);
    }
  }

  // フィルター適用後の通知リストを取得
  get filteredNotifications(): Notification[] {
    let filtered = this.notifications;
    
    if (this.filterType === 'trash') {
      // ゴミ箱: 削除済みのみ
      filtered = filtered.filter(n => n.isDeleted === true);
    } else {
      // 通常: 削除済みを除外（isDeletedがtrueでない場合を含める）
      filtered = filtered.filter(n => n.isDeleted !== true);
      
      if (this.filterType === 'read') {
        filtered = filtered.filter(n => n.isRead);
      } else if (this.filterType === 'unread') {
        filtered = filtered.filter(n => !n.isRead);
      }
    }
    
    return filtered;
  }

  // フィルターを変更
  async onFilterChange(filter: 'all' | 'read' | 'unread' | 'trash') {
    this.filterType = filter;
    await this.loadNotifications();
  }

  // 通知を削除（論理削除）
  async deleteNotification(notification: Notification, event: Event) {
    event.stopPropagation();
    
    if (!confirm('このお知らせを削除しますか？')) {
      return;
    }

    try {
      await this.notificationService.deleteNotification(notification.id);
      await this.loadNotifications();
    } catch (error: any) {
      alert('お知らせの削除に失敗しました: ' + error.message);
    }
  }

  // 通知を復元
  async restoreNotification(notification: Notification, event: Event) {
    event.stopPropagation();
    
    try {
      await this.notificationService.restoreNotification(notification.id);
      await this.loadNotifications();
    } catch (error: any) {
      alert('お知らせの復元に失敗しました: ' + error.message);
    }
  }

  // 通知を完全削除
  async permanentlyDeleteNotification(notification: Notification, event: Event) {
    event.stopPropagation();
    
    if (!confirm('このお知らせを完全に削除しますか？この操作は取り消せません。')) {
      return;
    }

    try {
      await this.notificationService.permanentlyDeleteNotification(notification.id);
      await this.loadNotifications();
    } catch (error: any) {
      alert('お知らせの完全削除に失敗しました: ' + error.message);
    }
  }

  // フィルター後の通知を一括既読にする
  async markAllFilteredAsRead() {
    if (this.filteredNotifications.length === 0) {
      return;
    }

    // チーム招待通知と削除済み通知は除外
    const targetNotifications = this.filteredNotifications.filter(n => 
      n.type !== NotificationType.TeamInvitation && !n.isDeleted && !n.isRead
    );

    if (targetNotifications.length === 0) {
      alert('既読にできるお知らせがありません');
      return;
    }

    if (!confirm(`${targetNotifications.length}件のお知らせを既読にしますか？`)) {
      return;
    }

    try {
      const notificationIds = targetNotifications.map(n => n.id);
      await this.notificationService.markAllAsRead(notificationIds);
      
      // ローカルの状態を更新
      for (const notification of targetNotifications) {
        notification.isRead = true;
        notification.readAt = Timestamp.now() as any;
      }
      
      await this.loadNotifications();
    } catch (error: any) {
      alert('一括既読に失敗しました: ' + error.message);
    }
  }

  // フィルター後の通知を一括削除（ゴミ箱以外）
  async deleteAllFiltered() {
    if (this.filteredNotifications.length === 0) {
      return;
    }

    // 削除済み通知は除外
    const targetNotifications = this.filteredNotifications.filter(n => !n.isDeleted);

    if (targetNotifications.length === 0) {
      alert('削除できるお知らせがありません');
      return;
    }

    if (!confirm(`${targetNotifications.length}件のお知らせを削除しますか？`)) {
      return;
    }

    try {
      const notificationIds = targetNotifications.map(n => n.id);
      await this.notificationService.deleteAllNotifications(notificationIds);
      await this.loadNotifications();
    } catch (error: any) {
      alert('一括削除に失敗しました: ' + error.message);
    }
  }

  // ゴミ箱内の通知を一括復元
  async restoreAllFiltered() {
    if (this.filteredNotifications.length === 0) {
      return;
    }

    // 削除済み通知のみ
    const targetNotifications = this.filteredNotifications.filter(n => n.isDeleted);

    if (targetNotifications.length === 0) {
      alert('復元できるお知らせがありません');
      return;
    }

    if (!confirm(`${targetNotifications.length}件のお知らせを復元しますか？`)) {
      return;
    }

    try {
      const notificationIds = targetNotifications.map(n => n.id);
      await this.notificationService.restoreAllNotifications(notificationIds);
      await this.loadNotifications();
    } catch (error: any) {
      alert('一括復元に失敗しました: ' + error.message);
    }
  }

  // ゴミ箱内の通知を一括完全削除
  async permanentlyDeleteAllFiltered() {
    if (this.filteredNotifications.length === 0) {
      return;
    }

    // 削除済み通知のみ
    const targetNotifications = this.filteredNotifications.filter(n => n.isDeleted);

    if (targetNotifications.length === 0) {
      alert('完全削除できるお知らせがありません');
      return;
    }

    if (!confirm(`${targetNotifications.length}件のお知らせを完全に削除しますか？この操作は取り消せません。`)) {
      return;
    }

    try {
      const notificationIds = targetNotifications.map(n => n.id);
      await this.notificationService.permanentlyDeleteAllNotifications(notificationIds);
      await this.loadNotifications();
    } catch (error: any) {
      alert('一括完全削除に失敗しました: ' + error.message);
    }
  }
}

