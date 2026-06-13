-- ADR-035 Mechanism 5: allow FAILED terminal interview status.
ALTER TABLE "interviews" DROP CONSTRAINT IF EXISTS "interviews_status_check";
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_status_check"
  CHECK ("status" IN ('CREATED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'EVALUATED', 'CANCELLED', 'FAILED'));
