# AccessLens — Web Accessibility Checker for Agencies

Phase 1 (this build): a fully client-side Chrome extension (Manifest V3). No backend,
no AI, no server costs. Detection is powered by [axe-core](https://github.com/dequelabs/axe-core)
(MPL-2.0). Licensing is handled by the Lemon Squeezy License API.

## What it does

- One-click WCAG audit of the active tab using axe-core, grouped by WCAG success criterion
- Plain-language tooltips for non-developers, severity & WCAG-level filters
- White-label PDF report generation (Pro) — your logo, company name, accent color
- Client / project / scan-history management stored locally (`chrome.storage.local`)
- Three-tier pricing (Free / Pro / Agency) with Phase 2 features clearly marked "Coming soon"
- Zero data leaves the device except license verification calls to Lemon Squeezy

## Local setup

### 1. Get axe-core and jsPDF

This repo already includes pre-fetched copies in `lib/`:

- `lib/axe.min.js` — from `axe-core@4.10.2` (`https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js`,
  or `node_modules/axe-core/axe.min.js` after `npm install axe-core`)
- `lib/jspdf.umd.min.js` — from `jspdf@2.5.2` (`https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js`,
  or `node_modules/jspdf/dist/jspdf.umd.min.js` after `npm install jspdf`)

If you need to refresh them, download the file and overwrite the existing one — no code changes
required as long as the global names (`window.axe`, `window.jspdf.jsPDF`) stay the same.

### 2. Load the extension

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `accesslens/` directory

### 3. Try it

- Click the toolbar icon → "Scan this page" (opens the side panel and runs axe-core)
- Open Settings (gear / popup link) to set your company name, logo, and accent color
- Free plan: 5 scans/day, 1 client, no PDF export. Pro unlocks unlimited scans/clients + PDF export.

## Lemon Squeezy setup (required before going live)

1. Create a Store (set its currency to **JPY**), then a **Product** (e.g. "AccessLens Pro")
   with a **Variant** (e.g. "Pro Monthly", ¥2,980/mo) and enable **"Generate license keys"**
   on the variant. Repeat for "AccessLens Agency" (¥7,480/mo).
2. Make both variants **subscription** products — when a subscription lapses, Lemon Squeezy
   automatically marks the issued license key `expired`/`disabled`, which `validateLicense()`
   detects and downgrades the user back to Free.
3. Copy each variant's hosted **checkout URL** and paste them into
   `licensing/lemonsqueezy.js` → `CHECKOUT_URLS.pro` / `CHECKOUT_URLS.agency`.
4. Find each variant's numeric **Variant ID** (Lemon Squeezy dashboard → variant settings)
   and add it to `licensing/lemonsqueezy.js` → `VARIANT_PLAN_MAP`, e.g.:
   ```js
   const VARIANT_PLAN_MAP = {
     123456: 'pro',
     123457: 'agency'
   };
   ```
5. No secret API key is required — the License API (`activate` / `validate` / `deactivate`)
   is a public endpoint that works with the license key alone, so everything runs from the
   client without a backend.

### License flow (UX)

1. User clicks "Upgrade to Pro" in the popup or options page → opens the Lemon Squeezy
   hosted checkout in a new tab.
2. After purchase, Lemon Squeezy emails the license key and shows it on the order
   confirmation page.
3. User pastes the key into Options → License → "Activate".
4. `activateLicense()` calls `POST /licenses/activate`, stores `instance_id` and status,
   and unlocks the matching plan.
5. On every browser startup and every 24 hours (`chrome.alarms`), `validateLicense()`
   re-checks `POST /licenses/validate` so a cancelled/expired subscription is detected
   and the user is moved back to Free automatically.

### Why client-side license gating is acceptable here

Client-side gating can technically be bypassed, but the target customer is a B2B agency
selling $1,500 audits to their own clients — a segment that won't risk running pirated
business tooling. Mitigations in place: startup + 24h re-validation, and instance-id
consistency checks (the same as the well-known "ExtensionPay" pattern).

## Pre-launch checklist (Chrome Web Store)

- [ ] Replace placeholder icons in `assets/icons/` with final artwork (16/48/128 px PNG)
- [ ] Set real Lemon Squeezy checkout URLs and `VARIANT_PLAN_MAP` in `licensing/lemonsqueezy.js`
- [ ] Verify `lib/axe.min.js` and `lib/jspdf.umd.min.js` are the intended versions
- [ ] Confirm `host_permissions` is limited to `https://api.lemonsqueezy.com/*`
- [ ] Write the store listing emphasizing: "Your data never leaves your device" (privacy
      is a differentiator vs. competitors that require cloud accounts)
- [ ] Test the full license lifecycle: activate → validate → subscription cancel → re-validate
      → downgrade to Free → deactivate
- [ ] Test Free plan limits: 5 scans/day reset at local-date rollover, 1 client cap, PDF export
      disabled
- [ ] Test Pro: unlimited scans/clients, white-label PDF export with custom logo/company/color
- [ ] Run a manual scan on a few real-world pages and confirm WCAG grouping, severity badges,
      tooltips, filters, and "copy selector" all work
- [ ] Verify dark mode rendering of popup, panel, and options pages
- [ ] Confirm CSP compliance — no inline scripts, all code in separate files

## Project structure

```
accesslens/
├── manifest.json
├── background.js              # side panel open, license re-validation alarm
├── lib/                       # bundled axe-core + jsPDF
├── content/
│   ├── content.js             # dynamic injection + scan orchestration
│   └── scanner.js             # axe-core result → WCAG-grouped format
├── panel/                     # side panel UI (results, filters, PDF export)
├── report/                    # white-label PDF generation (Pro)
├── licensing/                 # Lemon Squeezy License API client
├── storage/                   # chrome.storage wrapper + forward-compatible schema
├── popup/                     # toolbar popup (plan, scan count, upgrade)
├── options/                   # branding, license, pricing comparison
├── pricing/                   # plan definitions & feature gating
├── assets/icons/
└── _locales/en/
```

## Phase 2 (not implemented here — design notes only)

Scheduled scans, weekly email digests, cloud sync, and multi-seat client sharing require
a backend (Node.js + Express + PostgreSQL is a natural fit). The Phase 1
forward-compatible record schema (`id` / `syncStatus` / `updatedAt` / `deletedAt`) is
designed so the sync protocol can reuse `updatedAt`-based last-write-wins merging and
`deletedAt`-based delete propagation without any restructuring. The `pricing/plans.js`
flags `scheduledScans` / `emailDigest` / `cloudSync` are already defined and surfaced as
"Coming soon" in the Options pricing table — Phase 2 only needs to flip them to `true`
and wire up the corresponding features. Lemon Squeezy webhooks
(`subscription_created/updated/cancelled/expired`, HMAC-SHA256 signature verification)
would be added server-side to keep entitlement state in sync for scheduled-scan execution.
