import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Project, ProjectStatus } from '../../models/project.model';
import { ProjectService } from '../../services/project.service';
import { TaskService } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { NotificationType } from '../../models/notification.model';
import { TaskStatus } from '../../models/task.model';
import { Timestamp } from 'firebase/firestore';

export type ProjectCompletionAction = 'complete' | 'not_complete';

@Component({
  selector: 'app-project-completion-confirmation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './project-completion-confirmation.component.html',
  styleUrl: './project-completion-confirmation.component.css'
})
export class ProjectCompletionConfirmationComponent {
  private projectService = inject(ProjectService);
  private taskService = inject(TaskService);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);

  @Input() project!: Project;
  @Output() actionSelected = new EventEmitter<ProjectCompletionAction>();
  @Output() closed = new EventEmitter<void>();

  ProjectStatus = ProjectStatus;

  async onAction(action: ProjectCompletionAction) {
    if (action === 'complete') {
      // 未完了タスクのチェック
      const projectTasks = await this.taskService.getTasks({
        projectId: this.project.id,
        isDeleted: false
      });
      const incompleteTasks = projectTasks.filter(task => task.status !== TaskStatus.Completed);
      
      if (incompleteTasks.length > 0) {
        alert('未完了タスクが存在します。完了するか、削除してください。');
        return;
      }
      
      // 確認ダイアログを表示
      if (!confirm('このプロジェクトを完了にしますか？')) {
        // キャンセルされた場合は処理を中断
        return;
      }
      
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
    } else if (action === 'not_complete') {
      // 完了しない（dateCheckedAtを更新して、次回も確認する）
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

