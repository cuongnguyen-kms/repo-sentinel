import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Action, Resource } from '../../../core/models/enums';
import { PermissionsService } from '../../../core/services/permissions.service';
import type { WatchedRepoDto } from '../../../core/models/dto';
import { ReposService } from '../repos.service';
import { RepositoryBrowserDialog } from '../repository-browser-dialog/repository-browser-dialog';
import { RepoConfigDialog } from '../repo-config-dialog/repo-config-dialog';

@Component({
  selector: 'app-repositories-page',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './repositories-page.html',
  styleUrl: './repositories-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoriesPage {
  private readonly reposService = inject(ReposService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly permissions = inject(PermissionsService);

  readonly loading = signal(true);
  readonly repos = signal<WatchedRepoDto[]>([]);
  readonly polling = signal<string | null>(null);

  readonly canCreate = this.permissions.can(Resource.Repos, Action.Create);
  readonly canUpdate = this.permissions.can(Resource.Repos, Action.Update);
  readonly canDelete = this.permissions.can(Resource.Repos, Action.Delete);

  readonly columns = ['fullName', 'status', 'pollingInterval', 'lastPolledAt', 'openPrCount', 'actions'];

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.repos.set(await this.reposService.list());
    } finally {
      this.loading.set(false);
    }
  }

  openBrowseDialog(): void {
    const ref = this.dialog.open(RepositoryBrowserDialog, { width: '520px' });
    ref.afterClosed().subscribe((watched) => {
      if (watched) void this.load();
    });
  }

  openConfigDialog(repo: WatchedRepoDto): void {
    const ref = this.dialog.open(RepoConfigDialog, { width: '760px', maxWidth: '95vw', data: repo });
    ref.afterClosed().subscribe((updated) => {
      if (updated) void this.load();
    });
  }

  async unwatch(id: string): Promise<void> {
    await this.reposService.unwatch(id);
    await this.load();
  }

  async poll(id: string): Promise<void> {
    this.polling.set(id);
    try {
      await this.reposService.poll(id, true);
      this.snackBar.open('Poll queued', 'Dismiss', { duration: 3000 });
      setTimeout(() => void this.load(), 3000);
    } finally {
      this.polling.set(null);
    }
  }
}
