import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, ConnectionTestResult, GheConnectionDto } from '../../core/models/dto';

export interface CreateConnectionInput {
  hostname: string;
  username: string;
  token: string;
}

@Injectable({ providedIn: 'root' })
export class ConnectionsService {
  private readonly http = inject(HttpClient);

  async list(): Promise<GheConnectionDto[]> {
    const res = await firstValueFrom(this.http.get<ApiResponse<GheConnectionDto[]>>('/api/connections'));
    return res.data;
  }

  async create(input: CreateConnectionInput): Promise<GheConnectionDto> {
    const res = await firstValueFrom(this.http.post<ApiResponse<GheConnectionDto>>('/api/connections', input));
    return res.data;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/connections/${id}`));
  }

  async test(id: string): Promise<ConnectionTestResult> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<ConnectionTestResult>>(`/api/connections/${id}/test`, {})
    );
    return res.data;
  }
}
