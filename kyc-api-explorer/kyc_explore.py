#!/usr/bin/env python3
"""
kyc_explore.py — Standalone explorer for the KnowYourCustomer (KYB) API.

This is the *Gibraltar* registry API that the UBO agent uses (api.knowyourcustomer.dev),
NOT UK Companies House. It authenticates with OAuth2 client-credentials and dumps the
RAW, UNFILTERED JSON from every endpoint so you can see everything the key can reach —
not just the UBO name/percentage slice the agent keeps.

Auth flow (from the agent):
    POST /connect/token  (grant_type=client_credentials, scope=PublicApi) -> access_token
    Authorization: Bearer <token>

Known endpoints (used by the agent):
    POST /v2/Companies/search            {"query": name, "codeiso31662": "GI"}
    POST /v2/Companies                   create a KYB case -> caseCommonId
    GET  /v2/Companies/{caseId}          case status (statusId==3 -> Ready)
    GET  /v2/Companies/{caseId}/org-chart

Usage:
    python3 kyc_explore.py                      # guided tour: auth + probe + a GI search
    python3 kyc_explore.py auth                 # get a token and show the raw token response
    python3 kyc_explore.py probe                # probe candidate endpoints, report which work
    python3 kyc_explore.py search "<query>" GI  # search companies in a jurisdiction (ISO 3166-2)
    python3 kyc_explore.py full "<query>" GI    # search -> create case -> poll -> org-chart (all raw)
    python3 kyc_explore.py dumpall              # dump every test company's org-chart to one JSON file
    python3 kyc_explore.py get "/v2/....."       # raw GET on any path
    python3 kyc_explore.py post "/v2/..." '{...json...}'   # raw POST on any path

Credentials come from env first, then fall back to the repo sandbox values:
    GIBRALTAR_KYC_CLIENT_ID, GIBRALTAR_KYC_CLIENT_SECRET, KYC_BASE, KYC_SCOPE
"""
import json
import os
import sys
import time

import requests


