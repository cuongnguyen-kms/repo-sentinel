import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { TranslocoModule } from '@jsverse/transloco';
import parseDiff from 'parse-diff';
import type { AiReviewDto, CodeReviewFinding, CodeReviewResult, PostedFindingCommentDto } from '../../../core/models/dto';
import { DiffFileViewer, type PostFindingEvent, type ResolveFindingEvent } from '../diff-file-viewer/diff-file-viewer';

export type { PostFindingEvent, ResolveFindingEvent };

@Component({
  selector: 'app-ai-review-display',
  standalone: true,
  imports: [MatCardModule, TranslocoModule, DiffFileViewer],
  templateUrl: './ai-review-display.html',
  styleUrl: './ai-review-display.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiReviewDisplay {
  readonly review = input.required<AiReviewDto>();
  readonly postedComments = input<PostedFindingCommentDto[]>([]);
  readonly selectedFindingIds = input<Set<string>>(new Set());
  readonly actionBusy = input(false);

  readonly post = output<PostFindingEvent>();
  readonly resolve = output<ResolveFindingEvent>();
  readonly toggleSelect = output<string>();

  readonly postedByFindingId = computed(() => {
    const map = new Map<string, PostedFindingCommentDto>();
    for (const c of this.postedComments()) map.set(c.findingId, c);
    return map;
  });

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

  onPost(event: PostFindingEvent): void {
    this.post.emit(event);
  }

  onResolve(event: ResolveFindingEvent): void {
    this.resolve.emit(event);
  }

  onToggleSelect(findingId: string): void {
    this.toggleSelect.emit(findingId);
  }
}
