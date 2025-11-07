import { Injectable, inject } from '@angular/core';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  Timestamp,
  deleteField,
  limit
} from 'firebase/firestore';
import { db } from '../../firebase-config';
import { Team, TeamMember, TeamRole } from '../models/team.model';
import { TeamInvitation } from '../models/team-invitation.model';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { NotificationType } from '../models/notification.model';

@Injectable({
  providedIn: 'root'
})
export class TeamService {
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);

  async createTeam(teamData: Partial<Team>): Promise<string> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const team: Omit<Team, 'id'> = {
        name: teamData.name || '',
        description: teamData.description,
        ownerId: user.uid,
        ownerName: user.displayName || user.email || 'Unknown',
        members: teamData.members || [{
          userId: user.uid,
          userName: user.displayName || user.email || 'Unknown',
          userEmail: user.email || '',
          role: TeamRole.Owner,
          joinedAt: Timestamp.now()
        }],
        isDeleted: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      const docRef = await addDoc(collection(db, 'teams'), team);
      return docRef.id;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async getTeam(teamId: string): Promise<Team | null> {
    try {
      const docRef = doc(db, 'teams', teamId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data['isDeleted']) return null;
        return { id: docSnap.id, ...data } as Team;
      }
      return null;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async getTeamsForUser(userId: string): Promise<Team[]> {
    try {
      // オーナーまたはメンバーとして参加しているチームを取得
      const q = query(
        collection(db, 'teams'),
        where('isDeleted', '==', false)
      );
      
      const snapshot = await getDocs(q);
      const allTeams = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Team));

      // クライアント側でフィルタリング（メンバーとして参加しているチームを抽出）
      const userTeams = allTeams.filter(team => 
        team.ownerId === userId || 
        team.members.some(member => member.userId === userId)
      );

      return userTeams;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async updateTeam(teamId: string, updates: Partial<Team>): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      // 権限チェック
      const team = await this.getTeam(teamId);
      if (!team) throw new Error('Team not found');

      const isOwner = team.ownerId === user.uid;
      const member = team.members.find(m => m.userId === user.uid);
      const isAdmin = member?.role === TeamRole.Admin || member?.role === TeamRole.Owner;

      // 名前や説明の更新はオーナーまたは管理者のみ
      if (updates.name !== undefined || updates.description !== undefined) {
        if (!isOwner && !isAdmin) {
          throw new Error('チームの情報を更新する権限がありません');
        }
      }

      const teamRef = doc(db, 'teams', teamId);
      const cleanUpdates: any = {};

      for (const [key, value] of Object.entries(updates)) {
        if (key === 'updatedAt' || key === 'id') continue;
        if (value === undefined) {
          cleanUpdates[key] = deleteField();
        } else {
          cleanUpdates[key] = value;
        }
      }

      cleanUpdates.updatedAt = Timestamp.now();
      await updateDoc(teamRef, cleanUpdates);
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async deleteTeam(teamId: string): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const team = await this.getTeam(teamId);
      if (!team) throw new Error('Team not found');

      // オーナーのみ削除可能
      if (team.ownerId !== user.uid) {
        throw new Error('チームを削除する権限がありません（オーナーのみ可能）');
      }

      const teamRef = doc(db, 'teams', teamId);
      await updateDoc(teamRef, {
        isDeleted: true,
        deletedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async inviteMember(teamId: string, userEmail: string): Promise<string> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const team = await this.getTeam(teamId);
      if (!team) throw new Error('Team not found');

      // 権限チェック（オーナーまたは管理者のみ招待可能）
      const isOwner = team.ownerId === user.uid;
      const member = team.members.find(m => m.userId === user.uid);
      const isAdmin = member?.role === TeamRole.Admin || member?.role === TeamRole.Owner;

      if (!isOwner && !isAdmin) {
        throw new Error('メンバーを招待する権限がありません');
      }

      // ユーザーを検索
      const allUsers = await this.authService.getAllUsers();
      const targetUser = allUsers.find(u => u.email === userEmail);

      if (!targetUser) {
        throw new Error('指定されたメールアドレスのユーザーが見つかりません');
      }

      // 既にメンバーかチェック
      if (team.members.some(m => m.userId === targetUser.id)) {
        throw new Error('このユーザーは既にチームメンバーです');
      }

      // 招待レコードを作成
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7日後

      const invitation: Omit<TeamInvitation, 'id'> = {
        teamId: teamId,
        teamName: team.name,
        invitationToken: this.generateInvitationToken(),
        invitedBy: user.uid,
        invitedByName: user.displayName || user.email || 'Unknown',
        invitedByEmail: userEmail,
        invitationType: 'email',
        expiresAt: Timestamp.fromDate(expiresAt),
        status: 'pending',
        createdAt: Timestamp.now()
      };

      const invitationRef = await addDoc(collection(db, 'teamInvitations'), invitation);
      const invitationId = invitationRef.id;

      // 招待通知を送信（invitationIdを含める）
      // チーム招待通知は個人向けのため、teamIdは設定しない（招待者にも通知が行かないようにする）
      await this.notificationService.createNotification({
        userId: targetUser.id,
        type: NotificationType.TeamInvitation,
        title: 'チーム招待',
        message: `${user.displayName || user.email}がチーム「${team.name}」にあなたを招待しました`,
        invitationId: invitationId
      });

      return invitationId;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 招待リンクを生成
  async generateInvitationLink(teamId: string): Promise<string> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const team = await this.getTeam(teamId);
      if (!team) throw new Error('Team not found');

      // 権限チェック（オーナーまたは管理者のみ招待可能）
      const isOwner = team.ownerId === user.uid;
      const member = team.members.find(m => m.userId === user.uid);
      const isAdmin = member?.role === TeamRole.Admin || member?.role === TeamRole.Owner;

      if (!isOwner && !isAdmin) {
        throw new Error('メンバーを招待する権限がありません');
      }

      // 招待レコードを作成
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7日後

      const invitationToken = this.generateInvitationToken();
      const invitation: Omit<TeamInvitation, 'id'> = {
        teamId: teamId,
        teamName: team.name,
        invitationToken: invitationToken,
        invitedBy: user.uid,
        invitedByName: user.displayName || user.email || 'Unknown',
        invitationType: 'link',
        expiresAt: Timestamp.fromDate(expiresAt),
        status: 'pending',
        createdAt: Timestamp.now()
      };

      await addDoc(collection(db, 'teamInvitations'), invitation);

      // リンクを生成（実際のURLは環境に応じて変更）
      const baseUrl = window.location.origin;
      return `${baseUrl}/team-invitation/${invitationToken}`;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 招待トークンを生成
  private generateInvitationToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  async removeMember(teamId: string, memberUserId: string): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const team = await this.getTeam(teamId);
      if (!team) throw new Error('Team not found');

      // 権限チェック（オーナーまたは管理者のみ削除可能、ただし自分自身は削除できない）
      const isOwner = team.ownerId === user.uid;
      const member = team.members.find(m => m.userId === user.uid);
      const isAdmin = member?.role === TeamRole.Admin || member?.role === TeamRole.Owner;

      if (!isOwner && !isAdmin) {
        throw new Error('メンバーを削除する権限がありません');
      }

      // オーナーは削除できない
      if (team.ownerId === memberUserId) {
        throw new Error('オーナーは削除できません');
      }

      // 自分自身を削除する場合は退会処理
      if (memberUserId === user.uid) {
        return this.leaveTeam(teamId);
      }

      // メンバーを削除
      const updatedMembers = team.members.filter(m => m.userId !== memberUserId);
      await this.updateTeam(teamId, { members: updatedMembers });

      // 退会通知を送信（削除されたメンバーに）
      await this.notificationService.createNotification({
        userId: memberUserId,
        type: NotificationType.TeamLeave,
        title: 'チームから削除されました',
        message: `${user.displayName || user.email}がチーム「${team.name}」からあなたを削除しました`,
        teamId: teamId
      });
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async updateMemberRole(teamId: string, memberUserId: string, newRole: TeamRole): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const team = await this.getTeam(teamId);
      if (!team) throw new Error('Team not found');

      // 権限チェック（オーナーのみ権限変更可能）
      if (team.ownerId !== user.uid) {
        throw new Error('メンバーの権限を変更する権限がありません（オーナーのみ可能）');
      }

      // オーナーの権限は変更できない
      if (team.ownerId === memberUserId && newRole !== TeamRole.Owner) {
        throw new Error('オーナーの権限は変更できません');
      }

      // メンバーの権限を更新
      const updatedMembers = team.members.map(m => 
        m.userId === memberUserId ? { ...m, role: newRole } : m
      );
      await this.updateTeam(teamId, { members: updatedMembers });

      // 権限変更通知を送信
      const roleNames: { [key: string]: string } = {
        'owner': 'オーナー',
        'admin': '管理者',
        'member': 'メンバー',
        'viewer': '閲覧者'
      };

      await this.notificationService.createNotification({
        userId: memberUserId,
        type: NotificationType.TeamPermissionChange,
        title: 'チームの権限が変更されました',
        message: `${user.displayName || user.email}がチーム「${team.name}」でのあなたの権限を${roleNames[newRole]}に変更しました`,
        teamId: teamId
      });
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async leaveTeam(teamId: string): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const team = await this.getTeam(teamId);
      if (!team) throw new Error('Team not found');

      // オーナーは退会できない
      if (team.ownerId === user.uid) {
        throw new Error('オーナーはチームを退会できません。チームを削除するか、オーナー権限を譲渡してください');
      }

      // メンバーを削除
      const updatedMembers = team.members.filter(m => m.userId !== user.uid);
      await this.updateTeam(teamId, { members: updatedMembers });

      // 退会通知を送信（オーナーに）
      await this.notificationService.createNotification({
        userId: team.ownerId,
        type: NotificationType.TeamLeave,
        title: 'チームメンバーが退会しました',
        message: `${user.displayName || user.email}がチーム「${team.name}」を退会しました`,
        teamId: teamId
      });
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async sendAdminAnnouncement(teamId: string, message: string): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const team = await this.getTeam(teamId);
      if (!team) throw new Error('Team not found');

      // 権限チェック（オーナーまたは管理者のみ）
      const isOwner = team.ownerId === user.uid;
      const member = team.members.find(m => m.userId === user.uid);
      const isAdmin = member?.role === TeamRole.Admin || member?.role === TeamRole.Owner;

      if (!isOwner && !isAdmin) {
        throw new Error('お知らせを送信する権限がありません');
      }

      // 全メンバーにお知らせを送信（送信者を除く）
      for (const member of team.members) {
        if (member.userId !== user.uid) {
          await this.notificationService.createNotification({
            userId: member.userId,
            type: NotificationType.TeamAdminAnnouncement,
            title: 'チームからのお知らせ',
            message: `${user.displayName || user.email}からのお知らせ: ${message}`,
            teamId: teamId
          });
        }
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 権限チェック用のヘルパーメソッド
  async canEditTeam(teamId: string, userId: string): Promise<boolean> {
    const team = await this.getTeam(teamId);
    if (!team) return false;

    if (team.ownerId === userId) return true;
    const member = team.members.find(m => m.userId === userId);
    return member?.role === TeamRole.Admin || member?.role === TeamRole.Owner || false;
  }

  async canInviteMember(teamId: string, userId: string): Promise<boolean> {
    return this.canEditTeam(teamId, userId);
  }

  // チームの招待一覧を取得（pending状態のみ）
  async getPendingInvitations(teamId: string): Promise<TeamInvitation[]> {
    try {
      const q = query(
        collection(db, 'teamInvitations'),
        where('teamId', '==', teamId),
        where('status', '==', 'pending')
      );

      const snapshot = await getDocs(q);
      const invitations: TeamInvitation[] = [];

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const expiresAt = data['expiresAt']?.toDate();
        
        // 有効期限が切れている場合は除外
        if (expiresAt && expiresAt < new Date()) {
          // 期限切れの場合はステータスを更新
          await updateDoc(doc.ref, { status: 'expired' });
          continue;
        }

        invitations.push({ id: doc.id, ...data } as TeamInvitation);
      }

      return invitations;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 招待トークンから招待情報を取得
  async getInvitationByToken(token: string): Promise<TeamInvitation | null> {
    try {
      const q = query(
        collection(db, 'teamInvitations'),
        where('invitationToken', '==', token),
        where('status', '==', 'pending'),
        limit(1)
      );

      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;

      const doc = snapshot.docs[0];
      const data = doc.data();

      // 有効期限チェック
      const expiresAt = data['expiresAt']?.toDate();
      if (expiresAt && expiresAt < new Date()) {
        // 期限切れの場合はステータスを更新
        await updateDoc(doc.ref, { status: 'expired' });
        return null;
      }

      return { id: doc.id, ...data } as TeamInvitation;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 招待を受け入れる（メール招待）
  async acceptInvitation(invitationId: string): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const invitationRef = doc(db, 'teamInvitations', invitationId);
      const invitationSnap = await getDoc(invitationRef);

      if (!invitationSnap.exists()) {
        throw new Error('招待が見つかりません');
      }

      const invitation = invitationSnap.data() as TeamInvitation;

      // 有効期限チェック
      const expiresAt = invitation.expiresAt.toDate();
      if (expiresAt < new Date()) {
        await updateDoc(invitationRef, { status: 'expired' });
        throw new Error('招待の有効期限が切れています');
      }

      // ステータスチェック
      if (invitation.status !== 'pending') {
        throw new Error('この招待は既に処理済みです');
      }

      const team = await this.getTeam(invitation.teamId);
      if (!team) throw new Error('チームが見つかりません');

      // 既にメンバーかチェック
      if (team.members.some(m => m.userId === user.uid)) {
        await updateDoc(invitationRef, { status: 'accepted', acceptedAt: Timestamp.now() });
        throw new Error('既にチームメンバーです');
      }

      // メンバーを追加
      const newMember: TeamMember = {
        userId: user.uid,
        userName: user.displayName || user.email || 'Unknown',
        userEmail: user.email || '',
        role: TeamRole.Member,
        joinedAt: Timestamp.now(),
        invitedBy: invitation.invitedBy
      };

      const updatedMembers = [...team.members, newMember];
      await this.updateTeam(invitation.teamId, { members: updatedMembers });

      // 招待を更新
      await updateDoc(invitationRef, {
        status: 'accepted',
        acceptedAt: Timestamp.now()
      });

      // 招待者に通知
      await this.notificationService.createNotification({
        userId: invitation.invitedBy,
        type: NotificationType.TeamInvitationAccepted,
        title: 'チーム招待が承認されました',
        message: `${user.displayName || user.email}がチーム「${team.name}」への招待を承認しました`,
        teamId: invitation.teamId
      });
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // 招待を拒否する（メール招待）
  async rejectInvitation(invitationId: string): Promise<void> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const invitationRef = doc(db, 'teamInvitations', invitationId);
      const invitationSnap = await getDoc(invitationRef);

      if (!invitationSnap.exists()) {
        throw new Error('招待が見つかりません');
      }

      const invitation = invitationSnap.data() as TeamInvitation;

      // ステータスチェック
      if (invitation.status !== 'pending') {
        throw new Error('この招待は既に処理済みです');
      }

      // 招待を更新
      await updateDoc(invitationRef, {
        status: 'rejected',
        rejectedAt: Timestamp.now()
      });

      const team = await this.getTeam(invitation.teamId);
      if (!team) throw new Error('チームが見つかりません');

      // 招待者に通知
      await this.notificationService.createNotification({
        userId: invitation.invitedBy,
        type: NotificationType.TeamInvitationRejected,
        title: 'チーム招待が拒否されました',
        message: `${user.displayName || user.email}がチーム「${team.name}」への招待を拒否しました`,
        teamId: invitation.teamId
      });
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // リンク招待で参加する
  async joinTeamByLink(token: string, userEmail: string, password: string): Promise<void> {
    try {
      // まずログイン
      await this.authService.signIn(userEmail, password);

      const invitation = await this.getInvitationByToken(token);
      if (!invitation) {
        throw new Error('招待が見つからないか、有効期限が切れています');
      }

      if (invitation.invitationType !== 'link') {
        throw new Error('この招待はリンク招待ではありません');
      }

      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const team = await this.getTeam(invitation.teamId);
      if (!team) throw new Error('チームが見つかりません');

      // 既にメンバーかチェック
      if (team.members.some(m => m.userId === user.uid)) {
        await updateDoc(doc(db, 'teamInvitations', invitation.id), {
          status: 'accepted',
          acceptedAt: Timestamp.now()
        });
        throw new Error('既にチームメンバーです');
      }

      // メンバーを追加
      const newMember: TeamMember = {
        userId: user.uid,
        userName: user.displayName || user.email || 'Unknown',
        userEmail: user.email || '',
        role: TeamRole.Member,
        joinedAt: Timestamp.now(),
        invitedBy: invitation.invitedBy
      };

      const updatedMembers = [...team.members, newMember];
      await this.updateTeam(invitation.teamId, { members: updatedMembers });

      // 招待を更新
      await updateDoc(doc(db, 'teamInvitations', invitation.id), {
        status: 'accepted',
        acceptedAt: Timestamp.now()
      });

      // 招待者に通知
      await this.notificationService.createNotification({
        userId: invitation.invitedBy,
        type: NotificationType.TeamInvitationAccepted,
        title: 'チーム招待が承認されました',
        message: `${user.displayName || user.email}がチーム「${team.name}」への招待リンクから参加しました`,
        teamId: invitation.teamId
      });
    } catch (error: any) {
      throw new Error(error.message);
    }
  }
}

