# UBO Investigations — Background-Job Design

**Status:** Proposed (not yet implemented)
**Author:** Engineering
**Date:** 2026-06-24
**Scope:** `company-veritas` — the `/api/ubo` streaming endpoint and the Ownership panel.

---

## 1. Problem

Full-mode UBO investigations are **long and highly variable**. Measured against the live Dify
agent (depth-2, ownership-only, adverse-media + screening OFF):

| Run | Wall time | Outcome |
|-----|-----------|---------|
| Run A (localhost) | 62.1s | `done` |
| Run B (through Cloudflare tunnel) | **236.3s (~4 min)** | `done`, 23.7k-char report |

A heavier configuration (depth 3 + adverse media + screening) will run **longer still**.

The current design ties the entire run to **one synchronous HTTP request** that streams
Server-Sent Events (SSE) until the agent finishes. That couples a multi-minute agent run to the
request lifecycle, which breaks in three ways:

1. **Serverless function timeouts.** Vercel function duration is bounded by plan **and Fluid Compute**.
   With Fluid Compute enabled (the current default), **Hobby and Pro both allow up to 300s**; with
   Fluid Compute OFF, Hobby caps at **60s**. So a 236s run completes on Hobby *iff* Fluid Compute is
   on (`maxDuration=300`). Any run that exceeds ~300s 504s regardless of plan — that's the hard wall
   this design removes.
2. **Connection fragility.** Any client refresh, navigation, or transient network drop kills the
   run — the in-flight report is lost (there is nothing to reconnect to).
3. **Single-viewer.** Only the tab that started the run can see it. No other analyst, and no later
   reload, can watch or recover it.

### Already-shipped mitigations (these are NOT the background job — they buy headroom)
- **Clock-based heartbeat** (`: ping` every 10s, independent of agent activity) — keeps the SSE
  connection warm through idle proxies/tunnels. Reduced observed idle gap from 27s → 10s.
- **`maxDuration = 300`** — raises the serverless ceiling to the Pro maximum.
- **Upstream abort on client disconnect** — a refresh now aborts the Dify run instead of leaking it.

These make the **synchronous** design work on a **non-serverless host** (`next start` has no
function timeout — proven by the 236s tunnel run) and survive idle proxies. They do **not** solve
serverless timeouts beyond the plan cap, nor refresh-resilience. That is what this design adds.

---

## 2. When you need this

| Hosting / requirement | Synchronous (current) | Background job (this doc) |
|---|---|---|
| Non-serverless host (Render/Railway/Fly/VM, `next start`) | ✅ Works today | Optional (adds resilience) |
| Vercel Hobby/Pro **with Fluid Compute**, runs < 300s | ✅ Works (`maxDuration=300`) | ✅ Recommended |
| Any plan with Fluid Compute OFF (Hobby 60s) | ❌ Long runs 504 | ✅ Required |
| Runs > 300s (heavy depth-3 + adverse media + screening) | ❌ 504 on every plan | ✅ Required |
| Survive refresh / multiple viewers / audit trail of in-flight runs | ❌ | ✅ |

**Bottom line:** if you self-host on a plain Node box, the current code already works. Adopt
background jobs when you want serverless hosting **or** resilience to refresh/multi-viewer.

---

## 3. Core idea

Decouple the long agent run from the HTTP request. Persist run state in the database; let the
client poll/subscribe instead of holding a 4-minute connection open.

```
                 (fast, <1s)
  Client ───POST /api/ubo/jobs──▶  create job row (status=queued)  ──▶ returns { job_id }
                                          │
                                          ▼
                                   Worker picks up job
                                   runs Dify to completion
                                   writes progress + result to DB
                                          │
  Client ──GET /api/ubo/jobs/:id──▶  reads status/progress/report   ◀──┘
        (poll every ~2-3s, or Supabase Realtime subscription)
```

Because all state lives in `ubo_jobs`, a refresh/navigation simply re-attaches to the job by id;
the run keeps going regardless of who is watching.

---

## 4. Keep disambiguation synchronous (hybrid)

The flow is two turns: **resolve** (name → candidate entities, ~10s) then **investigate** (the long
multi-minute report). Only the second turn is slow.

> **Recommendation:** keep **turn 1 (resolve)** on the existing synchronous SSE path — it is fast and
> interactive (the analyst picks a candidate). Make **only turn 2 (investigate)** a background job.

This avoids modelling a "paused, awaiting candidate choice" job state and keeps the picker snappy.

---

## 5. Data model — `ubo_jobs`

> ⚠️ **Requires DDL.** The app only has the Supabase REST service key, which **cannot create
> tables**. This migration must be run once in the **Supabase SQL editor** (or via a Postgres
> connection). After it exists, PostgREST auto-exposes it and the app uses it via the same REST
> proxy pattern as everything else.

```sql
create table if not exists public.ubo_jobs (
  id              uuid primary key default gen_random_uuid(),
  client_id       text,                       -- null for ad-hoc runs (not tied to a profile)
  company_name    text not null,
  jurisdiction    text,
  params          jsonb not null default '{}',-- { depth, include_ownership, include_adverse_media,
                                              --   include_screening, conversationId, canonicalName }
  status          text not null default 'queued'
                    check (status in ('queued','running','done','error')),
  progress        jsonb not null default '[]',-- streamed progress lines (optional, for live feel)
  conversation_id text,
  message_id      text,
  markdown        text,                       -- the final report (full mode)
  header          jsonb,                      -- structured header strip
  payload         jsonb,                      -- structured UboPayload (kyc_lite only; usually null)
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ubo_jobs_status_created_idx on public.ubo_jobs (status, created_at);
create index if not exists ubo_jobs_client_idx        on public.ubo_jobs (client_id);
```

