import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { PaginatedResponse, PullRequestDto } from '../../core/models/dto';
import type { PrState, ReviewStatus } from '../../core/models/enums';

export interface ListPullRequestsFilters {
  repoId?: string;
  state?: PrState | 'DRAFT';
  author?: string;
  reviewStatus?: ReviewStatus;
  sort?: 'createdAtGhe' | 'updatedAtGhe' | 'additions' | 'deletions';
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class PullRequestsService {
  private readonly http = inject(HttpClient);

  async list(filters: ListPullRequestsFilters): Promise<PaginatedResponse<PullRequestDto>> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') params[key] = String(value);
    }
    const query = new URLSearchParams(params).toString();
    return firstValueFrom(this.http.get<PaginatedResponse<PullRequestDto>>(`/api/pull-requests?${query}`));
  }

  async detail(id: string): Promise<PullRequestDto> {
    const res = await firstValueFrom(this.http.get<{ success: true; data: PullRequestDto }>(`/api/pull-requests/${id}`));
    return res.data;
  }
}
