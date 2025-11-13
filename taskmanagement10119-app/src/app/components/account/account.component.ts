import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { User, UserRole } from '../../models/user.model';
import { updateProfile, updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider, deleteUser, User as FirebaseUser } from 'firebase/auth';
import { doc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '../../../firebase-config';
import { Timestamp } from 'firebase/firestore';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './account.component.html',
  styleUrl: './account.component.css'
})
export class AccountComponent implements OnInit {
  authService = inject(AuthService);
  router = inject(Router);
  location = inject(Location);

  user: User | null = null;
  firebaseUser: FirebaseUser | null = null;
  
  // 編集モード
  isEditingDisplayName = false;
  isEditingEmail = false;
  isEditingPassword = false;
  
  // フォーム値
  displayName = '';
  email = '';
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  
  // エラー・成功メッセージ
  errorMessage = '';
  successMessage = '';
  
  // アバター画像
  photoURL = '';
  isEditingAvatar = false;
  selectedFile: File | null = null;
  isUploading = false;
  
  // アカウント削除確認
  showDeleteConfirm = false;
  deletePassword = '';
  deleteConfirmText = '';

  async ngOnInit() {
    this.firebaseUser = this.authService.currentUser;
    if (!this.firebaseUser) {
      this.router.navigate(['/login']);
      return;
    }

    await this.loadUserData();
  }

  async loadUserData() {
    if (!this.firebaseUser) return;

    try {
      const userData = await this.authService.getUserData(this.firebaseUser.uid);
      if (userData) {
        this.user = userData;
        this.displayName = userData.displayName;
        this.email = userData.email;
        this.photoURL = userData.photoURL || '';
      } else {
        // Firestoreにデータがない場合は、Firebase Authの情報を表示
        this.displayName = this.firebaseUser.displayName || '';
        this.email = this.firebaseUser.email || '';
        this.photoURL = this.firebaseUser.photoURL || '';
      }
    } catch (error: any) {
      console.error('Failed to load user data:', error);
      this.errorMessage = 'ユーザー情報の取得に失敗しました';
    }
  }

  getRoleLabel(role: UserRole): string {
    return role === UserRole.Admin ? '管理者' : '一般ユーザー';
  }

  formatDate(timestamp: Timestamp | Date | any): string {
    if (!timestamp) return '-';
    try {
      const date = timestamp instanceof Timestamp ? timestamp.toDate() : 
                   timestamp?.toDate ? timestamp.toDate() : 
                   new Date(timestamp);
      if (isNaN(date.getTime())) return '-';
      return date.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return '-';
    }
  }

  startEditDisplayName() {
    this.isEditingDisplayName = true;
    this.errorMessage = '';
    this.successMessage = '';
  }

  cancelEditDisplayName() {
    this.isEditingDisplayName = false;
    this.displayName = this.user?.displayName || this.firebaseUser?.displayName || '';
  }

  async saveDisplayName() {
    if (!this.firebaseUser || !this.displayName.trim()) {
      this.errorMessage = '表示名を入力してください';
      return;
    }

    try {
      await updateProfile(this.firebaseUser, { displayName: this.displayName.trim() });
      
      // Firestoreのユーザーデータも更新
      if (this.user) {
        const userRef = doc(db, 'users', this.firebaseUser.uid);
        await updateDoc(userRef, {
          displayName: this.displayName.trim(),
          updatedAt: Timestamp.now()
        });
      }

      await this.loadUserData();
      this.isEditingDisplayName = false;
      this.successMessage = '表示名を更新しました';
      setTimeout(() => this.successMessage = '', 3000);
    } catch (error: any) {
      console.error('Failed to update display name:', error);
      this.errorMessage = '表示名の更新に失敗しました: ' + error.message;
    }
  }

  startEditEmail() {
    this.isEditingEmail = true;
    this.currentPassword = '';
    this.errorMessage = '';
    this.successMessage = '';
  }

  cancelEditEmail() {
    this.isEditingEmail = false;
    this.email = this.user?.email || this.firebaseUser?.email || '';
    this.currentPassword = '';
  }

  async saveEmail() {
    if (!this.firebaseUser || !this.email.trim()) {
      this.errorMessage = 'メールアドレスを入力してください';
      return;
    }

    if (!this.currentPassword) {
      this.errorMessage = '現在のパスワードを入力してください';
      return;
    }

    try {
      // 再認証
      const credential = EmailAuthProvider.credential(
        this.firebaseUser.email || '',
        this.currentPassword
      );
      await reauthenticateWithCredential(this.firebaseUser, credential);

      // メールアドレスを更新
      await updateEmail(this.firebaseUser, this.email.trim());
      
      // Firestoreのユーザーデータも更新
      if (this.user) {
        const userRef = doc(db, 'users', this.firebaseUser.uid);
        await updateDoc(userRef, {
          email: this.email.trim(),
          updatedAt: Timestamp.now()
        });
      }

      await this.loadUserData();
      this.isEditingEmail = false;
      this.currentPassword = '';
      this.successMessage = 'メールアドレスを更新しました';
      setTimeout(() => this.successMessage = '', 3000);
    } catch (error: any) {
      console.error('Failed to update email:', error);
      this.errorMessage = 'メールアドレスの更新に失敗しました: ' + error.message;
    }
  }