def _load_dotenv(path=".env"):
    """Minimal .env loader (no dependency). Values already in the environment win."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

# --- config -----------------------------------------------------------------
# Credentials come from a local .env file (copy .env.example -> .env) or the
# environment. Nothing sensitive is hardcoded here. These are SANDBOX creds.
BASE = os.environ.get("KYC_BASE", "https://api.knowyourcustomer.dev").rstrip("/")
CLIENT_ID = os.environ.get("GIBRALTAR_KYC_CLIENT_ID", "sbx_3q3cbWJKPpBL")
CLIENT_SECRET = os.environ.get("GIBRALTAR_KYC_CLIENT_SECRET", "")
SCOPE = os.environ.get("KYC_SCOPE", "PublicApi")
TIMEOUT = float(os.environ.get("KYC_TIMEOUT", "20"))

if not CLIENT_SECRET:
    sys.stderr.write(
        "ERROR: GIBRALTAR_KYC_CLIENT_SECRET is not set.\n"
        "  cp .env.example .env   # then paste the sandbox secret into .env\n"
        "  (or: export GIBRALTAR_KYC_CLIENT_SECRET=...)\n"
    )
    sys.exit(2)


# --- helpers ----------------------------------------------------------------
def _p(label, obj):
    """Pretty-print a raw JSON blob under a header."""
    print("\n" + "=" * 78)
    print(label)
    print("=" * 78)
    if isinstance(obj, (dict, list)):
        print(json.dumps(obj, indent=2, ensure_ascii=False, default=str))
    else:
        print(obj)


def _body(resp):
    try:
        return resp.json()
    except Exception:
        return resp.text


def get_token():
    """OAuth2 client-credentials. Returns (access_token, raw_token_response)."""
    r = requests.post(
        BASE + "/connect/token",
        data={
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "scope": SCOPE,
        },
        timeout=TIMEOUT,
    )
    raw = _body(r)
    if r.status_code != 200:
        _p(f"TOKEN FAILED (HTTP {r.status_code})", raw)
        sys.exit(1)
    return raw.get("access_token"), raw


def call(method, path, token, json_body=None, params=None, quiet=False):
    """Raw call. Prints status + body, returns (status_code, parsed_body)."""
    url = BASE + path if path.startswith("/") else BASE + "/" + path
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    if json_body is not None:
        headers["Content-Type"] = "application/json"
    r = requests.request(
        method, url, headers=headers, json=json_body, params=params, timeout=TIMEOUT
    )
    body = _body(r)
    if not quiet:
        _p(f"{method} {path}  ->  HTTP {r.status_code}", body)
    return r.status_code, body


# --- commands ---------------------------------------------------------------
def cmd_auth():
    token, raw = get_token()
    # scrub the token itself from the printed blob, keep the metadata (expiry/scope/type)
    shown = dict(raw)
    if "access_token" in shown:
        shown["access_token"] = shown["access_token"][:12] + "…(truncated)"
    _p("TOKEN RESPONSE (what your key is allowed to do)", shown)
    print("\nToken acquired OK. scope =", raw.get("scope"), "| expires_in =", raw.get("expires_in"))
    return token


def cmd_search(query, iso="GI"):
    token, _ = get_token()
    status, body = call(
        "POST", "/v2/Companies/search", token,
        json_body={"query": query, "codeiso31662": iso},
    )
    # surface the candidate list compactly so you can pick test companies
    results = ((body or {}).get("companySearch") or {}).get("results") or [] if isinstance(body, dict) else []
    if results:
        print(f"\n--- {len(results)} candidate(s) for '{query}' [{iso}] ---")
        for i, c in enumerate(results):
            print(f"  [{i}] {c.get('rawname') or c.get('name')}  "
                  f"| reg={c.get('externalCode') or c.get('registrationNumber')}  "
                  f"| status={c.get('status')}")
    return body


def cmd_full(query, iso="GI", max_wait=90):
    token, _ = get_token()

    # 1) search
    _, sbody = call("POST", "/v2/Companies/search", token,
                    json_body={"query": query, "codeiso31662": iso})
    results = ((sbody or {}).get("companySearch") or {}).get("results") or []
    if not results:
        print("No search results; nothing to create a case for.")
        return
    match = results[0]
    name = match.get("rawname") or match.get("name") or query
    regnum = match.get("externalCode") or match.get("registrationNumber") or ""
    print(f"\n>> Creating KYB case for: {name} (reg {regnum}) [{iso}]")

    # 2) create case
    cbody_req = {"rawname": name, "codeiso31662": iso}
    if regnum:
        cbody_req["externalCode"] = regnum
    _, cbody = call("POST", "/v2/Companies", token, json_body=cbody_req)
    case_id = ((((cbody or {}).get("caseDetail") or {}).get("details") or {})
               .get("common") or {}).get("caseCommonId")
    if not case_id:
        print("No caseCommonId returned — stopping.")
        return
    print(f">> case_id = {case_id}")

    # 3) poll status until Ready (statusId==3) or timeout
    waited = 0
    while waited < max_wait:
        time.sleep(6)
        waited += 6
        status, pbody = call("GET", f"/v2/Companies/{case_id}", token, quiet=True)
        sid = (((pbody or {}).get("caseDetail") or {}).get("details") or {}).get("common", {}).get("statusId")
        print(f"   ...polled at {waited}s -> statusId={sid}")
        if sid == 3:
            _p(f"CASE READY — full raw case detail (/v2/Companies/{case_id})", pbody)
            break
    else:
        print("Case did not reach Ready within budget; showing last state anyway.")
        _p(f"LAST CASE STATE (/v2/Companies/{case_id})", pbody)

    # 4) org-chart (the full ownership tree, raw)
    call("GET", f"/v2/Companies/{case_id}/org-chart", token)


# Candidate endpoints to discover what else the key can reach.
# GETs are safe/read-only; we only probe, we don't mutate.
PROBE_GETS = [
    "/v2/Companies",
    "/v2/Companies/jurisdictions",
    "/v2/Jurisdictions",
    "/v2/Countries",
    "/v2/Reference/jurisdictions",
    "/v2/Reference/countries",
    "/v2/Products",
    "/v2/Account",
    "/v2/Account/balance",
    "/v2/Account/usage",
    "/v2/Persons",
    "/v2/Persons/search",
    "/v2/Documents",
    "/v2/Filings",
    "/health",
    "/swagger/v1/swagger.json",
    "/swagger/index.html",
    "/.well-known/openid-configuration",
]


def cmd_probe():
    token, _ = get_token()
    print("\nProbing candidate endpoints (read-only). 200/201 = reachable.\n")
    hits = []
    for path in PROBE_GETS:
        try:
            status, body = call("GET", path, token, quiet=True)
        except Exception as e:
            print(f"  ERR  {path}  ({e})")
            continue
        marker = "OK " if status < 300 else ("AUTH" if status in (401, 403) else "   ")
        print(f"  [{status}] {marker} {path}")
        if status < 300:
            hits.append((path, body))
    for path, body in hits:
        _p(f"BODY OF {path}", body)
    if not hits:
        print("\nNo candidate GET returned 2xx. The API may be POST-only under /v2/Companies.")
    # Also show the OIDC discovery doc if available — it lists real scopes/endpoints.
    return hits


def _flatten_orgchart(node, depth=0, out=None):
    """Walk the recursive org-chart into flat rows (name/role/%/nationality/AML)."""
    if out is None:
        out = []
    if not isinstance(node, dict):
        return out
    if depth > 0:
        out.append({
            "depth": depth,
            "name": node.get("name"),
            "role": node.get("role"),
            "shares": node.get("shares"),
            "effective_pct": node.get("effectivePercentage"),
            "nationalityId": node.get("nationalityId"),
            "aml_flag": bool(node.get("isUnresolvedAML")),
        })
    for group in ("shareholders", "others", "officers"):
        for child in (node.get(group) or []):
            _flatten_orgchart(child, depth + 1, out)
    return out


def cmd_dumpall(out_path="scratchpad/kyc_all_orgcharts.json"):
    """List every case, dedupe to one Ready case per (name, ISO), dump each org-chart."""
    token, _ = get_token()
    status, cases = call("GET", "/v2/Companies", token, quiet=True)
    if not isinstance(cases, list):
        print("Unexpected /v2/Companies response; aborting."); return

    # dedupe: first Ready case per (entityName, ISO)
    picked = {}
    for c in cases:
        common = c.get("common", {}) or {}
        company = c.get("company", {}) or {}
        name = company.get("entityName")
        iso = company.get("countryCodeISO31662")
        cid = common.get("caseCommonId")
        if not (name and cid):
            continue
        if (common.get("statusName") or "").lower() != "ready":
            continue
        key = (name, iso)
        if key not in picked:
            props = company.get("properties", {}) or {}
            picked[key] = {"name": name, "iso": iso, "case_id": cid,
                           "reg": props.get("Registration Number", "")}

    print(f"\nFound {len(picked)} unique Ready compan(ies). Dumping org-charts...\n")
    results = []
    for info in picked.values():
        cid = info["case_id"]
        st, chart = call("GET", f"/v2/Companies/{cid}/org-chart", token, quiet=True)
        ok = st == 200 and isinstance(chart, dict)
        rows = _flatten_orgchart(chart) if ok else []
        ubos = [r for r in rows if (r["role"] or "") == "UltimateBeneficialOwner"]
        results.append({**info, "http": st, "org_chart": chart if ok else None,
                        "flattened": rows})
        print(f"  [{st}] {info['iso'] or '--':>3} | {info['name']:<40} "
              f"| nodes={len(rows):<2} | UBOs={len(ubos)}")
        for u in ubos:
            print(f"          -> UBO: {u['name']} ({u['effective_pct']}%)  AML={u['aml_flag']}")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nWrote {len(results)} org-charts -> {out_path}")
    return results


def cmd_get(path):
    token, _ = get_token()
    call("GET", path, token)


def cmd_post(path, body_json):
    token, _ = get_token()
    body = json.loads(body_json) if body_json else None
    call("POST", path, token, json_body=body)


def cmd_tour():
    print("KnowYourCustomer (KYB) API explorer — guided tour")
    print(f"BASE={BASE}  CLIENT_ID={CLIENT_ID[:10]}…  SCOPE={SCOPE}")
    cmd_auth()
    cmd_probe()
    # a broad GI search to reveal sandbox test companies
    print("\n\n### Sample Gibraltar (GI) searches to surface test companies ###")
    for q in ["insight", "limited", "holdings", "a"]:
        cmd_search(q, "GI")


# --- dispatch ---------------------------------------------------------------
def main():
    args = sys.argv[1:]
    if not args:
        cmd_tour(); return
    cmd = args[0].lower()
    if cmd == "auth":
        cmd_auth()
    elif cmd == "probe":
        cmd_probe()
    elif cmd == "search":
        cmd_search(args[1], args[2] if len(args) > 2 else "GI")
    elif cmd == "full":
        cmd_full(args[1], args[2] if len(args) > 2 else "GI")
    elif cmd == "dumpall":
        cmd_dumpall(args[1] if len(args) > 1 else "scratchpad/kyc_all_orgcharts.json")
    elif cmd == "get":
        cmd_get(args[1])
    elif cmd == "post":
        cmd_post(args[1], args[2] if len(args) > 2 else None)
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
