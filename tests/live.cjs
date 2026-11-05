const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
    const root = path.join(__dirname, '../artifacts/jellyfin-live');
    const session = JSON.parse(fs.readFileSync(path.join(root, 'session.json'), 'utf8'));
    const browser = await chromium.launch({ headless: true }); const results = [];
    try {
        for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
            const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(15000);
            const errors = []; page.on('pageerror', e => errors.push(e.message));
            await page.goto(session.base + '/web/');
            await page.locator('#txtManualName').fill('jellymanga-test'); await page.locator('#txtManualPassword').fill(session.password); await page.locator('#txtManualPassword').press('Enter');
            await page.waitForFunction(() => typeof ApiClient !== 'undefined' && ApiClient.getCurrentUserId());
            // Navigation must come from the server transformation, without adding scripts in this test.
            await page.locator('[data-jellymanga-home] button').click(); await page.locator('#jm-app h1').waitFor();
            await page.screenshot({ path: path.join(root, name + '-library.png') });
            const chapters = page.getByRole('button', { name: 'View chapters', exact: true });
            if (await chapters.count()) await chapters.first().click(); else await page.getByRole('button', { name: 'Chapters', exact: true }).first().click();
            await page.getByRole('button', { name: 'Read', exact: true }).first().click(); await page.locator('.jm-reader-pages img').waitFor();
            await page.waitForFunction(() => [...document.querySelectorAll('.jm-reader-pages img')].every(i => i.complete && i.naturalWidth > 0));
            await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.getByRole('button', { name: '← Library', exact: true }).click();
            await page.getByRole('button', { name: 'Admin dashboard', exact: true }).click(); await page.getByRole('button', { name: 'Sources', exact: true }).click(); await page.getByRole('button', { name: 'Add custom source', exact: true }).waitFor();
            await page.screenshot({ path: path.join(root, name + '-admin.png') });
            const jmErrors = errors.filter(e => /jellymanga|jm-app/i.test(e)); assert.deepEqual(jmErrors, []); results.push({ viewport: name, injection: true, reader: true, admin: true, errors }); await page.close();
        }
        fs.writeFileSync(path.join(root, 'browser-results.json'), JSON.stringify(results, null, 2)); console.log('Real Jellyfin web integration passed at desktop and mobile sizes.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
