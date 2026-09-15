# Gibraltar UBO Register — no-browser lookup

Pull **free** current beneficial-ownership data from Gibraltar's official public UBO register
([ubosearch.egov.gi](https://ubosearch.egov.gi/)) using plain HTTP — **no browser, no Playwright**.

Gibraltar's register is intentionally public and free for the *current* ownership snapshot.
(Only *historical* snapshots are pay-per-view — this tool never touches the payment flow.)

---

## Setup

```bash
pip install -r requirements.txt      # just: requests
```

## Run

```bash
# readable output
python3 gi_ubo_register.py "Gibtelecom"

# structured JSON
python3 gi_ubo_register.py "Bassadone" --json

# search by registration number works too
python3 gi_ubo_register.py "37905"
```

## Companies to test (verified working)

| Search term | Company | EICN | Owner type |
|---|---|---|---|
| `Gibtelecom` | GIBTELECOM LTD | 37905 | entities (HM Gov of Gibraltar 75% + Gibraltar Savings Bank) |
| `Bassadone` | BASSADONE AUTO WORLD LIMITED | 118133 | individual (100%) |
| `Hassans` | HASSANS ADMINISTRATIVE SERVICES LIMITED | 123099 | individual (32%) |
| `Bland` | BLAND LIMITED | 03044 | — |
| `Isolas` | ISOLAS LLP | 00001 | — |

Example:

```
$ python3 gi_ubo_register.py "Bassadone"

BASSADONE AUTO WORLD LIMITED  (EICN 118133)
  snapshot: 15/Sep/2026 14:46:21  |  category: Individual
    - GEORGE ALFRED CHARLES BASSADONE [person, Active]
      (b. October 1953, Company Director, nat. UNITED KINGDOM, res. Italy)  voting 100.0%, shares 100.0%
```

---

## What you get back

Per company: `name`, `eicn`, `snapshot_date`, `owner_category`, and a list of `beneficial_owners`.
Per owner:

| Field | Notes |
|---|---|
| `name` | owner name |
| `type` | `person` or `entity` |
| `date_of_birth` | month + year (individuals) |
| `occupation` | individuals |
| `nationality` | individuals |
| `residence` | individuals |
| `status` | `Active` / `Inactive` |
| `voting_rights_pct` | may be null if not stated |
| `shares_pct` | may be null if not stated |

See `sample_output.json` for a full example.

---

## How it works (4 plain HTTP calls — no browser)

```
1. GET  /                                   -> session cookie + ASP.NET viewstate
2. POST /                                   -> search postback; result has Get_payment('<encId>')
3. POST /Default.aspx/PayPerViewInternal     {"actualSnapshot":"<encId>"}
                                            -> {"d":{"Paid":true,"Saved":true,"Code":"<id>"}}   (£0, latest)
4. GET  /CompanyDetails?ID=<Code>           -> UBO HTML -> parsed into structured owners
```

The step-3 "payment" returns `Paid:true` at **£0** for the current snapshot — that's just how the
site's ASP.NET page-method is wired; no card, no charge. Roughly ~1s per lookup.

---

## Responsible use

- **Free surface only** — do not automate the historical-snapshot payment (`See snapshot`).
- **Be polite** — one query at a time, cache results, set a real User-Agent (edit `UA` in the script).
- **Personal data** — individual DOB / nationality / residence are personal data; handle and retain
  under a documented AML/KYC basis.
- Public-register data; verify against source for anything decision-critical.

---

## Hosting as a tool (Azure Function / Foundry)

Because it's pure HTTP (no Chromium), `lookup(company)` drops cleanly into a serverless
Azure Function (HTTP trigger) or Container App, which a Foundry agent can call as a custom /
OpenAPI tool — sitting alongside the KYB registry tool as a free Gibraltar source.
