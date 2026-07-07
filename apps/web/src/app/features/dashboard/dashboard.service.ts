import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, DashboardStats } from '../../core/models/dto';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  async getStats(): Promise<DashboardStats> {
    const res = await firstValueFrom(this.http.get<ApiResponse<DashboardStats>>('/api/dashboard/stats'));
    return res.data;
  }
}
