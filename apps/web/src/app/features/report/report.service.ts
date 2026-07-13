import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, MergedPrCommentsReport, SprintDto } from '../../core/models/dto';

@Injectable({ providedIn: 'root' })
export class ReportService {
  private readonly http = inject(HttpClient);

  async listSprints(): Promise<SprintDto[]> {
    const res = await firstValueFrom(this.http.get<ApiResponse<SprintDto[]>>('/api/report/sprints'));
    return res.data;
  }

  async mergedPrComments(params: { sprintStart?: string; sprintEnd?: string; repoId?: string }): Promise<MergedPrCommentsReport> {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value) query[key] = value;
    }
    const qs = new URLSearchParams(query).toString();
    const res = await firstValueFrom(
      this.http.get<ApiResponse<MergedPrCommentsReport>>(`/api/report/merged-pr-comments${qs ? `?${qs}` : ''}`)
    );
    return res.data;
  }
}
