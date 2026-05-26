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

-- =============================================================================
-- medicines — per-tenant formulary catalog. Codes are hospital-local SKUs;
-- the optional `atc_code` ties back to the WHO ATC classification for
-- interoperability with downstream reporting.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.medicines (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT         NOT NULL,
  generic_name  TEXT         NOT NULL,
  brand_name    TEXT,
  form          TEXT         NOT NULL
                  CHECK (form IN (
                    'TABLET', 'CAPSULE', 'SYRUP', 'INJECTION',
                    'CREAM', 'DROPS', 'INHALER', 'PATCH', 'OTHER'
                  )),
  strength      TEXT,
  atc_code      TEXT,
  is_controlled BOOLEAN      NOT NULL DEFAULT FALSE,
  default_unit  TEXT         NOT NULL DEFAULT 'unit',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS medicines_code_uq
  ON {{schema}}.medicines (code);
CREATE INDEX IF NOT EXISTS medicines_generic_name_idx
  ON {{schema}}.medicines (generic_name);
CREATE INDEX IF NOT EXISTS medicines_active_idx
  ON {{schema}}.medicines (is_active);

-- =============================================================================
-- pharmacy_inventory_batches — lot-tracked stock on hand. Quantity is in the
-- medicine's `default_unit` (or an override per batch); we keep the unit on
-- the batch so historical dispenses don't drift if the catalog default flips.
-- The batch number is unique per medicine to keep FEFO (first-expiry-first-out)
-- selection deterministic.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.pharmacy_inventory_batches (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id      UUID         NOT NULL
                     REFERENCES {{schema}}.medicines (id) ON DELETE RESTRICT,
  lot_number       TEXT         NOT NULL,
  expires_on       DATE         NOT NULL,
  quantity_on_hand INTEGER      NOT NULL CHECK (quantity_on_hand >= 0),
  unit             TEXT         NOT NULL,
  location         TEXT,
  received_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_inventory_batches_med_lot_uq
  ON {{schema}}.pharmacy_inventory_batches (medicine_id, lot_number);
CREATE INDEX IF NOT EXISTS pharmacy_inventory_batches_med_exp_idx
  ON {{schema}}.pharmacy_inventory_batches (medicine_id, expires_on);

-- =============================================================================
-- prescriptions — header row per prescribing event. One encounter can have
-- multiple prescriptions (e.g. a revision after lab results); status is the
-- server-side state machine.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.prescriptions (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id       UUID         NOT NULL
                       REFERENCES {{schema}}.encounters (id) ON DELETE RESTRICT,
  patient_id         UUID         NOT NULL
                       REFERENCES {{schema}}.patients (id) ON DELETE RESTRICT,
  prescriber_user_id TEXT         NOT NULL,
  status             TEXT         NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED', 'SUPERSEDED')),
  notes_enc          TEXT,
  issued_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  cancelled_reason   TEXT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prescriptions_encounter_idx
  ON {{schema}}.prescriptions (encounter_id);
CREATE INDEX IF NOT EXISTS prescriptions_patient_idx
  ON {{schema}}.prescriptions (patient_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS prescriptions_status_idx
  ON {{schema}}.prescriptions (status);

-- =============================================================================
-- prescription_items — one row per line item. `quantity_to_dispense` is the
-- total dispensable quantity in `medicine.default_unit` units; pharmacy
-- dispenses subtract from this implicitly via the dispense ledger.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.prescription_items (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id      UUID         NOT NULL
                         REFERENCES {{schema}}.prescriptions (id) ON DELETE CASCADE,
  medicine_id          UUID         NOT NULL
                         REFERENCES {{schema}}.medicines (id) ON DELETE RESTRICT,
  dose                 TEXT         NOT NULL,
  route                TEXT         NOT NULL
                         CHECK (route IN (
                           'ORAL', 'IV', 'IM', 'SC', 'TOPICAL',
                           'INHALED', 'OPHTHALMIC', 'OTIC',
                           'NASAL', 'RECTAL', 'OTHER'
                         )),
  frequency            TEXT         NOT NULL,
  duration_days        INTEGER      CHECK (duration_days IS NULL OR (duration_days BETWEEN 1 AND 365)),
  quantity_to_dispense INTEGER      NOT NULL CHECK (quantity_to_dispense > 0),
  prn                  BOOLEAN      NOT NULL DEFAULT FALSE,
  prn_reason           TEXT,
  instructions_enc     TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prescription_items_prescription_idx
  ON {{schema}}.prescription_items (prescription_id);
CREATE INDEX IF NOT EXISTS prescription_items_medicine_idx
  ON {{schema}}.prescription_items (medicine_id);

-- =============================================================================
-- pharmacy_dispenses — append-only ledger of stock movements out of inventory.
-- The dispense service performs the deduction in a single SQL statement that
-- conditions on `quantity_on_hand >= dispensed_qty`, so we never double-spend.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.pharmacy_dispenses (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_item_id UUID         NOT NULL
                         REFERENCES {{schema}}.prescription_items (id) ON DELETE RESTRICT,
  batch_id             UUID         NOT NULL
                         REFERENCES {{schema}}.pharmacy_inventory_batches (id) ON DELETE RESTRICT,
  quantity             INTEGER      NOT NULL CHECK (quantity > 0),
  unit                 TEXT         NOT NULL,
  dispensed_by_user_id TEXT         NOT NULL,
  dispensed_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  notes                TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pharmacy_dispenses_item_idx
  ON {{schema}}.pharmacy_dispenses (prescription_item_id);
CREATE INDEX IF NOT EXISTS pharmacy_dispenses_batch_idx
  ON {{schema}}.pharmacy_dispenses (batch_id);
CREATE INDEX IF NOT EXISTS pharmacy_dispenses_dispensed_at_idx
  ON {{schema}}.pharmacy_dispenses (dispensed_at DESC);

-- =============================================================================
-- PHASE B.3 — LABORATORY (orders, results, multi-level verification)
-- =============================================================================

-- =============================================================================
-- lab_tests — per-tenant catalog of orderable tests. Reference and critical
-- ranges are stored as text to allow non-numeric units (e.g. "POS/NEG") even
-- though the numeric path is the common one. The numeric thresholds are
-- snapshotted onto lab_results so historical flags do not change when the
-- catalog is later edited.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.lab_tests (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT         NOT NULL UNIQUE,
  name                TEXT         NOT NULL,
  specimen_type       TEXT         NOT NULL
                        CHECK (specimen_type IN (
                          'BLOOD', 'SERUM', 'PLASMA', 'URINE', 'STOOL',
                          'SPUTUM', 'CSF', 'SWAB', 'TISSUE', 'OTHER'
                        )),
  unit                TEXT,
  reference_low       NUMERIC(14,4),
  reference_high      NUMERIC(14,4),
  critical_low        NUMERIC(14,4),
  critical_high       NUMERIC(14,4),
  turnaround_minutes  INTEGER      CHECK (turnaround_minutes IS NULL OR turnaround_minutes > 0),
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lab_tests_active_idx
  ON {{schema}}.lab_tests (is_active);

-- =============================================================================
-- lab_orders — header. Each order belongs to one encounter and carries a
-- unique sample_barcode that pharmacy/lab staff scan. `priority` follows the
-- standard 4-tier triage scheme. PHI notes are encrypted at rest.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.lab_orders (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id        UUID         NOT NULL
                        REFERENCES {{schema}}.encounters (id) ON DELETE RESTRICT,
  patient_id          UUID         NOT NULL
                        REFERENCES {{schema}}.patients (id) ON DELETE RESTRICT,
  ordered_by_user_id  TEXT         NOT NULL,
  priority            TEXT         NOT NULL DEFAULT 'ROUTINE'
                        CHECK (priority IN ('ROUTINE', 'URGENT', 'STAT', 'EMERGENCY')),
  status              TEXT         NOT NULL DEFAULT 'PENDING_COLLECTION'
                        CHECK (status IN (
                          'PENDING_COLLECTION', 'COLLECTED', 'IN_PROGRESS',
                          'COMPLETED', 'CANCELLED'
                        )),
  sample_barcode      TEXT         NOT NULL UNIQUE,
  notes_enc           TEXT,
  ordered_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  collected_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_reason    TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lab_orders_patient_idx
  ON {{schema}}.lab_orders (patient_id, ordered_at DESC);
CREATE INDEX IF NOT EXISTS lab_orders_encounter_idx
  ON {{schema}}.lab_orders (encounter_id);
CREATE INDEX IF NOT EXISTS lab_orders_status_idx
  ON {{schema}}.lab_orders (status);

-- =============================================================================
-- lab_order_items — one row per requested test within an order. Carries a
-- per-test status so a multi-test panel can move tests through the workflow
-- independently. PHI instructions (e.g. "fasting required") encrypted.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.lab_order_items (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_order_id        UUID         NOT NULL
                        REFERENCES {{schema}}.lab_orders (id) ON DELETE CASCADE,
  lab_test_id         UUID         NOT NULL
                        REFERENCES {{schema}}.lab_tests (id) ON DELETE RESTRICT,
  status              TEXT         NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN (
                          'PENDING', 'IN_PROGRESS', 'RESULTED',
                          'VERIFIED', 'CANCELLED'
                        )),
  instructions_enc    TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (lab_order_id, lab_test_id)
);

CREATE INDEX IF NOT EXISTS lab_order_items_order_idx
  ON {{schema}}.lab_order_items (lab_order_id);
CREATE INDEX IF NOT EXISTS lab_order_items_test_idx
  ON {{schema}}.lab_order_items (lab_test_id);

-- =============================================================================
-- lab_results — append-only ledger of result values. Each row snapshots the
-- reference/critical ranges from the catalog at the moment of entry so a
-- later edit to lab_tests cannot retroactively change a historical flag.
-- Verification is a separate UPDATE on the existing row, not a new row, so
-- the chain technician -> pathologist -> finalized stays linear.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.lab_results (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_order_item_id   UUID         NOT NULL
                        REFERENCES {{schema}}.lab_order_items (id) ON DELETE CASCADE,
  value_numeric       NUMERIC(14,4),
  value_text          TEXT,
  unit                TEXT,
  flag                TEXT         NOT NULL DEFAULT 'NORMAL'
                        CHECK (flag IN (
                          'NORMAL', 'LOW', 'HIGH',
                          'CRITICAL_LOW', 'CRITICAL_HIGH', 'ABNORMAL'
                        )),
  reference_low       NUMERIC(14,4),
  reference_high      NUMERIC(14,4),
  critical_low        NUMERIC(14,4),
  critical_high       NUMERIC(14,4),
  observed_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  entered_by_user_id  TEXT         NOT NULL,
  verified_by_user_id TEXT,
  verified_at         TIMESTAMPTZ,
  notes_enc           TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK (
    value_numeric IS NOT NULL OR value_text IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS lab_results_item_idx
  ON {{schema}}.lab_results (lab_order_item_id, created_at DESC);

-- =============================================================================
-- PHASE B.3 — IMAGING (requests, studies, radiologist reports)
-- =============================================================================

-- =============================================================================
-- imaging_requests — header for an ordered imaging study. Modality is a fixed
-- set of common radiology modalities; `body_part` is free text to keep the
-- schema flexible. `clinical_question_enc` is PHI (the reason for the study).
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.imaging_requests (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id           UUID         NOT NULL
                           REFERENCES {{schema}}.encounters (id) ON DELETE RESTRICT,
  patient_id             UUID         NOT NULL
                           REFERENCES {{schema}}.patients (id) ON DELETE RESTRICT,
  ordered_by_user_id     TEXT         NOT NULL,
  modality               TEXT         NOT NULL
                           CHECK (modality IN (
                             'XRAY', 'CT', 'MRI', 'ULTRASOUND',
                             'MAMMOGRAPHY', 'FLUOROSCOPY'
                           )),
  body_part              TEXT         NOT NULL,
  priority               TEXT         NOT NULL DEFAULT 'ROUTINE'
                           CHECK (priority IN ('ROUTINE', 'URGENT', 'STAT', 'EMERGENCY')),
  status                 TEXT         NOT NULL DEFAULT 'REQUESTED'
                           CHECK (status IN (
                             'REQUESTED', 'SCHEDULED', 'IN_PROGRESS',
                             'PERFORMED', 'REPORTED', 'CANCELLED'
                           )),
  clinical_question_enc  TEXT,
  ordered_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  scheduled_for          TIMESTAMPTZ,
  cancelled_reason       TEXT,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS imaging_requests_patient_idx
  ON {{schema}}.imaging_requests (patient_id, ordered_at DESC);
CREATE INDEX IF NOT EXISTS imaging_requests_encounter_idx
  ON {{schema}}.imaging_requests (encounter_id);
CREATE INDEX IF NOT EXISTS imaging_requests_status_idx
  ON {{schema}}.imaging_requests (status);

-- =============================================================================
-- imaging_studies — performance record. `dicom_object_keys` is an array of
-- S3-style object keys that the eventual file-storage adapter will resolve.
-- One request can produce multiple studies (e.g. re-takes), so this is N:1.
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.imaging_studies (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  imaging_request_id    UUID         NOT NULL
                          REFERENCES {{schema}}.imaging_requests (id) ON DELETE CASCADE,
  equipment_id          TEXT,
  performed_by_user_id  TEXT         NOT NULL,
  performed_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  protocol              TEXT,
  image_count           INTEGER      NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  dicom_object_keys     TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  notes_enc             TEXT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS imaging_studies_request_idx
  ON {{schema}}.imaging_studies (imaging_request_id);

-- =============================================================================
-- imaging_reports — radiologist reporting workflow. Status moves forward only
-- (DRAFT -> PENDING_REVIEW -> REVIEWED -> FINALIZED); once FINALIZED the
-- report is immutable. Findings / impression / recommendations are PHI.
-- A study can have at most one report (UNIQUE on imaging_study_id).
-- =============================================================================
CREATE TABLE IF NOT EXISTS {{schema}}.imaging_reports (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  imaging_study_id        UUID         NOT NULL UNIQUE
                            REFERENCES {{schema}}.imaging_studies (id) ON DELETE CASCADE,
  radiologist_user_id     TEXT         NOT NULL,
  status                  TEXT         NOT NULL DEFAULT 'DRAFT'
                            CHECK (status IN (
                              'DRAFT', 'PENDING_REVIEW', 'REVIEWED', 'FINALIZED'
                            )),
  findings_enc            TEXT,
  impression_enc          TEXT,
  recommendations_enc     TEXT,
  reviewer_user_id        TEXT,
  signed_at               TIMESTAMPTZ,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS imaging_reports_status_idx
  ON {{schema}}.imaging_reports (status);
CREATE INDEX IF NOT EXISTS imaging_reports_radiologist_idx
  ON {{schema}}.imaging_reports (radiologist_user_id);
