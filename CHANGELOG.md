# Changelog

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
