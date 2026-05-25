/**
 * Base class for all domain-level errors. Extend with a stable `code` so the
 * global filter can map to a deterministic API envelope.
 */
export class DomainError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, httpStatus = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id?: string) {
    super(
      `${resource.toUpperCase()}_NOT_FOUND`,
      id ? `${resource} ${id} not found` : `${resource} not found`,
      404,
    );
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    super(code, message, 401);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(code, message, 403);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, code = 'CONFLICT') {
    super(code, message, 409);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_FAILED', message, 422, details);
  }
}
