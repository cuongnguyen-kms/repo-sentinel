import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);

  async getAll(): Promise<Record<string, string>> {
    const res = await firstValueFrom(
      this.http.get<{ success: true; data: Record<string, string> }>('/api/settings')
    );
    return res.data;
  }

  async update(values: Record<string, string>): Promise<void> {
    await firstValueFrom(this.http.patch('/api/settings', values));
  }
}
