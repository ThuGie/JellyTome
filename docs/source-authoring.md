# Source authoring

Built-in definitions are embedded in `Sources/catalog.json`. Administrator overrides live in SQLite and take precedence by source ID. IDs are stable: changing one creates a separate source and never merges existing manga.

Use **Admin dashboard → Sources → Add custom source**. The editor accepts JSON and validates selectors, hostnames, pagination/rate bounds, and adapter type before saving. Export definitions to version/share them. Imports start disabled. Removing an entry retains its override as a disabled tombstone and leaves library data intact; edit/re-enable it to restore it.

Example HTML source:

```json
{
  "id": "example",
  "name": "Example Manga",
  "baseUrl": "https://example.org",
  "kind": "html",
  "enabled": false,
  "priority": 100,
  "delayMilliseconds": 1500,
  "allowedHosts": ["images.example.org"],
  "searchPath": "/search?q={query}",
  "searchItems": ".result",
  "searchLink": "a",
  "searchCover": "img",
  "titleSelector": "h1",
  "descriptionSelector": ".description",
  "chaptersPath": "{series}",
  "chaptersMethod": "GET",
  "chapterItems": ".chapters a",
  "chapterLink": "",
  "pagesPath": "{chapter}",
  "pagesSelector": ".reader img",
  "imageAttribute": "data-src",
  "nextSelector": "",
  "maxPagination": 5,
  "reversePages": false
}
```

SearchItems selects result containers; SearchLink selects a link inside each container. An empty link selector uses the container itself. The same rule applies to chapter links. Relative URLs resolve against the fetched page. `data-src`, `data-lazy-src`, and `src` are image fallbacks. Chapter numbers retain fractional values; separate releases with identical numbers remain separate chapters.

Templates support `{query}` (URL-escaped), `{series}` (series URL without its trailing slash), `{seriesId}` (second path segment), `{chapter}`, and `{chapterId}` (second path segment). For Madara AJAX chapter listings use `chaptersMethod: "POST"` and `chaptersPath: "{series}/ajax/chapters/"`. Only an empty retrieval form is sent. Other POST APIs require a coded adapter.

`nextSelector` follows `href` links for search/chapter/page pagination up to `maxPagination`, with loop detection. If a site has different pagination rules for each stage, implement a dedicated adapter rather than pretending a single rule covers it. Sources must expose English content; mixed-language feeds require a coded adapter that filters language explicitly.

For an embedded, literal image array, `scriptImagePattern` may capture it in the named group `images`, for example `var\\s+pages\\s*=\\s*(?<images>\\[.*?\\])`. The captured array is parsed as data, including single-quoted JavaScript string literals; code is never evaluated. Regular expressions have a one-second execution timeout.

For `kind: "json"`, configure dotted property paths: `jsonItemsPath`, `jsonTitlePath`, `jsonUrlPath`, `jsonChaptersPath`, and `jsonPagesPath`. Array items are objects containing title/URL fields; page arrays can contain URL strings or URL objects. Numeric dotted path segments index arrays. The detail endpoint must expose the configured title field. Complex JSON APIs use `IMangaSource` in C#.

Only exact HTTPS hostnames are accepted, including redirected and CDN hosts. Wildcards, credentials in URLs, nonstandard ports, private/loopback/link-local destinations, and redirects to unlisted hosts are rejected. DNS is checked and pinned at connect time; proxy environment settings are not used. Do not add private hosts to work around a failed test.

Use the dashboard's **Test** form with a representative query and optional exact series URL. Full validation fetches every page in one chapter, creates and reopens a CBZ, checks page signatures/container endings, and deletes the test archive. Search, details, chapters, pages, and complete download must all pass before the result says Verified download. Saving edited rules invalidates the previous source check. A check verifies a sample at a particular time, not every title on a website.

Add fixtures when writing a coded adapter, record a live result, and update the checked source report. Do not check credentials, copied site code, or downloaded chapters into Git. Sources requiring protected image decryption or challenge bypass are not implemented.
