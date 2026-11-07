const { chromium } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const web = path.join(__dirname, '../src/Jellyfin.Plugin.JellyManga/Web');
const artifacts = path.join(__dirname, '../artifacts/browser'); fs.mkdirSync(artifacts, { recursive: true });
const series = { id: 'a'.repeat(64), sourceId: 'fixture', coverUrl: '', title: 'The Lantern Keeper', description: 'A young archivist follows a trail of forgotten stories through a city that never sees the sun.' };
const chapter = { id: 'b'.repeat(64), seriesId: series.id, title: 'Chapter 1 · A light in the stacks', number: 1 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const source = { id: 'fixture', name: 'Fixture source', baseUrl: 'https://example.org', kind: 'html', status: 'Verified download', enabled: true };
const job = { chapter, sourceId: 'fixture', status: 'Complete', pages: 12, attempts: 1 };
let progress = [], requested = 0, savedSettings, redownloading = false;
const calls = [];
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); const route = url.pathname.replace('/base/JellyManga/', '');
    if (url.pathname === '/base/web/index.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../JellyManga/assets/app.css"></head><body><header class="skinHeader"><div class="headerRight"></div></header><div class="mainDrawer"><div class="navMenuOptionContainer"><a id="foreign-plugin">JellySpot</a></div></div><div id="indexPage"><div class="homeSectionsContainer"></div></div><script>window.ApiClient={getUrl:p=>'/base/'+p,accessToken:()=>'legacy-not-used',setRequestHeaders:h=>{h.Authorization='MediaBrowser Client="JellyTomeTests", DeviceId="fixture", Token="test-token"'}};</script><script src="../JellyManga/assets/app.js"></script></body></html>`); return; }
    if (url.pathname === '/base/web/configurationpage') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><header class="skinHeader"><div class="headerRight"></div></header><script>window.ApiClient={getUrl:p=>'/base/'+p,accessToken:()=>'legacy-not-used',setRequestHeaders:h=>{h.Authorization='MediaBrowser Client="JellyTomeTests", DeviceId="fixture", Token="test-token"'}};</script>${fs.readFileSync(path.join(web,'config.html'),'utf8')}</body></html>`); return; }
    if (route === 'assets/icon.png') { res.setHeader('Content-Type','image/png'); res.end(fs.readFileSync(path.join(__dirname,'../thumb.png'))); return; }
    if (route.startsWith('assets/')) { res.setHeader('Content-Type', (route.endsWith('.css') ? 'text/css' : 'application/javascript') + '; charset=utf-8'); res.end(fs.readFileSync(path.join(web, route.slice(7)))); return; }
    if (url.pathname === '/fixture-cover.png') { res.setHeader('Content-Type', 'image/png'); res.end(png); return; }
    if (!req.headers.authorization?.includes('Token="test-token"')) { res.statusCode=401; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:'Modern Jellyfin authorization required'})); return; }
    assert.equal(req.headers['x-emby-token'], undefined); calls.push(req.method + ' ' + route);
    let text = ''; for await (const chunk of req) text += chunk; const body = text ? JSON.parse(text) : null;
    if (url.pathname.startsWith('/base/Environment/')) {
        res.setHeader('Content-Type','application/json');
        if (url.pathname.endsWith('/Drives')) res.end(JSON.stringify([{Name:'NAS volume',Path:'/volume1',Type:'Directory'}]));
        else if (url.pathname.endsWith('/ParentPath')) res.end(JSON.stringify('/volume1'));
        else { const p=url.searchParams.get('path'); res.end(JSON.stringify(p==='/volume1' ? [{Name:'Comics',Path:'/volume1/Comics',Type:'Directory'},{Name:'Manga',Path:'/volume1/Manga',Type:'Directory'}] : [])); }
        return;
    }
    if (route.startsWith('covers/')) { res.setHeader('Content-Type', 'image/png'); res.end(png); return; }
    if (route.includes('/pages/')) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100" viewBox="0 0 800 1100"><rect width="800" height="1100" fill="#f5f0e6"/><text x="40" y="65" font-family="sans-serif" font-size="24" fill="#293137">THE LANTERN KEEPER</text><text x="40" y="95" font-family="sans-serif" font-size="13" fill="#555">READER TEST FIXTURE · PAGE ${route.split('/').pop()}</text><rect x="40" y="125" width="720" height="340" fill="#283345"/><circle cx="610" cy="225" r="50" fill="#c2f36b"/><path d="M40 465L40 370 180 300 180 370 310 240 310 350 470 280 470 465" fill="#171d28"/><rect x="40" y="490" width="345" height="400" fill="#d9d1c0" stroke="#293137" stroke-width="3"/><rect x="410" y="490" width="350" height="400" fill="#293137"/><rect x="460" y="575" width="250" height="215" fill="#b7c0c9"/><path d="M580 575V790M460 680H710" stroke="#293137" stroke-width="12"/><text x="70" y="550" font-family="sans-serif" font-size="17">Every story begins</text><text x="70" y="580" font-family="sans-serif" font-size="17">with a little light.</text><rect x="40" y="915" width="720" height="125" fill="#c2f36b"/><text x="75" y="985" font-family="sans-serif" font-size="22">Layout fixture — not downloaded manga</text></svg>`); return; }
    let result;
    if (route === 'session') result = { userId: 'user-1', admin: true };
    else if (route === 'sources') result = [source];
    else if (route === 'search/' + series.id + '/details') result = { chapterCount: 43, firstChapterNumber: 22, lastChapterNumber: 64, missingStart: true, latestChapter: 'Chapter 64', description: 'Detailed synopsis' };
    else if (route === 'search') result = { results: [series], errors: [], downloadedCounts: { [series.id]: 1 } };
    else if (route === 'requests') { requested++; result = { series, monitoring: true }; }
    else if (route === 'library') result = [{ series, monitoring: true, downloaded: 1, progress: progress[0], lastUpdatedAt: '2026-11-06T12:00:00Z', latestUpdatedChapter: chapter }];
    else if (route.endsWith('/chapters')) result = [redownloading ? {...job, status:'Queued'} : job];
    else if (route.endsWith('/manifest')) result = { chapter, pages: 12 };
    else if (route === 'downloads') result = [{...job, seriesTitle: series.title}, {...job, chapter: {...chapter, number: 2, title:'Chapter 2'}, status:'Downloading', seriesTitle: series.title}];
    else if (route === 'admin/downloads/' + chapter.id + '/redownload' && req.method === 'POST') { redownloading = true; res.statusCode = 204; res.end(); return; }
    else if (route === 'progress') { if (body) { progress = [body]; res.statusCode = 204; res.end(); return; } result = progress; }
    else if (route === 'admin/overview') result = { injection: true, usedBytes: 1024, downloads: { Complete: 1 }, checks: [], monitored: [{ series, monitoring: true }], libraries: [{ name: 'Manga', itemId: 'lib' }], users: [{ id: 'user-1', username: 'Reader' }] };
    else if (route === 'admin/sources') result = [source];
    else if (route === 'admin/sources/fixture/enabled' && req.method === 'PUT') {
        source.enabled = body;
        result = source;
    }
    else if (route === 'admin/sources/fixture/downloads' && req.method === 'PUT') { source.maxConcurrentDownloads = body.maxConcurrentDownloads; res.statusCode = 204; res.end(); return; }
    else if (route === 'admin/settings') { if (body) { savedSettings = body; res.statusCode = 204; res.end(); return; } result = savedSettings || { storagePath: '/manga', libraryId: 'lib', storageLimitBytes: 50 * 1073741824, deniedUsers: [], monitorMinutes: 360, downloadConcurrency: 2 }; }
    else { res.statusCode = 404; result = { error: 'Fixture route missing: ' + route }; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true }); let assertions = 0;
    try {
        for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844]]) {
            progress = []; redownloading = false; const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(10000); const errors = []; page.on('pageerror', e => errors.push(e.message));
            await page.goto(`http://127.0.0.1:${server.address().port}/base/web/index.html`);
            await page.locator('[data-jellymanga-header]').click(); assertions++; await page.locator('#jm-app h1').waitFor();
            assert.equal(await page.locator('#foreign-plugin').count(), 1); assertions++;
            assert.equal(await page.locator('[data-jellymanga-nav], [data-jellymanga-home]').count(), 0); assertions++;
            assert.equal(await page.getByRole('button', {name:'Admin dashboard',exact:true}).count(),0); assertions++;
            assert.equal(await page.getByText('Manga · Browse & read',{exact:true}).count(),0); assertions++;
            await page.waitForFunction(() => document.querySelector('.jm-cover img')?.naturalWidth > 0); assertions++;
            assert.equal(await page.locator('.jm-cover-fallback:visible').count(), 0); assertions++;
            await page.locator('.jm-cover img').evaluate(img => { img.src = '/missing-cover.png'; });
            await page.locator('.jm-cover-fallback:visible').waitFor(); assertions++;
            await page.getByRole('button', { name: 'My library', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('.jm-cover img')?.naturalWidth > 0);
            await page.screenshot({ path: path.join(artifacts, name + '-library.png') });
            await page.getByRole('combobox', { name: 'Sort library' }).selectOption('title');
            await page.getByRole('button', { name: 'Recent updates', exact: true }).click();
            await page.getByRole('button', { name: 'Read latest addition', exact: true }).waitFor();
            await page.locator('time[datetime="2026-11-06T12:00:00Z"]').waitFor(); assertions += 2;
            await page.getByRole('button', { name: 'Discover', exact: true }).click(); await page.getByRole('textbox', { name: 'Search manga', exact: true }).fill('Lantern'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await page.getByRole('button', { name: 'Request & monitor' }).click();
            await page.getByRole('status').filter({ hasText: 'requested' }).waitFor(); assertions++;
            await page.getByText('1 chapter downloaded', {exact:true}).waitFor();
            await page.getByRole('button', {name:'Chapter details',exact:true}).click();
            await page.getByText('43 English chapter listings · Latest: Chapter 64 · Listed range: 22–64', {exact:true}).waitFor(); assertions += 2;
            await page.getByText('Missing the start · first numbered chapter is 22', {exact:true}).waitFor(); assertions++;
            await page.waitForFunction(() => document.querySelector('.jm-cover img')?.naturalWidth > 0); assertions++;
            assert(calls.some(call => call.startsWith('GET covers/'))); assertions++;
            await page.screenshot({ path: path.join(artifacts, name + '-discover.png') });
            await page.getByRole('button', {name:'View download progress',exact:true}).click();
            await page.getByText('1 of 2 chapters downloaded', {exact:true}).waitFor();
            await page.getByText('1 downloading', {exact:true}).waitFor(); assertions += 2;
            await page.getByRole('button', { name: 'My library', exact: true }).click(); await page.getByRole('button', { name: 'View chapters' }).click(); await page.getByRole('button', { name: 'Read', exact: true }).click(); await page.locator('.jm-reader-pages img').waitFor();
            await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.jm-reader-bottom input').value === '2'); assertions++;
            await page.keyboard.press('ArrowLeft'); await page.waitForFunction(() => document.querySelector('.jm-reader-bottom input').value === '3'); assertions++;
            await page.getByRole('combobox', { name: 'Reading mode' }).selectOption('vertical');
            await page.locator('.jm-vertical-page img').first().waitFor();
            assert.equal(await page.locator('.jm-vertical-page').count(), 12); assertions++;
            assert.equal(await page.getByRole('button', {name:'Continue scrolling',exact:true}).count(), 0); assertions++;
            await page.locator('.jm-vertical-page').nth(10).evaluate(node => node.scrollIntoView({block:'start'}));
            await page.locator('.jm-vertical-page[data-page="10"] img').waitFor();
            await page.waitForFunction(() => Number(document.querySelector('.jm-reader-bottom input').value) >= 11);
            assert(await page.locator('.jm-vertical-page img').count() <= 8); assertions++;
            await page.waitForFunction(() => !document.querySelector('.jm-vertical-page[data-page="0"] img')); assertions++;
            await page.locator('.jm-vertical-page').nth(2).evaluate(node => node.scrollIntoView({block:'start'}));
            await page.locator('.jm-vertical-page[data-page="2"] img').waitFor(); assertions++;
            await page.waitForFunction(() => Number(document.querySelector('.jm-reader-bottom input').value) === 3);
            await page.getByRole('combobox', { name: 'Reading mode' }).selectOption('ltr');
            await page.locator('.jm-reader-pages > img').waitFor();
            assert.equal(await page.locator('.jm-vertical-page').count(), 0); assertions++;
            await page.getByRole('combobox', { name: 'Reading mode' }).selectOption('vertical');
            await page.locator('.jm-vertical-page[data-page="2"] img').waitFor();
            await page.screenshot({ path: path.join(artifacts, name + '-reader.png') });
            await page.getByRole('button', { name: '← Library', exact: true }).click();
            await page.getByRole('button', { name: 'Chapters', exact: true }).click();
            await page.getByRole('button', { name: 'Redownload', exact: true }).click();
            await page.getByText('Queued', {exact:true}).waitFor(); assertions++;
            await page.goto(`http://127.0.0.1:${server.address().port}/base/web/configurationpage?name=JellyManga`); await page.getByRole('button', { name: 'Sources', exact: true }).click(); await page.getByRole('button', { name: 'Edit / rules' }).waitFor();
            const sourceRow = page.locator('.jm-row').filter({hasText:'Fixture source'});
            await sourceRow.evaluate(row => { row.dataset.toggleCheck = 'original'; });
            await sourceRow.getByRole('button', {name:'Disable',exact:true}).click();
            await sourceRow.getByRole('button', {name:'Enable',exact:true}).waitFor();
            await sourceRow.getByRole('button', {name:'Enable',exact:true}).click();
            await sourceRow.getByRole('button', {name:'Disable',exact:true}).waitFor();
            assert.equal(await sourceRow.getAttribute('data-toggle-check'), 'original'); assertions++;
            await page.getByLabel('Max concurrent downloads · Fixture source').fill('4');
            await page.getByRole('button', { name: 'Save download limit', exact: true }).click();
            await page.getByRole('status').filter({hasText:'Website download limit saved'}).waitFor();
            assert.equal(source.maxConcurrentDownloads, 4); assertions++;
            await page.getByRole('button', { name: 'Sources', exact: true }).click();
            assert.equal(await page.getByLabel('Max concurrent downloads · Fixture source').inputValue(), '4'); assertions++;
            await page.screenshot({ path: path.join(artifacts, name + '-sources.png') });
            await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByLabel('Global concurrent chapter downloads (1–8)').fill('4'); await page.getByLabel('AVIF quality (1–100)').fill('65'); await page.getByRole('button', { name: 'Save settings' }).click(); await page.getByRole('status').filter({ hasText: 'saved' }).waitFor(); assertions++;
            assert.equal(savedSettings.downloadConcurrency, 4); assertions++; assert.equal(savedSettings.avifQuality, 65); assert.equal(savedSettings.convertToAvif, true); assertions += 2;
            assert.equal(await page.locator('#jm-app').evaluate(e => e.scrollWidth <= e.clientWidth), true); assertions++;
            assert.equal(await page.getByRole('button', {name:'Discover',exact:true}).count(),0); assertions++;
            await page.getByRole('button', {name:'Choose folder',exact:true}).click();
            const picker=page.getByRole('dialog',{name:'Choose manga folder on server'}); await picker.waitFor();
            await picker.getByRole('button',{name:'Server roots',exact:true}).click();
            await picker.getByRole('button',{name:'NAS volume',exact:true}).click();
            await picker.getByRole('button',{name:'Comics',exact:true}).click();
            await picker.getByRole('button',{name:'Use this folder',exact:true}).click();
            assert.equal(await page.getByLabel('Selected manga folder').textContent(),'/volume1/Comics'); assertions++;
            await page.getByRole('button',{name:'Save settings',exact:true}).click(); await page.getByRole('status').filter({hasText:'saved'}).waitFor(); assert.equal(savedSettings.storagePath,'/volume1/Comics'); assertions++;
            await page.getByRole('button',{name:'Choose folder',exact:true}).click(); await page.keyboard.press('Escape'); await page.waitForFunction(()=>!document.querySelector('dialog[open]')); assert.equal(await page.locator('#jm-app').count(),1); assertions++;
            await page.evaluate(()=>window.JellyManga.close(false)); await page.waitForFunction(() => !document.getElementById('jm-app')); assertions++;
            await page.goto(`http://127.0.0.1:${server.address().port}/base/web/configurationpage?name=JellyManga`);
            await page.getByRole('heading', { name: 'Manga control room.' }).waitFor();
            assert.equal(await page.locator('#jm-open-admin').count(),0); assertions++;
            assert.equal(await page.locator('#jm-dashboard-host > #jm-app.jm-embedded').count(),1); assertions++;
            await page.evaluate(() => { const p=document.getElementById('jellyMangaConfigurationPage'); p.dispatchEvent(new Event('viewshow')); p.dispatchEvent(new Event('pageshow')); });
            await page.waitForTimeout(200); assert.equal(await page.locator('#jm-app').count(),1); assertions++;
            await page.screenshot({ path: path.join(artifacts, name + '-direct-dashboard.png') });
            assert.deepEqual(errors, []); assertions++; await page.close();
        }
        assert.equal(requested, 3); assert(calls.every(c => !c.includes('undefined'))); assertions += 2;
        fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ assertions, viewports: ['desktop', 'tablet', 'mobile'], errors: [] }, null, 2));
        console.log(`Browser integration: ${assertions} assertions passed across desktop/tablet/mobile.`);
    } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
