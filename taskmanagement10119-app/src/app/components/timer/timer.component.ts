import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { interval, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TaskService } from '../../services/task.service';
import { Task } from '../../models/task.model';
import { Timestamp } from 'firebase/firestore';

interface TimerState {
  isRunning: boolean;
  isPaused: boolean;
  startTime: number;
  elapsedTime: number;
  sessionStartTime?: number;
  breaks: number;
  currentPomodoro?: number;
  isBreak: boolean; // 休憩中かどうか
  breakElapsed: number; // 休憩経過時間（秒）
  breakNotificationCount: number; // 休憩通知の回数（5分ごと）
}

@Component({
  selector: 'app-timer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './timer.component.html',
  styleUrl: './timer.component.css'
})
export class TimerComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private taskService = inject(TaskService);
  private destroy$ = new Subject<void>();
  private pomodoroTimerStarted = false; // ポモドーロタイマーが既に開始されているか

  task: Task | null = null;
  mode: 'normal' | 'pomodoro' = 'normal';
  
  timerState: TimerState = {
    isRunning: false,
    isPaused: false,
    startTime: 0,
    elapsedTime: 0,
    breaks: 0,
    isBreak: false,
    breakElapsed: 0,
    breakNotificationCount: 0
  };

  displayTime = '00:00:00';
  pomodoroTime = 25 * 60; // 25分を秒で
  pomodoroElapsed = 0;
  breakTime = 5 * 60; // 5分を秒で
  
  // HTMLテンプレートで使用するため
  Math = Math;

  ngOnInit() {
    const taskId = this.route.snapshot.paramMap.get('taskId');
    if (taskId) {
      this.loadTask(taskId);
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.pomodoroTimerStarted = false;
  }

  async loadTask(taskId: string) {
    try {
      // taskIdパラメータがない場合はtaskIdパラメータを確認
      const routeTaskId = this.route.snapshot.paramMap.get('taskId') || taskId;
      this.task = await this.taskService.getTask(routeTaskId);
    } catch (error) {
      console.error('Error loading task:', error);
    }
  }

  startNormal() {
    this.mode = 'normal';
    this.timerState.isRunning = true;
    this.timerState.isPaused = false;
    this.timerState.startTime = Date.now() - this.timerState.elapsedTime;
    
    this.startTimer();
  }

  startPomodoro() {
    this.mode = 'pomodoro';
    this.timerState.isRunning = true;
    this.timerState.isPaused = false;
    this.timerState.startTime = Date.now();
    this.pomodoroElapsed = 0;
    
    this.startPomodoroTimer();
  }

  startTimer() {
    interval(1000).pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      if (this.timerState.isRunning && !this.timerState.isPaused) {
        this.timerState.elapsedTime = Date.now() - this.timerState.startTime;
        this.displayTime = this.formatTime(this.timerState.elapsedTime);
      }
    });
  }

  startPomodoroTimer() {
    // 既にタイマーが開始されている場合は、新しい購読を開始しない
    if (this.pomodoroTimerStarted) {
      return;
    }
    
    this.pomodoroTimerStarted = true;
    interval(1000).pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      if (this.mode === 'pomodoro') {
        if (this.timerState.isBreak) {
          // 休憩中の処理
          if (this.timerState.isRunning && !this.timerState.isPaused) {
            this.timerState.breakElapsed += 1;
            const remaining = this.breakTime - this.timerState.breakElapsed;
            this.displayTime = this.formatTime(Math.max(0, remaining * 1000));

            // 5分経過したら通知
            if (this.timerState.breakElapsed === this.breakTime) {
              this.onBreakComplete();
            }
            // 5分経過後、5分ごとに再開を促す通知
            else if (this.timerState.breakElapsed > this.breakTime && 
                     (this.timerState.breakElapsed - this.breakTime) % (5 * 60) === 0) {
              this.showResumePrompt();
            }
          }
        } else {
          // 作業中の処理
          if (this.timerState.isRunning && !this.timerState.isPaused) {
            this.pomodoroElapsed += 1;
            const remaining = this.pomodoroTime - this.pomodoroElapsed;
            this.displayTime = this.formatTime(Math.max(0, remaining * 1000));

            if (remaining <= 0) {
              this.onPomodoroComplete();
            }
          }
        }
      }
    });
  }

  onPomodoroComplete() {
    // ポモドーロ完了数をカウント
    this.timerState.breaks += 1;
    alert('25分経過しました！休憩を取りましょう。');
    this.timerState.isRunning = false;
    this.timerState.isPaused = false;
    this.timerState.isBreak = true;
    this.timerState.breakElapsed = 0;
    this.timerState.breakNotificationCount = 0;
    this.pomodoroElapsed = this.pomodoroTime;
    // 休憩時間の計測は開始しない（ユーザーが休憩開始ボタンを押すまで待つ）
  }

  startBreak() {
    this.timerState.isBreak = true;
    this.timerState.isRunning = true;
    this.timerState.isPaused = false;
    this.timerState.breakElapsed = 0;
    this.timerState.breakNotificationCount = 0;
    this.displayTime = this.formatTime(this.breakTime * 1000);
  }

  skipBreak() {
    // 休憩をスキップして次のポモドーロを開始
    this.timerState.isBreak = false;
    this.timerState.isRunning = false;
    this.timerState.isPaused = false;
    this.timerState.breakElapsed = 0;
    this.timerState.breakNotificationCount = 0;
    this.pomodoroElapsed = 0;
    this.displayTime = this.formatTime(this.pomodoroTime * 1000);
  }

  onBreakComplete() {
    alert('休憩時間（5分）が経過しました！再開してください。');
    // isRunningはfalseにしない（breakElapsedの更新を継続させて、5分ごとの通知を出すため）
    this.timerState.isPaused = false;
    this.timerState.breakNotificationCount = 1;
  }

  showResumePrompt() {
    this.timerState.breakNotificationCount += 1;
    alert(`休憩時間が${5 * this.timerState.breakNotificationCount}分経過しました。再開してください。`);
  }

  resumeFromBreak() {
    // 休憩から作業に戻る
    this.timerState.isBreak = false;
    this.timerState.isRunning = true;
    this.timerState.isPaused = false;
    this.pomodoroElapsed = 0;
    this.timerState.breakNotificationCount = 0;
    this.displayTime = this.formatTime(this.pomodoroTime * 1000);
  }

  pause() {
    this.timerState.isPaused = true;
    // ノーマルモードの場合、現在の経過時間を保持してstartTimeを調整
    if (this.mode === 'normal') {
      const currentElapsed = this.timerState.elapsedTime;
      this.timerState.startTime = Date.now() - currentElapsed;
    }
  }

  resume() {
    this.timerState.isPaused = false;
    // ノーマルモードの場合、startTimeを現在時刻から経過時間を引いた値に調整
    if (this.mode === 'normal') {
      this.timerState.startTime = Date.now() - this.timerState.elapsedTime;
    }
    // ポモドーロモードの場合、startPomodoroTimerは既に動いているので、isPausedをfalseにするだけでOK
  }

  stop() {
    this.timerState.isRunning = false;
    this.timerState.isPaused = false;
    this.timerState.isBreak = false;
    this.displayTime = '00:00:00';
    this.timerState.elapsedTime = 0;
    this.pomodoroElapsed = 0;
    this.timerState.breakElapsed = 0;
    this.timerState.breakNotificationCount = 0;
    // タイマーを停止したら、既存の購読を解除してフラグをリセット
    this.destroy$.next();
    this.destroy$ = new Subject<void>(); // 新しいSubjectを作成（次回開始時に新しい購読を開始できるように）
    this.pomodoroTimerStarted = false;
  }

  async finish() {
    if (!this.task) return;

    const seconds = this.calculateWorkSeconds();
    // 秒を分に変換（29秒以下は切り捨て、30秒以上は切り上げ）
    const remainder = seconds % 60;
    const minutes = Math.floor(seconds / 60) + (remainder >= 30 ? 1 : 0);
    
    if (confirm(`${minutes}分の作業を記録しますか？`)) {
      try {
        const now = Timestamp.now();
        const user = this.task.assigneeId;
        
        const workSession:any = {
          id: Date.now().toString(),
          startTime: Timestamp.fromMillis(this.timerState.startTime),
          endTime: now,
          breakDuration: this.timerState.breaks * 5, // 休憩時間（分）
          actualDuration: seconds, // 秒単位で記録
          isPomodoro: this.mode === 'pomodoro',
          
        };

        if (this.mode === 'pomodoro') {
          workSession.completedPomodoros = this.timerState.breaks + 1;
        }

        const currentWorkSessions = this.task.workSessions || [];
        const updatedSessions = [...currentWorkSessions, workSession];
        const newTotalTime = (this.task.totalWorkTime || 0) + seconds; // 秒単位で記録

        // 作業時間記録時は自動コメントをスキップ
        await this.taskService.updateTask(this.task.id, {
          workSessions: updatedSessions,
          totalWorkTime: newTotalTime
        }, true);

        alert(`${minutes}分の作業時間を記録しました`);
        this.stop();
        this.router.navigate(['/task', this.task.id]);
      } catch (error: any) {
        alert('作業時間の記録に失敗しました: ' + error.message);
      }
    }
  }

  calculateWorkSeconds(): number {
    if (this.mode === 'pomodoro') {
      // 休憩中の場合は現在のポモドーロ分のみ
      if (this.timerState.isBreak) {
        return this.timerState.breaks * 25 * 60;
      }
      return (this.timerState.breaks * 25 * 60) + this.pomodoroElapsed;
    }
    return Math.floor(this.timerState.elapsedTime / 1000); // ミリ秒→秒
  }

  formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      // 履歴がない場合はタスク詳細に戻る（タスクIDがある場合）
      if (this.task) {
        const from = this.route.snapshot.queryParamMap.get('from');
        const queryParams = from ? { from } : {};
        this.router.navigate(['/task', this.task.id], { queryParams });
      } else {
        this.router.navigate(['/home']);
      }
    }
  }
}

