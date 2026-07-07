import { HttpErrorResponse } from '@angular/common/http';

/** Extract a human-readable message from an API error response `{ success: false, error: string }`. */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { error?: string } | undefined;
    return body?.error ?? err.message ?? fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
