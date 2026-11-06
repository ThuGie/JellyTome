"""Upgrade/restart only the recorded, isolated test server, verifying both server ID and process path."""
import argparse,json,os,pathlib,signal,subprocess,time,urllib.request,zipfile
root=pathlib.Path(__file__).resolve().parents[1];live=root/'artifacts/jellyfin-live';p=argparse.ArgumentParser();p.add_argument('--server');p.add_argument('--ffmpeg');p.add_argument('--reference',action='append',default=[]);p.add_argument('--stopped',action='store_true');p.add_argument('--version',default='0.1.0.0');a=p.parse_args()
s=json.loads((live/'session.json').read_text());server=a.server or s.get('serverExe');ffmpeg=a.ffmpeg or s.get('ffmpeg');assert server and ffmpeg,'Supply server and ffmpeg paths on the first restart.'
if not a.stopped:
    info=json.load(urllib.request.urlopen(s['base']+'/System/Info/Public'));assert info['Id']==s['serverId'],'Wrong server identity'
pid=int(s['pid'])
if os.name=='nt':command_line=subprocess.check_output(['powershell','-NoProfile','-Command',f"(Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}').CommandLine"],text=True)
else:command_line=pathlib.Path(f'/proc/{pid}/cmdline').read_bytes().decode().replace('\0',' ')
if a.stopped:assert not command_line.strip(),'Recorded server process is still running; omit --stopped.'
else:assert str(live).casefold() in command_line.casefold() and 'jellyfin' in command_line.casefold(),'Refusing to stop a process outside the isolated test directory.'
subprocess.run(['python',str(root/'scripts/package.py'),'--version',a.version],check=True)
if not a.stopped:os.kill(pid,signal.SIGTERM)
for _ in range(50):
    try:urllib.request.urlopen(s['base']+'/System/Info/Public',timeout=.2);time.sleep(.2)
    except Exception:break
for attempt in range(50):
    try:
        with zipfile.ZipFile(root/('artifacts/releases/JellyTome_'+a.version+'.zip')) as z:z.extractall(live/('data/plugins/JellyTome_'+a.version))
        break
    except PermissionError:
        if attempt==49:raise
        time.sleep(.2)
for reference in a.reference:
    package=pathlib.Path(reference).resolve();destination=live/'data/plugins'/package.stem;destination.mkdir(exist_ok=True)
    with zipfile.ZipFile(package) as z:
        for item in z.infolist():
            if item.filename.endswith(('.dll','meta.json','.png')):(destination/pathlib.PurePosixPath(item.filename).name).write_bytes(z.read(item))
command=[server,'--datadir',str(live/'data'),'--configdir',str(live/'config'),'--cachedir',str(live/'cache'),'--logdir',str(live/'logs'),'--webdir',str(pathlib.Path(server).parent/'jellyfin-web'),'--ffmpeg',ffmpeg]
process=subprocess.Popen(command,stdout=(live/'restart.stdout.log').open('wb'),stderr=(live/'restart.stderr.log').open('wb'),creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
s.update(pid=process.pid,serverExe=server,ffmpeg=ffmpeg);(live/'session.json').write_text(json.dumps(s,indent=2));(live/'pid.txt').write_text(str(process.pid))
for _ in range(60):
    if process.poll() is not None:raise SystemExit('Test server failed to restart; inspect its logs.')
    try:
        info=json.load(urllib.request.urlopen(s['base']+'/System/Info/Public',timeout=1))
        if info['Id']==s['serverId']:break
    except Exception:pass
    time.sleep(1)
else:raise SystemExit('Restart timed out.')
print('Isolated server upgraded and ready.')
