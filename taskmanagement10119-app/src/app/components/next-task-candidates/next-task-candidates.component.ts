import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TaskService } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';
import { Task } from '../../models/task.model';

@Component({
  selector: 'app-next-task-candidates',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './next-task-candidates.component.html',
  styleUrl: './next-task-candidates.component.css'
})
export class NextTaskCandidatesComponent implements OnInit, OnChanges {
  private taskService = inject(TaskService);
  private authService = inject(AuthService);
  private router = inject(Router);

  @Input() showModal = false;
  @Output() closeModal = new EventEmitter<void>();

  candidates: Task[] = [];
  isLoading = false;

  ngOnInit() {
    if (this.showModal) {
      this.loadCandidates();
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['showModal'] && this.showModal) {
      this.loadCandidates();
    }
  }

  async loadCandidates() {
    this.isLoading = true;
    try {
      const user = this.authService.currentUser;
      if (user) {
        this.candidates = await this.taskService.getNextTaskCandidates(user.uid);
      }
    } catch (error) {
      console.error('Error loading next task candidates:', error);
    } finally {
      this.isLoading = false;
    }
  }

  selectTask(taskId: string) {
    this.router.navigate(['/task', taskId]);
    this.close();
  }

  close() {
    this.closeModal.emit();
  }

  formatDate(timestamp: any): string {
    const date = timestamp.toDate();
    return date.toLocaleDateString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric'
    });
  }

  getStatusLabel(status: string): string {
    const statusMap: { [key: string]: string } = {
      'not_started': '未着手',
      'in_progress': '進行中',
      'completed': '完了',
      'overdue': '期限切れ'
    };
    return statusMap[status] || status;
  }

  getPriorityLabel(priority: string): string {
    const priorityMap: { [key: string]: string } = {
      'important': '重要',
      'normal': '普通',
      'low': '低め',
      'none': 'なし',
      'custom': 'カスタム'
    };
    return priorityMap[priority] || priority;
  }
}
