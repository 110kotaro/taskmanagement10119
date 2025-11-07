import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  loginForm: FormGroup;
  signUpForm: FormGroup;
  showSignUp = false;
  errorMessage = '';

  constructor() {
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
  }

  async onLogin() {
    if (this.loginForm.valid) {
      try {
        const { email, password } = this.loginForm.value;
        await this.authService.signIn(email, password);
      } catch (error: any) {
        this.errorMessage = error.message || 'ログインに失敗しました';
      }
    }
  }

  async onSignUp() {
    if (this.signUpForm.valid) {
      if (this.signUpForm.value.password !== this.signUpForm.value.confirmPassword) {
        this.errorMessage = 'パスワードが一致しません';
        return;
      }

      try {
        const { email, password, displayName } = this.signUpForm.value;
        await this.authService.signUp(email, password, displayName);
      } catch (error: any) {
        this.errorMessage = error.message || '登録に失敗しました';
      }
    }
  }

  toggleForms() {
    this.showSignUp = !this.showSignUp;
    this.errorMessage = '';
  }
}

