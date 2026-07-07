import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { extractErrorMessage } from '../../../core/utils/http-error';
import { ReviewsService } from '../reviews.service';

@Component({
  selector: 'app-ai-review-trigger-button',
  standalone: true,
  imports: [MatButtonModule, MatProgressSpinnerModule],
  template: `
    <button mat-flat-button color="primary" (click)="trigger()" [disabled]="isActive() || pending()">
      @if (pending()) {
        <mat-spinner diameter="18"></mat-spinner>
      } @else {
        {{ label() }}
      }
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiReviewTriggerButton {
  private readonly reviewsService = inject(ReviewsService);
  private readonly snackBar = inject(MatSnackBar);

  readonly prId = input.required<string>();
  readonly isActive = input(false);
  readonly label = input('Run AI Review');
  readonly triggered = output<string>();

  readonly pending = signal(false);

  async trigger(): Promise<void> {
    this.pending.set(true);
    try {
      const result = await this.reviewsService.trigger(this.prId());
      this.triggered.emit(result.id);
    } catch (err) {
      const message = extractErrorMessage(err, 'Failed to trigger review');
      this.snackBar.open(message, 'Dismiss', { duration: 5000 });
    } finally {
      this.pending.set(false);
    }
  }
}
