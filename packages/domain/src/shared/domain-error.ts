export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export abstract class ValidationError extends DomainError {}
export abstract class NotFoundError extends DomainError {}
export abstract class ConflictError extends DomainError {}
export abstract class BusinessRuleViolationError extends DomainError {}
