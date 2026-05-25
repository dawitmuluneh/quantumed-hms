-- QuantuMed HMS — per-tenant schema DDL (canonical).
--
-- Applied by TenantProvisioningService.provisionSchema(schemaName) on hospital
-- onboarding and by the `db:provision-template` task to create the static
-- `tenant_template` schema (used by tests + as a reference of the latest
-- shape). The same DDL runs against every tenant schema so the SQL is the
-- single source of truth.
--
-- Conventions
--   * Identifiers are quoted via the calling service; this file is loaded as
--     a literal and the `{{schema}}` placeholder is substituted at runtime.
--   * UUID primary keys via `gen_random_uuid()` (built-in since Postgres 13).
--     `btree_gist` is required for the no-overlap exclusion constraint and is
--     installed once at the database level by the bootstrap migration.
--     This DDL assumes both are already present (see migrations).

--   * PHI columns end in `_enc`. Stored ciphertext is produced by
--     `FieldEncryptionService` (`v1.<iv>.<tag>.<ct>`); rejecting plain text
--     is the caller's responsibility.
--   * All timestamps are TIMESTAMPTZ; all enums are CHECK-constrained TEXT
--     to keep DDL evolution cheap.

-- =============================================================================
-- patients — primary clinical entity. One row per registered person.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.patients (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn                TEXT         NOT NULL,
  first_name_enc     TEXT         NOT NULL,
  last_name_enc      TEXT         NOT NULL,
  dob_enc            TEXT         NOT NULL,
  sex                TEXT         NOT NULL CHECK (sex IN ('M', 'F', 'O', 'U')),
  phone_enc          TEXT,
  email_enc          TEXT,
  address_enc        TEXT,
  preferred_language TEXT         NOT NULL DEFAULT 'en',
  portal_user_id     TEXT,
  status             TEXT         NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('ACTIVE', 'INACTIVE', 'DECEASED')),
  registered_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS patients_mrn_uq
  ON {{schema}}.patients (mrn);
CREATE INDEX IF NOT EXISTS patients_status_idx
  ON {{schema}}.patients (status);
CREATE INDEX IF NOT EXISTS patients_portal_user_id_idx
  ON {{schema}}.patients (portal_user_id);

