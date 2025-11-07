import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TeamService } from '../../services/team.service';

@Component({
  selector: 'app-team-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './team-create.component.html',
  styleUrl: './team-create.component.css'
})
export class TeamCreateComponent implements OnInit {
  private router = inject(Router);
  private teamService = inject(TeamService);
  private fb = inject(FormBuilder);

  createForm: FormGroup;
  isCreating = false;

  constructor() {
    this.createForm = this.fb.group({
      name: ['', Validators.required],
      description: ['']
    });
  }

  ngOnInit() {}

  async onCreate() {
    if (!this.createForm.valid) {
      alert('チーム名を入力してください');
      return;
    }

    try {
      this.isCreating = true;
      const formValue = this.createForm.value;
      
      const teamId = await this.teamService.createTeam({
        name: formValue.name,
        description: formValue.description
      });

      alert('チームを作成しました！');
      this.router.navigate(['/team', teamId]);
    } catch (error: any) {
      alert('チームの作成に失敗しました: ' + error.message);
    } finally {
      this.isCreating = false;
    }
  }

  goBack() {
    this.router.navigate(['/teams']);
  }
}

