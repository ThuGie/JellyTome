# Compatibility and validation

Validated on 2026-11-05. This is a preview release, not a claim that all planned sources or clients are certified.

| Target | Result |
|---|---|
| Jellyfin 10.11.11 / Windows / .NET 9 | Real isolated server installation, upgrade/restart, authenticated APIs, page injection, and reader tested |
| Earlier Jellyfin 10.11.x | Compiles against 10.11.3; user enumeration handles old property/new method API. Individual earlier servers not run |
| Linux / Synology | Portable managed plugin with host-provided SQLite; not executed on a physical Synology NAS |
| Desktop Chromium | Fixture and actual Jellyfin web integration tested |
| Mobile Chromium, 390×844 | Fixture and actual Jellyfin web integration tested |
| Tablet Chromium, 820×1180 | Fixture navigation, requests, reader, and administrator UI tested |
| Official Android mobile app | Intended via web integration; actual Android device/app not available for certification |
| Android TV, Swiftfin, third-party native clients | Not certified; do not assume injected web pages appear |
| Jellyfin base path `/manga-test` | Real server tested; relative injection URLs and API routing work |
| JellySpot 1.0.27 + JellySeerr 1.0.28 | Installed together on the isolated server; manga injection, reader, and admin integration passed |
| Jellyfin 12 | Not supported by this release |

Automated backend checks cover durable deduplication, source serialization/enabling, retries/backoff, cancellation races, recovery, fractional chapter ordering, per-user progress storage, path traversal, private/reserved hosts, redirect allowlists, HTML/JSON fixtures, complete archives, and storage-budget failures. A low storage quota is simulated; an actual physical full-disk event was not induced.

Browser fixture tests passed **32 assertions** across desktop/tablet/mobile. Live HTTP tests passed **42 checks**, including anonymous/restricted user denial, library permission changes, administrator restrictions, page access, and per-user reading progress. Live desktop/mobile browser tests use server-transformed pages without manually injecting scripts. Screenshots/results are under ignored `artifacts/browser` and `artifacts/jellyfin-live`.

Real-server tests exposed and fixed Jellyfin API casing differences and the 10.11.11 user enumeration API change. The installed package was upgraded and restarted between these tests. Test manga fixtures and reading progress persisted through the restart. Original application data and production Jellyfin services were not used.

Source results are maintained separately in [source-status.md](source-status.md). Full download validation confirms the selected chapter's extracted images and archive structure; it does not certify every title, every account state, or future site changes. MANGA Plus returned an API rejection without any account credentials being supplied. No user account was logged into that site.

## 0.1.0.2 regression verification

Verified header icon access and direct embedded administrator settings on real Jellyfin 10.11.11 with `EnableLegacyAuthorization=false`, on desktop and mobile. All 42 live HTTP checks passed with modern MediaBrowser authorization. Browser fixtures now reject legacy token headers and passed 44 assertions across desktop/tablet/mobile, including duplicate page events and settings-page auto-opening. Backend tests remain 29 passing.

## 0.1.0.3 regression verification

Browser fixtures passed 62 assertions, covering icon-only header access, no Home/drawer text shortcut, separate reader/admin menus, browsing server roots and folders, saving the selected directory, and cancelling without closing settings. Real Jellyfin 10.11.11 tests passed on desktop/mobile with the new 0.1.0.3 build confirmed active, including the native server directory endpoints with legacy authorization disabled.
