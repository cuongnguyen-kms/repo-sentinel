import { UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import type { File as DiffFile } from 'parse-diff';
import type { CodeReviewFinding } from '../../../core/models/dto';

interface RenderedLine {
  type: 'add' | 'del' | 'normal';
  lineNumber: number | undefined;
  content: string;
  findings: CodeReviewFinding[];
}

@Component({
  selector: 'app-diff-file-viewer',
  standalone: true,
  imports: [MatExpansionModule, MatIconModule, UpperCasePipe],
  templateUrl: './diff-file-viewer.html',
  styleUrl: './diff-file-viewer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffFileViewer {
  readonly file = input.required<DiffFile>();
  readonly findings = input<CodeReviewFinding[]>([]);

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
}
