# React Migration — MJMNursery-Sales-Web (www.mjmnursery.com)

This repo is being migrated from plain static HTML/JS to React + Vite,
page by page, with **zero downtime** (strangler pattern). Same setup as
the already-React `Mobile` and `Barcode_Counter` repos.

## ⚠️ ONE-TIME SWITCH — DO THIS BEFORE MERGING TO MAIN

The migration branch moves the site files into `public/` and builds the
site into `dist/` with GitHub Actions. GitHub Pages must therefore stop
serving the raw branch and start serving the Actions build.

**Order matters — do the switch FIRST:**

1. Go to the repo on GitHub → **Settings → Pages → Build and deployment
   → Source** → change from "Deploy from a branch" to **"GitHub Actions"**.
   Nothing changes for visitors yet — the old site stays live until the
   first successful workflow run replaces it.
2. Merge the migration branch into `main`. The `Deploy to GitHub Pages`
   workflow builds and deploys `dist/` (identical content on the first
   deploy). Visitors never see a gap.

If you merge **before** switching, GitHub Pages would rebuild from the
branch root — where `index.html` no longer exists — and the site would
break until the switch is made. Switch first.

**Rollback at any time:** Settings → Pages → Source back to "Deploy from
a branch" (branch `main`, folder `/`) *only works before the merge*.
After merging, roll back with `git revert` of the merge commit — the
workflow redeploys the previous state in ~1–2 minutes. Pages deploys are
atomic; visitors never see a half-deployed site.

## How the strangler pattern works here

- **Unmigrated pages** live in `public/` and are copied into `dist/`
  verbatim — byte-identical to today, same URLs.
- **Migrated pages** are React: an HTML shell at the repo root + an entry
  under `src/entries/` + a page under `src/pages/`, registered in
  `vite.config.js` `rollupOptions.input`.
- A page exists in exactly ONE of those two places. Vite fails the build
  on a collision, so this is self-policing.
- `legacy_urls.txt` (frozen list of every original URL) is checked
  against `dist/` on every build by `scripts/check_urls.sh` — a missing
  page fails CI and blocks the deploy.
- `legacy/` holds an untouched snapshot of the original site for
  reference.

## Never migrate (stay static in public/ permanently)

- `payment.html`
- `payment-callback.html` — Billplz redirect target; its URL is
  registered with the payment provider
- `payment-proof.html`

## Migration order (one PR each, lowest → highest risk)

1. ✅ Build pipeline (this scaffold — deploys today's site unchanged)
2. `auth.html` (login) — extracts `src/lib/supabase.js`
3. `customer-portal.html`
4. `admin.html` shell, then the nine `admin-*.js` modules one at a time
   (`admin-orders.js` last of those — it's the biggest)
5. `index.html` storefront LAST, gated on a full Billplz test purchase

## Verify before every merge

```bash
npm ci
npm run build          # must succeed
npm run check:urls     # every legacy URL present in dist/
npm run preview        # click: migrated page, one unmigrated page, login
```
