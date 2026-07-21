import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { ConnectionsService } from '../connections.service';

@Component({
  selector: 'app-connection-form-dialog',
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
  templateUrl: './connection-form-dialog.html',
  styleUrl: './connection-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionFormDialog {
  private readonly connectionsService = inject(ConnectionsService);
  private readonly dialogRef = inject(MatDialogRef<ConnectionFormDialog>);
  private readonly transloco = inject(TranslocoService);

  readonly hostname = signal('');
  readonly username = signal('');
  readonly token = signal('');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  cancel(): void {
    this.dialogRef.close();
  }

  async submit(): Promise<void> {
    if (!this.hostname() || !this.username() || !this.token()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const created = await this.connectionsService.create({
        hostname: this.hostname(),
        username: this.username(),
        token: this.token(),
      });
      this.dialogRef.close(created);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : this.transloco.translate('connections.form.createError'));
    } finally {
      this.saving.set(false);
    }
  }
}
