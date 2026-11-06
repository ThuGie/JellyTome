"""Create a checked-in text-only source report from ignored live probe artifacts."""
import argparse,datetime,json,pathlib,sqlite3
root=pathlib.Path(__file__).resolve().parents[1];parser=argparse.ArgumentParser();parser.add_argument('--update-catalog',action='store_true');args=parser.parse_args();checks={}
def collect(check):
    old=checks.get(check['sourceId'])
    if old is None or check['checkedAt']>old['checkedAt']:checks[check['sourceId']]=check
for directory in [*(root/'artifacts').glob('source-probe*'), root/'artifacts/mangaplus-session-check']:
    database=directory/'probe.db'
    if database.exists():
        with sqlite3.connect(database) as db:
            for row in db.execute("SELECT json FROM records WHERE kind='check'"):collect(json.loads(row[0]))
    report=directory/'results.json'
    if report.exists():
        for check in json.loads(report.read_text(encoding='utf8')):collect(check)
catalog_path=root/'src/Jellyfin.Plugin.JellyManga/Sources/catalog.json';catalog=json.loads(catalog_path.read_text(encoding='utf8'));verified=[]
def passed(c):return all(c.get(stage) for stage in ['search','details','chapters','pages','download'])
def clean(text):return str(text or '').replace('|','/').replace('\n',' ').replace('\r',' ')[:600]
for source in catalog:
    check=checks.get(source['id']);ok=check is not None and passed(check)
    if ok:verified.append(source['name'])
    if args.update_catalog:
        source['enabled']=bool(source.get('enabled')) and ok
        if ok:source['status']='Verified sample '+check['checkedAt'][:10]+' · '+check['title']
        elif check:source['status']='Experimental / failed live test: '+clean(check.get('error') or 'Full download not verified')[:180]
lines=['# Live source status','',f"Generated {datetime.datetime.now(datetime.timezone.utc).isoformat()}. **{len(verified)} distinct download sources have verified samples. "+("The 30-source target is met." if len(verified)>=30 else "The 30-source target is incomplete.")+"**",'',
       'Verified sample downloads: '+(', '.join(verified) or 'None')+'.','',
       'Each verified result required search, details, chapter listing, ordered page extraction, a complete chapter archive, and archive reopening/image checks. A homepage response, candidate definition, or metadata-only integration does not count. Tests use representative titles; the query and title are recorded below. No credentials, copied website code, or downloaded chapter content are included in this report.','',
       '| Website | Test query / representative title | Search | Details | Chapters | Pages | Full chapter | Checked (UTC) | Result |','|---|---|---|---|---|---|---|---|---|']
for source in sorted(catalog,key=lambda s:s['name'].lower()):
    c=checks.get(source['id'])
    if c:lines.append('| '+ ' | '.join([clean(source['name']),clean(c['query'])+' / '+clean(c.get('title')), *['Pass' if c.get(k) else 'No' for k in ['search','details','chapters','pages','download']],clean(c['checkedAt']),clean(c.get('error') or ('Verified sample' if passed(c) else 'Not fully verified'))])+' |')
    else:lines.append('| '+clean(source['name'])+' | — | — | — | — | — | No | — | '+clean(source.get('status','Candidate; not tested'))+' |')
lines += ['', '## Limitations', '', '- A site can change or become unavailable after a passing sample. Failed sites remain disabled by default.', '- Mixed sources with unrelated search recommendations are filtered by title terms before displaying results.', '- Some candidate sites returned HTTP 403/522, changed domains, or need specialized adapters. These are failures or candidates, not supported downloads.', '- MANGA Plus search/details/chapters work with the public anonymous session header; protected chapter images remain unsupported. No personal account was used.', '- Anime-Planet remains a discovery/partner-reading investigation and is not a downloadable content adapter.', '- WEBTOON extraction needs additional handling for unavailable/age-gated/otherwise empty sample chapters. It is not claimed as verified.', '- Tests are network/location/time dependent; the plugin reports source errors rather than bypassing challenges.']
(root/'docs/source-status.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
(root/'docs/source-results.json').write_text(json.dumps(sorted(checks.values(),key=lambda c:c['sourceId']),indent=2)+'\n',encoding='utf8')
if args.update_catalog:catalog_path.write_text(json.dumps(catalog,indent=2)+'\n',encoding='utf8')
print(f'{len(verified)} verified full-download sites; {len(checks)} recorded source checks; {len(catalog)} catalog entries.')
