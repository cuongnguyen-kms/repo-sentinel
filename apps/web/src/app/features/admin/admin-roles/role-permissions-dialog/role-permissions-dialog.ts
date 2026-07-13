import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { AdminRoleDto, PermissionDto } from '../../../../core/models/dto';
import { AdminPermissionsService } from '../../admin-permissions/admin-permissions.service';
import { AdminRolesService } from '../admin-roles.service';

const ACTIONS = ['create', 'read', 'update', 'delete'] as const;

interface PermissionRow {
  resource: string;
  cells: Array<{ action: string; permissionId: string | null }>;
}

@Component({
  selector: 'app-role-permissions-dialog',
  standalone: true,
  imports: [MatButtonModule, MatCheckboxModule, MatDialogModule, MatProgressSpinnerModule],
  templateUrl: './role-permissions-dialog.html',
  styleUrl: './role-permissions-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolePermissionsDialog {
  private readonly rolesService = inject(AdminRolesService);
  private readonly permissionsService = inject(AdminPermissionsService);
  private readonly dialogRef = inject(MatDialogRef<RolePermissionsDialog>);
  readonly role: AdminRoleDto = inject(MAT_DIALOG_DATA);

  readonly isAdminRole = computed(() => this.role.name === 'Admin');
  readonly actions = ACTIONS;

  readonly allPermissions = signal<PermissionDto[]>([]);
  readonly selectedIds = signal<Set<string>>(new Set(this.role.permissionIds));
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly rows = computed<PermissionRow[]>(() => {
    const byResource = new Map<string, Map<string, string>>();
    for (const p of this.allPermissions()) {
      if (!byResource.has(p.resource)) byResource.set(p.resource, new Map());
      byResource.get(p.resource)!.set(p.action, p.id);
    }
    return [...byResource.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([resource, actionMap]) => ({
        resource,
        cells: ACTIONS.map((action) => ({ action, permissionId: actionMap.get(action) ?? null })),
      }));
  });

  constructor() {
    void this.loadPermissions();
  }

  private async loadPermissions(): Promise<void> {
    this.loading.set(true);
    try {
      this.allPermissions.set(await this.permissionsService.list());
    } finally {
      this.loading.set(false);
    }
  }

  toggle(permissionId: string | null): void {
    if (this.isAdminRole() || !permissionId) return;
    this.selectedIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return next;
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }

  async save(): Promise<void> {
    if (this.isAdminRole()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.rolesService.setPermissions(this.role.id, [...this.selectedIds()]);
      this.dialogRef.close(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to update permissions');
    } finally {
      this.saving.set(false);
    }
  }
}
