/** Typed error carrying an HTTP status code — thrown by services, caught by route handlers. */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409 | 429 | 500 = 500
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
