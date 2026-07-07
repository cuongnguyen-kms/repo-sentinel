import { UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import type { File as DiffFile } from 'parse-diff';
import type { CodeReviewFinding, PostedFindingCommentDto } from '../../../core/models/dto';

interface RenderedLine {
  type: 'add' | 'del' | 'normal';
  lineNumber: number | undefined;
  content: string;
  findings: CodeReviewFinding[];
}

export interface PostFindingEvent {
  finding: CodeReviewFinding;
  filePath: string;
}

export interface ResolveFindingEvent {
  findingId: string;
  reason: 'MANUAL' | 'WONT_FIX';
}

@Component({
  selector: 'app-diff-file-viewer',
  standalone: true,
  imports: [MatButtonModule, MatCheckboxModule, MatExpansionModule, MatIconModule, UpperCasePipe],
  templateUrl: './diff-file-viewer.html',
  styleUrl: './diff-file-viewer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffFileViewer {
  readonly file = input.required<DiffFile>();
  readonly findings = input<CodeReviewFinding[]>([]);
  readonly postedComments = input<Map<string, PostedFindingCommentDto>>(new Map());
  readonly selectedFindingIds = input<Set<string>>(new Set());
  readonly actionBusy = input(false);

  readonly post = output<PostFindingEvent>();
  readonly resolve = output<ResolveFindingEvent>();
  readonly toggleSelect = output<string>();

  readonly expanded = signal(false);

  readonly filePath = computed(() => this.file().to ?? this.file().from ?? 'unknown');
  readonly findingCount = computed(() => this.findings().length);

  readonly lines = computed<RenderedLine[]>(() => {
    const findingsByLine = new Map<number, CodeReviewFinding[]>();
    for (const f of this.findings()) {
      const arr = findingsByLine.get(f.line) ?? [];
      arr.push(f);
      findingsByLine.set(f.line, arr);
    }

    const result: RenderedLine[] = [];
    for (const chunk of this.file().chunks) {
      for (const change of chunk.changes) {
        const lineNumber = change.type === 'del' ? undefined : (change as { ln?: number; ln2?: number }).ln ?? (change as { ln2?: number }).ln2;
        result.push({
          type: change.type,
          lineNumber,
          content: change.content,
          findings: lineNumber !== undefined ? findingsByLine.get(lineNumber) ?? [] : [],
        });
      }
    }
    return result;
  });

  private hasAutoExpanded = false;

  constructor() {
    // Auto-expand files that have findings, once, on first render
    effect(() => {
      if (!this.hasAutoExpanded && this.findingCount() > 0) {
        this.hasAutoExpanded = true;
        this.expanded.set(true);
      }
    });
  }

  toggle(): void {
    this.expanded.update((v) => !v);
  }

  postedFor(findingId: string): PostedFindingCommentDto | undefined {
    return this.postedComments().get(findingId);
  }

  isPosted(findingId: string): boolean {
    const posted = this.postedFor(findingId);
    return !!posted && !posted.deletedOnGithub;
  }

  isSelected(findingId: string): boolean {
    return this.selectedFindingIds().has(findingId);
  }

  onPost(finding: CodeReviewFinding): void {
    this.post.emit({ finding, filePath: this.filePath() });
  }

  onResolve(findingId: string, reason: 'MANUAL' | 'WONT_FIX'): void {
    this.resolve.emit({ findingId, reason });
  }

  onToggleSelect(findingId: string): void {
    this.toggleSelect.emit(findingId);
  }
}
