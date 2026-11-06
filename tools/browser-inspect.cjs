const {chromium}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
    const url=process.argv[2], click=process.argv.find(a=>a.startsWith('--click='))?.slice(8), name=process.argv.find(a=>a.startsWith('--name='))?.slice(7)||'page';
    if(!url)throw new Error('Supply a public page URL');
    const out=path.resolve(__dirname,'../artifacts/browser-source-audit');fs.mkdirSync(out,{recursive:true});
    const browser=await chromium.launch({headless:true});const page=await browser.newPage();const network=[];
    try{
        await page.route('**/*',r=>['image','font','media'].includes(r.request().resourceType())?r.abort():r.continue());
        page.on('response',r=>{if(['xhr','fetch'].includes(r.request().resourceType())&&new URL(r.url()).hostname.endsWith(new URL(url).hostname.replace(/^www\./,'')))network.push({url:r.url(),status:r.status(),type:r.headers()['content-type']});});
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(2200);
        if(click){await page.getByText(click,{exact:false}).first().click({timeout:10000});await page.waitForTimeout(2500);}
        const data=await page.evaluate(()=>({url:location.href,title:document.title,links:[...document.querySelectorAll('a[href]')].filter(a=>!/javascript:|^#$/.test(a.getAttribute('href'))).map(a=>({text:a.innerText.trim(),href:a.href})).filter(a=>a.text).slice(0,50),buttons:[...document.querySelectorAll('button')].map(b=>b.innerText).filter(Boolean).slice(0,30),images:[...document.querySelectorAll('img')].map(i=>({src:i.src,data:i.getAttribute('data-src')||i.getAttribute('data-url'),cls:i.className})).slice(-45)}));
        fs.writeFileSync(path.join(out,name+'.html'),await page.content());fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify({...data,network},null,2));console.log(JSON.stringify({...data,links:data.links.slice(-15),images:data.images.slice(0,4),network},null,2));
    }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
