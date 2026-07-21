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
import { AuthService } from '../../../../core/services/auth.service';
import { PermissionsService } from '../../../../core/services/permissions.service';
import { extractErrorMessage } from '../../../../core/utils/http-error';
import type { AdminUserDto } from '../../../../core/models/dto';
import { AdminUsersService } from '../admin-users.service';
import { UserFormDialog } from '../user-form-dialog/user-form-dialog';

@Component({
  selector: 'app-admin-users-page',
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
  templateUrl: './admin-users-page.html',
  styleUrl: './admin-users-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsersPage {
  private readonly usersService = inject(AdminUsersService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly permissions = inject(PermissionsService);
  private readonly auth = inject(AuthService);
  private readonly transloco = inject(TranslocoService);

  readonly loading = signal(true);
  readonly users = signal<AdminUserDto[]>([]);
  readonly busyId = signal<string | null>(null);

  readonly canCreate = this.permissions.can(Resource.Users, Action.Create);
  readonly canUpdate = this.permissions.can(Resource.Users, Action.Update);
  readonly canDelete = this.permissions.can(Resource.Users, Action.Delete);

  readonly columns = ['name', 'role', 'banned', 'groups', 'actions'];

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.users.set(await this.usersService.list());
    } finally {
      this.loading.set(false);
    }
  }

  isSelf(user: AdminUserDto): boolean {
    return this.auth.user()?.id === user.id;
  }

  openCreateDialog(): void {
    const ref = this.dialog.open(UserFormDialog, { width: '480px' });
    ref.afterClosed().subscribe((saved) => {
      if (saved) void this.load();
    });
  }

  openEditDialog(user: AdminUserDto): void {
    const ref = this.dialog.open(UserFormDialog, { width: '480px', data: user });
    ref.afterClosed().subscribe((saved) => {
      if (saved) void this.load();
    });
  }

  async toggleBan(user: AdminUserDto): Promise<void> {
    this.busyId.set(user.id);
    try {
      if (user.banned) {
        await this.usersService.update(user.id, { banned: false });
      } else {
        const reason = window.prompt(this.transloco.translate('admin.users.banReasonPrompt')) ?? undefined;
        await this.usersService.update(user.id, { banned: true, banReason: reason || undefined });
      }
      await this.load();
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, this.transloco.translate('admin.users.banFailed')), 'Dismiss', { duration: 5000 });
    } finally {
      this.busyId.set(null);
    }
  }

  async remove(user: AdminUserDto): Promise<void> {
    if (this.isSelf(user)) return;
    if (!window.confirm(this.transloco.translate('admin.users.confirmDelete', { name: user.name }))) return;

    this.busyId.set(user.id);
    try {
      await this.usersService.remove(user.id);
      await this.load();
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, this.transloco.translate('admin.users.deleteFailed')), 'Dismiss', { duration: 5000 });
    } finally {
      this.busyId.set(null);
    }
  }
}
