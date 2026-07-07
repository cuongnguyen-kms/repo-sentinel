import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { SocketService } from '../../../core/services/socket.service';
import { ReviewsService } from '../reviews.service';

/** Strip ANSI escape codes for plain-text display in a <pre> block. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

@Component({
  selector: 'app-ai-review-terminal-panel',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './ai-review-terminal-panel.html',
  styleUrl: './ai-review-terminal-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiReviewTerminalPanel implements OnDestroy {
  private readonly socketService = inject(SocketService);
  private readonly reviewsService = inject(ReviewsService);

  readonly reviewId = input.required<string>();
  readonly prId = input.required<string>();
  readonly phaseChanged = output<string>();
  readonly completed = output<void>();

  readonly logText = signal('');
  readonly phase = signal<string>('CLONING');
  readonly cancelling = signal(false);

  private readonly logEl = viewChild<ElementRef<HTMLPreElement>>('logEl');
  private currentReviewId: string | null = null;

  constructor() {
    effect(() => {
      const id = this.reviewId();
      if (id && id !== this.currentReviewId) {
        this.attach(id);
      }
    });
  }

  private attach(reviewId: string): void {
    this.detach();
    this.currentReviewId = reviewId;
    this.logText.set('');

    const socket = this.socketService.acquire();
    this.socketService.joinReview(reviewId);

    socket.on('review:phase', this.onPhase);
    socket.on('review:output', this.onOutput);
    socket.on('review:complete', this.onComplete);
    socket.on('review:failed', this.onComplete);
    socket.on('review:cancelled', this.onComplete);

    // Replay buffered output (covers reconnects / late mount)
    void this.reviewsService.getTerminalLog(reviewId).then((log) => {
      if (log && this.logText().length === 0) this.appendLog(log);
    });
  }

  private detach(): void {
    if (!this.currentReviewId) return;
    const socket = this.socketService.acquire();
    socket.off('review:phase', this.onPhase);
    socket.off('review:output', this.onOutput);
    socket.off('review:complete', this.onComplete);
    socket.off('review:failed', this.onComplete);
    socket.off('review:cancelled', this.onComplete);
    this.socketService.leaveReview(this.currentReviewId);
    this.socketService.release();
    this.currentReviewId = null;
  }

  private readonly onPhase = (data: { reviewId: string; phase: string }) => {
    if (data.reviewId !== this.currentReviewId) return;
    this.phase.set(data.phase);
    this.phaseChanged.emit(data.phase);
  };

  private readonly onOutput = (chunk: string) => {
    this.appendLog(chunk);
  };

  private readonly onComplete = () => {
    this.completed.emit();
  };

  private appendLog(chunk: string): void {
    this.logText.update((prev) => prev + stripAnsi(chunk));
    queueMicrotask(() => {
      const el = this.logEl()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async cancel(): Promise<void> {
    const id = this.currentReviewId;
    if (!id) return;
    this.cancelling.set(true);
    try {
      await this.reviewsService.cancel(id);
    } finally {
      this.cancelling.set(false);
    }
  }

  ngOnDestroy(): void {
    this.detach();
  }
}
