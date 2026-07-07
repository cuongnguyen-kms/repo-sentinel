import type { HttpInterceptorFn } from '@angular/common/http';

/** Ensures session cookies are sent on every API request (needed when web/api are on different origins in production). */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req.clone({ withCredentials: true }));
};
