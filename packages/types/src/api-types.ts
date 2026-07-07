/**
 * Generic API response wrappers used across all endpoints.
 */

export interface ApiResponse<T> {
  data: T;
  success: true;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  success: true;
}

export interface ApiError {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

export type ApiResult<T> = ApiResponse<T> | ApiError;
