import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { Action, Resource } from '../../core/models/enums';
import { AuthService } from '../../core/services/auth.service';
import { PermissionsService } from '../../core/services/permissions.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  resource: Resource;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: 'dashboard', resource: Resource.Dashboard },
  { path: '/connections', label: 'Connections', icon: 'link', resource: Resource.Connections },
  { path: '/repositories', label: 'Repositories', icon: 'source', resource: Resource.Repos },
  { path: '/pull-requests', label: 'Pull Requests', icon: 'merge', resource: Resource.PullRequests },
  { path: '/jira', label: 'JIRA', icon: 'assignment', resource: Resource.Atlassian },
  { path: '/report', label: 'Report', icon: 'bar_chart', resource: Resource.PrComments },
  { path: '/settings', label: 'Settings', icon: 'settings', resource: Resource.Settings },
];

const ADMIN_NAV_ITEMS: NavItem[] = [
  { path: '/admin/users', label: 'Users', icon: 'group', resource: Resource.Users },
  { path: '/admin/groups', label: 'Groups', icon: 'groups', resource: Resource.Groups },
  { path: '/admin/roles', label: 'Roles', icon: 'admin_panel_settings', resource: Resource.Roles },
  { path: '/admin/permissions', label: 'Permissions', icon: 'key', resource: Resource.Permissions },
];

@Component({
  selector: 'app-sidebar-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, MatIconModule, MatListModule],
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
