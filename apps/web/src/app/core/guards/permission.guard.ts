import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import type { Action, Resource } from '../models/enums';
import { AuthService } from '../services/auth.service';
import { PermissionsService } from '../services/permissions.service';

/**
 * Generic permission guard — reads `resource`/`action` from route data.
 * Usage: `{ canActivate: [permissionGuard], data: { resource: Resource.Repos, action: Action.Read } }`
 */
export const permissionGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const permissions = inject(PermissionsService);
  const router = inject(Router);

  await auth.initSession();
  if (!auth.isAuthenticated()) return router.createUrlTree(['/login']);

  const resource = route.data['resource'] as Resource | undefined;
  const action = route.data['action'] as Action | undefined;
  if (!resource || !action) return true;

  if (permissions.can(resource, action)) return true;
  return router.createUrlTree(['/']);
};
