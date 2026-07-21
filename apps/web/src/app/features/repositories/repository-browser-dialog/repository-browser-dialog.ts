import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import type { GheConnectionDto, GheRepoItem } from '../../../core/models/dto';
import { ConnectionsService } from '../../connections/connections.service';
import { ReposService } from '../repos.service';

@Component({
  selector: 'app-repository-browser-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    TranslocoModule,
  ],
  templateUrl: './repository-browser-dialog.html',
  styleUrl: './repository-browser-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryBrowserDialog {
  private readonly connectionsService = inject(ConnectionsService);
  private readonly reposService = inject(ReposService);
  private readonly dialogRef = inject(MatDialogRef<RepositoryBrowserDialog>);
  private readonly transloco = inject(TranslocoService);

  readonly connections = signal<GheConnectionDto[]>([]);
  readonly selectedConnectionId = signal<string>('');
  readonly search = signal('');
  readonly repos = signal<GheRepoItem[]>([]);
  readonly selected = signal<Set<string>>(new Set());
  readonly loading = signal(false);
  readonly watching = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.loadConnections();
  }

  private async loadConnections(): Promise<void> {
    const conns = await this.connectionsService.list();
    this.connections.set(conns);
    if (conns.length > 0) {
      this.selectedConnectionId.set(conns[0].id);
      await this.loadRepos();
    }
  }

  async onConnectionChange(id: string): Promise<void> {
    this.selectedConnectionId.set(id);
    this.selected.set(new Set());
    await this.loadRepos();
  }

  async loadRepos(): Promise<void> {
    const connId = this.selectedConnectionId();
    if (!connId) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.reposService.browse(connId, 1, this.search() || undefined);
      this.repos.set(result.repos);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : this.transloco.translate('repositories.browserDialog.browseFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  toggle(fullName: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }

  async watchSelected(): Promise<void> {
    const connId = this.selectedConnectionId();
    const chosen = this.repos().filter((r) => this.selected().has(r.fullName));
    if (!connId || chosen.length === 0) return;

    this.watching.set(true);
    this.error.set(null);
    try {
      await this.reposService.watch(
        connId,
        chosen.map((r) => ({ owner: r.owner, name: r.name, fullName: r.fullName }))
      );
      this.dialogRef.close(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : this.transloco.translate('repositories.browserDialog.watchFailed'));
    } finally {
      this.watching.set(false);
    }
  }
}
