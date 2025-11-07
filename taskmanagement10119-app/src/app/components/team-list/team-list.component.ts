import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TeamService } from '../../services/team.service';
import { AuthService } from '../../services/auth.service';
import { Team } from '../../models/team.model';

@Component({
  selector: 'app-team-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './team-list.component.html',
  styleUrl: './team-list.component.css'
})
export class TeamListComponent implements OnInit {
  private teamService = inject(TeamService);
  private authService = inject(AuthService);
  private router = inject(Router);

  teams: Team[] = [];
  isLoading = true;

  ngOnInit() {
    this.loadTeams();
  }

  async loadTeams() {
    try {
      const user = this.authService.currentUser;
      if (user) {
        this.teams = await this.teamService.getTeamsForUser(user.uid);
      }
      this.isLoading = false;
    } catch (error) {
      console.error('Error loading teams:', error);
      this.isLoading = false;
    }
  }

  formatDate(timestamp: any): string {
    const date = timestamp.toDate();
    return date.toLocaleDateString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  openCreateModal() {
    this.router.navigate(['/teams/create']);
  }

  viewTeam(teamId: string) {
    this.router.navigate(['/team', teamId]);
  }

  goBack() {
    this.router.navigate(['/home']);
  }
}

