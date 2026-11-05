"""Build a portable plugin zip; optionally generate a GitHub catalog for a supplied repository."""
import argparse, datetime, hashlib, json, pathlib, re, subprocess, zipfile

root = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--repository', help='GitHub owner/repository for release URLs; no network publishing occurs')
parser.add_argument('--version', default='0.1.0.0')
args = parser.parse_args()
if not re.fullmatch(r'\d+\.\d+\.\d+\.\d+', args.version): raise ValueError('Version must contain four numbers, for example 0.1.0.0')
if args.repository and (len(args.repository.split('/')) != 2 or any(not p or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._' for c in p) for p in args.repository.split('/'))): raise ValueError('Use owner/repository')
subprocess.run(['dotnet', 'build', str(root/'src/Jellyfin.Plugin.JellyManga'), '-c', 'Release', '--nologo', '-p:Version='+args.version], check=True)
output = root/'artifacts/releases'; output.mkdir(parents=True, exist_ok=True)
archive = output/('JellyTome_'+args.version+'.zip')
meta = dict(guid='165db579-6287-4f53-985b-7e503449eb33', name='JellyTome', description='Manga discovery, downloading, monitoring and reading inside Jellyfin. Preview release; see source test report.', overview='Manga library and reader', owner='ThuGie', category='General', version=args.version, targetAbi='10.11.3.0', status='Active', autoUpdate=True, imagePath='thumb.png', assemblies=['AngleSharp.dll', 'Jellyfin.Plugin.JellyManga.dll'])
build = root/'src/Jellyfin.Plugin.JellyManga/bin/Release/net9.0'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in ['Jellyfin.Plugin.JellyManga.dll', 'AngleSharp.dll']:
        z.write(build/name, name)
    z.writestr('meta.json', json.dumps(meta, indent=2)+'\n')
    z.write(root/'thumb.png', 'thumb.png')
    z.write(root/'LICENSE', 'LICENSE')
digest = hashlib.md5(archive.read_bytes()).hexdigest()
(output/(archive.name+'.sha256')).write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
if args.repository:
    version = dict(version=args.version, changelog='Preview release. Seven verified source samples; the planned 30-source target is incomplete. Check source and compatibility reports before installing.', targetAbi='10.11.3.0', sourceUrl=f'https://github.com/{args.repository}/releases/download/v{args.version}/{archive.name}', checksum=digest, timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(), dependencies=[])
    versions = []
    existing = root/'manifest.json'
    if existing.exists():
        previous = json.loads(existing.read_text())
        if previous and previous[0].get('guid') == meta['guid']: versions = [v for v in previous[0].get('versions', []) if v['version'] != args.version]
    manifest = [{k:meta[k] for k in ['guid','name','description','overview','owner','category']} | dict(imageUrl=f'https://raw.githubusercontent.com/{args.repository}/main/thumb.png', versions=sorted([version]+versions,key=lambda v:tuple(map(int,v['version'].split('.'))),reverse=True))]
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Created '+str(archive)+'\nMD5 '+digest)
from verify_release import validate
validate(archive, args.version, output/'manifest.json' if args.repository else None)
