import type { Result } from "@carbonteq/fp";
import type { FileRef } from "@repo/domain";
import type { StorageError } from "./storage-error.js";

export interface IFileStorageService {
  upload(file: Buffer, key: string, contentType: string): Promise<Result<FileRef, StorageError>>;
  download(key: string): Promise<Result<Buffer, StorageError>>;
  delete(key: string): Promise<Result<void, StorageError>>;
  getSignedUrl(key: string, expiresInSec: number): Promise<Result<string, StorageError>>;
}
