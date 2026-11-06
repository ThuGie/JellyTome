"""Verify real Jellyfin catalog discovery and optional installation on the isolated test server."""
import argparse,json,pathlib,urllib.parse,urllib.request
parser=argparse.ArgumentParser();parser.add_argument('--version',required=True);parser.add_argument('--install',action='store_true');parser.add_argument('--repository-url',default='https://raw.githubusercontent.com/ThuGie/JellyTome/main/manifest.json');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];session=json.loads((root/'artifacts/jellyfin-live/session.json').read_text());base=session['base'];url=args.repository_url
def call(path,method='GET',body=None):
    request=urllib.request.Request(base+path,method=method,headers={'Authorization':'MediaBrowser Client="JellyTomeTests", DeviceId="catalog-test", Token="'+session['token']+'"','Content-Type':'application/json'},data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(request,timeout=90) as response:
        raw=response.read();return json.loads(raw) if raw else None
assert call('/System/Info/Public')['Id']==session['serverId'],'Not the isolated test instance'
repositories=call('/Repositories')
if all(r['Url']!=url for r in repositories):call('/Repositories','POST',repositories+[dict(Name='JellyTome',Url=url,Enabled=True)])
package=call('/Packages/JellyTome');version=next(v for v in package['versions'] if v['version']==args.version)
assert version['repositoryUrl']==url and version['sourceUrl'].endswith('/JellyTome_'+args.version+'.zip')
if args.install:
    query=urllib.parse.urlencode(dict(assemblyGuid=package['guid'],version=args.version,repositoryUrl=url))
    call('/Packages/Installed/JellyTome?'+query,'POST')
    plugins=call('/Plugins');installed=next(p for p in plugins if p['Name']=='JellyTome' and p['Version']==args.version)
    print('Catalog version '+args.version+' installed: '+installed['Status']+'. Restart the isolated server to verify activation.')
else:print('Jellyfin catalog resolves version '+args.version+' and its published download URL.')
