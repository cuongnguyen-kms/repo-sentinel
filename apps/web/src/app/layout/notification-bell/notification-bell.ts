import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { NotificationsService } from '../../core/services/notifications.service';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [DatePipe, MatBadgeModule, MatButtonModule, MatIconModule, MatMenuModule],
  templateUrl: './notification-bell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBell {
  readonly notificationsService = inject(NotificationsService);

  constructor() {
    this.notificationsService.startListening();
  }

  onMenuOpened(): void {
    void this.notificationsService.loadRecent();
  }

  markAllRead(): void {
    void this.notificationsService.markAllAsRead();
  }
}
