import { Injectable } from '@angular/core';
import { io, type Socket } from 'socket.io-client';

/** Singleton Socket.IO connection — mirrors the original app's ref-counted use-socket hook. */
@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket | null = null;
  private refCount = 0;

  /** Acquire the shared socket connection. Call release() when the consumer unmounts. */
  acquire(): Socket {
    if (!this.socket) {
      this.socket = io({ transports: ['websocket'], withCredentials: true });
    }
    this.refCount++;
    return this.socket;
  }

  release(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0 && this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  joinReview(reviewId: string): void {
    this.socket?.emit('review:join', { reviewId });
  }

  leaveReview(reviewId: string): void {
    this.socket?.emit('review:leave', { reviewId });
  }
}
