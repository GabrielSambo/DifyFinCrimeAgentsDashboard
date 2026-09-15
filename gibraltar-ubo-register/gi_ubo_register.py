#!/usr/bin/env python3
"""
gi_ubo_register.py — pull FREE latest UBO data from Gibraltar's official public
UBO register (https://ubosearch.egov.gi/) using plain HTTP. NO browser required.

The register is intentionally public and free for the *current* ownership snapshot
(historical snapshots are the only pay-per-view part — this never touches payment).

How it works (all plain requests, 4 calls):
  1. GET  /                         -> session cookie + ASP.NET viewstate tokens
  2. POST /                         -> search postback; result carries Get_payment('<encId>')
  3. POST /Default.aspx/PayPerViewInternal  {"actualSnapshot":"<encId>"}
                                    -> {"d":{"Paid":true,"Saved":true,"Code":"<id>"}}  (£0 for latest)
  4. GET  /CompanyDetails?ID=<Code> -> the UBO HTML, parsed into structured owners

Requires only:  pip install requests

Usage:
  python3 gi_ubo_register.py "Gibtelecom"
  python3 gi_ubo_register.py "Bassadone" --json
"""
import html
import json
import re
import sys

import requests

BASE = "https://ubosearch.egov.gi/"
UA = "Mozilla/5.0 (compliance/KYC research; contact your-email)"


def _hidden(name, text):
    m = re.search(r'name="%s"[^>]*value="([^"]*)"' % re.escape(name), text)
    return html.unescape(m.group(1)) if m else ""


def _text(fragment):
    x = re.sub(r"<script.*?</script>", " ", fragment, flags=re.S | re.I)
    x = re.sub(r"<style.*?</style>", " ", x, flags=re.S | re.I)
    x = re.sub(r"<[^>]+>", " ", x)
    return re.sub(r"\s+", " ", html.unescape(x)).strip()


def _field(text, label):
    m = re.search(label + r":\s*([^:]+?)(?:\s+(?:Occupation|Nationality|Residence|Voting|Shares|Active|Inactive)\b|$)",
                  text, re.I)
    return m.group(1).strip() if m else None


def _pct(text, label):
    m = re.search(label + r":\s*([\d.]+)\s*%", text, re.I)
    return float(m.group(1)) if m else None


def lookup(company, session=None, take=1):
    s = session or requests.Session()
    s.headers.setdefault("User-Agent", UA)

    r = s.get(BASE, timeout=25)
    form = {
        "__EVENTTARGET": "", "__EVENTARGUMENT": "",
        "__VIEWSTATE": _hidden("__VIEWSTATE", r.text),
        "__VIEWSTATEGENERATOR": _hidden("__VIEWSTATEGENERATOR", r.text),
        "__EVENTVALIDATION": _hidden("__EVENTVALIDATION", r.text),
        "search": company,
    }
    r2 = s.post(BASE, data=form, timeout=25, headers={"Referer": BASE})

    # each result row: <button ... onclick="...Get_payment('<encId>')">NAME (EICN: 12345)</button>
    rows = re.findall(r"Get_payment\('([^']+)'\)[^>]*>\s*([^<(]+?)\s*\(EICN:?\s*(\d+)\)", r2.text)
    result = {"query": company, "found": bool(rows), "companies": []}
    for enc, name, eicn in rows[:take]:
        r3 = s.post(BASE + "Default.aspx/PayPerViewInternal",
                    data=json.dumps({"actualSnapshot": enc}),
                    headers={"Content-Type": "application/json; charset=utf-8", "Referer": BASE},
                    timeout=25)
        d = (r3.json() or {}).get("d") or {}
        code = d.get("Code")
        if not (d.get("Paid") and code):
            result["companies"].append({"name": _text(name), "eicn": eicn, "error": "no free snapshot code"})
            continue
        r4 = s.get(BASE + "CompanyDetails?ID=" + code, timeout=25, headers={"Referer": BASE})
        result["companies"].append(_parse_details(r4.text, _text(name), eicn))
    return result


def _parse_details(page_html, name, eicn):
    detail = {"name": name, "eicn": eicn, "beneficial_owners": []}
    body = _text(page_html)
    sd = re.search(r"Snapshot Date:\s*([0-9]{2}/[A-Za-z]{3}/[0-9]{4}(?:\s[0-9:]+)?)", body)
    if sd:
        detail["snapshot_date"] = sd.group(1)
    sec = re.search(r"Ultimate Beneficial Owner\(s\)\s*\(([^)]+)\)", body)
    if sec:
        detail["owner_category"] = sec.group(1).strip()   # "Individual" or "relevant legal entity"

    # split into owner cards on the repeated `row detail` container
    for chunk in re.split(r'class="row detail"', page_html)[1:]:
        ct = _text(chunk)
        headm = re.match(r"(.+?)\s+(Active|Inactive)\b", ct)
        if not headm:
            continue
        raw_name = headm.group(1)
        status = headm.group(2)
        dob = None
        dm = re.search(r"(.*?)\s+was born on\s+([A-Za-z]+\s+\d{4})", raw_name)
        if dm:
            nm, dob = dm.group(1).strip(), dm.group(2).strip()
        else:
            nm = re.sub(r"\(EICN:.*?\)", "", raw_name).strip()
        nm = re.sub(r"^[^A-Za-z0-9]+", "", nm).strip()  # drop leading icon/tag artifacts
        owner = {
            "name": nm,
            "type": "person" if dob else "entity",
            "date_of_birth": dob,
            "occupation": _field(ct, "Occupation"),
            "nationality": _field(ct, "Nationality"),
            "residence": _field(ct, "Residence"),
            "status": status,
            "voting_rights_pct": _pct(ct, "Voting rights"),
            "shares_pct": _pct(ct, "Shares"),
        }
        # drop empty duplicate echo cards
        if owner["name"]:
            detail["beneficial_owners"].append(owner)
    # de-dup by (name, shares)
    seen, uniq = set(), []
    for o in detail["beneficial_owners"]:
        k = (o["name"].lower(), o["shares_pct"], o["voting_rights_pct"])
        if k not in seen:
            seen.add(k); uniq.append(o)
    detail["beneficial_owners"] = uniq
    return detail


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__); sys.exit(1)
    data = lookup(args[0], take=5 if "--all" in sys.argv else 1)
    if "--json" in sys.argv:
        print(json.dumps(data, indent=2, ensure_ascii=False)); return
    if not data["found"]:
        print(f"No companies found for '{data['query']}'."); return
    for c in data["companies"]:
        print(f"\n{c.get('name')}  (EICN {c.get('eicn')})")
        print(f"  snapshot: {c.get('snapshot_date','?')}  |  category: {c.get('owner_category','?')}")
        for o in c.get("beneficial_owners", []):
            bits = []
            if o.get("date_of_birth"): bits.append(f"b. {o['date_of_birth']}")
            if o.get("occupation"): bits.append(o["occupation"])
            if o.get("nationality"): bits.append(f"nat. {o['nationality']}")
            if o.get("residence"): bits.append(f"res. {o['residence']}")
            pct = []
            if o.get("voting_rights_pct") is not None: pct.append(f"voting {o['voting_rights_pct']}%")
            if o.get("shares_pct") is not None: pct.append(f"shares {o['shares_pct']}%")
            print(f"    - {o['name']} [{o['type']}, {o['status']}]"
                  f"{'  (' + ', '.join(bits) + ')' if bits else ''}  {', '.join(pct) or '(no % stated)'}")


if __name__ == "__main__":
    main()
