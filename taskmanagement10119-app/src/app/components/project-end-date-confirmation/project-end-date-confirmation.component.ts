import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Project, ProjectStatus } from '../../models/project.model';
import { ProjectService } from '../../services/project.service';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { NotificationType } from '../../models/notification.model';
import { Timestamp } from 'firebase/firestore';

export type ProjectEndDateAction = 'complete' | 'extend' | 'ignore';

@Component({
  selector: 'app-project-end-date-confirmation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './project-end-date-confirmation.component.html',
  styleUrl: './project-end-date-confirmation.component.css'
})
export class ProjectEndDateConfirmationComponent {
  private projectService = inject(ProjectService);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);

  @Input() project!: Project;
  @Output() actionSelected = new EventEmitter<ProjectEndDateAction>();
  @Output() closed = new EventEmitter<void>();

  ProjectStatus = ProjectStatus;

  async onAction(action: ProjectEndDateAction) {
    if (action === 'complete') {
      // ステータスを完了に変更
      await this.projectService.updateProject(this.project.id, {
        status: ProjectStatus.Completed,
        dateCheckedAt: Timestamp.now()
      });
      
      // 全メンバーに通知を送信（操作者を除外）
      const user = this.authService.currentUser;
      if (this.project.members) {
        for (const member of this.project.members) {
          if (!user || member.userId !== user.uid) {
            await this.notificationService.createNotification({
              userId: member.userId,
              type: NotificationType.ProjectCompleted,
              title: 'プロジェクトが完了しました',
              message: `プロジェクト「${this.project.name}」が完了しました`,
              projectId: this.project.id
            });
          }
        }
      }
      
      this.actionSelected.emit(action);
      this.closed.emit();
    } else if (action === 'extend') {
      // 終了日変更モードに（AppComponentで処理）
      this.actionSelected.emit(action);
    } else if (action === 'ignore') {
      // 無視（dateCheckedAtを更新して、次回も確認する）
      await this.projectService.markProjectDateChecked(this.project.id);
      this.actionSelected.emit(action);
      this.closed.emit();
    }
  }

  onClose() {
    this.closed.emit();
  }

  formatDate(date: any): string {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
}

