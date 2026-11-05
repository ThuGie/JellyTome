"""Verify the repository's committed catalog after the release workflow updates it."""
import argparse,base64,json,pathlib,re,subprocess,tempfile
from verify_release import validate
p=argparse.ArgumentParser();p.add_argument('--repository',required=True);p.add_argument('--version',required=True);p.add_argument('--archive',required=True);a=p.parse_args()
if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',a.repository):raise ValueError('Invalid repository')
response=json.loads(subprocess.check_output(['gh','api',f'repos/{a.repository}/contents/manifest.json?ref=main'],text=True))
with tempfile.TemporaryDirectory(prefix='jellytome-catalog-') as directory:
    manifest=pathlib.Path(directory)/'manifest.json';manifest.write_bytes(base64.b64decode(response['content']))
    validate(a.archive,a.version,manifest)
print('Published main/manifest.json contains the expected release and matching ZIP checksum.')
