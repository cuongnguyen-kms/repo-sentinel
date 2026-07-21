import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { Action, Resource } from '../../../../core/models/enums';
import { PermissionsService } from '../../../../core/services/permissions.service';
import { extractErrorMessage } from '../../../../core/utils/http-error';
import type { AdminGroupDto } from '../../../../core/models/dto';
import { AdminGroupsService } from '../admin-groups.service';
import { GroupFormDialog } from '../group-form-dialog/group-form-dialog';
import { GroupRolesDialog } from '../group-roles-dialog/group-roles-dialog';

@Component({
  selector: 'app-admin-groups-page',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
    TranslocoModule,
  ],
  templateUrl: './admin-groups-page.html',
  styleUrl: './admin-groups-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminGroupsPage {
  private readonly groupsService = inject(AdminGroupsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly permissions = inject(PermissionsService);
  private readonly transloco = inject(TranslocoService);

  readonly loading = signal(true);
  readonly groups = signal<AdminGroupDto[]>([]);
  readonly busyId = signal<string | null>(null);

  readonly canCreate = this.permissions.can(Resource.Groups, Action.Create);
  readonly canUpdate = this.permissions.can(Resource.Groups, Action.Update);
  readonly canDelete = this.permissions.can(Resource.Groups, Action.Delete);

  readonly columns = ['name', 'memberCount', 'roles', 'actions'];

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.groups.set(await this.groupsService.list());
    } finally {
      this.loading.set(false);
    }
  }

  openCreateDialog(): void {
    const ref = this.dialog.open(GroupFormDialog, { width: '420px' });
    ref.afterClosed().subscribe((saved) => {
      if (saved) void this.load();
    });
  }

  openEditDialog(group: AdminGroupDto): void {
    const ref = this.dialog.open(GroupFormDialog, { width: '420px', data: group });
    ref.afterClosed().subscribe((saved) => {
      if (saved) void this.load();
    });
  }

  openRolesDialog(group: AdminGroupDto): void {
    const ref = this.dialog.open(GroupRolesDialog, { width: '420px', data: group });
    ref.afterClosed().subscribe((saved) => {
      if (saved) void this.load();
    });
  }

  async remove(group: AdminGroupDto): Promise<void> {
    if (!window.confirm(this.transloco.translate('admin.groups.confirmDelete', { name: group.name }))) return;

    this.busyId.set(group.id);
    try {
      await this.groupsService.remove(group.id);
    } catch (err) {
      const message = extractErrorMessage(err, this.transloco.translate('admin.groups.deleteFailed'));
      if (/member\(s\)/i.test(message) && window.confirm(this.transloco.translate('admin.groups.confirmDeleteAnyway', { message }))) {
        try {
          await this.groupsService.remove(group.id, true);
        } catch (retryErr) {
          this.snackBar.open(extractErrorMessage(retryErr, this.transloco.translate('admin.groups.deleteFailed')), 'Dismiss', { duration: 5000 });
        }
      } else {
        this.snackBar.open(message, 'Dismiss', { duration: 5000 });
      }
    } finally {
      this.busyId.set(null);
      await this.load();
    }
  }
}
