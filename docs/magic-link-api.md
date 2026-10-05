# Magic Link API

Create a shareable, expiring link to a brand's Commercial Command Center dashboard. One call takes the brand's details, builds the dashboard from live data if it doesn't exist yet, and returns a link straight away. Each partner can get their own variant of the link.

Base URL (production): `https://command-center-next-bfuw7h4slq-uc.a.run.app`

---

## Quick start

```bash
curl -X POST "$BASE/api/magic-links" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "brand_name": "Ninja",
    "brand_category": "air fryer",
    "brand_product": ["Foodi DualZone", "Crispi"],
    "brand_link": "https://www.ninjakitchen.com",
    "partner_id": "acme",
    "expires_in_hours": 72
  }'
```

Send the returned `url` to the partner. It opens the dashboard; if the dashboard is still being built, the page says so and opens by itself when it's ready (usually 3–4 minutes).

---

## How it works

```
caller ──POST /api/magic-links──▶ server
                                   │
                                   ├─ brand already has a measured dashboard? ──▶ link to it            (201)
                                   ├─ a build for it already running?         ──▶ link to that build    (202)
                                   └─ otherwise: start a build                ──▶ link to the new build (202)
                                                 │
                                                 ▼  (3–4 min, in the background)
                       Keepa  — the brand's and competitors' Amazon listings, 13 weeks of daily data
                       Apify  — product pages, delivery promise, Amazon search results
                       Claude — 12 shopper questions × 2 runs → AI share of answer

partner opens https://<host>/share#<token>
   └─ page reads the token from the # (never sent to the server), removes it from the address bar,
      and fetches GET /api/payloads/<slug> with Authorization: Bearer <token>
         ├─ build ready     → dashboard
         ├─ still building  → "being built…" (retries every 10 s)
         └─ expired / bad   → a clear message
```

- The link is **pinned** to one build: rebuilding the brand later does not change what an existing link shows. Create a new link to share the newer build.
- Every number on the dashboard is measured (Keepa, Apify, Claude). Anything without a source is left blank and marked "not measured". Amazon US is the only retailer covered.

---

## `POST /api/magic-links`

### Authentication

Admin only. Send either header:

```
Authorization: Bearer <ADMIN_SHARED_SECRET>
x-admin-token: <ADMIN_SHARED_SECRET>
```

(An admin browser session from `/admin` also works.)

### Request body (JSON)

| Field | Type | Required | Notes |
|---|---|---|---|
| `brand_name` | string | **yes** | Must match how the brand appears on Amazon listings (brand field or title), e.g. `"SharkNinja"` vs `"Shark"`. |
| `brand_category` | string | **yes** | Plain shopper wording, e.g. `"air fryer"`. Drives the Amazon search, Claude's questions and the shelf read. |
| `brand_product` | string or string[] | no | Up to 7 product names. Each is searched as `"<brand> <product>"`. Without it, the top listings for the category are used. Comma- or newline-separated strings are accepted. (`brand_products` is an alias.) |
| `brand_link` | string | no | The brand's website, `http(s)://…`. Stored with the build. |
| `partner_id` | string | no | 1–64 chars: letters, digits, `.` `_` `:` `-`. Signed into the link, so each partner gets a distinct link. |
| `competitors` | string[] | no | Up to 4 competitor brands. If omitted, Claude names the 4 most direct competitors (`competitors_source: "claude"`). |
| `region` | string | no | Default `"US"`. Other Amazon marketplaces are accepted but only US has been verified. |
| `rebuild` | boolean | no | Default `false`. `true` always starts a new build with these inputs (~100 Keepa tokens). |
| `expires_in_hours` | number | no | Default `72`, maximum `720` (30 days). |
| `label` | string | no | Up to 120 chars, for your own reference. |
| `slug` | string | no | Defaults to the brand name, lowercased with hyphens (`"Ninja"` → `ninja`). |

**Short form for an existing brand:** `{ "slug": "anker", "partner_id": "acme" }` (optionally `"build_id"` to pin a specific build). No build is started.

### What decides reuse vs. build

1. `rebuild` is `false` and the brand's latest build is measured → **reuse it** (`201`).
2. A build for the brand is already queued or running → **link to that build** (`202`).
3. Otherwise → **start a build** with the request's inputs (`202`).

When an existing build is reused, `built_with` shows the inputs that build actually used, which may differ from what you sent. Send `"rebuild": true` if they should match.

### Response

`201 Created` (dashboard ready) or `202 Accepted` (dashboard building):

```json
{
  "url": "https://<host>/share#eyJ2IjoxLCJzbHVnIjoibmluamEi…",
  "token": "eyJ2IjoxLCJzbHVnIjoibmluamEi…",
  "slug": "ninja",
  "partner_id": "acme",
  "label": null,
  "issued_at": "2026-10-05T06:34:37.000Z",
  "expires_at": "2026-10-06T06:34:37.000Z",
  "build": { "id": "b_1riO44eiB8", "status": "queued", "poll_url": "/api/builds/b_1riO44eiB8" },
  "brand": {
    "name": "Ninja",
    "category": "air fryer",
    "products": ["Foodi DualZone", "Crispi"],
    "link": "https://www.ninjakitchen.com",
    "region": "US"
  },
  "competitors": ["Cosori", "Instant Pot", "Philips", "Gourmia"],
  "competitors_source": "claude",
  "reused_existing_build": false,
  "built_with": null
}
```

