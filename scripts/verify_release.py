"""Validate the exact package and catalog that Jellyfin will consume."""
import argparse,hashlib,json,pathlib,re,uuid,zipfile

def validate(archive, version, manifest=None):
    archive=pathlib.Path(archive)
    with zipfile.ZipFile(archive) as z:
        names=z.namelist()
        if any(pathlib.PurePosixPath(n).name!=n or '\\' in n for n in names):raise ValueError('Package entries must be flat filenames')
        meta=json.loads(z.read('meta.json'))
        if meta['version']!=version or meta['name']!='JellyTome':raise ValueError('Plugin metadata name/version mismatch')
        dlls={n for n in names if n.endswith('.dll')}
        if set(meta.get('assemblies',[]))!=dlls:raise ValueError('Every bundled DLL, including dependencies, must be in the assembly allowlist')
        if not {'AngleSharp.dll','Jellyfin.Plugin.JellyManga.dll'}.issubset(dlls):raise ValueError('Required plugin dependencies missing')
        if meta.get('imagePath') not in names:raise ValueError('Plugin icon is missing')
        uuid.UUID(meta['guid'])
    if manifest:
        entries=json.loads(pathlib.Path(manifest).read_text());entry=next(e for e in entries if e['guid']==meta['guid'])
        v=next(v for v in entry['versions'] if v['version']==version)
        if not re.fullmatch(r'\d+\.\d+\.\d+\.\d+',v['targetAbi']):raise ValueError('Invalid target ABI')
        if v['checksum'].lower()!=hashlib.md5(archive.read_bytes()).hexdigest():raise ValueError('Catalog checksum does not match release ZIP')
        if not v['sourceUrl'].endswith('/v'+version+'/'+archive.name):raise ValueError('Catalog source URL does not match the release asset')
    return meta

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--archive',required=True);p.add_argument('--version',required=True);p.add_argument('--manifest');a=p.parse_args()
    validate(a.archive,a.version,a.manifest);print('Release package, dependency allowlist, and catalog validated.')
