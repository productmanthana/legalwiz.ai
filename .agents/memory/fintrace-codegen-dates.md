---
name: Zod date coercion vs Drizzle date strings
description: Why orval zod output must not coerce dates in this project
---
Orval zod output must keep `useDates: false` and not coerce `date` in bodies.
**Why:** Drizzle date columns use `mode: "string"`; coerced Date objects failed typecheck on every insert/update, and response parsing turned dates into ISO datetimes.
**How to apply:** If regenerating or changing orval.config.ts, keep this; validate request bodies only, never parse responses.
