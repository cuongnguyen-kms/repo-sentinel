import { Injectable, inject } from '@angular/core';
import type { Action, Resource } from '../models/enums';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private readonly auth = inject(AuthService);

  /** True if the current user can perform `action` on `resource`. Admins bypass all checks. */
  can(resource: Resource, action: Action): boolean {
    if (this.auth.isAdmin()) return true;
    const required = `${resource}:${action}`;
    return this.auth.permissions().includes(required);
  }
}
