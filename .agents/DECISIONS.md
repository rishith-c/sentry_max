# IgnisLink Architecture Decision Log

This file is append-only. Each ADR should include context, decision, consequences, and affected owners.

## ADR-0001 - Coordination Source of Truth

- Date: 2026-05-02
- Status: accepted
- Owners: codex, claude

### Context

Two coding agents are working concurrently and need deterministic coordination without manual GitHub UI edits.

### Decision

Use files under `.agents/` as the coordination source of truth, protected by `.agents/LOCK`. `BOARD.md` tracks ownership, `HANDOFF.md` records cross-agent messages, `DECISIONS.md` records architecture decisions, and `BLOCKERS.md` tracks waiting states.

### Consequences

All shared coordination changes must acquire the lock before editing and release it immediately after.

