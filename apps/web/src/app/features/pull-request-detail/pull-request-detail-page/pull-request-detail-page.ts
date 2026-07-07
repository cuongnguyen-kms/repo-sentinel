import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Action, Resource } from '../../../core/models/enums';
import { PermissionsService } from '../../../core/services/permissions.service';
import type { AiReviewDto, AiReviewSummaryDto, PullRequestDto } from '../../../core/models/dto';
import { PullRequestsService } from '../../pull-requests/pull-requests.service';
import { ReviewsService } from '../reviews.service';
import { AiReviewStatusBadge } from '../ai-review-status-badge/ai-review-status-badge';
import { AiReviewTriggerButton } from '../ai-review-trigger-button/ai-review-trigger-button';
import { AiReviewTerminalPanel } from '../ai-review-terminal-panel/ai-review-terminal-panel';
import { AiReviewDisplay } from '../ai-review-display/ai-review-display';
import { ReviewHistoryList } from '../review-history-list/review-history-list';

const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING']);
const POLL_INTERVAL_MS = 5000;

@Component({
  selector: 'app-pull-request-detail-page',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    AiReviewStatusBadge,
    AiReviewTriggerButton,
    AiReviewTerminalPanel,
    AiReviewDisplay,
    ReviewHistoryList,
  ],
  templateUrl: './pull-request-detail-page.html',
  styleUrl: './pull-request-detail-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PullRequestDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly pullRequestsService = inject(PullRequestsService);
  private readonly reviewsService = inject(ReviewsService);
  private readonly permissions = inject(PermissionsService);

  readonly canTrigger = this.permissions.can(Resource.Reviews, Action.Create);
  readonly canDelete = this.permissions.can(Resource.Reviews, Action.Delete);

  readonly loading = signal(true);
  readonly pr = signal<PullRequestDto | null>(null);
  readonly latestReview = signal<AiReviewDto | null>(null);
  readonly history = signal<AiReviewSummaryDto[]>([]);

  readonly isActive = computed(() => {
    const status = this.latestReview()?.status;
    return status ? ACTIVE_STATUSES.has(status) : false;
  });

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly prId: string;

  constructor() {
    this.prId = this.route.snapshot.paramMap.get('id')!;
    void this.loadAll();
  }

  private async loadAll(): Promise<void> {
    this.loading.set(true);
    try {
      const [pr, review, history] = await Promise.all([
        this.pullRequestsService.detail(this.prId),
        this.reviewsService.getLatest(this.prId),
        this.reviewsService.getHistory(this.prId),
      ]);
      this.pr.set(pr);
      this.latestReview.set(review);
      this.history.set(history.data);
      this.schedulePollIfActive();
    } finally {
      this.loading.set(false);
    }
  }

  private schedulePollIfActive(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (!this.isActive()) return;
    this.pollTimer = setTimeout(() => void this.refreshReview(), POLL_INTERVAL_MS);
  }

  private async refreshReview(): Promise<void> {
    const review = await this.reviewsService.getLatest(this.prId);
    this.latestReview.set(review);
    if (!this.isActive()) {
      const history = await this.reviewsService.getHistory(this.prId);
      this.history.set(history.data);
    }
    this.schedulePollIfActive();
  }

  onTriggered(reviewId: string): void {
    void this.refreshReview();
    void reviewId;
  }

  onReviewCompleted(): void {
    void this.refreshReview();
  }
}
