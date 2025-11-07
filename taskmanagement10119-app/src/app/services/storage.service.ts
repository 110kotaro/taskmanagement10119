import { Injectable, inject } from '@angular/core';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Timestamp } from 'firebase/firestore';
import { storage } from '../../firebase-config';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private authService = inject(AuthService);

  async uploadFile(file: File, taskId: string): Promise<{ id: string; name: string; url: string; uploadedAt: Timestamp }> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const timestamp = Date.now();
      const fileName = `${timestamp}_${file.name}`;
      const storageRef = ref(storage, `tasks/${taskId}/${fileName}`);

      // ファイルをアップロード
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);

      return {
        id: timestamp.toString(),
        name: file.name,
        url: downloadURL,
        uploadedAt: Timestamp.now()
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`ファイルのアップロードに失敗しました: ${errorMessage}`);
    }
  }

  async uploadProjectFile(file: File, projectId: string): Promise<{ id: string; name: string; url: string; uploadedAt: Timestamp }> {
    try {
      const user = this.authService.currentUser;
      if (!user) throw new Error('User not authenticated');

      const timestamp = Date.now();
      const fileName = `${timestamp}_${file.name}`;
      const storageRef = ref(storage, `projects/${projectId}/${fileName}`);

      // ファイルをアップロード
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);

      return {
        id: timestamp.toString(),
        name: file.name,
        url: downloadURL,
        uploadedAt: Timestamp.now()
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`ファイルのアップロードに失敗しました: ${errorMessage}`);
    }
  }

  async deleteFile(fileUrl: string): Promise<void> {
    try {
      // fileUrlから適切なパスを抽出する必要がある場合がある
      // Firebase StorageのURLからパスを抽出する関数が必要
      const fileRef = ref(storage, this.extractPathFromUrl(fileUrl));
      await deleteObject(fileRef);
    } catch (error: unknown) {
      console.error('ファイルの削除に失敗しました:', error);
      // ファイルが存在しない場合などはエラーを無視
    }
  }

  private extractPathFromUrl(url: string): string {
    // Firebase StorageのURLからパスを抽出
    // URL形式: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?...
    try {
      const urlObj = new URL(url);
      const path = decodeURIComponent(urlObj.pathname.split('/o/')[1]?.split('?')[0] || '');
      return path;
    } catch {
      // URLが無効な場合は、URL全体をパスとして使用
      return url;
    }
  }
}

