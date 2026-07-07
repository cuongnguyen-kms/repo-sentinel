import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { DashboardStats } from '../../../core/models/dto';
import { DashboardService } from '../dashboard.service';

interface StatCard {
  label: string;
  value: number;
  icon: string;
  accent: 'primary' | 'tertiary' | 'success' | 'warn';
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [MatCardModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  private readonly dashboardService = inject(DashboardService);

  readonly loading = signal(true);
  readonly stats = signal<DashboardStats | null>(null);

  readonly cards = signal<StatCard[]>([]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const stats = await this.dashboardService.getStats();
      this.stats.set(stats);
      this.cards.set([
        { label: 'Watched Repos', value: stats.totalWatched, icon: 'source', accent: 'primary' },
        { label: 'Open PRs', value: stats.openPrs, icon: 'merge', accent: 'tertiary' },
        { label: 'New Today', value: stats.newToday, icon: 'fiber_new', accent: 'success' },
        { label: 'Pending Reviews', value: stats.pendingReviews, icon: 'rate_review', accent: 'warn' },
      ]);
    } finally {
      this.loading.set(false);
    }
  }
}
