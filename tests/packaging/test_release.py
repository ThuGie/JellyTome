import importlib.util,json,pathlib,tempfile,unittest,zipfile
spec=importlib.util.spec_from_file_location('verify_release',pathlib.Path(__file__).resolve().parents[2]/'scripts/verify_release.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ReleaseTests(unittest.TestCase):
    def package(self, directory, assemblies):
        path=pathlib.Path(directory)/'JellyTome_0.1.0.1.zip'
        with zipfile.ZipFile(path,'w') as z:
            z.writestr('meta.json',json.dumps(dict(name='JellyTome',version='0.1.0.1',guid='165db579-6287-4f53-985b-7e503449eb33',assemblies=assemblies,imagePath='thumb.png')))
            for n in ['Jellyfin.Plugin.JellyManga.dll','AngleSharp.dll','thumb.png']:z.writestr(n,b'fixture')
        return path
    def test_all_dependencies_are_allowlisted(self):
        with tempfile.TemporaryDirectory() as d:module.validate(self.package(d,['AngleSharp.dll','Jellyfin.Plugin.JellyManga.dll']),'0.1.0.1')
    def test_missing_dependency_allowlist_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError,'allowlist'):module.validate(self.package(d,['Jellyfin.Plugin.JellyManga.dll']),'0.1.0.1')
    def test_version_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError,'version'):module.validate(self.package(d,['AngleSharp.dll','Jellyfin.Plugin.JellyManga.dll']),'0.1.0.2')
