export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} ${id} was not found`);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Not allowed") {
    super("FORBIDDEN", message);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super("CONFLICT", message);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super("VALIDATION", message);
  }
}

export class GmailAuthError extends DomainError {
  constructor(message = "Gmail authorization is invalid or revoked") {
    super("GMAIL_AUTH", message);
  }
}

export class GmailRateLimitError extends DomainError {
  readonly retryAfterMs: number;

  constructor(retryAfterMs = 1000, message = "Gmail rate limit exceeded") {
    super("GMAIL_RATE_LIMIT", message);
    this.retryAfterMs = retryAfterMs;
  }
}
