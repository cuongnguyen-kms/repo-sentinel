import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatListModule } from '@angular/material/list';
import type { AiReviewSummaryDto } from '../../../core/models/dto';
import { AiReviewStatusBadge } from '../ai-review-status-badge/ai-review-status-badge';

@Component({
  selector: 'app-review-history-list',
  standalone: true,
  imports: [DatePipe, MatListModule, AiReviewStatusBadge],
  templateUrl: './review-history-list.html',
  styles: [
    `
      .review-title {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewHistoryList {
  readonly reviews = input.required<AiReviewSummaryDto[]>();
}
