# Veritas — Client Due-Diligence Workstation

Veritas is an AML analyst workstation for client due diligence (CDD). Analysts onboard
clients, screen them against sanctions/PEP lists, trace corporate beneficial ownership,
track required documents, and monitor the book over time — all against a single client
record.

It is a **Next.js** application that talks to AI investigation agents and a **Supabase**
datastore through server-side API routes (no secrets ever reach the browser).

## Features

- **Dashboard** — portfolio view of every client with KYC-screening status and document
  status (requested / received / validated).
- **KYC Assistant** — conversational onboarding and review for new and existing clients.
- **Ownership & Screening** — beneficial-ownership tracing and PEP/sanctions screening,
  with toggleable investigation modules.
- **Client Profile** — the consolidated record: identity, screening, ownership, history,
  and a configurable review cadence.
- **Remediation** — document-focused monitoring: outstanding-document tracking, periodic
  re-screening, and document requests (RFI) to clients.

## Tech stack

- Next.js (App Router) · React · TypeScript · Tailwind CSS
- Supabase (PostgREST) for the client record of truth
- Server-side API routes proxy all agent/database calls and hold all credentials

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in your environment values
npm run dev                     # http://localhost:3000
```

Production build:

```bash
npm run build
npm run start
```

## Configuration

All configuration is via environment variables — see `.env.example` for the full list.
These are read **server-side only**; never expose service keys to the client. Provide
them through your hosting provider's environment settings (or a local `.env.local`,
which is gitignored).

## Deployment

Deploys cleanly to any Next.js-compatible host (e.g. Vercel): import the repository,
set the environment variables from `.env.example`, and deploy. Enable access protection
before sharing non-public environments.
