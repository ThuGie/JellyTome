"""Start a new, isolated Jellyfin test server. Never touches a running user's server or its data."""
import argparse, json, os, pathlib, secrets, shutil, subprocess, time, urllib.request, zipfile

parser=argparse.ArgumentParser();parser.add_argument('--server',required=True,help='Path to an existing Jellyfin executable (read only)');parser.add_argument('--ffmpeg',required=True);parser.add_argument('--resume',action='store_true');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]; live=root/'artifacts/jellyfin-live';live.mkdir(parents=True,exist_ok=True)
if (live/'session.json').exists(): raise SystemExit('An isolated session already exists. Stop that session explicitly before preparing a replacement.')
server=pathlib.Path(args.server).resolve()
for folder in ['data/plugins/JellyManga','data/plugins/FileTransformation','config','cache','logs','manga']:(live/folder).mkdir(parents=True,exist_ok=True)
if not args.resume:
    subprocess.run(['python',str(root/'scripts/package.py')],check=True)
    with zipfile.ZipFile(root/'artifacts/releases/JellyTome_0.1.0.0.zip') as z:z.extractall(live/'data/plugins/JellyManga')
    ft=live/'file-transformation.zip'
    urllib.request.urlretrieve('https://github.com/IAmParadox27/jellyfin-plugin-file-transformation/releases/download/3.0.3.0/Release-10.11.11.zip',ft)
    with zipfile.ZipFile(ft) as z:
        for item in z.infolist():
            if item.filename.endswith(('.dll','meta.json')):
                target=live/'data/plugins/FileTransformation'/pathlib.PurePosixPath(item.filename).name;target.write_bytes(z.read(item))
    (live/'config/network.xml').write_text('''<?xml version="1.0"?><NetworkConfiguration><BaseUrl>/manga-test</BaseUrl><InternalHttpPort>28096</InternalHttpPort><PublicHttpPort>28096</PublicHttpPort><EnableHttps>false</EnableHttps><EnableIPv4>true</EnableIPv4><EnableIPv6>false</EnableIPv6><EnableRemoteAccess>false</EnableRemoteAccess><AutoDiscovery>false</AutoDiscovery><LocalNetworkAddresses><string>127.0.0.1</string></LocalNetworkAddresses></NetworkConfiguration>''')
    stdout=(live/'stdout.log').open('wb');stderr=(live/'stderr.log').open('wb')
    command=[str(server),'--datadir',str(live/'data'),'--configdir',str(live/'config'),'--cachedir',str(live/'cache'),'--logdir',str(live/'logs'),'--webdir',str(server.parent/'jellyfin-web'),'--ffmpeg',args.ffmpeg]
    process=subprocess.Popen(command,stdout=stdout,stderr=stderr,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    pid=process.pid;(live/'pid.txt').write_text(str(pid))
else:pid=int((live/'pid.txt').read_text());process=None
base='http://127.0.0.1:28096/manga-test';token=None
def call(path,method='GET',data=None):
    headers={'Content-Type':'application/json','X-Emby-Authorization':'MediaBrowser Client="JellyMangaTests", Device="Isolated", DeviceId="jellymanga-isolated", Version="1"'}
    if token:headers['X-Emby-Token']=token
    req=urllib.request.Request(base+path,method=method,headers=headers,data=None if data is None else json.dumps(data).encode())
    with urllib.request.urlopen(req,timeout=15) as response:
        raw=response.read();return json.loads(raw) if raw else None
for attempt in range(90):
    if process is not None and process.poll() is not None:raise SystemExit('Test server exited. Inspect artifacts/jellyfin-live/stdout.log')
    try:info=call('/System/Info/Public');break
    except Exception:time.sleep(1)
else:raise SystemExit('Test server did not become ready. Inspect its logs.')
password=secrets.token_urlsafe(24)
call('/Startup/Configuration','POST',{'UICulture':'en-US','MetadataCountryCode':'US','PreferredMetadataLanguage':'en'})
call('/Startup/User') # Initializes Jellyfin's first user before updating it.
call('/Startup/User','POST',{'Name':'jellymanga-test','Password':password})
call('/Startup/RemoteAccess','POST',{'EnableRemoteAccess':False,'EnableAutomaticPortMapping':False})
call('/Startup/Complete','POST')
auth=call('/Users/AuthenticateByName','POST',{'Username':'jellymanga-test','Pw':password});token=auth['AccessToken']
call('/Library/VirtualFolders?name=Manga&collectionType=books','POST',{'LibraryOptions':{'PathInfos':[{'Path':str(live/'manga')}],'EnableRealtimeMonitor':False}})
library=next(v for v in call('/Library/VirtualFolders') if v['Name']=='Manga')
config=call('/JellyManga/admin/settings');config.update(storagePath=str(live/'manga'),libraryId=library['ItemId']);call('/JellyManga/admin/settings','PUT',config)
session=dict(base=base,userId=auth['User']['Id'],token=token,password=password,serverId=info['Id'],pid=pid,libraryId=library['ItemId'])
(live/'session.json').write_text(json.dumps(session,indent=2));print('Isolated server ready on '+base+'. Credentials are in ignored artifacts; not printed.')
