import { Timestamp } from 'firebase/firestore';

export enum TeamRole {
  Owner = 'owner',      // オーナー
  Admin = 'admin',      // 管理者
  Member = 'member',    // メンバー
  Viewer = 'viewer'     // 閲覧者
}

export interface TeamMember {
  userId: string;
  userName: string;
  userEmail: string;
  role: TeamRole;
  joinedAt: Timestamp;
  invitedBy?: string;   // 招待したユーザーID
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  ownerName: string;
  members: TeamMember[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isDeleted: boolean;
  deletedAt?: Timestamp;
}

