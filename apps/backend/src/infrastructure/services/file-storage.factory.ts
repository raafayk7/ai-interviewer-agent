import { Result } from "@carbonteq/fp";
import type { IFileStorageService } from "@repo/application";
import { LocalFileStorageService } from "./local-file-storage.service.js";
import { S3FileStorageService } from "./s3-file-storage.service.js";

export type FileStorageDriver = "local" | "s3";

/**
 * Selects the file-storage adapter at the composition root based on
 * FILE_STORAGE_DRIVER (default "local"). Both recognized branches already return
 * Result<_, Error>; the union widens to the IFileStorageService port so all
 * composition sites depend on the abstraction, not a concrete adapter.
 */
export function fileStorageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Result<IFileStorageService, Error> {
  const driver = (env["FILE_STORAGE_DRIVER"] ?? "local") as FileStorageDriver;

  switch (driver) {
    case "s3":
      return S3FileStorageService.fromEnv(env);
    case "local":
      return LocalFileStorageService.fromEnv(env);
    default:
      return Result.Err(
        new Error(`Unknown FILE_STORAGE_DRIVER: "${driver}" (expected "local" or "s3")`),
      );
  }
}
