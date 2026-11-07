# Changelog

## 0.1.0.10

- Show the listed chapter range and flag sources whose numbered chapters start after chapter 1.
- Let administrators stop monitoring and remove a manga, its queued downloads, archives, and reading progress from the shared library.

## 0.1.0.9

- Show the downloaded chapter count on matching search results.
- Add on-demand chapter details with the source’s English chapter count, latest listed chapter, and synopsis.

## 0.1.0.8

- Render lazy-loaded thumbnails in search, library, and Continue Reading through authenticated Jellyfin endpoints, with local cover caching and source referrers.
- Fetch missing cover metadata for existing library entries, retain source identities, retry unavailable covers with backoff, and use a downloaded page when no source cover is available.
- Include cover art from MangaDex, Flame Comics, and HTML source details; retain private-network and source-host validation.
- Start eligible queued chapters in numeric order, including after restart, instead of archive-ID order. Concurrent downloads may finish out of order.

## 0.1.0.7

- Add AVIF image validation and image/avif responses for converted CBZ chapters.
- Default new downloads to full-resolution AVIF quality 65; add conversion and quality controls in Settings.
- Use Jellyfin FFmpeg with libaom-av1, two encoder slots, cancellation, staged output validation, and atomic completion.
- Retain existing AVIF and animated pages. Supply a backed-up script for existing CBZ conversion.

## 0.1.0.6

- Replace five-page vertical batches with continuous scrolling through the entire chapter, without a Continue scrolling button.
- Lazy-load nearby pages with two fetches at a time; release distant image data while preserving page positions and dimensions for scrolling back.
- Track reading progress while scrolling, restore the selected page, and cancel pending loads when leaving the reader or switching modes.
- Verify scrolling beyond page five, backward loading, memory cleanup, progress, and switching modes at desktop/tablet/mobile sizes.

## 0.1.0.5

- Add an editable concurrent chapter limit per website (1–8) in Sources, alongside the clearly labeled global limit in Settings. Defaults remain two globally and one per website.
- Apply both limits to the queue immediately; lowering a limit lets active chapters finish before starting more. Preserve source verification when saving download limits.
- Permit overlapping image transfers from separate chapter jobs while preserving request pacing, Retry-After backoff, and destination validation.
- Test same-website and cross-website queue limits, live changes, persistence, authorization, browser controls, and concurrent paced image transfers.

## 0.1.0.4

- Expand browser-inspected source adapters and publish complete chapter validation results for 30 distinct websites. Untested and failed candidates remain disabled.
- Add Flame Comics public Next.js data extraction; correct MangaPill, MangaFreak, MangaSushi, and further HTML adapters from current site responses.
- Read ordinary base64 inline script data without executing website code; support DOM fallback and complete list-style chapters.
- Refresh unchanged legacy built-in source rules after upgrades while preserving administrator choices and custom edits.
- Send MANGA Plus its public anonymous session header, fixing catalog rejection. Protected chapter images remain unsupported.
- Skip empty MangaDex feed entries and record sample chapter URLs and image counts in source diagnostics.

## 0.1.0.3

- Keep only the JellyTome icon in the top header; remove the Home text button and extra drawer shortcut.
- Keep administrator menus exclusively inside the Jellyfin dashboard, with reader navigation exclusively in the reader.
- Replace typed storage paths with a server-side folder picker using Jellyfin's directory browser APIs, with server roots, folder navigation, parent navigation, library shortcuts, selection, and cancellation.
- Keep the embedded dashboard visible during Jellyfin route events and place it below the native header.
- Verify server-folder selection and separate navigation in desktop, tablet, and mobile tests.

## 0.1.0.2

- Add the JellyTome icon to Jellyfin's top header, including mobile layouts.
- Open the administrator dashboard directly inside the plugin settings page; remove the extra launch button.
- Use Jellyfin's current session authorization headers for API calls and reader images, fixing 401 errors when legacy authorization is disabled.
- Test direct settings navigation, header access, repeated page events, and modern authorization on desktop/tablet/mobile, plus a real Jellyfin server with legacy authorization disabled.

## 0.1.0.1

- Register the bundled AngleSharp dependency in Jellyfin's assembly allowlist, fixing plugin startup.
- Validate packaged DLLs, icon, version, catalog checksum, and committed release metadata automatically.

## 0.1.0.0

- Initial preview with an embedded reader, source management, downloads, and monitoring. Superseded due to the dependency allowlist issue.
