const { chromium } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const web = path.join(__dirname, '../src/Jellyfin.Plugin.JellyManga/Web');
const artifacts = path.join(__dirname, '../artifacts/browser'); fs.mkdirSync(artifacts, { recursive: true });
const series = { id: 'a'.repeat(64), sourceId: 'fixture', title: 'The Lantern Keeper', description: 'A young archivist follows a trail of forgotten stories through a city that never sees the sun.' };
const chapter = { id: 'b'.repeat(64), seriesId: series.id, title: 'Chapter 1 · A light in the stacks', number: 1 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const source = { id: 'fixture', name: 'Fixture source', baseUrl: 'https://example.org', kind: 'html', status: 'Verified download', enabled: true };
const job = { chapter, sourceId: 'fixture', status: 'Complete', pages: 12, attempts: 1 };
let progress = [], requested = 0, savedSettings;
const calls = [];
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); const route = url.pathname.replace('/base/JellyManga/', '');
    if (url.pathname === '/base/web/index.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../JellyManga/assets/app.css"></head><body><header class="skinHeader"><div class="headerRight"></div></header><div class="mainDrawer"><div class="navMenuOptionContainer"><a id="foreign-plugin">JellySpot</a></div></div><div id="indexPage"><div class="homeSectionsContainer"></div></div><script>window.ApiClient={getUrl:p=>'/base/'+p,accessToken:()=>'legacy-not-used',setRequestHeaders:h=>{h.Authorization='MediaBrowser Client="JellyTomeTests", DeviceId="fixture", Token="test-token"'}};</script><script src="../JellyManga/assets/app.js"></script></body></html>`); return; }
    if (url.pathname === '/base/web/configurationpage') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><header class="skinHeader"><div class="headerRight"></div></header><script>window.ApiClient={getUrl:p=>'/base/'+p,accessToken:()=>'legacy-not-used',setRequestHeaders:h=>{h.Authorization='MediaBrowser Client="JellyTomeTests", DeviceId="fixture", Token="test-token"'}};</script>${fs.readFileSync(path.join(web,'config.html'),'utf8')}</body></html>`); return; }
    if (route === 'assets/icon.png') { res.setHeader('Content-Type','image/png'); res.end(fs.readFileSync(path.join(__dirname,'../thumb.png'))); return; }
    if (route.startsWith('assets/')) { res.setHeader('Content-Type', (route.endsWith('.css') ? 'text/css' : 'application/javascript') + '; charset=utf-8'); res.end(fs.readFileSync(path.join(web, route.slice(7)))); return; }
    if (!req.headers.authorization?.includes('Token="test-token"')) { res.statusCode=401; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:'Modern Jellyfin authorization required'})); return; }
    assert.equal(req.headers['x-emby-token'], undefined); calls.push(req.method + ' ' + route);
    let text = ''; for await (const chunk of req) text += chunk; const body = text ? JSON.parse(text) : null;
    if (route.includes('/pages/')) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100" viewBox="0 0 800 1100"><rect width="800" height="1100" fill="#f5f0e6"/><text x="40" y="65" font-family="sans-serif" font-size="24" fill="#293137">THE LANTERN KEEPER</text><text x="40" y="95" font-family="sans-serif" font-size="13" fill="#555">READER TEST FIXTURE · PAGE ${route.split('/').pop()}</text><rect x="40" y="125" width="720" height="340" fill="#283345"/><circle cx="610" cy="225" r="50" fill="#c2f36b"/><path d="M40 465L40 370 180 300 180 370 310 240 310 350 470 280 470 465" fill="#171d28"/><rect x="40" y="490" width="345" height="400" fill="#d9d1c0" stroke="#293137" stroke-width="3"/><rect x="410" y="490" width="350" height="400" fill="#293137"/><rect x="460" y="575" width="250" height="215" fill="#b7c0c9"/><path d="M580 575V790M460 680H710" stroke="#293137" stroke-width="12"/><text x="70" y="550" font-family="sans-serif" font-size="17">Every story begins</text><text x="70" y="580" font-family="sans-serif" font-size="17">with a little light.</text><rect x="40" y="915" width="720" height="125" fill="#c2f36b"/><text x="75" y="985" font-family="sans-serif" font-size="22">Layout fixture — not downloaded manga</text></svg>`); return; }
    let result;
    if (route === 'session') result = { userId: 'user-1', admin: true };
    else if (route === 'sources') result = [source];
    else if (route === 'search') result = { results: [series], errors: [] };
    else if (route === 'requests') { requested++; result = { series, monitoring: true }; }
    else if (route === 'library') result = [{ series, monitoring: true, downloaded: 1, progress: progress[0] }];
    else if (route.endsWith('/chapters')) result = [job];
    else if (route.endsWith('/manifest')) result = { chapter, pages: 12 };
    else if (route === 'downloads') result = [job];
    else if (route === 'progress') { if (body) { progress = [body]; res.statusCode = 204; res.end(); return; } result = progress; }
    else if (route === 'admin/overview') result = { injection: true, usedBytes: 1024, downloads: { Complete: 1 }, checks: [], monitored: [{ series, monitoring: true }], libraries: [{ name: 'Manga', itemId: 'lib' }], users: [{ id: 'user-1', username: 'Reader' }] };
    else if (route === 'admin/sources') result = [source];
    else if (route === 'admin/settings') { if (body) { savedSettings = body; res.statusCode = 204; res.end(); return; } result = savedSettings || { storagePath: '/manga', libraryId: 'lib', storageLimitBytes: 50 * 1073741824, deniedUsers: [], monitorMinutes: 360, downloadConcurrency: 2 }; }
    else { res.statusCode = 404; result = { error: 'Fixture route missing: ' + route }; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true }); let assertions = 0;
    try {
        for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844]]) {
            progress = []; const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(10000); const errors = []; page.on('pageerror', e => errors.push(e.message));
            await page.goto(`http://127.0.0.1:${server.address().port}/base/web/index.html`);
            await page.locator('[data-jellymanga-header]').click(); assertions++; await page.locator('#jm-app h1').waitFor();
            assert.equal(await page.locator('#foreign-plugin').count(), 1); assertions++;
            assert.equal(await page.locator('[data-jellymanga-nav]').count(), 1); assertions++;
            await page.screenshot({ path: path.join(artifacts, name + '-library.png') });
            await page.getByRole('button', { name: 'Discover', exact: true }).click(); await page.getByRole('textbox', { name: 'Search manga', exact: true }).fill('Lantern'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await page.getByRole('button', { name: 'Request & monitor' }).click();
            await page.getByRole('status').filter({ hasText: 'requested' }).waitFor(); assertions++;
            await page.screenshot({ path: path.join(artifacts, name + '-discover.png') });
            await page.getByRole('button', { name: 'My library', exact: true }).click(); await page.getByRole('button', { name: 'View chapters' }).click(); await page.getByRole('button', { name: 'Read', exact: true }).click(); await page.locator('.jm-reader-pages img').waitFor();
            await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.jm-reader-bottom input').value === '2'); assertions++;
            await page.keyboard.press('ArrowLeft'); await page.waitForFunction(() => document.querySelector('.jm-reader-bottom input').value === '3'); assertions++;
            await page.getByRole('combobox', { name: 'Reading mode' }).selectOption('vertical'); await page.waitForTimeout(350); assert.equal(await page.locator('.jm-reader-pages img').count(), 5); assertions++;
            await page.screenshot({ path: path.join(artifacts, name + '-reader.png') });
            await page.getByRole('button', { name: '← Library', exact: true }).click(); await page.getByRole('button', { name: 'Admin dashboard', exact: true }).click(); await page.getByRole('button', { name: 'Sources', exact: true }).click(); await page.getByRole('button', { name: 'Edit / rules' }).waitFor();
            await page.screenshot({ path: path.join(artifacts, name + '-sources.png') });
            await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Save settings' }).click(); await page.getByRole('status').filter({ hasText: 'saved' }).waitFor(); assertions++;
            assert.equal(await page.locator('#jm-app').evaluate(e => e.scrollWidth <= e.clientWidth), true); assertions++;
            await page.getByRole('button', { name: 'Back to Jellyfin' }).click(); await page.waitForFunction(() => !document.getElementById('jm-app')); assertions++;
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
