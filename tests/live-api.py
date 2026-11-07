"""Run only against the isolated test instance created by scripts/live-server.py."""
import base64,datetime,hashlib,json,pathlib,secrets,sqlite3,urllib.error,urllib.request,uuid,zipfile

root=pathlib.Path(__file__).resolve().parents[1];live=root/'artifacts/jellyfin-live';session=json.loads((live/'session.json').read_text());base=session['base'];admin=session['token'];checks=[]
def call(path,method='GET',data=None,token=admin,expected=200):
    headers={'Content-Type':'application/json','X-Emby-Authorization':'MediaBrowser Client="JellyMangaTests", Device="Isolated", DeviceId="jellymanga-api", Version="1"'}
    if token:headers['Authorization']='MediaBrowser Client="JellyTomeTests", Device="Isolated", DeviceId="jellymanga-api", Version="1", Token="'+token+'"'
    request=urllib.request.Request(base+path,method=method,headers=headers,data=None if data is None else json.dumps(data).encode())
    try:
        with urllib.request.urlopen(request,timeout=15) as response:status=response.status;raw=response.read();content_type=response.headers.get('Content-Type','')
    except urllib.error.HTTPError as e:status=e.code;raw=e.read();content_type=e.headers.get('Content-Type','')
    assert status==expected,(path,status,raw[:1000]);checks.append(f'{method} {path}: {status}')
    return json.loads(raw) if raw and 'json' in content_type else raw
assert call('/System/Info/Public')['Id']==session['serverId'],'Not the isolated test server'
assert call('/Users/'+session['userId'])['Name']=='jellymanga-test'
call('/JellyManga/session',token=None,expected=401);call('/JellyManga/admin/settings',token=None,expected=401)
assert call('/JellyManga/admin/overview')['injection']
html=call('/web/index.html',token=None).decode();assert html.count('data-jellymanga-assets')==2
assert b'JellyManga' in call('/JellyManga/assets/app.js',token=None)
series_id=hashlib.sha256(b'live-series').hexdigest();chapter_id=hashlib.sha256(b'live-chapter').hexdigest()
series=dict(id=series_id,sourceId='fixture',url='https://example.org/series',title='Live test manga',description='Isolated reader fixture',coverUrl='')
chapter=dict(id=chapter_id,seriesId=series_id,url='https://example.org/chapter',title='Chapter 1',number=1,language='en')
folder=live/'manga'/series_id;folder.mkdir(exist_ok=True);relative=series_id+'/'+chapter_id+'.cbz'
png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=')
with zipfile.ZipFile(live/'manga'/relative,'w') as archive:
    archive.writestr('00000.png',png);archive.writestr('00001.png',png);archive.writestr('ComicInfo.xml','<ComicInfo><Title>Fixture</Title></ComicInfo>')
database=live/'data/plugins/Jellyfin.Plugin.JellyManga/jellymanga.db';assert database.resolve().is_relative_to(live.resolve())
with sqlite3.connect(database) as db:
    db.execute('INSERT OR REPLACE INTO records VALUES(?,?,?)',('series',series_id,json.dumps(dict(series=series,monitoring=False))))
    db.execute('INSERT OR REPLACE INTO records VALUES(?,?,?)',('job',chapter_id,json.dumps(dict(chapter=chapter,sourceId='fixture',requestedBy=session['userId'],status='Complete',attempts=1,relativePath=relative,pages=2))))
source=next(s for s in call('/JellyManga/admin/sources') if s['id']=='mangapill')
try:
    call('/JellyManga/admin/sources/mangapill/downloads','PUT',dict(maxConcurrentDownloads=4),expected=204)
    updated=next(s for s in call('/JellyManga/admin/sources') if s['id']=='mangapill')
    assert updated['maxConcurrentDownloads']==4 and updated['status']==source['status']
    for invalid in [0,9]:call('/JellyManga/admin/sources/mangapill/downloads','PUT',dict(maxConcurrentDownloads=invalid),expected=400)
finally:call('/JellyManga/admin/sources/mangapill/downloads','PUT',dict(maxConcurrentDownloads=source.get('maxConcurrentDownloads',1)),expected=204)
call('/JellyManga/admin/sources/mangapill/downloads','PUT',dict(maxConcurrentDownloads=4),token=None,expected=401)
call('/JellyManga/session');assert call('/JellyManga/chapters/'+chapter_id+'/manifest')['pages']==2
assert call('/JellyManga/chapters/'+chapter_id+'/pages/0')==png
call('/JellyManga/chapters/'+chapter_id+'/pages/-1',expected=400)
assert call('/JellyManga/covers/'+series_id)==png
call('/JellyManga/covers/'+series_id,token=None,expected=401)
now=datetime.datetime.now(datetime.timezone.utc).isoformat();progress=dict(seriesId=series_id,chapterId=chapter_id,page=1,bookmarked=True,updatedAt=now)
call('/JellyManga/progress','PUT',progress,expected=204);assert next(p for p in call('/JellyManga/progress') if p['chapterId']==chapter_id)['page']==1
call('/JellyManga/progress','PUT',progress|dict(page=999),expected=400)
user=None
try:
    password=secrets.token_urlsafe(24);name='manga-viewer-'+uuid.uuid4().hex[:6]
    user=call('/Users/New','POST',dict(Name=name,Password=password));user_id=user['Id'];policy=user['Policy'];policy.update(IsAdministrator=False,EnableAllFolders=False,EnabledFolders=[])
    call('/Users/'+user_id+'/Policy','POST',policy,expected=204)
    auth=call('/Users/AuthenticateByName','POST',dict(Username=name,Pw=password));token=auth['AccessToken']
    for endpoint in ['/session','/library','/downloads','/progress','/sources','/chapters/'+chapter_id+'/manifest','/chapters/'+chapter_id+'/pages/0','/covers/'+series_id,'/admin/overview','/admin/sources','/admin/settings']:
        call('/JellyManga'+endpoint,token=token,expected=403)
    policy['EnabledFolders']=[session['libraryId']];call('/Users/'+user_id+'/Policy','POST',policy,expected=204)
    call('/JellyManga/admin/sources/mangapill/downloads','PUT',dict(maxConcurrentDownloads=4),token=token,expected=403)
    call('/JellyManga/session',token=token);assert call('/JellyManga/progress',token=token)==[]
    call('/JellyManga/chapters/'+chapter_id+'/manifest',token=token)
    call('/JellyManga/progress','PUT',progress|dict(page=0,bookmarked=False),token=token,expected=204)
    assert next(p for p in call('/JellyManga/progress') if p['chapterId']==chapter_id)['page']==1
    for endpoint in ['/admin/settings','/admin/sources','/admin/overview']:call('/JellyManga'+endpoint,token=token,expected=403)
    call('/JellyManga/admin/sources/custom','PUT',dict(id='custom',name='Unsafe',baseUrl='https://127.0.0.1',kind='html'),expected=400)
    config=call('/JellyManga/admin/settings');call('/JellyManga/admin/settings','PUT',config|dict(deniedUsers=[user_id]),expected=204);call('/JellyManga/library',token=token,expected=403)
    call('/JellyManga/admin/settings','PUT',config,expected=204)
finally:
    if user:call('/Users/'+user['Id'],'DELETE',expected=204)
output=live/'api-results.json';output.write_text(json.dumps(dict(checks=checks,count=len(checks)),indent=2));print(f'Live HTTP integration: {len(checks)} checks passed, including actual library permissions and progress isolation.')
