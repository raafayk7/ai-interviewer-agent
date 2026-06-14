import { NotFoundError, ValidationError } from "../../../shared/domain-error.js";

export class InvalidReportInputError extends ValidationError {
  readonly code = "INVALID_REPORT_INPUT";
}

export class ReportNotFoundError extends NotFoundError {
  readonly code = "REPORT_NOT_FOUND";
  constructor(id: string) {
    super(`Report with id ${id} not found`);
  }
}
