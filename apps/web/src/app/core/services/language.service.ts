import { Injectable, effect, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';

export type AppLanguage = 'en' | 'vi';

const STORAGE_KEY = 'repo-sentinel.language';

/**
 * Persists the active language to localStorage and drives TranslocoService,
 * mirroring ThemeService's signal + effect pattern for light/dark mode.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);

  readonly language = signal<AppLanguage>(this.readStored());

  constructor() {
    effect(() => {
      const lang = this.language();
      localStorage.setItem(STORAGE_KEY, lang);
      this.transloco.setActiveLang(lang);
    });
  }

  setLanguage(lang: AppLanguage): void {
    this.language.set(lang);
  }

  private readStored(): AppLanguage {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'en' || stored === 'vi' ? stored : 'en';
  }
}
