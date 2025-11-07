import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TeamService } from '../../services/team.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-team-invitation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './team-invitation.component.html',
  styleUrl: './team-invitation.component.css'
})
export class TeamInvitationComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private teamService = inject(TeamService);
  private authService = inject(AuthService);

  token: string = '';
  email: string = '';
  password: string = '';
  isNewUser: boolean = false;
  displayName: string = '';
  isLoading = false;
  errorMessage: string = '';
  invitationInfo: any = null;

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (!this.token) {
      this.errorMessage = '招待トークンが無効です';
      return;
    }

    this.loadInvitationInfo();
  }

  async loadInvitationInfo() {
    try {
      this.isLoading = true;
      const invitation = await this.teamService.getInvitationByToken(this.token);
      
      if (!invitation) {
        this.errorMessage = '招待が見つからないか、有効期限が切れています';
        this.isLoading = false;
        return;
      }

      this.invitationInfo = invitation;
      this.isLoading = false;
    } catch (error: any) {
      this.errorMessage = '招待情報の読み込みに失敗しました: ' + error.message;
      this.isLoading = false;
    }
  }

  toggleNewUser() {
    this.isNewUser = !this.isNewUser;
    if (this.isNewUser) {
      this.password = '';
    }
  }

  async onSubmit() {
    if (!this.email || !this.password) {
      this.errorMessage = 'メールアドレスとパスワードを入力してください';
      return;
    }

    if (this.isNewUser && !this.displayName) {
      this.errorMessage = '表示名を入力してください';
      return;
    }

    try {
      this.isLoading = true;
      this.errorMessage = '';

      if (this.isNewUser) {
        // 新規ユーザー登録
        await this.authService.signUp(this.email, this.password, this.displayName);
      } else {
        // 既存ユーザーでログイン
        await this.authService.signIn(this.email, this.password);
      }

      // チームに参加
      await this.teamService.joinTeamByLink(this.token, this.email, this.password);
      
      alert('チームに参加しました！');
      this.router.navigate(['/team', this.invitationInfo.teamId]);
    } catch (error: any) {
      this.errorMessage = error.message;
      this.isLoading = false;
    }
  }

  goBack() {
    this.router.navigate(['/login']);
  }
}

