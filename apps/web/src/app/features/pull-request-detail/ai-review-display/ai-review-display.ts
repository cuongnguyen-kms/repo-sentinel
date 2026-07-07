import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import parseDiff from 'parse-diff';
import type { AiReviewDto, CodeReviewFinding, CodeReviewResult } from '../../../core/models/dto';
import { DiffFileViewer } from '../diff-file-viewer/diff-file-viewer';

@Component({
  selector: 'app-ai-review-display',
  standalone: true,
  imports: [MatCardModule, DiffFileViewer],
  templateUrl: './ai-review-display.html',
  styleUrl: './ai-review-display.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiReviewDisplay {
  readonly review = input.required<AiReviewDto>();

  readonly codeReview = computed<CodeReviewResult | null>(() => {
    const json = this.review().codeReviewJson;
    if (!json) return null;
    try {
      return JSON.parse(json) as CodeReviewResult;
    } catch {
      return null;
    }
  });

  readonly diffFiles = computed(() => {
    const diff = this.review().diffContent;
    if (!diff) return [];
    try {
      return parseDiff(diff);
    } catch {
      return [];
    }
  });

  readonly scoreColor = computed(() => {
    const score = this.review().score;
    if (score === null || score === undefined) return 'neutral';
    if (score >= 8) return 'good';
    if (score >= 5) return 'warn';
    return 'bad';
  });

  findingsForFile(filePath: string): CodeReviewFinding[] {
    return this.codeReview()?.findings.filter((f) => f.file === filePath || filePath.endsWith(f.file)) ?? [];
  }
}
