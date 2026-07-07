import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Action, Resource } from '../../../core/models/enums';
import { PermissionsService } from '../../../core/services/permissions.service';
import type { GheConnectionDto } from '../../../core/models/dto';
import { ConnectionsService } from '../connections.service';
import { ConnectionFormDialog } from '../connection-form-dialog/connection-form-dialog';

@Component({
  selector: 'app-connections-page',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './connections-page.html',
  styleUrl: './connections-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionsPage {
  private readonly connectionsService = inject(ConnectionsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly permissions = inject(PermissionsService);

  readonly loading = signal(true);
  readonly connections = signal<GheConnectionDto[]>([]);
  readonly testing = signal<string | null>(null);
  readonly testResults = signal<Record<string, string>>({});

  readonly canCreate = this.permissions.can(Resource.Connections, Action.Create);
  readonly canDelete = this.permissions.can(Resource.Connections, Action.Delete);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.connections.set(await this.connectionsService.list());
    } finally {
      this.loading.set(false);
    }
  }

  openAddDialog(): void {
    const ref = this.dialog.open(ConnectionFormDialog, { width: '420px' });
    ref.afterClosed().subscribe((created) => {
      if (created) void this.load();
    });
  }

  async remove(id: string): Promise<void> {
    await this.connectionsService.remove(id);
    await this.load();
  }

  async test(id: string): Promise<void> {
    this.testing.set(id);
    try {
      const result = await this.connectionsService.test(id);
      this.testResults.update((r) => ({ ...r, [id]: result.success ? `✓ ${result.message}` : `✗ ${result.message}` }));
      this.snackBar.open(result.message, 'Dismiss', { duration: 4000 });
    } finally {
      this.testing.set(null);
    }
  }
}
