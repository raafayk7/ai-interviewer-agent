import type { Result } from "@carbonteq/fp";

export interface IUnitOfWork {
  transaction<T>(work: () => Promise<Result<T, Error>>): Promise<Result<T, Error>>;
}
