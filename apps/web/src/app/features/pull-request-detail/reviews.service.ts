import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  AiReviewDto,
  AiReviewSummaryDto,
  ApiResponse,
  PostedFindingCommentDto,
  ResolveGithubThreadsResult,
  ReviewComparisonSummary,
} from '../../core/models/dto';

export interface PostCommentRequest {
  findingId: string;
  path: string;
  line: number;
  endLine?: number;
  body: string;
  subjectType?: 'file';
  reviewId?: string;
}

export interface SubmitReviewRequest {
  event?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  body?: string;
  findings: Array<{ findingId: string; path: string; line: number; endLine?: number; body: string }>;
}

export interface ResolveFindingRequest {
  reason?: 'MANUAL' | 'WONT_FIX';
  reviewId?: string;
}

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

  async listPostedComments(prId: string, reviewId?: string): Promise<PostedFindingCommentDto[]> {
    const query = reviewId ? `?reviewId=${encodeURIComponent(reviewId)}` : '';
    const res = await firstValueFrom(
      this.http.get<ApiResponse<PostedFindingCommentDto[]>>(`/api/pull-requests/${prId}/review/posted-comments${query}`)
    );
    return res.data;
  }

  async postFindingComment(prId: string, body: PostCommentRequest): Promise<{ id: number; html_url: string }> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<{ id: number; html_url: string }>>(`/api/pull-requests/${prId}/review/comments`, body)
    );
    return res.data;
  }

  async submitReview(prId: string, body: SubmitReviewRequest): Promise<{ id: number; html_url: string; postedCount: number }> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<{ id: number; html_url: string; postedCount: number }>>(`/api/pull-requests/${prId}/review/submit`, body)
    );
    return res.data;
  }

  async resolveFinding(prId: string, findingId: string, body: ResolveFindingRequest): Promise<{ resolved: number }> {
    const res = await firstValueFrom(
      this.http.patch<ApiResponse<{ resolved: number }>>(`/api/pull-requests/${prId}/review/findings/${findingId}/resolve`, body)
    );
    return res.data;
  }

  async resolveGithubThreads(prId: string, findingIds: string[], reviewId?: string): Promise<ResolveGithubThreadsResult> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<ResolveGithubThreadsResult>>(`/api/pull-requests/${prId}/review/resolve-github-threads`, { findingIds, reviewId })
    );
    return res.data;
  }

  async syncGithubThreadStatus(prId: string, reviewId?: string): Promise<{ synced: number }> {
    const query = reviewId ? `?reviewId=${encodeURIComponent(reviewId)}` : '';
    const res = await firstValueFrom(
      this.http.post<ApiResponse<{ synced: number }>>(`/api/pull-requests/${prId}/review/sync-github-thread-status${query}`, {})
    );
    return res.data;
  }

  async syncReplies(prId: string): Promise<{ synced: number; dismissed: number; reopened: number; errors: number }> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<{ synced: number; dismissed: number; reopened: number; errors: number }>>(`/api/pull-requests/${prId}/review/sync-replies`, {})
    );
    return res.data;
  }

  async getComparison(reviewId: string): Promise<ReviewComparisonSummary> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<ReviewComparisonSummary>>(`/api/reviews/${reviewId}/comparison`)
    );
    return res.data;
  }

  async setJiraTicket(prId: string, ticketKey: string | null): Promise<{ ticketKey: string | null }> {
    const res = await firstValueFrom(
      this.http.patch<ApiResponse<{ ticketKey: string | null }>>(`/api/pull-requests/${prId}/jira-ticket`, { ticketKey })
    );
    return res.data;
  }
}
