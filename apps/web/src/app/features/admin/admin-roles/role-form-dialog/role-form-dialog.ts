import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import type { AdminRoleDto } from '../../../../core/models/dto';
import { AdminRolesService } from '../admin-roles.service';

@Component({
  selector: 'app-role-form-dialog',
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
  templateUrl: './role-form-dialog.html',
  styleUrl: './role-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoleFormDialog {
  private readonly rolesService = inject(AdminRolesService);
  private readonly dialogRef = inject(MatDialogRef<RoleFormDialog>);
  private readonly transloco = inject(TranslocoService);
  readonly data: AdminRoleDto | null = inject(MAT_DIALOG_DATA, { optional: true }) ?? null;

  readonly isEdit = computed(() => this.data !== null);

  readonly name = signal(this.data?.name ?? '');
  readonly description = signal(this.data?.description ?? '');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  cancel(): void {
    this.dialogRef.close();
  }

  async save(): Promise<void> {
    if (!this.name()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const input = { name: this.name(), description: this.description() || undefined };
      if (this.isEdit()) {
        await this.rolesService.update(this.data!.id, input);
      } else {
        await this.rolesService.create(input);
      }
      this.dialogRef.close(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : this.transloco.translate('admin.roles.form.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }
}
