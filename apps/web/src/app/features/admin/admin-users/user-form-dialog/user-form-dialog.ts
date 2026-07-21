import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import type { AdminGroupDto, AdminUserDto } from '../../../../core/models/dto';
import { AdminGroupsService } from '../../admin-groups/admin-groups.service';
import { AdminUsersService } from '../admin-users.service';

@Component({
  selector: 'app-user-form-dialog',
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
    TranslocoModule,
  ],
  templateUrl: './user-form-dialog.html',
  styleUrl: './user-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserFormDialog {
  private readonly usersService = inject(AdminUsersService);
  private readonly groupsService = inject(AdminGroupsService);
  private readonly dialogRef = inject(MatDialogRef<UserFormDialog>);
  private readonly transloco = inject(TranslocoService);
  readonly data: AdminUserDto | null = inject(MAT_DIALOG_DATA, { optional: true }) ?? null;

  readonly isEdit = computed(() => this.data !== null);

  readonly name = signal(this.data?.name ?? '');
  readonly email = signal(this.data?.email ?? '');
  readonly password = signal('');

  readonly allGroups = signal<AdminGroupDto[]>([]);
  readonly selectedGroupIds = signal<Set<string>>(new Set(this.data?.groups.map((g) => g.id) ?? []));

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.loadGroups();
  }

  private async loadGroups(): Promise<void> {
    this.allGroups.set(await this.groupsService.list());
  }

  toggleGroup(id: string): void {
    this.selectedGroupIds.update((prev) => {
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
    if (!this.name() || !this.email()) return;
    if (!this.isEdit() && this.password().length < 8) {
      this.error.set(this.transloco.translate('admin.users.form.passwordTooShort'));
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      const groupIds = [...this.selectedGroupIds()];
      if (this.isEdit()) {
        const user = this.data!;
        await this.usersService.update(user.id, { name: this.name(), email: this.email() });
        await this.usersService.setGroups(user.id, groupIds);
      } else {
        await this.usersService.create({ name: this.name(), email: this.email(), password: this.password(), groupIds });
      }
      this.dialogRef.close(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : this.transloco.translate('admin.users.form.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }
}
