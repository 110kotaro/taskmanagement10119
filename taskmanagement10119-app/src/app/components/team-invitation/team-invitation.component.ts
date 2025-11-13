import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TeamService } from '../../services/team.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-team-invitation',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './team-invitation.component.html',
  styleUrl: './team-invitation.component.css'
})
export class TeamInvitationComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private teamService = inject(TeamService);
  private authService = inject(AuthService);
  private fb = inject(FormBuilder);

  token: string = '';
  isNewUser: boolean = false;
  isLoading = false;
  errorMessage: string = '';
  invitationInfo: any = null;
  
  loginForm!: FormGroup;
  signUpForm!: FormGroup;

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (!this.token) {
      this.errorMessage = '招待トークンが無効です';
      return;
    }

    // フォームを初期化
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });

    this.signUpForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      displayName: ['', [Validators.required]]
    });

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
    this.errorMessage = '';
    if (this.isNewUser) {
      this.loginForm.reset();
    } else {
      this.signUpForm.reset();
    }
  }

  async onSubmit() {
    this.errorMessage = '';

    if (this.isNewUser) {
      // 新規ユーザー登録
      if (this.signUpForm.invalid) {
        this.errorMessage = '入力内容を確認してください';
        return;
      }

      if (this.signUpForm.value.password !== this.signUpForm.value.confirmPassword) {
        this.errorMessage = 'パスワードが一致しません';
        return;
      }

      try {
        this.isLoading = true;
        const { email, password, displayName } = this.signUpForm.value;
        await this.authService.signUp(email, password, displayName);
        
        // チームに参加
        const result = await this.teamService.joinTeamByLink(this.token, email, password);
        
        if (result.alreadyMember) {
          // 既にメンバーの場合
          alert('すでに参加しています');
          this.router.navigate(['/team', result.teamId]);
          return;
        }
        
        alert('チームに参加しました！');
        this.router.navigate(['/team', result.teamId]);
      } catch (error: any) {
        this.errorMessage = error.message || '登録に失敗しました';
        this.isLoading = false;
      }
    } else {
      // 既存ユーザーでログイン
      if (this.loginForm.invalid) {
        this.errorMessage = '入力内容を確認してください';
        return;
      }

      try {
        this.isLoading = true;
        const { email, password } = this.loginForm.value;
        await this.authService.signIn(email, password);
        
        // チームに参加
        const result = await this.teamService.joinTeamByLink(this.token, email, password);
        
        if (result.alreadyMember) {
          // 既にメンバーの場合
          alert('すでに参加しています');
          this.router.navigate(['/team', result.teamId]);
          return;
        }
        
        alert('チームに参加しました！');
        this.router.navigate(['/team', result.teamId]);
      } catch (error: any) {
        this.errorMessage = error.message || 'ログインに失敗しました';
        this.isLoading = false;
      }
    }
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      // 履歴がない場合はログイン画面に戻る
      this.router.navigate(['/login']);
    }
  }
}

