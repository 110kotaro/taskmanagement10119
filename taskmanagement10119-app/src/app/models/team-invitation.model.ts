import { Timestamp } from 'firebase/firestore';

export interface TeamInvitation {
  id: string;
  teamId: string;
  teamName: string;
  invitationToken: string; // 一意のトークン
  invitedBy: string; // 招待したユーザーID
  invitedByName: string; // 招待したユーザー名
  invitedByEmail?: string; // メール招待の場合のメールアドレス
  invitationType: 'email' | 'link'; // 招待方法
  expiresAt: Timestamp; // 有効期限
  status: 'pending' | 'accepted' | 'rejected' | 'expired'; // ステータス
  acceptedAt?: Timestamp;
  rejectedAt?: Timestamp;
  createdAt: Timestamp;
}

