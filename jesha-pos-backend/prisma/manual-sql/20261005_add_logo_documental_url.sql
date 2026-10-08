-- Apply manually in local first, then production only through the schema-change protocol.
-- Execute this entire file as one script so the explicit COMMIT is not omitted.
SELECT current_database() AS database_name,
       current_user AS database_user,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port,
       current_setting('transaction_read_only') AS transaction_read_only,
       NOW() AS checked_at;

SELECT COUNT(*) AS empresas_antes
FROM "Empresa";

BEGIN;

ALTER TABLE "Empresa"
  ADD COLUMN IF NOT EXISTS "logoDocumentalUrl" TEXT;

DO $$
DECLARE
  column_type TEXT;
  nullable TEXT;
BEGIN
  SELECT data_type, is_nullable
    INTO column_type, nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'Empresa'
    AND column_name = 'logoDocumentalUrl';

  IF column_type IS DISTINCT FROM 'text' OR nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'Empresa.logoDocumentalUrl debe ser TEXT NULLABLE; tipo=%, nullable=%',
      column_type, nullable;
  END IF;
END $$;

COMMIT;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Empresa'
  AND column_name = 'logoDocumentalUrl';

SELECT COUNT(*) AS empresas_despues,
       COUNT("logoDocumentalUrl") AS empresas_con_logo_documental
FROM "Empresa";
