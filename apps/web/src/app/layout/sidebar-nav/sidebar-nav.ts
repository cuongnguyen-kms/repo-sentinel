import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { TranslocoModule } from '@jsverse/transloco';
import { Action, Resource } from '../../core/models/enums';
import { AuthService } from '../../core/services/auth.service';
import { PermissionsService } from '../../core/services/permissions.service';

interface NavItem {
  path: string;
  /** Translation key (sidebar.*), not display text — resolved via the `transloco` pipe in the template. */
  labelKey: string;
  icon: string;
  resource: Resource;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', labelKey: 'sidebar.dashboard', icon: 'dashboard', resource: Resource.Dashboard },
  { path: '/connections', labelKey: 'sidebar.connections', icon: 'link', resource: Resource.Connections },
  { path: '/repositories', labelKey: 'sidebar.repositories', icon: 'source', resource: Resource.Repos },
  { path: '/pull-requests', labelKey: 'sidebar.pullRequests', icon: 'merge', resource: Resource.PullRequests },
  { path: '/jira', labelKey: 'sidebar.jira', icon: 'assignment', resource: Resource.Atlassian },
  { path: '/report', labelKey: 'sidebar.report', icon: 'bar_chart', resource: Resource.PrComments },
  { path: '/settings', labelKey: 'sidebar.settings', icon: 'settings', resource: Resource.Settings },
];

const ADMIN_NAV_ITEMS: NavItem[] = [
  { path: '/admin/users', labelKey: 'sidebar.users', icon: 'group', resource: Resource.Users },
  { path: '/admin/groups', labelKey: 'sidebar.groups', icon: 'groups', resource: Resource.Groups },
  { path: '/admin/roles', labelKey: 'sidebar.roles', icon: 'admin_panel_settings', resource: Resource.Roles },
  { path: '/admin/permissions', labelKey: 'sidebar.permissions', icon: 'key', resource: Resource.Permissions },
];

@Component({
  selector: 'app-sidebar-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, MatIconModule, MatListModule, TranslocoModule],
  templateUrl: './sidebar-nav.html',
  styleUrl: './sidebar-nav.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarNav {
  private readonly permissions = inject(PermissionsService);
  private readonly auth = inject(AuthService);

  readonly items = computed(() =>
    NAV_ITEMS.filter((item) => this.permissions.can(item.resource, Action.Read))
  );

  readonly isAdmin = this.auth.isAdmin;

  readonly adminItems = computed(() => (this.isAdmin() ? ADMIN_NAV_ITEMS : []));
}
