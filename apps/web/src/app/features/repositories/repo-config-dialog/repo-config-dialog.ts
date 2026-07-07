import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { WatchedRepoDto } from '../../../core/models/dto';
import { ReposService } from '../repos.service';

@Component({
  selector: 'app-repo-config-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
  ],
  templateUrl: './repo-config-dialog.html',
  styleUrl: './repo-config-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepoConfigDialog {
  private readonly reposService = inject(ReposService);
  private readonly dialogRef = inject(MatDialogRef<RepoConfigDialog>);
  readonly repo: WatchedRepoDto = inject(MAT_DIALOG_DATA);

  readonly pollingInterval = signal(this.repo.pollingInterval);
  readonly isActive = signal(this.repo.isActive);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  cancel(): void {
    this.dialogRef.close();
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const updated = await this.reposService.updateConfig(this.repo.id, {
        pollingInterval: this.pollingInterval(),
        isActive: this.isActive(),
      });
      this.dialogRef.close(updated);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to update repo');
    } finally {
      this.saving.set(false);
    }
  }
}
