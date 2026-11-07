# JellyTome

<img src="thumb.png" alt="JellyTome icon" width="180">

A Jellyfin server plugin for manga discovery, immediate requests, CBZ downloads, release monitoring, and reading inside Jellyfin. Everything runs in the Jellyfin process. No companion server, Docker container, browser automation service, or external database is required.

**0.1 preview:** the Sources list includes bundled sites with verified full chapter downloads and your custom sources. See the [live source results](docs/source-status.md) for the audit.

## Install

Use **0.1.0.1 or newer**. The original 0.1.0.0 release omitted AngleSharp from Jellyfin's assembly allowlist and could appear as NotSupported. Install the newer catalog version and restart Jellyfin; do not delete manga files or the plugin database.

Catalog URL: `https://raw.githubusercontent.com/ThuGie/JellyTome/main/manifest.json`

Add this URL under **Dashboard → Plugins → Repositories**, then install JellyTome from the catalog. Manual installation is also available below.

1. Use Jellyfin **10.11.x with .NET 9**. The actual server integration was tested on **10.11.11**; earlier 10.11 builds are compile targets, not individually certified. Jellyfin 12 is not a supported target for this release.
2. Install the [File Transformation plugin](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation) using its repository and the version matching your Jellyfin server.
3. Build `python scripts/package.py`, or use the generated `artifacts/releases/JellyTome_VERSION.zip`. Stop Jellyfin, extract the archive to a new `JellyTome` directory inside Jellyfin's plugins directory, and restart. Do not install test/probe binaries.
4. Open **Dashboard → Plugins → JellyTome**. Choose an existing Books library, click **Choose folder** to browse the server and select a writable manga storage directory, and set a storage budget. The plugin uses the chosen library's access permissions. Prefer a storage directory inside that library.
5. Open Sources, enable and test desired adapters, and then open the **JellyTome icon in the top header**. Requesting a manga immediately downloads available English chapters and monitors future releases.

For a Synology package installation, use the plugin directory belonging to that package and give the Jellyfin service account write permission on the chosen manga directory. Paths vary between package maintainers; this plugin does not assume a NAS model or a hardcoded `/var/packages` location. It does not alter the installed Jellyfin web files.

## What is included

- Embedded discovery, library, continue-reading, downloads, and administrator pages using Jellyfin accounts.
- Responsive RTL/LTR, double-page, and continuous vertical reading with lazy loading; keyboard/touch controls, zoom, fullscreen, bookmarks, chapter navigation, and progress sync.
- Immediate requests for permitted users. Administrators can block individual users in addition to the normal library permissions.
- Persistent SQLite download queue with deduplication, retry backoff, editable per-website chapter concurrency, cancellation, pause/resume, and restart recovery.
- English chapter discovery and six-hour monitoring by default; two chapter downloads globally and one per website by default. Adjust the global limit in Settings and each website’s limit in Sources (both 1–8); the lower applicable limit wins. Source request delays remain enforced. Lowering limits lets active chapters finish.
- CBZ archives with ComicInfo metadata, bounded image/chapter sizes, temporary staging, atomic final moves, and storage budgets.
- Administrator source catalog, custom HTML/JSON rules, import/export, live tests, source priority, health checks, and recent diagnostic events.
- Source traffic restricted to public HTTPS destinations, with DNS checks at connection time and redirect validation. No shell scripts or arbitrary JavaScript are executed from source definitions.

Native client support depends on the client using Jellyfin's web interface. The official Android mobile client's web integration is an intended target, but **a physical Android app session has not been tested**. Mobile Chromium tests are not presented as native-app certification. See [compatibility and validation](docs/compatibility.md).

The plugin settings page renders the administrator dashboard directly, with no reader menus. The reader contains no administrator menus. Storage selection uses a server-side folder picker rather than a typed path. Requests use Jellyfin's modern session authorization and work with legacy authorization disabled.

## Develop and test

```sh
dotnet test tests/JellyManga.Tests -c Release
npm ci
npx playwright install chromium
npm test
python scripts/package.py
```

Opt-in source checks make real requests and can download an entire chapter before deleting the test archive:

```sh
dotnet run --project tools/SourceProbe -c Release -- --live --download --ids=mangakatana,mangareadorg --query="One Piece" --minutes=3
```

Results and all downloaded test content remain under ignored `artifacts/`. `--output=PATH` selects a separate report directory. Avoid simultaneous builds into the same probe output directory on Windows. `--representative` repeats a previously recorded representative title rather than the default query.

`scripts/live-server.py` can prepare an isolated test server from an existing Jellyfin executable. It uses its own data/config/cache, binds localhost port 28096, and sets the `/manga-test` base path. Credentials are generated into ignored artifacts. `tests/live-api.py` and `npm run test:live` use only that recorded test instance. Test scripts never use a production Jellyfin account.

## Public releases

Run `python scripts/package.py --repository OWNER/REPOSITORY` to generate a plugin zip, checksums, and Jellyfin `manifest.json` with GitHub release URLs. Pushing a four-part version tag such as `v0.1.0.0` runs the release workflow: tests, package, GitHub release, and automatic update of `manifest.json` on `main`. The workflow can also be dispatched with a version. This preview is marked as a prerelease. The zip includes only the plugin and AngleSharp; Jellyfin supplies its own SQLite and framework dependencies, so it is independent of CPU architecture.

Source rules and metadata live in the plugin data directory; manga archives live in the configured storage directory. Back up both, together with Jellyfin's plugin configuration XML. Removing a source disables it and retains downloaded files and reading progress. This release does not automatically import an unrelated pre-existing CBZ collection or automatically migrate its storage path.

Source extraction can break when websites change. Authentication requirements, subscriptions, encrypted pages, access challenges, and regional restrictions are reported rather than bypassed. MANGA Plus and Anime-Planet are investigated candidates, not certified download sources in this release.

See [source authoring](docs/source-authoring.md), [API](docs/api.md), and [validation](docs/compatibility.md). Original code is MIT licensed. File Transformation is a separate dependency; JellySpot and JellySeerr informed the integration pattern. Keiyoushi's public source metadata informed candidate URLs and MANGA Plus wire-field investigation; Kotlin extension code is not shipped in this plugin.

## AVIF storage

New downloads default to full-resolution AVIF quality 65. Adjust quality (1–100), or disable conversion to retain originals, in Dashboard → JellyTome → Settings. Conversion uses Jellyfin’s configured FFmpeg and requires libaom-av1 and its AVIF muxer. Unsupported FFmpeg builds produce an actionable download error. Up to two encodes run concurrently. Quality maps 1–100 to AV1 CRF 63–0; results can differ between encoders. Existing AVIF and animated pages are retained.

For existing CBZs, use tools/convert-library-avif.py with the library path and --apply. It requires Pillow with AVIF support (11.3+), defaults to quality 65, keeps verified originals in artifacts/library-avif65-backups, preserves dimensions and metadata, validates output, and replaces archives only if originals have not changed. Without --apply it only inventories. Pause downloads during bulk conversion for a stable inventory. Install JellyTome 0.1.0.7 or newer before reading AVIF archives. Other CBZ clients need their own AVIF support.

Cover thumbnails are lazy-loaded through authenticated Jellyfin requests and cached in the plugin data folder. Existing manga with missing cover metadata are repaired when their thumbnail is requested. If the source has no usable cover, the first downloaded page is used; failed remote lookups retry after five minutes. Source URLs and private-network checks still apply. The queue starts eligible chapters in numeric order and fills the configured download slots. Chapters from the same series can download in parallel and may finish in a different order.
