import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { AdminGroupDto, AdminRoleDto } from '../../../../core/models/dto';
import { AdminGroupsService } from '../admin-groups.service';
import { AdminRolesService } from '../../admin-roles/admin-roles.service';

@Component({
  selector: 'app-group-roles-dialog',
  standalone: true,
  imports: [MatButtonModule, MatCheckboxModule, MatDialogModule, MatListModule, MatProgressSpinnerModule],
  templateUrl: './group-roles-dialog.html',
  styleUrl: './group-roles-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupRolesDialog {
  private readonly groupsService = inject(AdminGroupsService);
  private readonly rolesService = inject(AdminRolesService);
  private readonly dialogRef = inject(MatDialogRef<GroupRolesDialog>);
  readonly group: AdminGroupDto = inject(MAT_DIALOG_DATA);

  readonly allRoles = signal<AdminRoleDto[]>([]);
  readonly selectedRoleIds = signal<Set<string>>(new Set(this.group.roles.map((r) => r.id)));
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.loadRoles();
  }

  private async loadRoles(): Promise<void> {
    this.loading.set(true);
    try {
      this.allRoles.set(await this.rolesService.list());
    } finally {
      this.loading.set(false);
    }
  }

  toggle(id: string): void {
    this.selectedRoleIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.groupsService.setRoles(this.group.id, [...this.selectedRoleIds()]);
      this.dialogRef.close(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to update roles');
    } finally {
      this.saving.set(false);
    }
  }
}
