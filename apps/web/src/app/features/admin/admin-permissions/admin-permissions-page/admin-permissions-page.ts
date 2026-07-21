import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { TranslocoModule } from '@jsverse/transloco';
import type { PermissionDto } from '../../../../core/models/dto';
import { AdminPermissionsService } from '../admin-permissions.service';

@Component({
  selector: 'app-admin-permissions-page',
  standalone: true,
  imports: [MatProgressSpinnerModule, MatTableModule, TranslocoModule],
  templateUrl: './admin-permissions-page.html',
  styleUrl: './admin-permissions-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPermissionsPage {
  private readonly permissionsService = inject(AdminPermissionsService);

  readonly loading = signal(true);
  readonly permissions = signal<PermissionDto[]>([]);

  readonly columns = ['resource', 'action'];

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.permissions.set(await this.permissionsService.list());
    } finally {
      this.loading.set(false);
    }
  }
}
