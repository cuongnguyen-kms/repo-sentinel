import { Injectable, effect, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'repo-sentinel.theme';

/**
 * Controls the `color-scheme` CSS property on `<html>`. The M3 theme in styles.scss is
 * built with `theme-type: color-scheme`, so every Material token already resolves via the
 * CSS `light-dark()` function — no duplicate theme block needed, just flip this property.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly preference = signal<ThemePreference>(this.readStored());

  readonly isDark = signal(this.resolveIsDark(this.preference()));

  constructor() {
    effect(() => {
      const pref = this.preference();
      localStorage.setItem(STORAGE_KEY, pref);
      const dark = this.resolveIsDark(pref);
      this.isDark.set(dark);
      document.documentElement.style.colorScheme = pref === 'system' ? 'light dark' : pref;
    });

    if (this.preference() === 'system' && window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (this.preference() === 'system') this.isDark.set(e.matches);
      });
    }
  }

  toggle(): void {
    this.preference.set(this.isDark() ? 'light' : 'dark');
  }

  setPreference(pref: ThemePreference): void {
    this.preference.set(pref);
  }

  private readStored(): ThemePreference {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  }

  private resolveIsDark(pref: ThemePreference): boolean {
    if (pref === 'dark') return true;
    if (pref === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }
}
