import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import type { MergedPrCommentsReport, MergedPrReportRow, SprintDto } from '../../../core/models/dto';
import { ReportService } from '../report.service';

/** Maps a comment category to one of the shared `.chip-*` status classes. */
const CATEGORY_CHIP_CLASS: Record<string, string> = {
  OPEN: 'chip-error',
  FIXED_CODE: 'chip-success',
  NO_LONGER_FLAGGED: 'chip-success',
  INVALID_COMMENT: 'chip-neutral',
  NOT_FIX_NOW: 'chip-warn',
  BY_DESIGN: 'chip-info',
  ACCEPTED_RISK: 'chip-info',
  NO_REPLY: 'chip-warn',
  OTHER_RESOLVED: 'chip-success',
  OTHER_DISMISSED: 'chip-neutral',
};

@Component({
  selector: 'app-report-page',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTableModule,
  ],
  templateUrl: './report-page.html',
  styleUrl: './report-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportPage {
  private readonly reportService = inject(ReportService);

  readonly loading = signal(true);
  readonly sprints = signal<SprintDto[]>([]);
  readonly selectedSprint = signal<SprintDto | null>(null);
  readonly report = signal<MergedPrCommentsReport | null>(null);

  readonly commentColumns = ['finding', 'category', 'status', 'replies', 'link'];

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    this.loading.set(true);
    try {
      const sprints = await this.reportService.listSprints();
      this.sprints.set(sprints);
      const current = sprints.find((s) => s.label.endsWith('(current)')) ?? sprints[0] ?? null;
      this.selectedSprint.set(current);
      if (current) await this.loadReport(current);
    } finally {
      this.loading.set(false);
    }
  }

  async onSprintChange(sprint: SprintDto): Promise<void> {
    this.selectedSprint.set(sprint);
    this.loading.set(true);
    try {
      await this.loadReport(sprint);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadReport(sprint: SprintDto): Promise<void> {
    const data = await this.reportService.mergedPrComments({ sprintStart: sprint.start, sprintEnd: sprint.end });
    this.report.set(data);
  }

  categoryChipClass(category: string): string {
    return CATEGORY_CHIP_CLASS[category] ?? 'chip-neutral';
  }

  categoryLabel(category: string): string {
    return category
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  trackByPrId(_index: number, row: MergedPrReportRow): string {
    return row.prId;
  }

  compareSprints(a: SprintDto | null, b: SprintDto | null): boolean {
    return a?.label === b?.label;
  }
}
