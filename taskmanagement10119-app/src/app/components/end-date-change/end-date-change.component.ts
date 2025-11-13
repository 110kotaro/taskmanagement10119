import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Task } from '../../models/task.model';
import { TaskService } from '../../services/task.service';
import { Router } from '@angular/router';
import { Timestamp } from 'firebase/firestore';

@Component({
  selector: 'app-end-date-change',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './end-date-change.component.html',
  styleUrl: './end-date-change.component.css'
})
export class EndDateChangeComponent {
  private taskService = inject(TaskService);
  private router = inject(Router);

  @Input() task!: Task;
  @Output() cancelled = new EventEmitter<void>();
  @Output() updated = new EventEmitter<string>(); // タスクIDを通知

  newEndDate: string = '';
  errorMessage: string = '';

  ngOnInit() {
    // 現在の終了日を初期値として設定
    if (this.task && this.task.endDate) {
      const currentDate = this.task.endDate.toDate();
      this.newEndDate = this.formatDateForInput(currentDate);
    } else {
      // 今日の日付を初期値として設定
      const today = new Date();
      this.newEndDate = this.formatDateForInput(today);
    }
  }

  formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async onSave() {
    if (!this.newEndDate) {
      this.errorMessage = '終了日を入力してください';
      return;
    }

    try {
      const newDate = new Date(this.newEndDate + 'T23:59:59');
      const newEndDate = Timestamp.fromDate(newDate);

      // 開始日より前の日付は設定できない
      if (this.task.startDate && newEndDate.toMillis() < this.task.startDate.toMillis()) {
        this.errorMessage = '終了日は開始日以降の日付を設定してください';
        return;
      }

      // 終了日を更新
      await this.taskService.updateTask(this.task.id, {
        endDate: newEndDate
      });
      
      // 終了日チェック済みフラグを更新
      await this.taskService.markTaskEndDateChecked(this.task.id);

      // タスク更新を通知
      this.updated.emit(this.task.id);

      // タスク詳細画面に遷移
      this.router.navigate(['/task', this.task.id]);
    } catch (error: any) {
      this.errorMessage = '終了日の更新に失敗しました: ' + error.message;
      console.error('Error updating end date:', error);
    }
  }

  onCancel() {
    this.cancelled.emit();
  }

  formatDate(date: any): string {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  getMinDate(): string {
    if (this.task && this.task.startDate) {
      const startDate = this.task.startDate.toDate();
      return this.formatDateForInput(startDate);
    }
    const today = new Date();
    return this.formatDateForInput(today);
  }
}
