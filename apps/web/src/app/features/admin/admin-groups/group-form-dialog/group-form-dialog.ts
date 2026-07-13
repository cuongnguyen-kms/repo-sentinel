import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { AdminGroupDto } from '../../../../core/models/dto';
import { AdminGroupsService } from '../admin-groups.service';

@Component({
  selector: 'app-group-form-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule],
  templateUrl: './group-form-dialog.html',
  styleUrl: './group-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupFormDialog {
  private readonly groupsService = inject(AdminGroupsService);
  private readonly dialogRef = inject(MatDialogRef<GroupFormDialog>);
  readonly data: AdminGroupDto | null = inject(MAT_DIALOG_DATA, { optional: true }) ?? null;

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
        await this.groupsService.update(this.data!.id, input);
      } else {
        await this.groupsService.create(input);
      }
      this.dialogRef.close(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save group');
    } finally {
      this.saving.set(false);
    }
  }
}
