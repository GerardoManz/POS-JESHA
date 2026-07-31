-- Add idempotency + snapshots to AbonoBitacora
ALTER TABLE "AbonoBitacora"
  ADD COLUMN "idempotencyKey"        TEXT,
  ADD COLUMN "saldoAntesSnapshot"    DECIMAL(12,2),
  ADD COLUMN "saldoDespuesSnapshot"  DECIMAL(12,2),
  ADD COLUMN "estadoResultante"      "EstadoBitacora",
  ADD COLUMN "cerradaEnSnapshot"     TIMESTAMPTZ;

ALTER TABLE "AbonoBitacora"
  ADD CONSTRAINT "AbonoBitacora_empresaId_idempotencyKey_key"
  UNIQUE ("empresaId", "idempotencyKey");

-- Add FK from MovimientoCaja to AbonoBitacora
ALTER TABLE "MovimientoCaja"
  ADD COLUMN "abonoBitacoraId" INT;

ALTER TABLE "MovimientoCaja"
  ADD CONSTRAINT "MovimientoCaja_abonoBitacoraId_fkey"
  FOREIGN KEY ("abonoBitacoraId")
  REFERENCES "AbonoBitacora"("id") ON DELETE RESTRICT;

ALTER TABLE "MovimientoCaja"
  ADD CONSTRAINT "MovimientoCaja_abonoBitacoraId_key"
  UNIQUE ("abonoBitacoraId");

CREATE INDEX "MovimientoCaja_abonoBitacoraId_idx"
  ON "MovimientoCaja"("abonoBitacoraId");
