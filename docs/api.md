# Plugin API

All routes are relative to Jellyfin's configured base URL. Plugin JSON uses camelCase independently of Jellyfin's global API casing. Send the normal Jellyfin token in `X-Emby-Token`; no second login system exists.

| Route | Behavior |
|---|---|
| `GET /JellyManga/assets/app.js`, `app.css` | Public embedded UI assets only |
| `GET /JellyManga/session` | Current user/access/admin status |
| `GET /JellyManga/sources` | Enabled source summaries |
| `GET /JellyManga/search?query=…&sourceId=…` | Federated results and per-source errors; source is optional |
| `POST /JellyManga/requests` | `{sourceId,url}`: queue all available English chapters and monitor |
| `GET /JellyManga/library` | Series, download counts, and the current user's progress |
| `GET /JellyManga/library/{id}/chapters` | Chapter/download states ordered by chapter number |
| `GET /JellyManga/downloads` | Shared download states; no requester identifiers/storage paths |
| `GET /JellyManga/chapters/{id}/manifest` | Chapter details and page count for a complete download |
| `GET /JellyManga/chapters/{id}/pages/{zeroBasedIndex}` | Validated archive image; authentication required |
| `GET`, `PUT /JellyManga/progress` | User-isolated `{seriesId,chapterId,page,bookmarked,updatedAt}` |
| `GET /JellyManga/admin/overview` | Health, library/user choices, series, and source checks |
| `GET`, `PUT /JellyManga/admin/settings` | Storage, library, monitoring, concurrency, pause, budget, denied users |
| `GET /JellyManga/admin/logs` | Up to 200 recent diagnostic events |
| `GET /JellyManga/admin/sources` | Full catalog including disabled/removed definitions; export payload |
| `PUT`, `DELETE /JellyManga/admin/sources/{id}` | Save definition or disable/remove source |
| `POST /JellyManga/admin/sources/import` | Array of up to 100 definitions; imported disabled |
| `POST /JellyManga/admin/sources/{id}/test` | `{query,seriesUrl?,download}`: stage-by-stage test |
| `POST /JellyManga/admin/downloads/{id}/{action}` | `retry`, `resume`, `pause`, or `cancel` |
| `PUT /JellyManga/admin/series/{id}` | `{monitoring}` |
| `POST /JellyManga/admin/series/{id}/check` | Mark due for the next monitoring pass |

User endpoints require an actual Jellyfin user session, access to the configured library, and no explicit administrator block. Administrators retain manga access; `/admin` routes additionally enforce Jellyfin's `RequiresElevation` policy. API keys without a user identity cannot use user endpoints. Anonymous requests receive 401 and forbidden users receive 403. The UI hides administrator controls, but the server also enforces permissions on every protected route.

Expected error JSON is `{error: "…"}` with 400 for invalid definitions/input, 403 for denied user access, 404 for missing downloads, 408 for interrupted requests, 502 for source HTTP failures, or 500 with a generic message and details in Jellyfin logs. Standard ASP.NET validation failures may use problem-details JSON. Static assets contain no credentials.

Completed archives are served as individual bounded images, never arbitrary filesystem paths. Progress writes validate series/chapter identity and page bounds and use server timestamps. A source or chapter URL never becomes a local storage filename; SHA-256 IDs determine archive paths.

`PUT /JellyManga/admin/sources/{id}/downloads` (administrator only) accepts `{ "maxConcurrentDownloads": 4 }` (1–8). This changes the website limit without resetting its verification. Global `downloadConcurrency` remains in admin settings. Both limits apply; changes affect new chapter starts without interrupting active work.
