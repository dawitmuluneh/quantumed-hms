# ADR 0005 — AI/ML triage as a pluggable adapter (deferred provider)

**Status:** Accepted (Phase A)
**Date:** 2025-05-25

## Context

The action plan mandates "embedded AI/ML for patient triage." The user opted
to **defer the provider choice** when asked in Phase A.

## Decision

Phase A ships an `AiTriagePort` interface in `apps/api/src/modules/ai-triage`
(stubbed for Phase B). Three implementations are anticipated:

1. **`RuleBasedTriageAdapter`** — deterministic rule engine over a small set of
   vital signs and presenting complaints. No network calls, no external
   dependencies. Always available.
2. **`OpenAITriageAdapter`** — uses a hosted LLM. Requires `OPENAI_API_KEY`.
   Disabled until the user provides credentials.
3. **`LocalModelTriageAdapter`** — calls a self-hosted inference endpoint
   (e.g. vLLM, Ollama). Requires `LOCAL_AI_URL`.

The active adapter is selected by `AI_TRIAGE_PROVIDER` env var
(`rules` | `openai` | `local`). Default in Phase A: `rules`.

All adapters return the same `TriageResult` shape so the consuming
modules (Phase B `patients`, `encounters`) are provider-agnostic. PHI sent to
any external adapter is logged, audited, and gated on a per-hospital
"AI processing consent" flag.

## Consequences

- Phase B+ work is unblocked: clinical modules can integrate a stable
  contract without committing to a vendor.
- Switching providers is a config change, not a refactor.
- Adapter selection is auditable: the `AuditLog` records which adapter
  produced each triage decision.
