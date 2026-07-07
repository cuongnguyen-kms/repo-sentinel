import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import type { NotificationDto } from '../models/dto';
import { SocketService } from './socket.service';

interface NotificationsResponse {
  success: true;
  data: NotificationDto[];
  total: number;
}

@Injectable({ providedIn: 'root' })
export class NotificationsService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly socketService = inject(SocketService);
  private readonly snackBar = inject(MatSnackBar);

  readonly unreadCount = signal(0);
  readonly notifications = signal<NotificationDto[]>([]);

  private listening = false;

  private readonly onNotificationNew = (data?: { title?: string }) => {
    void this.refreshUnreadCount();
    if (data?.title) {
      this.snackBar.open(data.title, 'Dismiss', { duration: 5000 });
    }
  };

  private readonly onPrNew = (data: { pr?: { title?: string } }) => {
    if (data.pr?.title) this.snackBar.open(`New PR: ${data.pr.title}`, 'Dismiss', { duration: 5000 });
  };

  private readonly onReviewComplete = (data: { summary?: string; score?: number | null }) => {
    this.snackBar.open(`Review complete — score ${data.score ?? 'n/a'}`, 'Dismiss', { duration: 5000 });
  };

  /** Start listening for realtime notification events. Safe to call multiple times. */
  startListening(): void {
    if (this.listening) return;
    this.listening = true;
    const socket = this.socketService.acquire();
    socket.on('notification:new', this.onNotificationNew);
    socket.on('pr:new', this.onPrNew);
    socket.on('review:complete', this.onReviewComplete);
    void this.refreshUnreadCount();
  }

  stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    const socket = this.socketService.acquire();
    socket.off('notification:new', this.onNotificationNew);
    socket.off('pr:new', this.onPrNew);
    socket.off('review:complete', this.onReviewComplete);
    this.socketService.release();
  }

  async refreshUnreadCount(): Promise<void> {
    const res = await firstValueFrom(
      this.http.get<{ success: true; data: { count: number } }>('/api/notifications/unread-count')
    );
    this.unreadCount.set(res.data.count);
  }

  async loadRecent(limit = 10): Promise<void> {
    const res = await firstValueFrom(this.http.get<NotificationsResponse>(`/api/notifications?limit=${limit}`));
    this.notifications.set(res.data);
  }

  async markAllAsRead(): Promise<void> {
    await firstValueFrom(this.http.patch('/api/notifications/read-all', {}));
    await this.refreshUnreadCount();
    await this.loadRecent();
  }

  ngOnDestroy(): void {
    this.stopListening();
  }
}
