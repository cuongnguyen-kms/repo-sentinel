import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { AtlassianConnectionsService } from '../atlassian-connections.service';

@Component({
  selector: 'app-atlassian-connection-form-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    TranslocoModule,
  ],
  templateUrl: './atlassian-connection-form-dialog.html',
  styleUrl: './atlassian-connection-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AtlassianConnectionFormDialog {
  private readonly atlassianConnectionsService = inject(AtlassianConnectionsService);
  private readonly dialogRef = inject(MatDialogRef<AtlassianConnectionFormDialog>);
  private readonly transloco = inject(TranslocoService);

  readonly hostname = signal('');
  readonly email = signal('');
  readonly apiToken = signal('');
  readonly boardId = signal('');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  cancel(): void {
    this.dialogRef.close();
  }

  async submit(): Promise<void> {
    if (!this.hostname() || !this.email() || !this.apiToken()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const saved = await this.atlassianConnectionsService.replace({
        hostname: this.hostname(),
        email: this.email(),
        apiToken: this.apiToken(),
        boardId: this.boardId() ? Number(this.boardId()) : null,
      });
      this.dialogRef.close(saved);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : this.transloco.translate('connections.atlassianForm.saveError'));
    } finally {
      this.saving.set(false);
    }
  }
}