-- =============================================================================
-- dependents — minors/elderly under a guardian. May or may not have their own
-- patient record yet.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.dependents (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_patient_id UUID         NOT NULL
                        REFERENCES {{schema}}.patients (id) ON DELETE CASCADE,
  patient_id          UUID
                        REFERENCES {{schema}}.patients (id) ON DELETE SET NULL,
  first_name_enc      TEXT         NOT NULL,
  last_name_enc       TEXT         NOT NULL,
  dob_enc             TEXT         NOT NULL,
  relation            TEXT         NOT NULL
                        CHECK (relation IN ('CHILD', 'SPOUSE', 'PARENT', 'SIBLING', 'OTHER')),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dependents_guardian_idx
  ON {{schema}}.dependents (guardian_patient_id);

-- =============================================================================
-- resources — rooms, beds, equipment that can be scheduled.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.resources (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT         NOT NULL,
  name          TEXT         NOT NULL,
  resource_type TEXT         NOT NULL
                  CHECK (resource_type IN ('ROOM', 'BED', 'EQUIPMENT')),
  location      TEXT,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS resources_code_uq
  ON {{schema}}.resources (code);

-- =============================================================================
-- schedules — recurring weekly availability windows for a provider. The
-- scheduling service overlays these against the appointments table to compute
-- bookable slots.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.schedules (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id  TEXT         NOT NULL,
  day_of_week       SMALLINT     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time        TIME         NOT NULL,
  end_time          TIME         NOT NULL,
  effective_from    DATE,
  effective_until   DATE,
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT schedules_time_range CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS schedules_provider_idx
  ON {{schema}}.schedules (provider_user_id, day_of_week);

-- =============================================================================
-- appointments — scheduled clinical visits. An appointment becomes an
-- encounter on check-in (we keep both rows linked via `encounter_id`).
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.appointments (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          UUID         NOT NULL
                        REFERENCES {{schema}}.patients (id) ON DELETE RESTRICT,
  provider_user_id    TEXT         NOT NULL,
  resource_id         UUID
                        REFERENCES {{schema}}.resources (id) ON DELETE SET NULL,
  scheduled_start     TIMESTAMPTZ  NOT NULL,
  scheduled_end       TIMESTAMPTZ  NOT NULL,
  status              TEXT         NOT NULL DEFAULT 'SCHEDULED'
                        CHECK (status IN (
                          'SCHEDULED', 'CONFIRMED', 'CHECKED_IN',
                          'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
                        )),
  reason              TEXT,
  notes_enc           TEXT,
  encounter_id        UUID,
  created_by_user_id  TEXT,
  cancelled_reason    TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT appointments_time_range CHECK (scheduled_end > scheduled_start)
);

CREATE INDEX IF NOT EXISTS appointments_patient_idx
  ON {{schema}}.appointments (patient_id, scheduled_start);
CREATE INDEX IF NOT EXISTS appointments_provider_idx
  ON {{schema}}.appointments (provider_user_id, scheduled_start);
CREATE INDEX IF NOT EXISTS appointments_status_idx
  ON {{schema}}.appointments (status, scheduled_start);

-- Hard guard against double-booking the same provider with overlapping
-- non-cancelled appointments. Implemented as a partial range exclusion so
-- cancelled/no-show rows don't count.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA platform;

ALTER TABLE {{schema}}.appointments
  DROP CONSTRAINT IF EXISTS appointments_provider_no_overlap;

ALTER TABLE {{schema}}.appointments
  ADD CONSTRAINT appointments_provider_no_overlap
  EXCLUDE USING gist (
    provider_user_id WITH =,
    tstzrange(scheduled_start, scheduled_end, '[)') WITH &&
  ) WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'));

-- =============================================================================
-- encounters — clinical visits (one row per check-in / per inpatient stay).
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.encounters (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID         NOT NULL
                      REFERENCES {{schema}}.patients (id) ON DELETE RESTRICT,
  provider_user_id  TEXT         NOT NULL,
  appointment_id    UUID
                      REFERENCES {{schema}}.appointments (id) ON DELETE SET NULL,
  encounter_type    TEXT         NOT NULL
                      CHECK (encounter_type IN (
                        'OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'TELEMEDICINE'
                      )),
  chief_complaint   TEXT,
  notes_enc         TEXT,
  status            TEXT         NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED')),
  started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT encounters_time_range CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS encounters_patient_idx
  ON {{schema}}.encounters (patient_id, started_at DESC);
CREATE INDEX IF NOT EXISTS encounters_provider_idx
  ON {{schema}}.encounters (provider_user_id, started_at DESC);

-- Now that encounters exists, close the appointments -> encounters FK.
ALTER TABLE {{schema}}.appointments
  DROP CONSTRAINT IF EXISTS appointments_encounter_fk;
ALTER TABLE {{schema}}.appointments
  ADD CONSTRAINT appointments_encounter_fk
  FOREIGN KEY (encounter_id)
  REFERENCES {{schema}}.encounters (id) ON DELETE SET NULL;

-- =============================================================================
-- vitals — point-in-time clinical measurements during an encounter. BMI is
-- computed and persisted at insert time so historical rows don't drift if the
-- formula changes.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.vitals (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id        UUID         NOT NULL
                        REFERENCES {{schema}}.encounters (id) ON DELETE CASCADE,
  recorded_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  heart_rate_bpm      INTEGER      CHECK (heart_rate_bpm BETWEEN 20 AND 300),
  systolic_bp         INTEGER      CHECK (systolic_bp BETWEEN 40 AND 300),
  diastolic_bp        INTEGER      CHECK (diastolic_bp BETWEEN 20 AND 200),
  spo2_pct            INTEGER      CHECK (spo2_pct BETWEEN 0 AND 100),
  temperature_c       NUMERIC(4,1) CHECK (temperature_c BETWEEN 25.0 AND 45.0),
  respiratory_rate    INTEGER      CHECK (respiratory_rate BETWEEN 4 AND 80),
  weight_kg           NUMERIC(5,2) CHECK (weight_kg BETWEEN 0.5 AND 500.0),
  height_cm           NUMERIC(5,1) CHECK (height_cm BETWEEN 20.0 AND 260.0),
  bmi                 NUMERIC(5,2),
  pain_score          SMALLINT     CHECK (pain_score BETWEEN 0 AND 10),
  notes               TEXT,
  recorded_by_user_id TEXT         NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vitals_encounter_idx
  ON {{schema}}.vitals (encounter_id, recorded_at DESC);

-- =============================================================================
-- encounter_diagnoses — ICD-10 codes attached to an encounter. We denormalize
-- the description for audit history and so the encounter list stays readable
-- even if the canonical ICD-10 catalog rev's.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.encounter_diagnoses (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id       UUID         NOT NULL
                       REFERENCES {{schema}}.encounters (id) ON DELETE CASCADE,
  icd10_code         TEXT         NOT NULL,
  icd10_description  TEXT         NOT NULL,
  is_primary         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT encounter_diagnoses_code_fmt
    CHECK (icd10_code ~ '^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$')
);

CREATE INDEX IF NOT EXISTS encounter_diagnoses_encounter_idx
  ON {{schema}}.encounter_diagnoses (encounter_id);
CREATE INDEX IF NOT EXISTS encounter_diagnoses_code_idx
  ON {{schema}}.encounter_diagnoses (icd10_code);

-- Only one primary diagnosis per encounter.
CREATE UNIQUE INDEX IF NOT EXISTS encounter_diagnoses_primary_uq
  ON {{schema}}.encounter_diagnoses (encounter_id)
  WHERE is_primary = TRUE;