  startEditPassword() {
    this.isEditingPassword = true;
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.errorMessage = '';
    this.successMessage = '';
  }

  cancelEditPassword() {
    this.isEditingPassword = false;
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
  }

  async savePassword() {
    if (!this.firebaseUser || !this.currentPassword || !this.newPassword) {
      this.errorMessage = 'すべてのパスワードフィールドを入力してください';
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage = '新しいパスワードが一致しません';
      return;
    }

    if (this.newPassword.length < 6) {
      this.errorMessage = 'パスワードは6文字以上である必要があります';
      return;
    }

    try {
      // 再認証
      const credential = EmailAuthProvider.credential(
        this.firebaseUser.email || '',
        this.currentPassword
      );
      await reauthenticateWithCredential(this.firebaseUser, credential);

      // パスワードを更新
      await updatePassword(this.firebaseUser, this.newPassword);

      this.isEditingPassword = false;
      this.currentPassword = '';
      this.newPassword = '';
      this.confirmPassword = '';
      this.successMessage = 'パスワードを更新しました';
      setTimeout(() => this.successMessage = '', 3000);
    } catch (error: any) {
      console.error('Failed to update password:', error);
      this.errorMessage = 'パスワードの更新に失敗しました: ' + error.message;
    }
  }

  startEditAvatar() {
    this.isEditingAvatar = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.selectedFile = null;
  }

  cancelEditAvatar() {
    this.isEditingAvatar = false;
    this.photoURL = this.user?.photoURL || this.firebaseUser?.photoURL || '';
    this.selectedFile = null;
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
      // プレビュー表示
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.photoURL = e.target.result;
      };
      reader.readAsDataURL(this.selectedFile);
    }
  }

  async uploadImage(): Promise<string> {
    if (!this.firebaseUser || !this.selectedFile) {
      throw new Error('ファイルが選択されていません');
    }

    // ファイル名を生成（ユーザーID + タイムスタンプ）
    const fileExtension = this.selectedFile.name.split('.').pop();
    const fileName = `avatars/${this.firebaseUser.uid}_${Date.now()}.${fileExtension}`;
    const storageRef = ref(storage, fileName);

    // ファイルをアップロード
    await uploadBytes(storageRef, this.selectedFile);

    // ダウンロードURLを取得
    const downloadURL = await getDownloadURL(storageRef);
    return downloadURL;
  }

  async saveAvatar() {
    if (!this.firebaseUser) return;

    try {
      this.isUploading = true;
      this.errorMessage = '';
      
      let finalPhotoURL = this.photoURL.trim();

      // ファイルが選択されている場合はアップロード
      if (this.selectedFile) {
        finalPhotoURL = await this.uploadImage();
      }

      // 空の場合はnullを設定
      if (!finalPhotoURL) {
        finalPhotoURL = '';
      }

      await updateProfile(this.firebaseUser, { photoURL: finalPhotoURL || null });
      
      // Firestoreのユーザーデータも更新
      if (this.user) {
        const userRef = doc(db, 'users', this.firebaseUser.uid);
        await updateDoc(userRef, {
          photoURL: finalPhotoURL || null,
          updatedAt: Timestamp.now()
        });
      }

      await this.loadUserData();
      this.isEditingAvatar = false;
      this.selectedFile = null;
      this.isUploading = false;
      this.successMessage = 'アバター画像を更新しました';
      setTimeout(() => this.successMessage = '', 3000);
    } catch (error: any) {
      console.error('Failed to update avatar:', error);
      this.errorMessage = 'アバター画像の更新に失敗しました: ' + error.message;
      this.isUploading = false;
    }
  }

  showDeleteAccountDialog() {
    this.showDeleteConfirm = true;
    this.deletePassword = '';
    this.deleteConfirmText = '';
    this.errorMessage = '';
  }

  cancelDeleteAccount() {
    this.showDeleteConfirm = false;
    this.deletePassword = '';
    this.deleteConfirmText = '';
  }

  async confirmDeleteAccount() {
    if (!this.firebaseUser) return;

    if (this.deleteConfirmText !== '削除') {
      this.errorMessage = '確認のため「削除」と入力してください';
      return;
    }

    if (!this.deletePassword) {
      this.errorMessage = 'パスワードを入力してください';
      return;
    }

    try {
      // 再認証
      const credential = EmailAuthProvider.credential(
        this.firebaseUser.email || '',
        this.deletePassword
      );
      await reauthenticateWithCredential(this.firebaseUser, credential);

      // Firestoreのユーザーデータを削除
      if (this.user) {
        await deleteDoc(doc(db, 'users', this.firebaseUser.uid));
      }

      // Firebase Authのアカウントを削除
      await deleteUser(this.firebaseUser);

      // ログアウトしてログインページにリダイレクト
      await this.router.navigate(['/login']);
    } catch (error: any) {
      console.error('Failed to delete account:', error);
      this.errorMessage = 'アカウントの削除に失敗しました: ' + error.message;
    }
  }

  async logout() {
    try {
      await this.authService.signOut();
    } catch (error: any) {
      console.error('Failed to logout:', error);
      this.errorMessage = 'ログアウトに失敗しました: ' + error.message;
    }
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/home']);
    }
  }
}

