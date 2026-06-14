import { Result } from "@carbonteq/fp";
import { ValidationError } from "../domain-error.js";

export class InvalidFileRefError extends ValidationError {
  readonly code = "INVALID_FILE_REF";
}

export interface FileRefProps {
  readonly key: string; // storage key, e.g. "interviews/abc/cv.pdf"
  readonly contentType: string; // MIME, e.g. "application/pdf"
  readonly sizeBytes: number;
  readonly originalFilename: string;
  readonly uploadedAt: Date;
}

export class FileRef {
  private constructor(
    readonly key: string,
    readonly contentType: string,
    readonly sizeBytes: number,
    readonly originalFilename: string,
    readonly uploadedAt: Date,
  ) {}

  static create(props: FileRefProps): Result<FileRef, InvalidFileRefError> {
    if (!props.key.trim()) {
      return Result.Err(new InvalidFileRefError("FileRef.key must not be empty"));
    }
    if (!props.contentType.trim()) {
      return Result.Err(new InvalidFileRefError("FileRef.contentType must not be empty"));
    }
    if (!Number.isFinite(props.sizeBytes) || props.sizeBytes < 0) {
      return Result.Err(new InvalidFileRefError("FileRef.sizeBytes must be a non-negative finite number"));
    }
    if (!props.originalFilename.trim()) {
      return Result.Err(new InvalidFileRefError("FileRef.originalFilename must not be empty"));
    }
    return Result.Ok(
      new FileRef(props.key, props.contentType, props.sizeBytes, props.originalFilename, props.uploadedAt),
    );
  }

  serialize(): FileRefProps {
    return {
      key: this.key,
      contentType: this.contentType,
      sizeBytes: this.sizeBytes,
      originalFilename: this.originalFilename,
      uploadedAt: this.uploadedAt,
    };
  }

  static fromSerialized(data: FileRefProps): FileRef {
    // Trusted persistence path — caller guarantees validity.
    return new FileRef(data.key, data.contentType, data.sizeBytes, data.originalFilename, data.uploadedAt);
  }
}
