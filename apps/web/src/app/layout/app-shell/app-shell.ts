import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { SidebarNav } from '../sidebar-nav/sidebar-nav';
import { TopBar } from '../top-bar/top-bar';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, MatSidenavModule, SidebarNav, TopBar],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  private readonly auth = inject(AuthService);
  readonly sidenavOpened = signal(true);

  constructor() {
    void this.auth.initSession();
  }

  toggle(): void {
    this.sidenavOpened.update((v) => !v);
  }
}
