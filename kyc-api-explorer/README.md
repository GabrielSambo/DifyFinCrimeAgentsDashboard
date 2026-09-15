# KYC / KYB API Explorer

A **standalone** explorer for the KnowYourCustomer (KYB) API — the registry/UBO API that the
Veritas UBO agent uses for Gibraltar and other jurisdictions. It authenticates, then dumps the
**raw, unfiltered JSON** from every reachable endpoint so you can see exactly what the key can pull.

- **API base:** `https://api.knowyourcustomer.dev`
- **Auth:** OAuth2 client-credentials (`POST /connect/token`, scope `PublicApi`) → Bearer token
- **Environment:** this is a **sandbox / demo tenant** (`Credlink - DEMO`). Data is fixed demo data, not live registry data.

> ⚠️ This is **not** UK Companies House. It's a separate commercial KYB aggregator that *sources* from
> Companies House (GB), HKCR (HK), ACRA (SG), etc. See the jurisdictions table below.

---

## 1. Setup (30 seconds)

Requires Python 3.8+ and `requests`.

```bash
pip install requests
cp .env.example .env      # then paste the sandbox client secret into .env
```

The script auto-loads `.env` (which is git-ignored, so the secret is never committed).
You can also set the values as real environment variables instead of using `.env`.

---

## 2. Ready-to-run commands

```bash
# Guided tour: auth + probe every endpoint + sample Gibraltar searches
python3 kyc_explore.py

# Just authenticate and show what the key is allowed to do (scope + TTL)
python3 kyc_explore.py auth

# Probe every candidate endpoint and report which ones the key can reach
python3 kyc_explore.py probe

# List all 251 jurisdictions + which registry backs each
python3 kyc_explore.py get /v2/Jurisdictions

# List existing cases in the sandbox = ready-made test companies
python3 kyc_explore.py get /v2/Companies

# Search a registry by company name + ISO 3166-2 code
python3 kyc_explore.py search "Insight Tech Limited" GI
python3 kyc_explore.py search "CROPWELL BISHOP" GB

# Full end-to-end for one company: search -> create case -> poll -> org-chart (all raw)
python3 kyc_explore.py full "Insight Tech Limited" GI
python3 kyc_explore.py full "CROPWELL BISHOP CREAMERY LIMITED" GB

# Loop over EVERY test company and dump each org-chart into one JSON file
python3 kyc_explore.py dumpall
python3 kyc_explore.py dumpall my_output.json     # custom output path

# Raw call any endpoint yourself
python3 kyc_explore.py get  /v2/Companies/1000006369/org-chart
python3 kyc_explore.py post /v2/Companies/search '{"query":"Ubizense","codeiso31662":"HK"}'
```

---

## 3. What the key can reach

| Endpoint | Method | Status | What you get |
|---|---|---|---|
| `/connect/token` | POST | 200 | OAuth token, 600s TTL, scope `PublicApi` |
| `/health` | GET | 200 | service version/build |
| `/v2/Jurisdictions` | GET | 200 | 251 jurisdictions + backing data sources |
| `/v2/Companies` | GET | 200 | **list of existing cases = test companies** |
| `/v2/Companies/search` | POST | 200 | search a registry by name + ISO |
| `/v2/Companies` | POST | 200 | create a KYB case (resolves in ~24s) |
| `/v2/Companies/{id}` | GET | 200 | full case: identity, address, **AML/World-Check summary**, data-source provenance |
| `/v2/Companies/{id}/org-chart` | GET | 200 | **ownership/control tree** (UBOs, directors, shareholders, %, nationality, AML flags) |
| `/v2/Documents` | GET | 405 | exists but not GET-able this way |
| `/v2/Persons`, `/v2/Account`, `/swagger`, … | GET | 404 | not exposed on this key |

Full example payloads for each are in **[EXAMPLE_OUTPUTS.md](EXAMPLE_OUTPUTS.md)**.

---

## 4. Test companies (from `GET /v2/Companies`)

| ISO | Company | Reg # | Org-chart UBOs |
|---|---|---|---|
| GI | Insight Tech Limited | 122223 | Margaret Louise Janke (100%) |
| GB | CROPWELL BISHOP CREAMERY LIMITED | 00364890 | deep 55-node tree, none tagged UBO |
| SG | SC ENGINEERING PRIVATE LIMITED | 200815219G | Chin Eng Lee 34%, Chong Chwee Seng 33%, David Soon Kin Mun 33% |
| HK | Ubizense Limited | 69293323 | Kwong Man Cheng 40%, Sung Chi Chu 40% |
| GB | Thames Valley Logistics Ltd | — | none tagged |
| — | Charwyne Maritime Trading FZE | — | (no org-chart resolved) |

`sample_all_orgcharts.json` is a saved run of `dumpall` over all of the above.

---

## 5. Automated registries (subset of the 251 jurisdictions)

| ISO | Country | Data source |
|---|---|---|
| GB | United Kingdom | CompaniesHouse |
| HK | Hong Kong | HKCR, IRD |
| SG | Singapore | ACRA |
| US | United States | OpenCorporates |
| IE | Ireland | CRO |
| DE | Germany | Handelsregister |
| CY | Cyprus | DRCOR |
| MT | Malta | MBR |
| GI | Gibraltar | demo-harvest |

Everything else is `demo-harvest` (sandbox) or `manual`. Run `python3 kyc_explore.py get /v2/Jurisdictions` for the full list.

---

## 6. Files

| File | What it is |
|---|---|
| `kyc_explore.py` | the explorer CLI |
| `README.md` | this guide |
| `.env.example` | credential template |
| `EXAMPLE_OUTPUTS.md` | real example JSON for every endpoint |
| `sample_all_orgcharts.json` | saved `dumpall` output for all test companies |
