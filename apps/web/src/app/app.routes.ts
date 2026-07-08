import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { permissionGuard } from './core/guards/permission.guard';
import { Action, Resource } from './core/models/enums';
import { LoginPage } from './features/auth/login-page/login-page';

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/app-shell/app-shell').then((m) => m.AppShell),
    children: [
      {
        path: '',
        canActivate: [permissionGuard],
        data: { resource: Resource.Dashboard, action: Action.Read },
        loadComponent: () =>
          import('./features/dashboard/dashboard-page/dashboard-page').then((m) => m.DashboardPage),
      },
      {
        path: 'connections',
        canActivate: [permissionGuard],
        data: { resource: Resource.Connections, action: Action.Read },
        loadComponent: () =>
          import('./features/connections/connections-page/connections-page').then((m) => m.ConnectionsPage),
      },
      {
        path: 'repositories',
        canActivate: [permissionGuard],
        data: { resource: Resource.Repos, action: Action.Read },
        loadComponent: () =>
          import('./features/repositories/repositories-page/repositories-page').then((m) => m.RepositoriesPage),
      },
      {
        path: 'pull-requests',
        canActivate: [permissionGuard],
        data: { resource: Resource.PullRequests, action: Action.Read },
        loadComponent: () =>
          import('./features/pull-requests/pull-requests-page/pull-requests-page').then((m) => m.PullRequestsPage),
      },
      {
        path: 'pull-requests/:id',
        canActivate: [permissionGuard],
        data: { resource: Resource.PullRequests, action: Action.Read },
        loadComponent: () =>
          import('./features/pull-request-detail/pull-request-detail-page/pull-request-detail-page').then(
            (m) => m.PullRequestDetailPage
          ),
      },
      {
        path: 'jira',
        canActivate: [permissionGuard],
        data: { resource: Resource.Atlassian, action: Action.Read },
        loadComponent: () => import('./features/jira/jira-page/jira-page').then((m) => m.JiraPage),
      },
      {
        path: 'settings',
        canActivate: [permissionGuard],
        data: { resource: Resource.Settings, action: Action.Read },
        loadComponent: () => import('./features/settings/settings-page/settings-page').then((m) => m.SettingsPage),
      },
    ],
  },
];
