# Fugui Xiaoan L3 Package

**Version**: v1.0
**Date**: 2026-07-14
**Source**: N1-N10 L2 design documents, extracted via N12 L2->L3 unpacking
**Base**: State-Control Architecture v4.7

## Files

| File | Description |
|------|-------------|
| `turnType-schema.json` | Unified turnType format (both taskTypes) |
| `tunables.json` | Tunable parameters + conflictRules (single_param + cross_param) |
| `constitutions/root-constitution.json` | Root constitution 7 articles (passphrase-based) |
| `constitutions/common-rules.json` | Common rules 3 items |
| `constitutions/intent-recognition.json` | Intent recognition constitution (high) |
| `constitutions/record-session.json` | Record session constitution (critical) |
| `constitutions/query-session.json` | Query session constitution |
| `constitutions/delete-session.json` | Delete session constitution |
| `constitutions/compare-session.json` | Compare session constitution |
| `constitutions/other-session.json` | Other/fallback session constitution |

## Consumer

This L3 package is consumed by N13 skeleton generation. A code-specialized model reads all JSON files and auto-generates:

- `scheduler.js` — state machine + passphrase layer + ANALYZING + supervision loop + DET recheck
- `context-manager.js` — 3 interfaces + field_based hard gate + @importance truncation
- `constitutions/` — all constitution deserialization
- `tunables.js` — getTunable() + dual-mode conflict detection (single_param/cross_param)
- `contract-store.js` — SQLite + WAL mode, 7 tables
- `telemetry.js` — OpenTelemetry trace instrumentation

## Key Data

- Root constitution: 7 articles
- Phase constitutions: 6 files (with @importance + @outputs + @tunable)
- Tunable parameters: 14 (5 from v4.7)
- Conflict rules: 1 single_param + 1 cross_param
- turnType: 6 values, includes changeLevel (both taskTypes)
