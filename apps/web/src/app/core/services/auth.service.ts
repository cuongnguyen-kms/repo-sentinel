import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AuthUser } from '../models/dto';

interface GetSessionResponse {
  session: { id: string; expiresAt: string };
  user: AuthUser;
}

interface SignInResponse {
  redirect: boolean;
  token: string;
  user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly _user = signal<AuthUser | null>(null);
  private readonly _permissions = signal<string[]>([]);
  private readonly _initialized = signal(false);
  private readonly _loading = signal(false);

  readonly user = this._user.asReadonly();
  readonly permissions = this._permissions.asReadonly();
  readonly initialized = this._initialized.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly isAdmin = computed(() => this._user()?.role === 'admin');

  private initPromise: Promise<void> | null = null;

  /** Load session + permissions once. Safe to call multiple times — dedupes in-flight loads. */
  async initSession(): Promise<void> {
    if (this._initialized()) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this._loading.set(true);
      try {
        const session = await firstValueFrom(
          this.http.get<GetSessionResponse | null>('/api/auth/get-session')
        ).catch(() => null);

        if (session?.user) {
          this._user.set(session.user);
          const permsRes = await firstValueFrom(
            this.http.get<{ permissions: string[] }>('/api/auth/permissions')
          ).catch(() => ({ permissions: [] }));
          this._permissions.set(permsRes.permissions);
        } else {
          this._user.set(null);
          this._permissions.set([]);
        }
      } finally {
        this._loading.set(false);
        this._initialized.set(true);
      }
    })();

    return this.initPromise;
  }

  async signIn(email: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<SignInResponse>('/api/auth/sign-in/email', { email, password })
    );
    this._user.set(res.user);
    const permsRes = await firstValueFrom(
      this.http.get<{ permissions: string[] }>('/api/auth/permissions')
    ).catch(() => ({ permissions: [] }));
    this._permissions.set(permsRes.permissions);
    this._initialized.set(true);
  }

  async signOut(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/sign-out', {})).catch(() => undefined);
    this.clear();
  }

  /** Clear local session state (used on sign-out and 401 responses). */
  clear(): void {
    this._user.set(null);
    this._permissions.set([]);
    this._initialized.set(true);
    this.initPromise = null;
  }
}
