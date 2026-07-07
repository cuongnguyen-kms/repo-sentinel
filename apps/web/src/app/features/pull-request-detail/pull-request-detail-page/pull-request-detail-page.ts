import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Action, Resource } from '../../../core/models/enums';
import { PermissionsService } from '../../../core/services/permissions.service';
import { extractErrorMessage } from '../../../core/utils/http-error';
import type {
  AiReviewDto,
  AiReviewSummaryDto,
  PostedFindingCommentDto,
  PullRequestDto,
  ReviewComparisonSummary,
} from '../../../core/models/dto';
import { PullRequestsService } from '../../pull-requests/pull-requests.service';
import { ReviewsService } from '../reviews.service';
import { AiReviewStatusBadge } from '../ai-review-status-badge/ai-review-status-badge';
import { AiReviewTriggerButton } from '../ai-review-trigger-button/ai-review-trigger-button';
import { AiReviewTerminalPanel } from '../ai-review-terminal-panel/ai-review-terminal-panel';
import { AiReviewDisplay, type PostFindingEvent, type ResolveFindingEvent } from '../ai-review-display/ai-review-display';
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
  private readonly snackBar = inject(MatSnackBar);

  readonly canTrigger = this.permissions.can(Resource.Reviews, Action.Create);
  readonly canDelete = this.permissions.can(Resource.Reviews, Action.Delete);
  readonly canPostFindings = this.permissions.can(Resource.Findings, Action.Create);
  readonly canUpdateFindings = this.permissions.can(Resource.Findings, Action.Update);

  readonly loading = signal(true);
  readonly pr = signal<PullRequestDto | null>(null);
  readonly latestReview = signal<AiReviewDto | null>(null);
  readonly history = signal<AiReviewSummaryDto[]>([]);

  readonly postedComments = signal<PostedFindingCommentDto[]>([]);
  readonly comparison = signal<ReviewComparisonSummary | null>(null);
  readonly selectedFindingIds = signal<Set<string>>(new Set());
  readonly actionBusy = signal(false);

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
      await this.refreshReviewMetadata(review);
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
      await this.refreshReviewMetadata(review);
    }
    this.schedulePollIfActive();
  }

  private async refreshReviewMetadata(review: AiReviewDto | null): Promise<void> {
    if (!review || review.status !== 'COMPLETED') {
      this.postedComments.set([]);
      this.comparison.set(null);
      return;
    }
    const [posted, comparison] = await Promise.all([
      this.reviewsService.listPostedComments(this.prId, review.id),
      this.reviewsService.getComparison(review.id),
    ]);
    this.postedComments.set(posted);
    this.comparison.set(comparison);
  }

  onTriggered(reviewId: string): void {
    void this.refreshReview();
    void reviewId;
  }

  onReviewCompleted(): void {
    void this.refreshReview();
  }

  async onPostFinding(event: PostFindingEvent): Promise<void> {
    const review = this.latestReview();
    if (!review) return;
    this.actionBusy.set(true);
    try {
      await this.reviewsService.postFindingComment(this.prId, {
        findingId: event.finding.id,
        path: event.filePath,
        line: event.finding.line,
        endLine: event.finding.endLine,
        body: buildFindingCommentBody(event.finding),
        reviewId: review.id,
      });
      await this.refreshReviewMetadata(review);
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, 'Failed to post comment'), 'Dismiss', { duration: 5000 });
    } finally {
      this.actionBusy.set(false);
    }
  }

  async onResolveFinding(event: ResolveFindingEvent): Promise<void> {
    const review = this.latestReview();
    if (!review) return;
    this.actionBusy.set(true);
    try {
      await this.reviewsService.resolveFinding(this.prId, event.findingId, {
        reason: event.reason,
        reviewId: review.id,
      });
      await this.refreshReviewMetadata(review);
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, 'Failed to resolve finding'), 'Dismiss', { duration: 5000 });
    } finally {
      this.actionBusy.set(false);
    }
  }

  onToggleSelect(findingId: string): void {
    this.selectedFindingIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(findingId)) next.delete(findingId);
      else next.add(findingId);
      return next;
    });
  }

  async onSubmitSelected(): Promise<void> {
    const review = this.latestReview();
    const codeReview = parseCodeReviewJson(review?.codeReviewJson ?? null);
    const selected = this.selectedFindingIds();
    if (!review || !codeReview || selected.size === 0) return;

    const findings = codeReview.findings.filter((f) => selected.has(f.id));
    this.actionBusy.set(true);
    try {
      await this.reviewsService.submitReview(this.prId, {
        findings: findings.map((f) => ({
          findingId: f.id,
          path: f.file,
          line: f.line,
          endLine: f.endLine,
          body: buildFindingCommentBody(f),
        })),
      });
      this.selectedFindingIds.set(new Set());
      await this.refreshReviewMetadata(review);
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, 'Failed to submit review'), 'Dismiss', { duration: 5000 });
    } finally {
      this.actionBusy.set(false);
    }
  }

  async onSyncThreadStatus(): Promise<void> {
    const review = this.latestReview();
    if (!review) return;
    this.actionBusy.set(true);
    try {
      await this.reviewsService.syncGithubThreadStatus(this.prId, review.id);
      await this.refreshReviewMetadata(review);
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, 'Failed to sync thread status'), 'Dismiss', { duration: 5000 });
    } finally {
      this.actionBusy.set(false);
    }
  }

  async onSyncReplies(): Promise<void> {
    const review = this.latestReview();
    if (!review) return;
    this.actionBusy.set(true);
    try {
      await this.reviewsService.syncReplies(this.prId);
      await this.refreshReviewMetadata(review);
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, 'Failed to sync replies'), 'Dismiss', { duration: 5000 });
    } finally {
      this.actionBusy.set(false);
    }
  }
}

function parseCodeReviewJson(json: string | null): { findings: Array<{ id: string; file: string; line: number; endLine?: number; severity: string; title: string; comment: string; suggestion?: string }> } | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function buildFindingCommentBody(finding: { severity: string; title: string; comment: string; suggestion?: string }): string {
  let body = `**[${finding.severity.toUpperCase()}] ${finding.title}**\n\n${finding.comment}`;
  if (finding.suggestion) body += `\n\n${finding.suggestion}`;
  return body;
}
