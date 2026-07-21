import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, type Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { TranslocoModule } from '@jsverse/transloco';
import { PrState, ReviewStatus } from '../../../core/models/enums';
import type { PullRequestDto } from '../../../core/models/dto';
import { PullRequestsService } from '../pull-requests.service';
import { AiReviewStatusBadge } from '../../pull-request-detail/ai-review-status-badge/ai-review-status-badge';

@Component({
  selector: 'app-pull-requests-page',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    TranslocoModule,
    AiReviewStatusBadge,
  ],
  templateUrl: './pull-requests-page.html',
  styleUrl: './pull-requests-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PullRequestsPage {
  private readonly pullRequestsService = inject(PullRequestsService);

  readonly PrState = PrState;
  readonly ReviewStatus = ReviewStatus;

  readonly loading = signal(true);
  readonly rows = signal<PullRequestDto[]>([]);
  readonly total = signal(0);
  readonly page = signal(0);
  readonly pageSize = signal(20);
  readonly sortField = signal<'createdAtGhe' | 'updatedAtGhe' | 'additions' | 'deletions'>('createdAtGhe');
  readonly sortOrder = signal<'asc' | 'desc'>('desc');

  readonly stateFilter = signal<PrState | 'DRAFT' | ''>('');
  readonly authorFilter = signal('');
  readonly reviewStatusFilter = signal<ReviewStatus | ''>('');

  readonly columns = ['title', 'author', 'state', 'reviewStatus', 'updatedAtGhe', 'score'];

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const result = await this.pullRequestsService.list({
        state: this.stateFilter() || undefined,
        author: this.authorFilter() || undefined,
        reviewStatus: this.reviewStatusFilter() || undefined,
        sort: this.sortField(),
        order: this.sortOrder(),
        page: this.page() + 1,
        limit: this.pageSize(),
      });
      this.rows.set(result.data);
      this.total.set(result.total);
    } finally {
      this.loading.set(false);
    }
  }

  onFilterChange(): void {
    this.page.set(0);
    void this.load();
  }

  onPageChange(event: PageEvent): void {
    this.page.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    void this.load();
  }

  onSortChange(sort: Sort): void {
    if (!sort.active || !sort.direction) return;
    this.sortField.set(sort.active as 'createdAtGhe' | 'updatedAtGhe' | 'additions' | 'deletions');
    this.sortOrder.set(sort.direction);
    void this.load();
  }
}
