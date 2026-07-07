import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AiReviewDto, AiReviewSummaryDto, ApiResponse } from '../../core/models/dto';

@Injectable({ providedIn: 'root' })
export class ReviewsService {
  private readonly http = inject(HttpClient);

  async trigger(prId: string): Promise<{ id: string; status: string }> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<{ id: string; status: string }>>(`/api/pull-requests/${prId}/review`, {})
    );
    return res.data;
  }

  async getLatest(prId: string): Promise<AiReviewDto | null> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<AiReviewDto>>(`/api/pull-requests/${prId}/review`));
      return res.data;
    } catch {
      return null;
    }
  }

  async getHistory(prId: string, limit = 20, offset = 0): Promise<{ data: AiReviewSummaryDto[]; total: number }> {
    const res = await firstValueFrom(
      this.http.get<{ success: true; data: AiReviewSummaryDto[]; total: number }>(
        `/api/pull-requests/${prId}/reviews?limit=${limit}&offset=${offset}`
      )
    );
    return { data: res.data, total: res.total };
  }

  async getById(reviewId: string): Promise<AiReviewDto> {
    const res = await firstValueFrom(this.http.get<ApiResponse<AiReviewDto>>(`/api/reviews/${reviewId}`));
    return res.data;
  }

  async getTerminalLog(reviewId: string): Promise<string | null> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<{ id: string; terminalLog: string | null }>>(`/api/reviews/${reviewId}/terminal-log`)
    );
    return res.data.terminalLog;
  }

  async cancel(reviewId: string): Promise<{ id: string; status: string }> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<{ id: string; status: string }>>(`/api/reviews/${reviewId}/cancel`, {})
    );
    return res.data;
  }

  async remove(reviewId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/reviews/${reviewId}`));
  }
}
