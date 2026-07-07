import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Status → shared chip class map (see styles.scss `.chip-*` utilities, defined with
 * light-dark() so they adapt to the active color scheme). ReviewStatus (PullRequest.reviewStatus)
 * and AiReviewStatus (AiReview.status) share several literal string values (QUEUED, FAILED),
 * so this is keyed by the shared string value directly rather than by enum reference.
 */
const STATUS_CLASS: Record<string, string> = {
  PENDING: 'chip-neutral',
  QUEUED: 'chip-info',
  IN_PROGRESS: 'chip-info',
  RUNNING: 'chip-info',
  REVIEWED: 'chip-success',
  COMPLETED: 'chip-success',
  UPDATED: 'chip-warn',
  FAILED: 'chip-error',
  CANCELLED: 'chip-neutral',
};

@Component({
  selector: 'app-ai-review-status-badge',
  standalone: true,
  template: `<span class="status-chip" [class]="cssClass()">{{ status() }}</span>`,
  styles: [
    `
      .status-chip {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.02em;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiReviewStatusBadge {
  readonly status = input.required<string>();
  readonly cssClass = computed(() => STATUS_CLASS[this.status()] ?? 'chip-neutral');
}
