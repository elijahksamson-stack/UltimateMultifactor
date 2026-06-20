# UltimateMultifactor — app

The scoring core of UltimateMultifactor: it ranks the OTM universe on seven
sector-z-scored factors (X/Y/Z technical + P/B, P/S, EQ-Stability, EQ-Growth)
and writes the ranked discovery list to its own database. For architecture,
data flow, env vars, and how to run it, see [`CLAUDE.md`](./CLAUDE.md); for the
full design rationale see the spec at
`../docs/superpowers/specs/2026-06-19-ultimatemultifactor-design.md`.
