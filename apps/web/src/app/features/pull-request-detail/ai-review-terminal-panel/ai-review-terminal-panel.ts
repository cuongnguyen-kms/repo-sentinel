import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, afterNextRender, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { SocketService } from '../../../core/services/socket.service';
import { ReviewsService } from '../reviews.service';

/** Subset of the Claude CLI `stream-json` NDJSON event shapes carried by "review:stream-event". */
type ClaudeStreamEvent =
  | { type: 'stream_event'; event: { delta?: { type: string; text?: string } } }
  | { type: 'assistant'; message: { content: Array<{ type: string }> } }
  | { type: 'result'; total_cost_usd: number; duration_ms: number }
  | { type: 'system' };

@Component({
  selector: 'app-ai-review-terminal-panel',
  standalone: true,
  imports: [DecimalPipe, MatButtonModule, MatIconModule],
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

  readonly phase = signal<string>('CLONING');
  readonly cancelling = signal(false);

  readonly tokenCount = signal(0);
  readonly costUsd = signal<number | null>(null);
  readonly durationMs = signal<number | null>(null);
  readonly isThinking = signal(false);

  /** "Thinking…"/"Writing…" while the review is actively streaming, else null. */
  readonly thinkingLabel = computed(() => {
    if (this.phase() !== 'REVIEWING') return null;
    return this.isThinking() ? 'Thinking…' : 'Writing…';
  });

  private readonly containerEl = viewChild<ElementRef<HTMLDivElement>>('terminalContainer');

  private terminal: Terminal | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private currentReviewId: string | null = null;

  constructor() {
    // The xterm container isn't in the DOM until after the first render.
    afterNextRender(() => {
      this.createTerminal();
      const id = this.reviewId();
      if (id) this.attach(id);
    });

    effect(() => {
      const id = this.reviewId();
      if (id && id !== this.currentReviewId && this.terminal) {
        this.attach(id);
      }
    });
  }

  private createTerminal(): void {
    const container = this.containerEl()?.nativeElement;
    if (!container) return;

    const terminal = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      fontSize: 13,
      fontFamily: "'Roboto Mono', monospace",
      theme: { background: '#111111', foreground: '#d4d4d4' },
      scrollback: 10_000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    // Defer initial fit until the container has its final layout size.
    setTimeout(() => fitAddon.fit(), 0);

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(container);

    this.terminal = terminal;
    this.resizeObserver = resizeObserver;
  }

  private attach(reviewId: string): void {
    this.detachSocket();
    this.currentReviewId = reviewId;
    this.terminal?.reset();
    this.tokenCount.set(0);
    this.costUsd.set(null);
    this.durationMs.set(null);
    this.isThinking.set(false);

    const socket = this.socketService.acquire();
    this.socketService.joinReview(reviewId);

    socket.on('review:phase', this.onPhase);
    socket.on('review:output', this.onOutput);
    socket.on('review:stream-event', this.onStreamEvent);
    socket.on('review:complete', this.onComplete);
    socket.on('review:failed', this.onComplete);
    socket.on('review:cancelled', this.onComplete);

    // Replay buffered output (covers reconnects / late mount)
    void this.reviewsService.getTerminalLog(reviewId).then((log) => {
      if (log) this.terminal?.write(log);
    });
  }

  private detachSocket(): void {
    if (!this.currentReviewId) return;
    const socket = this.socketService.acquire();
    socket.off('review:phase', this.onPhase);
    socket.off('review:output', this.onOutput);
    socket.off('review:stream-event', this.onStreamEvent);
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
    this.terminal?.write(chunk);
  };

  /** Tracks token count, cost, duration, and thinking/writing state from the raw CLI event stream. */
  private readonly onStreamEvent = (event: ClaudeStreamEvent) => {
    if (event.type === 'stream_event') {
      const delta = event.event?.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        this.tokenCount.update((n) => n + 1);
      }
    } else if (event.type === 'assistant') {
      const hasThinking = event.message.content.some((b) => b.type === 'thinking');
      const hasText = event.message.content.some((b) => b.type === 'text');
      if (hasThinking) this.isThinking.set(true);
      if (hasText) this.isThinking.set(false);
    } else if (event.type === 'result') {
      this.costUsd.set(event.total_cost_usd);
      this.durationMs.set(event.duration_ms);
      this.isThinking.set(false);
    }
  };

  private readonly onComplete = () => {
    this.completed.emit();
  };

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
    this.detachSocket();
    this.resizeObserver?.disconnect();
    this.terminal?.dispose();
  }
}
