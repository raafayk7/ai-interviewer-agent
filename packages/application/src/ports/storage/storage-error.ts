import { ServiceInfraError } from "../../core/service-error.js";

export abstract class StorageError extends ServiceInfraError {}

export class StorageUnavailableError extends StorageError {
  readonly code = "STORAGE_UNAVAILABLE";
}

export class StorageNotFoundError extends StorageError {
  readonly code = "STORAGE_NOT_FOUND";
  constructor(readonly key: string) {
    super(`Storage object not found for key: ${key}`);
  }
}

export class StorageUnknownError extends StorageError {
  readonly code = "STORAGE_UNKNOWN";
  constructor(message: string, readonly operation: string) {
    super(message);
  }
}
