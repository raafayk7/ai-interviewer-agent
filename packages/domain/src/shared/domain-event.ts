import { randomUUID } from "node:crypto";

export abstract class DomainEvent {
  readonly eventId: string;
  readonly occurredAt: Date;

  constructor(readonly aggregateId: string) {
    this.eventId = randomUUID();
    this.occurredAt = new Date();
  }
}
