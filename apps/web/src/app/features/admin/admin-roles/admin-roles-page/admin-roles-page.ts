import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Action, Resource } from '../../../../core/models/enums';
import { PermissionsService } from '../../../../core/services/permissions.service';
import { extractErrorMessage } from '../../../../core/utils/http-error';
import type { AdminRoleDto } from '../../../../core/models/dto';
import { AdminRolesService } from '../admin-roles.service';
import { RoleFormDialog } from '../role-form-dialog/role-form-dialog';
import { RolePermissionsDialog } from '../role-permissions-dialog/role-permissions-dialog';

@Component({
  selector: 'app-admin-roles-page',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './admin-roles-page.html',
  styleUrl: './admin-roles-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRolesPage {
  private readonly rolesService = inject(AdminRolesService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly permissions = inject(PermissionsService);

  readonly loading = signal(true);
  readonly roles = signal<AdminRoleDto[]>([]);
  readonly busyId = signal<string | null>(null);

  readonly canCreate = this.permissions.can(Resource.Roles, Action.Create);
  readonly canUpdate = this.permissions.can(Resource.Roles, Action.Update);
  readonly canDelete = this.permissions.can(Resource.Roles, Action.Delete);

  readonly columns = ['name', 'permissionCount', 'groupCount', 'actions'];

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.roles.set(await this.rolesService.list());
    } finally {
      this.loading.set(false);
    }
  }

  openCreateDialog(): void {
    const ref = this.dialog.open(RoleFormDialog, { width: '420px' });
    ref.afterClosed().subscribe((saved) => {
      if (saved) void this.load();
    });
  }

  openEditDialog(role: AdminRoleDto): void {
    const ref = this.dialog.open(RoleFormDialog, { width: '420px', data: role });
    ref.afterClosed().subscribe((saved) => {
      if (saved) void this.load();
    });
  }

  openPermissionsDialog(role: AdminRoleDto): void {
    const ref = this.dialog.open(RolePermissionsDialog, { width: '640px', data: role });
    ref.afterClosed().subscribe((saved) => {
      if (saved) void this.load();
    });
  }

  async remove(role: AdminRoleDto): Promise<void> {
    if (!window.confirm(`Delete role "${role.name}"?`)) return;

    this.busyId.set(role.id);
    try {
      await this.rolesService.remove(role.id);
    } catch (err) {
      const message = extractErrorMessage(err, 'Failed to delete role');
      if (/group\(s\)/i.test(message) && window.confirm(`${message}\n\nDelete anyway?`)) {
        try {
          await this.rolesService.remove(role.id, true);
        } catch (retryErr) {
          this.snackBar.open(extractErrorMessage(retryErr, 'Failed to delete role'), 'Dismiss', { duration: 5000 });
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
