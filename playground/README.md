# Playground

Scratch scripts for exploring the KnowYourCustomer (KYB) API that powers the
Gibraltar UBO jurisdiction. Not part of the Next.js app build.

## kyc_api_demo.py
Walks every KYB API call for one company and prints the raw output of each step
(token → search → create case → poll → members → org-chart), then a plain summary.

```bash
pip install requests
python kyc_api_demo.py                            # Insight Tech Limited / GI
python kyc_api_demo.py "Insight Tech Limited" GI  # or pass company + ISO country
```

Sandbox note: only `Insight Tech Limited` and
`PREMIER INTERNATIONAL CORPORATE SERVICES LIMITED` (GI) return data in the sandbox.
