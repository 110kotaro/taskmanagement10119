import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type ThemeMode = 'light' | 'dark' | 'auto';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private currentThemeSubject = new BehaviorSubject<ThemeMode>('light');
  public currentTheme$: Observable<ThemeMode> = this.currentThemeSubject.asObservable();

  private readonly STORAGE_KEY = 'theme_preference';

  constructor() {
    this.loadTheme();
    // システムテーマ変更を監視
    if (typeof window !== 'undefined') {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.currentThemeSubject.value === 'auto') {
          this.applyTheme('auto');
        }
      });
    }
  }

  getCurrentTheme(): ThemeMode {
    return this.currentThemeSubject.value;
  }

  setTheme(mode: ThemeMode) {
    this.currentThemeSubject.next(mode);
    this.saveTheme(mode);
    this.applyTheme(mode);
  }

  private loadTheme() {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    const mode = (saved as ThemeMode) || 'light';
    this.setTheme(mode);
  }

  private saveTheme(mode: ThemeMode) {
    localStorage.setItem(this.STORAGE_KEY, mode);
  }

  private applyTheme(mode: ThemeMode) {
    const actualMode = mode === 'auto' 
      ? this.getSystemTheme() 
      : mode;
    
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', actualMode);
    }
  }

  private getSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}

