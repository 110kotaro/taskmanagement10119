import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TeamService } from '../../services/team.service';
import { AuthService } from '../../services/auth.service';
import { Team, TeamMember, TeamRole } from '../../models/team.model';
import { TeamInvitation } from '../../models/team-invitation.model';

@Component({
  selector: 'app-team-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './team-detail.component.html',
  styleUrl: './team-detail.component.css'
})
export class TeamDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private teamService = inject(TeamService);
  private authService = inject(AuthService);

  team: Team | null = null;
  isLoading = true;
  isEditing = false;
  isInviting = false;
  isGeneratingLink = false;
  
  inviteEmail = '';
  invitationLink = '';
  showInvitationLink = false;
  
  pendingInvitations: TeamInvitation[] = [];
  
  currentUserRole: TeamRole | null = null;
  isOwner = false;
  isAdmin = false;

  ngOnInit() {
    const teamId = this.route.snapshot.paramMap.get('id');
    if (teamId) {
      this.loadTeam(teamId);
    }
  }

  async loadTeam(teamId: string) {
    try {
      this.isLoading = true;
      this.team = await this.teamService.getTeam(teamId);
      
      if (this.team) {
        const user = this.authService.currentUser;
        if (user) {
          this.isOwner = this.team.ownerId === user.uid;
          const member = this.team.members.find(m => m.userId === user.uid);
          this.currentUserRole = member?.role || null;
          this.isAdmin = member?.role === TeamRole.Admin || member?.role === TeamRole.Owner || false;
          
          // デバッグログ
          console.log('[チーム詳細] デバッグ情報:');
          console.log('  - ユーザーID:', user.uid);
          console.log('  - チームオーナーID:', this.team.ownerId);
          console.log('  - isOwner:', this.isOwner);
          console.log('  - currentUserRole:', this.currentUserRole);
          console.log('  - isAdmin:', this.isAdmin);
          console.log('  - メンバー情報:', member);
          console.log('  - チームメンバー一覧:', this.team.members);
          console.log('  - 退会ボタン表示条件 (!isOwner):', !this.isOwner);
        } else {
          console.log('[チーム詳細] ユーザーがログインしていません');
        }

        // 招待中リストを取得（管理者のみ）
        if (this.isAdmin) {
          this.pendingInvitations = await this.teamService.getPendingInvitations(teamId);
        }
      } else {
        console.log('[チーム詳細] チームが見つかりませんでした');
      }
      
      this.isLoading = false;
    } catch (error) {
      console.error('Error loading team:', error);
      alert('チームの読み込みに失敗しました');
      this.isLoading = false;
    }
  }

  async onInvite() {
    if (!this.inviteEmail.trim()) {
      alert('メールアドレスを入力してください');
      return;
    }

    if (!this.team) return;

    try {
      this.isInviting = true;
      await this.teamService.inviteMember(this.team.id, this.inviteEmail.trim());
      alert('メンバーを招待しました');
      this.inviteEmail = '';
      this.isInviting = false;
      // チーム情報と招待中リストを再読み込み
      await this.loadTeam(this.team.id);
    } catch (error: any) {
      alert('メンバーの招待に失敗しました: ' + error.message);
      this.isInviting = false;
    }
  }

  async onGenerateLink() {
    if (!this.team) return;

    try {
      this.isGeneratingLink = true;
      this.invitationLink = await this.teamService.generateInvitationLink(this.team.id);
      this.showInvitationLink = true;
      this.isGeneratingLink = false;
    } catch (error: any) {
      alert('招待リンクの生成に失敗しました: ' + error.message);
      this.isGeneratingLink = false;
    }
  }

  async onCopyLink() {
    if (!this.invitationLink) return;

    try {
      await navigator.clipboard.writeText(this.invitationLink);
      alert('招待リンクをコピーしました');
    } catch (error) {
      // フォールバック: テキストエリアを使用
      const textarea = document.createElement('textarea');
      textarea.value = this.invitationLink;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert('招待リンクをコピーしました');
    }
  }

  closeInvitationLink() {
    this.showInvitationLink = false;
    this.invitationLink = '';
  }

  async onRemoveMember(memberUserId: string) {
    if (!this.team) return;
    if (!confirm('このメンバーをチームから削除しますか？')) return;

    try {
      await this.teamService.removeMember(this.team.id, memberUserId);
      alert('メンバーを削除しました');
      await this.loadTeam(this.team.id);
    } catch (error: any) {
      alert('メンバーの削除に失敗しました: ' + error.message);
    }
  }

  async onUpdateRole(memberUserId: string, newRole: TeamRole) {
    if (!this.team) return;

    try {
      await this.teamService.updateMemberRole(this.team.id, memberUserId, newRole);
      alert('権限を変更しました');
      await this.loadTeam(this.team.id);
    } catch (error: any) {
      alert('権限の変更に失敗しました: ' + error.message);
    }
  }

  async onLeaveTeam() {
    if (!this.team) return;
    if (!confirm('チームを退会しますか？')) return;

    try {
      await this.teamService.leaveTeam(this.team.id);
      alert('チームを退会しました');
      this.router.navigate(['/teams']);
    } catch (error: any) {
      alert('チームの退会に失敗しました: ' + error.message);
    }
  }

  getRoleLabel(role: TeamRole): string {
    const roleLabels: { [key: string]: string } = {
      'owner': 'オーナー',
      'admin': '管理者',
      'member': 'メンバー',
      'viewer': '閲覧者'
    };
    return roleLabels[role] || role;
  }

  formatDate(timestamp: any): string {
    const date = timestamp.toDate();
    return date.toLocaleDateString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      // 履歴がない場合はチーム一覧に戻る
      this.router.navigate(['/teams']);
    }
  }
}

