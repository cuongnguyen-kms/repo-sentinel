import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, BrowseReposResponse, WatchedRepoDto } from '../../core/models/dto';

export interface WatchRepoItemInput {
  owner: string;
  name: string;
  fullName: string;
}

export interface UpdateRepoInput {
  pollingInterval?: number;
  isActive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ReposService {
  private readonly http = inject(HttpClient);

  async browse(connectionId: string, page: number, search?: string): Promise<BrowseReposResponse> {
    const params: Record<string, string> = { page: String(page) };
    if (search) params['search'] = search;
    const query = new URLSearchParams(params).toString();
    const res = await firstValueFrom(
      this.http.get<ApiResponse<BrowseReposResponse>>(`/api/connections/${connectionId}/repos?${query}`)
    );
    return res.data;
  }

  async watch(connectionId: string, repos: WatchRepoItemInput[]): Promise<{ count: number }> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<{ count: number }>>('/api/repos/watch', { connectionId, repos })
    );
    return res.data;
  }

  async unwatch(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/repos/watch/${id}`));
  }

  async list(): Promise<WatchedRepoDto[]> {
    const res = await firstValueFrom(this.http.get<ApiResponse<WatchedRepoDto[]>>('/api/repos'));
    return res.data;
  }

  async updateConfig(id: string, input: UpdateRepoInput): Promise<WatchedRepoDto> {
    const res = await firstValueFrom(this.http.patch<ApiResponse<WatchedRepoDto>>(`/api/repos/${id}`, input));
    return res.data;
  }

  async poll(id: string, force = false): Promise<{ queued: boolean }> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<{ queued: boolean }>>(`/api/repos/${id}/poll`, { force })
    );
    return res.data;
  }
}
