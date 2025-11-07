import { Injectable, inject } from '@angular/core';
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase-config';
import { Task, Reminder } from '../models/task.model';
import { NotificationService } from './notification.service';
import { NotificationType } from '../models/notification.model';
import { TaskService } from './task.service';

@Injectable({
  providedIn: 'root'
})
export class ReminderService {
  private notificationService = inject(NotificationService);
  private taskService = inject(TaskService);
  private checkInterval: any = null;

  startReminderChecking() {
    // 既に開始されている場合は停止
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    // 初回チェック
    this.checkReminders();

    // 1分ごとにチェック
    this.checkInterval = setInterval(() => {
      this.checkReminders();
    }, 60000); // 60秒 = 1分
  }

  stopReminderChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  async checkReminders() {
    try {
      // 削除されていないタスクを取得
      const q = query(
        collection(db, 'tasks'),
        where('isDeleted', '==', false)
      );

      const querySnapshot = await getDocs(q);
      const now = new Date();
      const nowTimestamp = Timestamp.now();

      for (const docSnapshot of querySnapshot.docs) {
        const task = { id: docSnapshot.id, ...docSnapshot.data() } as Task;

        // タスクが完了している場合はスキップ
        if (task.status === 'completed') {
          continue;
        }

        // リマインダーをチェック
        if (task.reminders && task.reminders.length > 0) {
          for (const reminder of task.reminders) {
            // 既に送信済みの場合はスキップ
            if (reminder.sent) {
              continue;
            }

            let shouldNotify = false;
            let scheduledTime: Date | null = null;

            // カスタムリマインダー（絶対日時）
            if (reminder.scheduledAt) {
              scheduledTime = reminder.scheduledAt.toDate();
              // 現在時刻がスケジュール時刻を過ぎているかチェック
              if (now >= scheduledTime) {
                shouldNotify = true;
              }
            }
            // 相対リマインダー（開始前/期限前）
            else if (reminder.type && reminder.amount !== undefined && reminder.unit) {
              const taskStartDate = task.startDate.toDate();
              const taskEndDate = task.endDate.toDate();

              if (reminder.type === 'before_start') {
                scheduledTime = this.calculateReminderTime(taskStartDate, reminder.amount, reminder.unit);
                if (scheduledTime && now >= scheduledTime) {
                  shouldNotify = true;
                }
              } else if (reminder.type === 'before_end') {
                scheduledTime = this.calculateReminderTime(taskEndDate, reminder.amount, reminder.unit);
                if (scheduledTime && now >= scheduledTime) {
                  shouldNotify = true;
                }
              }
            }

            if (shouldNotify) {
              // 通知を送信
              await this.sendReminderNotification(task, reminder, scheduledTime);
              
              // リマインダーを送信済みにマーク
              await this.markReminderAsSent(task.id, reminder.id);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Error checking reminders:', error);
    }
  }

  private calculateReminderTime(baseDate: Date, amount: number, unit: 'minute' | 'hour' | 'day'): Date | null {
    const reminderTime = new Date(baseDate);
    
    switch (unit) {
      case 'minute':
        reminderTime.setMinutes(reminderTime.getMinutes() - amount);
        break;
      case 'hour':
        reminderTime.setHours(reminderTime.getHours() - amount);
        break;
      case 'day':
        reminderTime.setDate(reminderTime.getDate() - amount);
        break;
      default:
        return null;
    }
    
    return reminderTime;
  }

  private async sendReminderNotification(task: Task, reminder: Reminder, scheduledTime: Date | null) {
    try {
      // タスクの担当者に通知（担当者がいない場合は作成者に通知）
      const userId = task.assigneeId || task.creatorId;
      
      let message = '';
      if (reminder.type === 'before_start') {
        message = `タスク「${task.title}」が開始予定時刻の${this.formatReminderTime(reminder)}前に近づいています`;
      } else if (reminder.type === 'before_end') {
        message = `タスク「${task.title}」が期限の${this.formatReminderTime(reminder)}前に近づいています`;
      } else if (scheduledTime) {
        message = `タスク「${task.title}」のリマインダーです`;
      }

      await this.notificationService.createNotification({
        userId: userId,
        type: NotificationType.TaskReminder,
        title: 'タスクのリマインダー',
        message: message,
        taskId: task.id,
        projectId: task.projectId
      });
    } catch (error: any) {
      console.error('Error sending reminder notification:', error);
    }
  }

  private formatReminderTime(reminder: Reminder): string {
    if (!reminder.amount || !reminder.unit) return '';
    
    const unitMap: { [key: string]: string } = {
      'minute': '分',
      'hour': '時間',
      'day': '日'
    };
    
    return `${reminder.amount}${unitMap[reminder.unit]}`;
  }

  private async markReminderAsSent(taskId: string, reminderId: string) {
    try {
      // タスクを取得
      const task = await this.taskService.getTask(taskId);
      if (!task) return;

      // リマインダーを更新
      const updatedReminders = task.reminders.map(reminder => {
        if (reminder.id === reminderId) {
          return {
            ...reminder,
            sent: true,
            sentAt: Timestamp.now()
          };
        }
        return reminder;
      });

      // タスクを更新
      // リマインダー送信時の更新は自動コメントをスキップ（バックグラウンド処理のため）
      await this.taskService.updateTask(taskId, {
        reminders: updatedReminders
      }, true);
    } catch (error: any) {
      console.error('Error marking reminder as sent:', error);
    }
  }
}

