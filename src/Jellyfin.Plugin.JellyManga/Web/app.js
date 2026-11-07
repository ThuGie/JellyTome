/* JellyTome: embedded Jellyfin UI, no external runtime or service. */
(() => {
    'use strict';
    if (window.JellyManga) return;
    let root, main, session, current = 'library', poll, reader, generation = 0, pageAbort, pageObserver;
    let progressWrites = Promise.resolve();
    const blobUrls = new Map();
    const coverUrls = new Set(); let coverObserver;
    const element = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const button = (text, action, cls = '') => { const b = element('button', cls, text); b.type = 'button'; b.onclick = async () => { b.disabled = true; try { await action(); } catch (e) { message(e.message, true); } finally { b.disabled = false; } }; return b; };
    const sessionHeaders = () => { const headers = {}; ApiClient.setRequestHeaders(headers); return headers; };
    const api = async (path, method = 'GET', body, signal) => {
        const response = await fetch(ApiClient.getUrl('JellyManga/' + path), { method, credentials: 'same-origin', headers: { ...sessionHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || data.Message || `Request failed (${response.status})`); }
        return response.status === 204 ? null : response.json();
    };
    function cover(series) {
        const frame = element('div', 'jm-cover'); const fallback = element('span', 'jm-cover-fallback', 'Loading cover…'); frame.append(fallback);
        frame.dataset.coverId = series.id; frame.dataset.coverTitle = series.title;
        if (!coverObserver) coverObserver = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                coverObserver.unobserve(entry.target); loadCover(entry.target);
            }
        }, { root, rootMargin: '400px', threshold: 0 });
        coverObserver.observe(frame); return frame;
    }
    async function loadCover(frame) {
        const signal = pageAbort.signal, fallback = frame.querySelector('.jm-cover-fallback');
        try {
            const response = await fetch(ApiClient.getUrl('JellyManga/covers/' + encodeURIComponent(frame.dataset.coverId)), { credentials: 'same-origin', headers: sessionHeaders(), signal });
            if (!response.ok) throw new Error('Cover unavailable');
            const data = await response.blob(); if (signal.aborted || !frame.isConnected) return;
            const url = URL.createObjectURL(data); coverUrls.add(url);
            const image = element('img'); image.alt = frame.dataset.coverTitle + ' thumbnail'; image.decoding = 'async';
            image.onload = () => { fallback.hidden = true; };
            image.onerror = () => { image.remove(); fallback.hidden = false; fallback.textContent = 'Cover unavailable'; coverUrls.delete(url); URL.revokeObjectURL(url); };
            image.src = url; frame.append(image);
        } catch (error) { if (error.name !== 'AbortError' && frame.isConnected) fallback.textContent = 'Cover unavailable'; }
    }
    function message(text, error = false) { if (!main) return; let box = main.querySelector('.jm-status'); if (!box) { box = element('div'); box.setAttribute('role', 'status'); main.prepend(box); } box.className = 'jm-status' + (error ? ' jm-error' : ''); box.textContent = text; }
    function empty(text) { main.append(element('div', 'jm-empty', text)); }
    function heading(title, subtitle) { main.append(element('div', 'jm-kicker', 'YOUR NEXT CHAPTER'), element('h1', '', title)); if (subtitle) main.append(element('p', 'jm-lede', subtitle)); }
    function releaseImages() { coverObserver?.disconnect(); coverObserver = null; for (const url of coverUrls) URL.revokeObjectURL(url); coverUrls.clear(); pageObserver?.disconnect(); pageAbort?.abort(); pageAbort = new AbortController(); for (const value of blobUrls.values()) URL.revokeObjectURL(value); blobUrls.clear(); }
    function close(push = true) { const embedded = root?.dataset.embedded === '1'; generation++; clearInterval(poll); reader = null; releaseImages(); root?.remove(); root = null; main = null; document.removeEventListener('keydown', keys); if (push && !embedded && history.state?.jellyManga) history.back(); }
    async function open(tab = 'library', options = {}) {
        if (typeof ApiClient === 'undefined' || !ApiClient.accessToken()) return;
        if (tab === 'admin' && !options.host) { location.hash = '#/configurationpage?name=JellyManga'; return; }
        if (root) { if ((options.host && root.parentNode === options.host) || (!options.host && root.dataset.embedded !== '1')) { await navigate(tab); return; } close(false); }
        root = element('section'); root.id = 'jm-app'; root.setAttribute('aria-label', 'JellyTome'); if (options.host) { root.className = 'jm-embedded'; root.dataset.embedded = '1'; }
        const header = element('header', 'jm-header'); const brand = element('div', 'jm-brand', 'Jelly'); brand.append(element('span', '', 'Tome'));
        const nav = element('nav', 'jm-nav'); nav.setAttribute('aria-label', 'Manga navigation'); if (options.host) nav.hidden = true;
        header.append(brand, nav, button('Back to Jellyfin', () => close(), 'jm-close')); main = element('main', 'jm-main'); root.append(header, main); (options.host || document.body).append(root); if (options.host) header.querySelector('.jm-close').hidden = true;
        try {
            session = await api('session');
            for (const [id, label] of (options.host ? [] : [['discover', 'Discover'], ['library', 'My library'], ['continue', 'Continue reading'], ['downloads', 'Downloads']])) {
                const b = button(label, () => navigate(id)); b.dataset.tab = id; nav.append(b);
            }
            if (!options.host) history.pushState({ ...(history.state || {}), jellyManga: true }, '', location.href);
            document.addEventListener('keydown', keys); await navigate(tab);
        } catch (e) { message(e.message, true); }
    }
    async function navigate(tab) {
        clearInterval(poll); generation++; reader = null; releaseImages(); current = tab; if (!main) return;
        root.querySelector('.jm-header').hidden = false; main.className = 'jm-main'; main.replaceChildren(); root.scrollTop = 0;
        root.querySelectorAll('[data-tab]').forEach(b => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
        const version = generation;
        try {
            if (tab === 'discover') await discover(version);
            else if (tab === 'library' || tab === 'continue') await library(tab === 'continue', version);
            else if (tab === 'downloads') await downloads(version);
            else if (tab === 'admin' && session.admin) await admin('Overview', version);
        } catch (e) { if (version === generation) message(e.message, true); }
    }
    async function discover(version) {
        heading('Find your next obsession.', 'Search your enabled sources. Request a series once; new English chapters arrive automatically.');
        const sources = await api('sources'); if (version !== generation) return;
        const form = element('form', 'jm-search'); const input = element('input'); input.placeholder = 'Search manga, manhwa, webtoons…'; input.setAttribute('aria-label', 'Search manga'); input.required = true; input.minLength = 2;
        const select = element('select'); select.setAttribute('aria-label', 'Source'); select.append(new Option('All enabled sources', '')); sources.forEach(s => select.append(new Option(s.name, s.id)));
        const submit = button('Search', () => form.requestSubmit(), 'jm-primary'); form.append(input, select, submit); main.append(form);
        const results = element('div', 'jm-grid'); main.append(results);
        if (!sources.length) empty('No sources are enabled. Ask your administrator to configure and test sources.');
        let searchNumber = 0;
        form.onsubmit = async e => {
            e.preventDefault(); const number = ++searchNumber; submit.disabled = true; results.replaceChildren(); message('Searching sources…');
            try {
                const data = await api('search?query=' + encodeURIComponent(input.value) + (select.value ? '&sourceId=' + encodeURIComponent(select.value) : ''));
                if (version !== generation || number !== searchNumber) return;
                message(`${data.results.length} results${data.errors.length ? ` · ${data.errors.length} sources could not respond` : ''}`);
                for (const s of data.results) {
                    const card = element('article', 'jm-card'); card.append(cover(s), element('div', 'jm-badge', sources.find(x => x.id === s.sourceId)?.name || s.sourceId), element('h3', '', s.title), element('p', '', s.description || 'English chapters · automatic release monitoring'));
                    const downloaded = data.downloadedCounts?.[s.id] ?? 0;
                    if (downloaded > 0) card.append(element('div', 'jm-badge', downloaded === 1 ? '1 chapter downloaded' : downloaded + ' chapters downloaded'));
                    const chapterInfo = element('p', 'jm-muted');
                    chapterInfo.setAttribute('aria-live', 'polite');
                    card.append(chapterInfo);
                    const details = button('Chapter details', async () => {
                        chapterInfo.textContent = 'Loading chapter details…';
                        let info;
                        try {
                            info = await api('search/' + encodeURIComponent(s.id) + '/details');
                        } catch (_) {
                            chapterInfo.textContent = 'Chapter details unavailable. Try again.';
                            return;
                        }
                        chapterInfo.textContent = info.chapterCount + ' English chapter listings' + (info.latestChapter ? ' · Latest: ' + info.latestChapter : '');
                        if (info.description) card.querySelector('p').textContent = info.description;
                        details.remove();
                    });
                    card.append(details);
                    const actions = element('div', 'jm-actions'); actions.append(button('Request & monitor', async () => { await api('requests', 'POST', { sourceId: s.sourceId, url: s.url }); message(`“${s.title}” requested. Available chapters are queued and monitoring is on.`); }, 'jm-primary')); card.append(actions); results.append(card);
                }
                if (data.errors.length) { const errors = element('details'); errors.append(element('summary', '', 'Source diagnostics'), element('pre', '', data.errors.map(x => x.sourceId + ': ' + x.error).join('\n'))); main.append(errors); }
            } catch (ex) { if (version === generation) message(ex.message, true); } finally { submit.disabled = false; }
        };
    }
    async function library(continuing, version) {
        heading(continuing ? 'Pick up where you left off.' : 'Your manga, always ready.', continuing ? 'Your progress follows your Jellyfin account across devices.' : 'Downloaded chapters and monitored series from all your sources.');
        let data = await api('library'); if (version !== generation) return;
        if (continuing) data = data.filter(x => x.progress).sort((a, b) => b.progress.updatedAt.localeCompare(a.progress.updatedAt));
        if (!data.length) { empty(continuing ? 'Start reading a chapter to see it here.' : 'Your library is waiting. Discover a series to start downloading.'); return; }
        const grid = element('div', 'jm-grid'); main.append(grid);
        for (const item of data) {
            const card = element('article', 'jm-card'); card.append(cover(item.series), element('div', 'jm-badge', item.series.sourceId), element('h3', '', item.series.title), element('p', '', `${item.downloaded} chapters downloaded · ${item.monitoring ? 'Monitoring' : 'Not monitoring'}`));
            const actions = element('div', 'jm-actions'); actions.append(button(item.progress ? 'Continue reading' : 'View chapters', () => item.progress ? read(item.progress.chapterId, item.progress.page, item.progress.bookmarked) : chapterList(item.series)));
            if (item.progress) actions.append(button('Chapters', () => chapterList(item.series))); card.append(actions); grid.append(card);
        }
    }
    async function chapterList(series) {
        generation++; const version = generation; main.replaceChildren(); heading(series.title, series.description); main.append(button('← Library', () => navigate('library')));
        const jobs = await api('library/' + series.id + '/chapters'); if (version !== generation) return;
        const panel = element('div', 'jm-panel'); main.append(panel);
        for (const job of jobs) { const row = element('div', 'jm-row'); row.append(element('div', '', job.chapter.title), job.status === 'Complete' ? button('Read', () => read(job.chapter.id)) : element('small', '', job.status)); panel.append(row); }
    }
    async function downloads(version) {
        heading('Chapters on their way.', 'Requests start immediately. Your administrator can pause, cancel, or retry downloads.');
        const panel = element('div', 'jm-panel'); main.append(panel);
        const refresh = async () => {
            const jobs = await api('downloads'); if (version !== generation) return; panel.replaceChildren();
            if (!jobs.length) panel.append(element('div', 'jm-empty', 'No downloads requested yet.'));
            for (const job of jobs) { const row = element('div', 'jm-row'); const info = element('div'); info.append(element('strong', '', job.chapter.title), element('div', 'jm-muted', `${job.sourceId} · ${job.status} · attempt ${job.attempts}`)); if (job.error) info.append(element('small', '', job.error)); row.append(info); if (job.status === 'Complete') row.append(button('Read', () => read(job.chapter.id))); panel.append(row); }
        }; await refresh(); poll = setInterval(() => refresh().catch(e => message(e.message, true)), 5000);
    }
    async function admin(section, version = generation) {
        if (!session.admin || root?.dataset.embedded !== '1') throw new Error('Open administration from Jellyfin Dashboard > JellyTome.');
        main.replaceChildren(); heading('Manga control room.', 'Sources, downloads, storage, and access in one place.');
        const tabs = element('nav', 'jm-admin-tabs'); tabs.setAttribute('aria-label', 'Administration');
        for (const label of ['Overview', 'Sources', 'Downloads', 'Monitored series', 'Storage', 'Users', 'Settings', 'Diagnostics']) tabs.append(button(label, () => { generation++; return admin(label); }, label === section ? 'jm-primary' : ''));
        main.append(tabs); const panel = element('section', 'jm-panel'); main.append(panel);
        const overview = await api('admin/overview'); if (version !== generation) return;
        if (section === 'Overview') {
            const stats = element('div', 'jm-stats');
            for (const [label, value] of [['Downloaded', overview.downloads.Complete || 0], ['Queued', overview.downloads.Queued || 0], ['Failed', overview.downloads.Failed || 0], ['Verified sources', overview.checks.filter(c => c.download && c.search && c.details && c.chapters && c.pages).length]]) { const stat = element('div', 'jm-stat'); stat.append(element('b', '', String(value)), element('span', 'jm-muted', label)); stats.append(stat); }
            panel.append(stats, element('p', '', overview.injection ? 'File Transformation: registered' : 'File Transformation: not registered. Install the dependency and restart Jellyfin.'), element('p', '', 'Storage used: ' + (overview.usedBytes == null ? 'Not configured' : (overview.usedBytes / 1073741824).toFixed(2) + ' GiB')));
            if (overview.storageError) panel.append(element('p', 'jm-error', overview.storageError));
            for (const check of overview.checks) panel.append(element('p', 'jm-muted', `${check.sourceId}: ${check.error || (check.download ? 'Complete chapter checked' : 'Download not tested')} · ${new Date(check.checkedAt).toLocaleString()}`));
        } else if (section === 'Diagnostics') { const logs = await api('admin/logs'); if (version !== generation) return; if (!logs.length) panel.append(element('p', 'jm-muted', 'No diagnostic events yet.')); for (const entry of logs) { const row = element('div', 'jm-row'); const info = element('div'); info.append(element('strong', '', entry.kind), element('p', 'jm-muted', entry.message), element('small', '', new Date(entry.at).toLocaleString())); row.append(info); panel.append(row); }
        } else if (section === 'Sources') await sourceAdmin(panel, version);
        else if (section === 'Downloads') {
            const config = await api('admin/settings'); panel.append(button(config.paused ? 'Resume queue & monitoring' : 'Pause queue & monitoring', async () => { await api('admin/settings', 'PUT', { ...config, paused: !config.paused }); await admin(section); }));
            const jobs = await api('downloads'); if (version !== generation) return;
            for (const job of jobs) { const row = element('div', 'jm-row'); const info = element('div'); info.append(element('strong', '', job.chapter.title), element('p', 'jm-muted', job.status + (job.error ? ' · ' + job.error : ''))); const actions = element('div', 'jm-actions'); if (job.status !== 'Complete') for (const action of ['retry', 'pause', 'cancel']) actions.append(button(action, async () => { await api(`admin/downloads/${job.chapter.id}/${action}`, 'POST'); await admin(section); })); row.append(info, actions); panel.append(row); }
        } else if (section === 'Monitored series') {
            for (const s of overview.monitored) { const row = element('div', 'jm-row'); const info = element('div'); info.append(element('strong', '', s.series.title), element('p', 'jm-muted', s.error || (s.lastChecked ? 'Checked ' + new Date(s.lastChecked).toLocaleString() : 'Not checked yet'))); row.append(info, button(s.monitoring ? 'Stop monitoring' : 'Monitor releases', async () => { await api('admin/series/' + s.series.id, 'PUT', { monitoring: !s.monitoring }); await admin(section); })); panel.append(row); }
        } else await settings(panel, overview, section, version);
    }
    function field(container, text, value, type = 'text') { const label = element('label', '', text); const input = element('input'); input.type = type; if (type === 'checkbox') input.checked = Boolean(value); else input.value = value ?? ''; label.append(input); container.append(label); return input; }
    async function settings(panel, overview, section, version) {
        const config = await api('admin/settings'); if (version !== generation) return; const form = element('form', 'jm-form'); panel.append(form);
        const controls = {};
        if (section === 'Settings' || section === 'Storage') {
            const storageLabel = element('label', '', 'Manga storage folder'); const selectedFolder = element('output', 'jm-folder-path', config.storagePath || 'No folder selected'); selectedFolder.value = config.storagePath || ''; selectedFolder.setAttribute('aria-label', 'Selected manga folder'); controls.storagePath = selectedFolder;
            const choose = button('Choose folder', () => directoryPicker(selectedFolder.value, overview.libraries, path => { selectedFolder.value = path; choose.focus(); })); storageLabel.append(selectedFolder, choose); form.append(storageLabel); const label = element('label', '', 'Jellyfin library controlling user access'); const select = element('select'); select.append(new Option('Select library…', '')); for (const lib of overview.libraries) select.append(new Option(lib.name, lib.itemId)); select.value = config.libraryId; label.append(select); form.append(label); controls.libraryId = select;
            controls.storageLimitBytes = field(form, 'Storage limit (GiB, 0 = unlimited)', config.storageLimitBytes / 1073741824, 'number'); controls.storageLimitBytes.min = '0';
        }
        if (section === 'Settings') { controls.monitorMinutes = field(form, 'Check releases every (minutes)', config.monitorMinutes, 'number'); controls.downloadConcurrency = field(form, 'Global concurrent chapter downloads (1–8)', config.downloadConcurrency, 'number'); controls.downloadConcurrency.min = '1'; controls.downloadConcurrency.max = '8'; controls.downloadConcurrency.step = '1'; form.append(element('p', 'jm-muted', 'The global limit applies across all websites. Set each website’s limit in Sources. Lower limits take effect as active downloads finish.')); controls.convertToAvif = field(form, 'Convert downloaded pages to AVIF', config.convertToAvif ?? true, 'checkbox'); controls.avifQuality = field(form, 'AVIF quality (1–100)', config.avifQuality ?? 65, 'number'); controls.avifQuality.min = '1'; controls.avifQuality.max = '100'; controls.avifQuality.step = '1'; form.append(element('p', 'jm-muted', 'Default quality 65. Keeps full resolution. Requires libaom-av1 in Jellyfin FFmpeg. Existing AVIF and GIF pages are retained; changing quality affects future downloads.')); controls.paused = field(form, 'Pause queue and monitoring', config.paused, 'checkbox'); }
        const blocked = [];
        if (section === 'Users') { form.append(element('p', 'jm-muted', 'Users with access to the configured Jellyfin library can search, read, and request immediately. Block individual accounts below. Administrators retain access.')); for (const user of overview.users) { const input = field(form, 'Block ' + user.username, config.deniedUsers.some(id => id.replaceAll('-', '') === user.id.replaceAll('-', '')), 'checkbox'); blocked.push([user.id, input]); } }
        const save = button('Save settings', () => form.requestSubmit(), 'jm-primary'); form.append(save);
        form.onsubmit = async e => { e.preventDefault(); try { const update = { ...config }; for (const [key, input] of Object.entries(controls)) update[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) * (key === 'storageLimitBytes' ? 1073741824 : 1) : input.value; if (section === 'Users') update.deniedUsers = blocked.filter(x => x[1].checked).map(x => x[0]); await api('admin/settings', 'PUT', update); message('Settings saved.'); } catch (ex) { message(ex.message, true); } };
    }
    async function serverApi(path) {
        const response = await fetch(ApiClient.getUrl(path), { credentials: 'same-origin', headers: sessionHeaders() });
        const text = await response.text(); let data; try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
        if (!response.ok) throw new Error(data?.error || data?.Message || 'Jellyfin cannot browse this folder. Check the server account permissions.');
        return data;
    }
    async function directoryPicker(initial, libraries, select) {
        const dialog = element('dialog', 'jm-directory-picker'); dialog.setAttribute('aria-label', 'Choose manga folder on server');
        const title = element('h2', '', 'Choose manga folder'); const help = element('p', 'jm-muted', 'Browse folders on your Jellyfin server.');
        const location = element('output', 'jm-folder-path', 'Server roots'); location.setAttribute('aria-label', 'Current server folder');
        const status = element('p', 'jm-muted'); status.setAttribute('role', 'status'); const list = element('div', 'jm-directory-list'); const toolbar = element('div', 'jm-actions'); const actions = element('div', 'jm-actions');
        let path = '', revision = 0;
        const choose = button('Use this folder', () => { if (path) { select(path); dialog.close(); } }, 'jm-primary'); choose.disabled = true;
        async function visit(next) {
            const request = ++revision; choose.disabled = true; list.replaceChildren(); status.textContent = 'Loading folders...';
            try {
                const items = await serverApi(next ? 'Environment/DirectoryContents?includeDirectories=true&includeFiles=false&path=' + encodeURIComponent(next) : 'Environment/Drives');
                if (!dialog.open || request !== revision) return;
                path = next; location.value = path || 'Server roots'; status.textContent = items.length ? '' : 'No subfolders. You can select this folder.';
                for (const item of items) { const name = item.Name ?? item.name; const folder = item.Path ?? item.path; const entry = button(name, () => visit(folder), 'jm-directory-entry'); const icon = element('span', 'material-icons notranslate', 'folder'); icon.setAttribute('aria-hidden', 'true'); entry.prepend(icon); list.append(entry); }
                choose.disabled = !path;
            } catch (error) { if (request === revision) status.textContent = error.message; }
        }
        toolbar.append(button('Server roots', () => visit('')), button('Up', async () => { if (!path) return; try { await visit(await serverApi('Environment/ParentPath?path=' + encodeURIComponent(path)) || ''); } catch (error) { status.textContent = error.message; } }));
        const shortcuts = element('div', 'jm-actions');
        for (const library of libraries) for (const folder of (library.locations || library.Locations || [])) shortcuts.append(button(library.name || library.Name || folder, () => visit(folder)));
        actions.append(button('Cancel', () => dialog.close()), choose); dialog.append(title, help, toolbar, shortcuts, location, status, list, actions); root.append(dialog);
        dialog.addEventListener('close', () => { revision++; dialog.remove(); }); dialog.showModal(); await visit(initial || '');
    }
    async function sourceAdmin(panel, version) {
        const sources = await api('admin/sources'); if (version !== generation) return;
        const actions = element('div', 'jm-actions'); actions.append(button('Add custom source', () => editSource({ id: '', name: '', baseUrl: 'https://example.org', kind: 'html', enabled: false, delayMilliseconds: 1500, maxPagination: 5, allowedHosts: [], searchPath: '/?s={query}', searchItems: '.result', searchLink: 'a', searchCover: 'img', titleSelector: 'h1', descriptionSelector: '.description', chaptersPath: '{series}', chapterItems: '.chapters a', chapterLink: '', pagesSelector: '.reader img', imageAttribute: 'src' })), button('Export definitions', () => { const blob = new Blob([JSON.stringify(sources, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = element('a'); a.href = url; a.download = 'jellymanga-sources.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }), button('Import definitions', () => { const input = element('input'); input.type = 'file'; input.accept = '.json'; input.onchange = async () => { try { if (!input.files[0] || input.files[0].size > 1024 * 1024) throw new Error('Choose a JSON file smaller than 1 MiB.'); await api('admin/sources/import', 'POST', JSON.parse(await input.files[0].text())); await admin('Sources'); } catch (e) { message(e.message, true); } }; input.click(); })); panel.append(actions);
        for (const source of sources) {
            const row = element('div', 'jm-row'); const info = element('div'); info.append(element('strong', '', source.name), element('div', 'jm-muted', source.status), element('small', '', source.removed ? 'Removed · library retained' : source.enabled ? 'Enabled' : 'Disabled')); const controls = element('div', 'jm-actions');
            const limitForm = element('form', 'jm-form'); const limit = field(limitForm, 'Max concurrent downloads · ' + source.name, source.maxConcurrentDownloads ?? 1, 'number'); limit.min = '1'; limit.max = '8'; limit.step = '1';
            limitForm.append(button('Save download limit', () => limitForm.requestSubmit()));
            limitForm.onsubmit = async e => { e.preventDefault(); try { await api('admin/sources/' + encodeURIComponent(source.id) + '/downloads', 'PUT', { maxConcurrentDownloads: Number(limit.value) }); source.maxConcurrentDownloads = Number(limit.value); message('Website download limit saved. The global limit and request delay still apply.'); } catch (ex) { message(ex.message, true); } };
            info.append(limitForm);
            controls.append(button('Edit / rules', () => editSource(source)), button(source.enabled ? 'Disable' : 'Enable', async () => { await api('admin/sources/' + source.id, 'PUT', { ...source, enabled: !source.enabled, removed: false }); await admin('Sources'); }), button('Test', () => testSource(source)), button('Remove', async () => { await api('admin/sources/' + source.id, 'DELETE'); await admin('Sources'); })); row.append(info, controls); panel.append(row);
        }
    }
    function editSource(source) {
        main.replaceChildren(); heading(source.id ? 'Edit source rules.' : 'Add a source.', 'Use CSS selectors for HTML or dotted property paths for JSON. Explicitly allow each image CDN host. Saving resets verification.');
        main.append(button('← Sources', () => admin('Sources'))); const form = element('form', 'jm-panel'); const textarea = element('textarea'); textarea.setAttribute('aria-label', 'Source definition JSON'); textarea.value = JSON.stringify(source, null, 2); form.append(textarea, button('Save source', () => form.requestSubmit(), 'jm-primary')); main.append(form);
        form.onsubmit = async e => { e.preventDefault(); try { const value = JSON.parse(textarea.value); await api('admin/sources/' + encodeURIComponent(value.id), 'PUT', value); await admin('Sources'); message('Source saved. Test it before relying on downloads.'); } catch (ex) { message(ex.message, true); } };
    }
    function testSource(source) {
        main.replaceChildren(); heading('Test ' + source.name, 'Test search, details, chapter extraction, and optionally a complete chapter download. Test archives are deleted afterward.'); main.append(button('← Sources', () => admin('Sources')));
        const form = element('form', 'jm-panel'); const query = field(form, 'Search query', 'One Piece'); const url = field(form, 'Optional exact series URL', ''); const download = field(form, 'Download and validate a complete chapter (requires configured storage)', false, 'checkbox'); const submit = button('Run test', () => form.requestSubmit(), 'jm-primary'); form.append(submit); main.append(form);
        form.onsubmit = async e => { e.preventDefault(); submit.disabled = true; message('Testing source. A full chapter can take several minutes.'); try { const result = await api('admin/sources/' + source.id + '/test', 'POST', { query: query.value, seriesUrl: url.value || null, download: download.checked }); message(result.error || (result.download ? 'Full chapter download verified.' : 'Extraction checked; download not verified.'), !!result.error); form.append(element('pre', '', JSON.stringify(result, null, 2))); } catch (ex) { message(ex.message, true); } finally { submit.disabled = false; } };
    }
    async function imageFor(chapter, page, signal) {
        const key = chapter + ':' + page; if (blobUrls.has(key)) return blobUrls.get(key);
        const response = await fetch(ApiClient.getUrl(`JellyManga/chapters/${chapter}/pages/${page}`), { credentials: 'same-origin', headers: sessionHeaders(), signal });
        if (!response.ok) throw new Error('Could not load page ' + (page + 1)); const url = URL.createObjectURL(await response.blob());
        if (signal.aborted) { URL.revokeObjectURL(url); throw new DOMException('Aborted', 'AbortError'); } blobUrls.set(key, url); return url;
    }
    async function read(id, start, bookmarked) {
        generation++; const version = generation; clearInterval(poll); releaseImages(); main.replaceChildren(); main.className = 'jm-reader'; root.querySelector('.jm-header').hidden = true;
        try {
            const manifest = await api('chapters/' + id + '/manifest'); const progress = await api('progress'); if (version !== generation) return;
            const saved = progress.find(p => p.chapterId === id); let preferences = {}; try { preferences = JSON.parse(localStorage.getItem('jm-reader:' + session.userId) || '{}'); } catch (_) { /* invalid local preference */ }
            reader = { id, chapter: manifest.chapter, total: manifest.pages, page: Math.min(start ?? saved?.page ?? 0, manifest.pages - 1), bookmarked: bookmarked ?? saved?.bookmarked ?? false, mode: preferences.mode || 'rtl', zoom: 100, render: 0 };
            const bar = element('div', 'jm-reader-toolbar'); const mode = element('select'); mode.setAttribute('aria-label', 'Reading mode'); for (const [value, text] of [['rtl', 'Right to left'], ['ltr', 'Left to right'], ['double', 'Double page'], ['vertical', 'Vertical scroll']]) mode.append(new Option(text, value)); mode.value = reader.mode;
            mode.onchange = () => { reader.mode = mode.value; localStorage.setItem('jm-reader:' + session.userId, JSON.stringify({ mode: reader.mode })); drawPages(); };
            bar.append(button('← Library', () => navigate('library')), element('strong', '', manifest.chapter.title), mode, button('−', () => { reader.zoom = Math.max(50, reader.zoom - 10); drawPages(); }), button('+', () => { reader.zoom = Math.min(200, reader.zoom + 10); drawPages(); }), button('Fullscreen', async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await root.requestFullscreen(); }), button(reader.bookmarked ? 'Bookmarked' : 'Bookmark', async () => { reader.bookmarked = !reader.bookmarked; await saveProgress(); bar.querySelector('[data-bookmark]').textContent = reader.bookmarked ? 'Bookmarked' : 'Bookmark'; })); bar.lastChild.dataset.bookmark = '1';
            const pages = element('div', 'jm-reader-pages'); pages.tabIndex = 0; pages.setAttribute('aria-label', 'Chapter pages');
            let touchX = 0; pages.addEventListener('touchstart', e => { touchX = e.changedTouches[0].clientX; }, { passive: true }); pages.addEventListener('touchend', e => { if (!reader || reader.mode === 'vertical') return; const dx = e.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 70) move((dx < 0 ? 1 : -1) * (reader.mode === 'rtl' ? -1 : 1)); }, { passive: true });
            const bottom = element('div', 'jm-reader-bottom'); const position = element('input'); position.type = 'number'; position.min = '1'; position.max = String(manifest.pages); position.setAttribute('aria-label', 'Page number'); position.style.width = '80px'; position.onchange = () => move(Number(position.value) - 1 - reader.page);
            bottom.append(button('Previous', () => move(-1)), position, element('span', '', '/ ' + manifest.pages), button('Next', () => move(1)), button('Next chapter', nextChapter)); main.append(bar, pages, bottom); await drawPages();
        } catch (e) { if (version === generation) { main.append(button('← Library', () => navigate('library'))); message(e.message, true); } }
    }
    async function saveProgress() { if (!reader) return; const r = reader; const snapshot = { seriesId: r.chapter.seriesId, chapterId: r.id, page: r.page, bookmarked: r.bookmarked, updatedAt: new Date().toISOString() }; progressWrites = progressWrites.catch(() => {}).then(() => api('progress', 'PUT', snapshot)); await progressWrites; }
    async function drawPages() {
        if (!reader) return; const r = reader; const render = ++r.render; const area = main.querySelector('.jm-reader-pages'); if (!area) return;
        pageObserver?.disconnect(); area.replaceChildren(); area.className = 'jm-reader-pages jm-' + r.mode; main.querySelector('.jm-reader-bottom input').value = r.page + 1;
        const count = r.mode === 'double' && innerWidth > 700 ? 2 : 1;
        if (r.mode === 'vertical') { drawVertical(r, render, area); await saveProgress(); return; }
        const indices = Array.from({ length: Math.min(count, r.total - r.page) }, (_, i) => r.page + i);
        if (r.mode === 'rtl' && count === 2) indices.reverse();
        for (const page of indices) { const img = element('img'); img.alt = 'Page ' + (page + 1); img.dataset.page = page; img.loading = 'lazy'; img.style.width = r.zoom + '%'; area.append(img); imageFor(r.id, page, pageAbort.signal).then(url => { if (reader === r && render === r.render) img.src = url; }).catch(e => { if (e.name !== 'AbortError' && reader === r) message(e.message, true); }); }
        for (const [key, value] of blobUrls) { const [chapter, page] = key.split(':'); if (chapter !== r.id || Math.abs(Number(page) - r.page) > 6) { URL.revokeObjectURL(value); blobUrls.delete(key); } }
        if (r.page + count < r.total) imageFor(r.id, r.page + count, pageAbort.signal).catch(() => {});
        await saveProgress();
    }
    function drawVertical(r, render, area) {
        for (const url of blobUrls.values()) URL.revokeObjectURL(url); blobUrls.clear();
        const slots = [], nearby = new Set(), queued = new Set(), loading = new Map();
        let disposed = false, frame = 0;
        r.pageSizes ??= new Map();
        const alive = () => !disposed && reader === r && r.render === render;
        function discard(page) {
            const key = r.id + ':' + page, url = blobUrls.get(key);
            slots[page].replaceChildren();
            if (url) { URL.revokeObjectURL(url); blobUrls.delete(key); }
        }
        function updateProgress() {
            frame = 0; if (!alive()) return;
            const line = root.getBoundingClientRect().top + Math.min(160, root.clientHeight * .25);
            let low = 0, high = slots.length - 1;
            while (low < high) { const middle = (low + high) >> 1; if (slots[middle].getBoundingClientRect().bottom <= line) low = middle + 1; else high = middle; }
            if (r.page !== low) { r.page = low; main.querySelector('.jm-reader-bottom input').value = low + 1; saveProgress().catch(e => message(e.message, true)); }
        }
        function onScroll() { if (!frame) frame = requestAnimationFrame(updateProgress); }
        function pump() {
            if (!alive()) return;
            while (loading.size < 2 && queued.size) {
                const page = queued.values().next().value; queued.delete(page);
                if (!nearby.has(page) || loading.has(page) || slots[page].querySelector('img')) continue;
                const abort = new AbortController(); loading.set(page, abort);
                imageFor(r.id, page, abort.signal).then(async url => {
                    if (!alive() || !nearby.has(page) || abort.signal.aborted) return;
                    const image = element('img'); image.alt = 'Page ' + (page + 1); image.decoding = 'async'; image.src = url;
                    await image.decode();
                    if (!alive() || !nearby.has(page) || abort.signal.aborted) return;
                    const ratio = image.naturalWidth + ' / ' + image.naturalHeight;
                    r.pageSizes.set(page, ratio); slots[page].style.aspectRatio = ratio;
                    slots[page].replaceChildren(image); onScroll();
                }).catch(error => {
                    if (error.name !== 'AbortError' && alive() && nearby.has(page)) {
                        const retry = button('Retry page ' + (page + 1), () => { slots[page].replaceChildren(); queued.add(page); pump(); });
                        slots[page].replaceChildren(retry);
                    }
                }).finally(() => {
                    loading.delete(page);
                    if (!disposed && !nearby.has(page)) discard(page);
                    if (alive() && nearby.has(page) && abort.signal.aborted) queued.add(page);
                    pump();
                });
            }
        }
        for (let page = 0; page < r.total; page++) {
            const slot = element('div', 'jm-vertical-page'); slot.dataset.page = page;
            slot.setAttribute('aria-label', 'Page ' + (page + 1));
            slot.style.width = r.zoom + '%'; slot.style.aspectRatio = r.pageSizes.get(page) || '2 / 3';
            slots.push(slot); area.append(slot);
        }
        // Keep placeholders for the entire chapter; only nearby pages retain image data.
        const observer = new IntersectionObserver(entries => {
            if (!alive()) return;
            for (const entry of entries) {
                const page = Number(entry.target.dataset.page);
                if (entry.isIntersecting) { nearby.add(page); queued.add(page); }
                else { nearby.delete(page); queued.delete(page); loading.get(page)?.abort(); discard(page); }
            }
            pump(); onScroll();
        }, { root, rootMargin: '1200px 0px', threshold: 0 });
        pageObserver = { disconnect() {
            disposed = true; observer.disconnect(); root?.removeEventListener('scroll', onScroll);
            cancelAnimationFrame(frame); for (const abort of loading.values()) abort.abort();
            for (let page = 0; page < slots.length; page++) discard(page);
        } };
        root.addEventListener('scroll', onScroll, { passive: true });
        root.scrollTop += slots[r.page].getBoundingClientRect().top - root.getBoundingClientRect().top - 65;
        slots.forEach(slot => observer.observe(slot));
    }
    async function move(delta) { if (!reader) return; const step = reader.mode === 'double' && innerWidth > 700 ? 2 : 1; reader.page = Math.max(0, Math.min(reader.total - 1, reader.page + delta * (Math.abs(delta) === 1 ? step : 1))); await drawPages(); }
    async function nextChapter() { if (!reader) return; const r = reader; const jobs = (await api('library/' + r.chapter.seriesId + '/chapters')).filter(j => j.status === 'Complete'); const next = jobs[jobs.findIndex(j => j.chapter.id === r.id) + 1]; if (next) await read(next.chapter.id, 0); else message('You are up to date with downloaded chapters.'); }
    function keys(e) { if (!root || root.querySelector('dialog[open]')) return; if (e.key === 'Escape' && !document.fullscreenElement) { close(); return; } if (!reader || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return; if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); move((e.key === 'ArrowRight' ? 1 : -1) * (reader.mode === 'rtl' ? -1 : 1)).catch(ex => message(ex.message, true)); } }
    // Scope observers to adding our own entries; never rewrite/remove another plugin's navigation.
    let scheduled = false;
    function mountNavigation() {
        scheduled = false; if (typeof ApiClient === 'undefined' || !ApiClient.accessToken()) return;
        for (const parent of document.querySelectorAll('.skinHeader .headerRight, .headerRight, .appHeader .headerActions')) {
            if (parent.querySelector('[data-jellymanga-header]')) continue;
            const entry = button('', () => open('library')); entry.className = 'paper-icon-button-light headerButton headerButtonRight emby-button jm-header-icon'; entry.dataset.jellymangaHeader = '1'; entry.title = 'JellyTome'; entry.setAttribute('aria-label', 'JellyTome');
            const image = element('img'); image.src = ApiClient.getUrl('JellyManga/assets/icon.png'); image.alt = ''; image.setAttribute('aria-hidden', 'true'); image.onerror = () => { const glyph = element('span', 'material-icons notranslate', 'menu_book'); glyph.setAttribute('aria-hidden', 'true'); image.replaceWith(glyph); }; entry.append(image); parent.prepend(entry);
        }
        document.querySelectorAll('[data-jellymanga-home], [data-jellymanga-nav]').forEach(entry => entry.remove());
    }
    const observer = new MutationObserver(() => { if (!scheduled) { scheduled = true; setTimeout(mountNavigation, 150); } }); observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', () => { if (root && root.dataset.embedded !== '1') close(false); });
    window.addEventListener('hashchange', () => { if (root && root.dataset.embedded !== '1') close(false); });
    window.addEventListener('beforeunload', () => releaseImages());
    document.addEventListener('visibilitychange', () => { if (reader && document.hidden) saveProgress().catch(() => {}); });
    window.JellyManga = { open, close, closeEmbedded: host => { if (root?.parentNode === host) close(false); } }; mountNavigation();
})();
