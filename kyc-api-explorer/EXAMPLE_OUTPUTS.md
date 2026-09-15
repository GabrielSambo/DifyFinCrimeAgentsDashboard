# KnowYourCustomer (KYB) API — full endpoint tour with real sandbox outputs

Key: the Gibraltar KYB key from the UBO agent (`GIBRALTAR_KYC_CLIENT_*`).
Base: `https://api.knowyourcustomer.dev` · Auth: OAuth2 client-credentials (scope `PublicApi`).
Run it yourself: `python3 kyc_explore.py` (guided tour) or the sub-commands below.

> This is a **sandbox / demo tenant** ("Credlink - DEMO"). Data is fixed demo data, not live registry data.

---

## What the key can reach (probe result)

| Endpoint | Method | Status | Notes |
|---|---|---|---|
| `/connect/token` | POST | 200 | OAuth token, 600s TTL, scope `PublicApi` |
| `/health` | GET | 200 | service health/version |
| `/v2/Jurisdictions` | GET | 200 | 251 jurisdictions + data sources |
| `/v2/Companies` | GET | 200 | **lists existing cases = ready-made test companies** |
| `/v2/Companies/search` | POST | 200 | search a registry by name + ISO code |
| `/v2/Companies` | POST | 200 | create a KYB case (kicks off resolution) |
| `/v2/Companies/{id}` | GET | 200 | full case detail (identity, address, AML summary, data sources) |
| `/v2/Companies/{id}/org-chart` | GET | 200 | ownership/control tree (UBOs, directors, shareholders) |
| `/v2/Documents` | GET | 405 | exists but not GET-able this way |
| everything else probed | — | 404 | not present (no `/Persons`, `/Account`, `/swagger`, etc.) |

---

## 1. `POST /connect/token`
```json
{ "access_token": "eyJhbGciOiJI…", "token_type": "Bearer", "expires_in": 600, "scope": "PublicApi" }
```

## 2. `GET /health`
```json
{ "status": "ok", "version": "1.0.0", "commit": "f0fe830a…", "buildTime": "2026-09-14T08:31:03Z" }
```

## 3. `GET /v2/Jurisdictions` (251 total — sample)
```json
{ "jurisdictions": { "jurisdiction": [
  { "name": "United Kingdom", "codeiso31662": "GB", "area": "Europe", "isautomated": true, "dataSources": ["CompaniesHouse"] },
  { "name": "Hong Kong",      "codeiso31662": "HK", "area": "Asia",   "isautomated": true, "dataSources": ["HKCR","IRD"] },
  { "name": "Singapore",      "codeiso31662": "SG", "area": "Asia",   "isautomated": true, "dataSources": ["ACRA"] },
  { "name": "Gibraltar",      "codeiso31662": "GI", "area": "Europe", "isautomated": true, "dataSources": ["demo-harvest"] }
]}}
```
Real/automated registries: **GB** (CompaniesHouse), **HK** (HKCR/IRD), **SG** (ACRA), **US** (OpenCorporates),
**IE** (CRO), **DE** (Handelsregister), **CY** (DRCOR), **MT** (MBR). Everything else is `demo-harvest` or manual.

## 4. `POST /v2/Companies/search`  body `{"query":"insight","codeiso31662":"GI"}`
```json
{ "companySearch": { "results": [
  { "name": "Insight Tech Limited", "rawname": "Insight Tech Limited", "type": "Company",
    "externalCode": "122223", "registrationNumber": "122223", "companyStatus": "Active",
    "caseCommonId": 2000236, "dataSource": "demo-harvest", "countryCodeISO31662": "GI" }
]}}
```

## 5. `POST /v2/Companies`  (create case) → then poll `GET /v2/Companies/{id}`
Status walks through `statusId` 0 → 50 → 53 → 9 → **3 (Ready)** over ~24s. The Ready case detail includes:
- `company.properties` — type, status, registration number, incorporation date, other identifier (`GICO.122223-77`)
- `caseAddress` — `5 SECRETARY'S LANE, GIBRALTAR, GX11 1AA`
- `caseAmlSummary.worldCheckSummary` — pep / sanctions / terrorism / crimes / law-enforcement flags (all `NoMatches`)
- `stepDataSource` — provenance per step (Company Identity, Director, Secretary, Shareholder, UBO, AML)
- `allUbosIdentified: "Yes"`, `isCaseAMLPositive: false`

## 6. `GET /v2/Companies/{id}/org-chart`  (the ownership tree — what the UBO agent parses)
```json
{
  "name": "Insight Tech Limited", "role": "Spose", "jurisdictionId": 86,
  "others": [
    { "name": "Margaret Louise Janke", "role": "UltimateBeneficialOwner",
      "shares": 100.0, "effectivePercentage": 100.0, "nationalityId": 198, "isUnresolvedAML": false }
  ],
  "officers": [
    { "name": "PREMIER INTERNATIONAL CORPORATE SERVICES LIMITED", "role": "Secretary", "jurisdictionId": 86 },
    { "name": "Margaret Louise Janke", "role": "Director", "nationalityId": 198 }
  ],
  "shareholders": [
    { "name": "Margaret Louise Janke", "role": "Shareholder", "shares": 100.0, "effectivePercentage": 100.0 }
  ]
}
```
Tree fields: `others`/`officers`/`shareholders` recurse; each node has `role`, `shares`,
`effectivePercentage`, `nationalityId` (198 = South African), `isUnresolvedAML` (the AML alert flag).

---

## Ready-made test companies (from `GET /v2/Companies`)

| ISO | Company | Reg # | Status |
|---|---|---|---|
| GI | Insight Tech Limited | 122223 | Ready |
| GB | CROPWELL BISHOP CREAMERY LIMITED | 00364890 | Ready |
| SG | SC ENGINEERING PRIVATE LIMITED | 200815219G | Ready |
| HK | Ubizense Limited | 69293323 | Ready |
| GB | Thames Valley Logistics Ltd | — | Ready |
| — | Charwyne Maritime Trading FZE | — | Ready |

Try them: `python3 kyc_explore.py full "CROPWELL BISHOP CREAMERY LIMITED" GB`

Raw full dumps are in `scratchpad/kyc_probe.txt`, `scratchpad/kyc_outputs_part1.txt`, `scratchpad/kyc_full_case.txt`.