On `done`, the existing **Save to profile** flow stays unchanged — it copies the finished
`markdown`/`header` into `customers.data.cdd.ubo_reports` (the explicit, user-controlled save). The
`ubo_jobs` row is the *run record*; `cdd.ubo_reports` is the *saved-to-client* record.

---

## 6. The worker — where the long run actually executes

This is the crux on serverless. Three viable options:

### Option A — Standalone Node worker (recommended when self-hosting)
A small always-on Node process (same repo, separate entrypoint) that:
1. Claims a `queued` job (`update ... set status='running' where id = (select id ... for update skip locked)`),
   or subscribes via Supabase Realtime / `pg_notify`.
2. Runs `streamChat("ubo", …)` to completion (no HTTP timeout — it is not a request handler).
3. Writes `progress` incrementally, then `markdown`/`header` + `status='done'` (or `error`).

- **Pros:** host-agnostic, no platform timeout, simplest mental model, reuses `lib/dify.ts` as-is.
- **Cons:** one more process to run (fine on Render/Railway/Fly/a VM; can be the same box).

### Option B — Durable workflow service (recommended when staying on Vercel)
Use **Inngest** or **Trigger.dev** — purpose-built for long-running steps that exceed serverless
limits. The Next app `await inngest.send("ubo/investigate", …)`; the durable function runs the agent
to completion off the request path and writes results to `ubo_jobs`.

- **Pros:** stay fully on Vercel; retries/observability built in.
- **Cons:** new third-party dependency + its own keys.

### Option C — Dify-side completion webhook
If the Dify workflow can POST back on completion, expose `POST /api/ubo/jobs/:id/callback` that the
agent calls with the final report; the request handler just records it.

- **Pros:** no worker process.
- **Cons:** depends on Dify workflow webhook support; harder to surface live progress.

> **Default pick:** Option A if you self-host (you already proved a plain Node host runs a 236s job
> fine), Option B if you must stay on Vercel.

---

## 7. API surface

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/ubo/jobs` | Create a turn-2 job `{ company_name, jurisdiction, params, client_id? }` → `{ job_id }` (fast). |
| `GET`  | `/api/ubo/jobs/:id` | Poll: `{ status, progress[], markdown?, header?, error? }`. |
| `GET`  | `/api/ubo/jobs?client_id=…` | (Optional) list a client's runs. |

Polling cadence: ~2–3s. Or skip polling entirely with a **Supabase Realtime** subscription on the
row (push updates). A job stuck in `running` past a hard ceiling (e.g. 8 min) is swept to `error` by
the worker/a cron so the UI never hangs forever.

---

## 8. Client (Ownership panel) changes

- After candidate selection, instead of opening the long SSE stream, `POST /api/ubo/jobs` and store
  the returned `job_id` (in component state **and** `localStorage`, keyed by client/company).
- Render progress by polling `GET /api/ubo/jobs/:id` (reuse the existing progress-line UI).
- On `status==='done'`, render `<UboReport>` + the existing **Save to profile** bar.
- **Resilience:** on mount, if a `job_id` exists in `localStorage` and its job is still `running`,
  re-attach and resume showing progress — refresh no longer loses the run.

`useUboInvestigation` gains a job-polling mode alongside the current streaming mode; gate it behind a
flag (`NEXT_PUBLIC_UBO_JOBS=1`) so the synchronous path stays as a fallback during rollout.

---

## 9. Rollout

1. Run the `ubo_jobs` migration in Supabase (one-time, manual — no DDL via REST key).
2. Ship the worker (Option A/B) + the two job routes behind the flag, flag OFF.
3. Flip the flag on in a non-prod env; verify a 4-min run completes, survives a mid-run refresh, and
   is visible from a second tab.
4. Enable in prod. Keep the synchronous path one release as fallback, then remove.

### Risks / edge cases
- **Idempotency:** don't double-spawn the agent if `POST /jobs` is retried — dedupe on
  `(client_id, company_name, recent created_at)` or an idempotency key.
- **Cost:** background runs complete even if the user leaves — a `cancel` action should set
  `status='error'`/`'canceled'` and abort the worker's Dify fetch.
- **Stuck jobs:** worker watchdog / cron to fail jobs running past the ceiling.
- **Two-turn coupling:** resolve stays synchronous (§4); the job carries the `conversationId` from
  turn 1 so turn 2 runs on the same Dify conversation.

---

## 10. TL;DR

- UBO full runs take **60s–~4min** (measured 236s) and are variable. Serverless request timeouts
  (Vercel Hobby 60s / Pro 300s) cannot reliably hold them.
- Already shipped: 10s heartbeat, `maxDuration=300`, upstream-abort-on-disconnect → makes the
  **synchronous** design work on a **non-serverless host** and survive idle proxies.
- For **serverless hosting** or **refresh/multi-viewer resilience**, move turn-2 to a **background
  job**: `ubo_jobs` table + a worker (standalone Node, or Inngest/Trigger.dev on Vercel) + poll/
  Realtime. Keep turn-1 disambiguation synchronous.
