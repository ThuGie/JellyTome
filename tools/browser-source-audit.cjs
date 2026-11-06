/* Read-only source investigation in isolated browser sessions. No personal profiles, stealth, or challenge solving. */
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts/browser-source-audit'); fs.mkdirSync(output, { recursive: true });
const definitions = JSON.parse(fs.readFileSync(path.join(root, 'src/Jellyfin.Plugin.JellyManga/Sources/catalog.json'), 'utf8'));
const wanted = process.argv.find(a => a.startsWith('--ids='))?.slice(6).split(',');
const selected = definitions.filter(d => !wanted || wanted.includes(d.id));
const results = [];
async function audit(browser, source) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const page = await context.newPage();
    const network = []; const bodies = []; let serial = 0;
    page.setDefaultTimeout(7000);
    // Keep a trace of normal browser requests while avoiding unnecessary media downloads.
    await page.route('**/*', route => { const request=route.request(); const host=new URL(request.url()).hostname; const current=new URL(page.url().startsWith('http')?page.url():source.baseUrl).hostname.replace(/^www\./,''); if (['image','font','media'].includes(request.resourceType()) || request.frame().parentFrame() || /doubleclick|analytics|facebook|criteo|onclck|propeller|metricswpsh|rapidadexchange|googletagmanager/.test(host)) return route.abort(); return route.continue(); });
    page.on('response', response => {
        const request = response.request(); const type = response.headers()['content-type'] || '';
        if (!['document','xhr','fetch'].includes(request.resourceType())) return;
        const headers = request.headers();
        network.push({ url: response.url(), status: response.status(), method: request.method(), type, requestHeaders: Object.keys(headers), sessionHeader: !!headers['session-token'] });
        if (request.resourceType() !== 'document' && /json|protobuf|octet-stream/.test(type) && !/google|analytics|doubleclick|adservice|facebook/.test(response.url())) {
            const index = serial++;
            bodies.push(response.body().then(buffer => { if (buffer.length <= 1024 * 1024) fs.writeFileSync(path.join(output, source.id + '-response-' + index + '.bin'), buffer); }).catch(() => {}));
        }
    });
    let error = null, status = null;
    try {
        const response = await page.goto(source.baseUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }); status = response?.status();
        await page.waitForTimeout(1800);
        if (!process.argv.includes('--no-search') && !/just a moment|verify you are human|attention required/i.test(await page.title())) {
            const inputs = page.locator('input[type="search"],input[name="s"],input[name="q"],input[name="keyword"],input[placeholder*="search" i]');
            for (let i = 0; i < Math.min(await inputs.count(), 6); i++) {
                const input = inputs.nth(i); if (!await input.isVisible()) continue;
                await input.fill(source.id === 'webtoon' ? 'Omniscient Reader' : 'One Piece');
                await input.press('Enter'); await page.waitForTimeout(2200); break;
            }
        }
    } catch (e) { error = e.message.split('\n')[0]; }
    let state;
    try {
        state = await page.evaluate(() => ({
            title: document.title, url: location.href,
            text: document.body?.innerText.slice(0, 900),
            inputs: [...document.querySelectorAll('input')].slice(0, 15).map(e => ({name:e.name,type:e.type,placeholder:e.placeholder})),
            forms: [...document.forms].slice(0, 5).map(f => ({action:f.action,method:f.method})),
            links: [...document.querySelectorAll('a[href]')].filter(a => /\/manga\/|\/series\/|\/titles\/|\/comic\/|\/title\//.test(a.href)).slice(0, 35).map(a => ({title:a.innerText.trim().slice(0,100),url:a.href,cls:a.className,parent:a.parentElement?.className})),
            scripts: [...document.scripts].filter(s=>s.src).map(s=>s.src).slice(-10)
        }));
        fs.writeFileSync(path.join(output, source.id + '.html'), await page.content());
    } catch (e) { state = { url: page.url(), title: '', text: '', links: [] }; error ||= e.message; }
    await Promise.race([Promise.allSettled(bodies),new Promise(resolve=>setTimeout(resolve,1500))]);
    const record = { sourceId: source.id, checkedAt: new Date().toISOString(), status, error, ...state, network };
    fs.writeFileSync(path.join(output, source.id + '.json'), JSON.stringify(record, null, 2)); results.push(record);
    console.log(`${source.id}: ${status || '-'} ${state.title.slice(0,65)} -> ${state.url} (${state.links.length} candidate links)`);
    await context.close();
}
(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        let next = 0;
        await Promise.all(Array.from({length:Math.min(4,selected.length)}, async () => {
            while (next < selected.length) { const source=selected[next++]; try { await audit(browser,source); } catch(e) { console.log(source.id+': '+e.message.split('\n')[0]); } }
        }));
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(results.map(({network,links,scripts,text,forms,inputs,...summary})=>summary), null, 2));
    } finally { await browser.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });
