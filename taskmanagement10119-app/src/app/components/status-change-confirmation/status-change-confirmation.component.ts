import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Task, TaskStatus } from '../../models/task.model';
import { TaskService } from '../../services/task.service';
import { Router } from '@angular/router';

export type ConfirmationAction = 'change_to_in_progress' | 'change_to_completed' | 'change_end_date' | 'ignore';

@Component({
  selector: 'app-status-change-confirmation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './status-change-confirmation.component.html',
  styleUrl: './status-change-confirmation.component.css'
})
export class StatusChangeConfirmationComponent {
  private taskService = inject(TaskService);
  private router = inject(Router);

  @Input() task!: Task;
  @Input() checkType: 'startDate' | 'endDate' = 'startDate';
  @Output() actionSelected = new EventEmitter<ConfirmationAction>();
  @Output() closed = new EventEmitter<void>();

  TaskStatus = TaskStatus;

  async onAction(action: ConfirmationAction) {
    if (action === 'change_to_in_progress') {
      // ステータスを進行中に変更
      await this.taskService.updateTask(this.task.id, {
        status: TaskStatus.InProgress
      });
      // 開始日チェックの場合のみdateCheckedAtを更新
      // 終了日チェックが必要な場合は、終了日チェック完了時に更新される
      if (this.checkType === 'startDate') {
        // 終了日チェックも必要か確認
        const checkResult = this.taskService.checkTaskDates(this.task);
        if (!checkResult.needsEndDateCheck) {
          // 終了日チェックが不要な場合のみ更新
          await this.taskService.markTaskDateChecked(this.task.id);
        }
        // 終了日チェックが必要な場合は更新しない（終了日チェック完了時に更新される）
      }
      this.actionSelected.emit(action);
      this.closed.emit();
    } else if (action === 'change_to_completed') {
      // 確認ダイアログを表示
      if (!confirm('このタスクを完了にしますか？')) {
        // キャンセルされた場合は処理を中断
        return;
      }
      
      // ステータスを完了に変更
      const { Timestamp } = await import('firebase/firestore');
      await this.taskService.updateTask(this.task.id, {
        status: TaskStatus.Completed,
        completedAt: Timestamp.now()
      });
      // 開始日チェックの場合はdateCheckedAt、終了日チェックの場合はendDateCheckedAtを更新
      if (this.checkType === 'startDate') {
        await this.taskService.markTaskDateChecked(this.task.id);
      } else {
        await this.taskService.markTaskEndDateChecked(this.task.id);
      }
      this.actionSelected.emit(action);
      this.closed.emit();
    } else if (action === 'change_end_date') {
      // 終了日変更モードに
      this.actionSelected.emit(action);
    } else if (action === 'ignore') {
      // 無視（チェック済みフラグのみ更新）
      // 開始日チェックの場合はdateCheckedAt、終了日チェックの場合はendDateCheckedAtを更新
      if (this.checkType === 'startDate') {
        await this.taskService.markTaskDateChecked(this.task.id);
      } else {
        await this.taskService.markTaskEndDateChecked(this.task.id);
      }
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
