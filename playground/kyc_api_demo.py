#!/usr/bin/env python3
"""
kyc_api_demo.py
===============
Walks every KnowYourCustomer (KYB) API call for ONE company and prints the raw
output of each step, so you can show exactly what the API returns.

Example company: "Insight Tech Limited" (Gibraltar / GI)  ->  UBO: Margaret Louise Janke, 100%

Run:
    pip install requests          # only dependency
    python kyc_api_demo.py
    # or override:  python kyc_api_demo.py "Insight Tech Limited" GI
"""
import sys, json, time, requests

# --- Sandbox credentials (safe to share; this is the KYB sandbox) ---------
BASE      = "https://api.knowyourcustomer.dev"
CLIENT_ID = "sbx_3q3cbWJKPpBL"
SECRET    = "nncst0ImcCjcyMBov0aeR4a2r7mbpc0lcWw4pvoutL4"

COMPANY = sys.argv[1] if len(sys.argv) > 1 else "Insight Tech Limited"
COUNTRY = sys.argv[2] if len(sys.argv) > 2 else "GI"   # ISO 3166 (GI=Gibraltar, GB=UK, ...)

STATUS = {0:"created",50:"queued",51:"processing",53:"verifying",54:"resolving ownership",
          9:"AML screening",100:"documents",107:"consolidating",3:"READY"}


def show(title, obj, limit=2500):
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)
    txt = json.dumps(obj, indent=2, ensure_ascii=False)
    print(txt if len(txt) <= limit else txt[:limit] + f"\n... [truncated, {len(txt)} chars total]")


# --- 1. OAuth2 token (client_credentials) ---------------------------------
print(f"\n### STEP 1 — POST {BASE}/connect/token   (get a bearer token, ~10 min TTL)")
tok = requests.post(f"{BASE}/connect/token", data={
    "grant_type": "client_credentials", "client_id": CLIENT_ID,
    "client_secret": SECRET, "scope": "PublicApi"}, timeout=30).json()
show("TOKEN RESPONSE", {**tok, "access_token": tok["access_token"][:32] + "...(truncated)"})
H = {"Authorization": f"Bearer {tok['access_token']}"}
HJ = {**H, "Content-Type": "application/json"}

# --- 2. Search the company ------------------------------------------------
print(f"\n### STEP 2 — POST {BASE}/v2/Companies/search   body={{'query': '{COMPANY}', 'codeiso31662': '{COUNTRY}'}}")
search = requests.post(f"{BASE}/v2/Companies/search", headers=HJ,
                       json={"query": COMPANY, "codeiso31662": COUNTRY}, timeout=30).json()
show("SEARCH RESPONSE", search)
results = (search.get("companySearch") or {}).get("results") or []
if not results:
    print(f"\n>> No match for '{COMPANY}' in {COUNTRY}. (Sandbox GI only has: "
          f"Insight Tech Limited, PREMIER INTERNATIONAL CORPORATE SERVICES LIMITED)")
    sys.exit(0)
match   = results[0]
rawname = match.get("rawname") or match.get("name")
regnum  = match.get("externalCode") or match.get("registrationNumber")
print(f"\n>> matched: {rawname}  (reg {regnum})")

# --- 3. Create a KYB case -------------------------------------------------
print(f"\n### STEP 3 — POST {BASE}/v2/Companies   (open a KYB case -> caseCommonId)")
body = {"rawname": rawname, "codeiso31662": COUNTRY}
if regnum:
    body["externalCode"] = regnum
created = requests.post(f"{BASE}/v2/Companies", headers=HJ, json=body, timeout=30).json()
case_id = ((((created.get("caseDetail") or {}).get("details") or {}).get("common") or {}).get("caseCommonId"))
show("CREATE RESPONSE (trimmed)", {"caseCommonId": case_id,
     "statusId": ((((created.get('caseDetail') or {}).get('details') or {}).get('common') or {}).get('statusId'))})
print(f"\n>> caseCommonId = {case_id}")

# --- 4. Poll until Ready (statusId == 3) ----------------------------------
print(f"\n### STEP 4 — GET {BASE}/v2/Companies/{{caseCommonId}}   (poll every 3s until statusId==3)")
t0 = time.time()
case = {}
for _ in range(40):
    case = requests.get(f"{BASE}/v2/Companies/{case_id}", headers=H, timeout=30).json()
    sid = ((((case.get("caseDetail") or {}).get("details") or {}).get("common") or {}).get("statusId"))
    print(f"   t={time.time()-t0:5.1f}s   statusId={sid}  ({STATUS.get(sid,'?')})")
    if sid == 3:
        break
    time.sleep(3)

# --- 5. Members -----------------------------------------------------------
print(f"\n### STEP 5 — GET {BASE}/v2/Companies/{{caseCommonId}}/members")
members = requests.get(f"{BASE}/v2/Companies/{case_id}/members", headers=H, timeout=30).json()
show("MEMBERS RESPONSE", members)

# --- 6. Org-chart (the ownership tree) ------------------------------------
print(f"\n### STEP 6 — GET {BASE}/v2/Companies/{{caseCommonId}}/org-chart")
chart = requests.get(f"{BASE}/v2/Companies/{case_id}/org-chart", headers=H, timeout=30).json()
show("ORG-CHART RESPONSE", chart, limit=6000)

# --- 7. Plain-English summary (the UBOs) ----------------------------------
print("\n" + "=" * 78)
print("SUMMARY — Ultimate Beneficial Owners (natural persons with a % stake)")
print("=" * 78)
NAT = {0:"",2:"British",3:"Chinese (HK)",193:"Singaporean",198:"South African"}
def walk(n, seen):
    if not isinstance(n, dict):
        return
    nm = n.get("name") or (n.get("member") or {}).get("entityName")
    pct, role = n.get("effectivePercentage"), n.get("role")
    if isinstance(pct, (int, float)) and pct > 0 and (nm, pct) not in seen:
        seen.add((nm, pct))
        nat = n.get("nationalityId"); nat = nat if isinstance(nat, str) else NAT.get(nat, "")
        aml = " [AML ALERT]" if n.get("isUnresolvedAML") else ""
        print(f"   {nm:<34} {pct:>6}%   {nat or '-':<14} role={role}{aml}")
    for k in ("shareholders", "others", "officers"):
        for c in (n.get(k) or []):
            walk(c, seen)
walk(chart, set())
print("\nDone.")