| Field | Meaning |
|---|---|
| `url` | The link to send. The token is after `#`. |
| `token` | The same token on its own, for API use (see below). |
| `build.status` | `ready`, `queued` or `running`. |
| `build.poll_url` | Build progress (admin). |
| `competitors` / `competitors_source` | Competitors used for a new build, and whether they came from the `request` or from `claude`. `null` / `"existing build"` when reused. |
| `reused_existing_build` | `true` if no new build was started. |
| `built_with` | When reused: the category, competitors, products, link and region that build was made from. |

The short form returns the same envelope without `brand`, `competitors` and `built_with`.

### Errors

| Status | Cause |
|---|---|
| `400` | Missing `brand_name`/`brand_category`; bad `partner_id`, `brand_link`, `slug`, `build_id` or `expires_in_hours`; invalid JSON |
| `401` | No or wrong admin credentials |
| `404` | Short form: brand or pinned build not found |
| `409` | Short form: the brand's latest build predates measured-only (simulated data). Rebuild it first. |
| `500` | `MAGIC_LINK_SECRET` is not configured on the server |

Errors are `{ "error": "<message>" }`.

---

## The share link

`https://<host>/share#<token>`

- Anyone with the link can open it until it expires. No login.
- The token is in the URL fragment, which browsers never send to the server, so it doesn't appear in server or proxy logs. The page removes it from the address bar after reading it and keeps it for the tab, so reloading works.
- Pages are served `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`.

What the recipient sees:

| Situation | Page shows |
|---|---|
| Ready | The dashboard |
| Still building | "This dashboard is being built from live data — it opens by itself when ready" |
| Expired | "This share link has expired." |
| Tampered or for another brand | "This share link isn't valid." |
| Opened without the `#…` part | "This share link is incomplete" |
| Build failed | "The build for this dashboard failed. Ask whoever shared it for a new link." |

---

## Reading dashboard data with a token

The share page calls this; you can too.

```
GET /api/payloads/<slug>
Authorization: Bearer <token>
```

| Status | Meaning |
|---|---|
| `200` | Dashboard JSON for the pinned build (`x-build-id` header) |
| `202` | Still building; `Retry-After: 10` |
| `401` | Invalid token, or the token is for a different brand |
| `404` | Build not found |
| `409` | Pinned build is a retired simulated build |
| `410` | Token expired |
| `424` | The build failed |

Admins can call the same endpoint with the admin token to get the brand's latest measured build.

## Build progress

```
GET /api/builds/<build_id>
Authorization: Bearer <ADMIN_SHARED_SECRET>
```

Returns `status` (`queued` → `running` → `ready` or `failed`), per-step progress (`asin-discovery`, `keepa`, `keepa-competitors`, `apify-amazon`, `amazon-shelf`, `ai-visibility`, `builder`, `relabel`, `rebrand`, `upload`) and `error`. A build with no progress for 30 minutes is marked `failed`.

---

## The token

A self-contained signed value: `base64url(claims) + "." + base64url(HMAC-SHA256(claims, MAGIC_LINK_SECRET))`.

```json
{
  "v": 1,
  "slug": "ninja",
  "buildId": "b_1riO44eiB8",
  "label": null,
  "partnerId": "acme",
  "issuedAt": 1791182077,
  "expiresAt": 1791268477,
  "nonce": "xtpg6TiY-3BT"
}
```

- Nothing is stored server-side; the signature proves the claims. Changing any byte invalidates it.
- The claims are readable by anyone holding the token (they are signed, not encrypted). Don't put secrets in `label` or `partner_id`.
- `partnerId` makes each partner's link distinct and identifiable. Two calls with the same `partner_id` still return two different links (different `nonce`).
- **Revocation:** individual links can't be revoked. Rotating `MAGIC_LINK_SECRET` invalidates every outstanding link.

---

## Cost and timing

| | |
|---|---|
| Reusing an existing dashboard | Free, ~1–2 s |
| New build | ~100 Keepa tokens, ~$0.07 Apify, ~25 Claude calls; ready in ~3–4 min |
| Response time when a build is started | ~5–10 s (most of it is Claude choosing competitors; faster when `competitors` is sent) |

Keepa refills about 21 tokens a minute. Use `rebuild: true` deliberately.

## Server configuration

| Secret | Purpose |
|---|---|
| `MAGIC_LINK_SECRET` | Signs links (32+ characters). In Secret Manager, bound to the `command-center-next` Cloud Run service. |
| `ADMIN_SHARED_SECRET` | Admin credential for this API and the admin pages. |
| `INS_KEEPA_KEY`, `APIFY_TOKEN` | Data sources for builds. |

## Limitations

- Competitor products are whatever ranks top in Keepa's search for `"<competitor> <category>"`; only the subject brand's products can be named.
- Amazon US only; website traffic and other retailers are not measured.
- Links are pinned to a build; a rebuilt dashboard needs a new link.

See `ISSUES.md` for the full list of known data gaps.
