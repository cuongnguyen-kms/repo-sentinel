import type { NotificationType, NotificationStatus } from "./enums.js";

export interface NotificationDto {
  id: string;
  type: NotificationType;
  status: NotificationStatus;
  title: string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}
