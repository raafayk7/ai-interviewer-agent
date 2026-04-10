import { Option } from "@carbonteq/fp";

export interface IEntity {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type CreateEntity<T extends IEntity> = Omit<T, "id" | "createdAt" | "updatedAt">;

export type SimpleSerialized<T> = {
  [K in keyof T]: T[K] extends Option<infer U> ? U | null : T[K];
};

export abstract class BaseEntity implements IEntity {
  readonly id!: string;
  readonly createdAt!: Date;
  readonly updatedAt!: Date;

  protected _serialize() {
    return {
      id: this.id,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
