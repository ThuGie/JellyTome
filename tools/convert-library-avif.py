"""Convert CBZ pages to AVIF, retaining original archives in a separate backup folder."""
import argparse, concurrent.futures, hashlib, io, json, os, pathlib, shutil, sys, tempfile, threading, time, zipfile
from PIL import Image, ImageCms

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("library", type=pathlib.Path)
parser.add_argument("--quality", type=int, default=65)
parser.add_argument("--workers", type=int, default=4)
parser.add_argument("--backup", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1] / "artifacts/library-avif65-backups")
parser.add_argument("--retry-failed", action="store_true", help="Retry only the latest failed entries in the backup conversion log.")
parser.add_argument("--apply", action="store_true", help="Replace originals after backup and validation; otherwise only show the inventory.")
args = parser.parse_args()
if not 1 <= args.quality <= 100 or not 1 <= args.workers <= 16:
    parser.error("Quality must be 1–100 and workers 1–16.")
root = args.library.resolve(strict=True)
backup = args.backup.resolve()
if not root.is_dir() or backup == root or backup.is_relative_to(root) or root.is_relative_to(backup):
    parser.error("Library and backup must be separate, non-overlapping directories.")
def safe(path):
    current = path
    while current != root:
        if current.is_symlink() or getattr(current.stat(), "st_file_attributes", 0) & 1024:
            raise ValueError("Refusing symlink/junction: " + str(current))
        current = current.parent
    if getattr(root.stat(), "st_file_attributes", 0) & 1024:
        raise ValueError("Refusing junction library root.")
def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""): h.update(chunk)
    return h.hexdigest()
files = []
for directory, dirs, names in os.walk(root, followlinks=False):
    dirs[:] = [d for d in dirs if not d.startswith(".") and not pathlib.Path(directory, d).is_symlink() and not getattr(pathlib.Path(directory, d).stat(), "st_file_attributes", 0) & 1024]
    for name in sorted(names):
        if name.lower().endswith(".cbz"):
            path = pathlib.Path(directory, name); safe(path); files.append(path)
if args.retry_failed:
    retry_log = backup / "conversion-results.jsonl"
    if not retry_log.exists(): parser.error("No conversion log exists to retry.")
    latest = {}
    for line in retry_log.read_text(encoding="utf8").splitlines():
        row = json.loads(line); latest[row["file"]] = row
    files = [p for p in files if latest.get(str(p.relative_to(root)), {}).get("status") == "failed"]
total = sum(p.stat().st_size for p in files)
print(f"{len(files)} CBZs, {total / 1e9:.3f} GB; quality {args.quality}, {args.workers} workers.", flush=True)
if not args.apply:
    print("Preview only. Add --apply to back up and replace archives."); sys.exit(0)
backup.mkdir(parents=True, exist_ok=True)
if shutil.disk_usage(backup).free < total * 1.1:
    sys.exit("Insufficient free space for complete original backups.")
lock = threading.Lock()
log = backup / "conversion-results.jsonl"
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}
def convert(path):
    relative = path.relative_to(root)
    before = path.stat()
    original_hash = digest(path)
    original_copy = backup / relative
    original_copy.parent.mkdir(parents=True, exist_ok=True)
    if original_copy.exists() and digest(original_copy) != original_hash:
        original_copy = original_copy.with_name(original_copy.stem + "-" + original_hash[:16] + ".cbz")
    if not original_copy.exists():
        fd, temporary_copy = tempfile.mkstemp(prefix=".backup-", dir=original_copy.parent); os.close(fd)
        try:
            shutil.copyfile(path, temporary_copy)
            if digest(pathlib.Path(temporary_copy)) != original_hash:
                raise ValueError("Source changed while backing up.")
            os.replace(temporary_copy, original_copy)
        finally:
            if os.path.exists(temporary_copy): os.unlink(temporary_copy)
    if digest(original_copy) != original_hash: raise ValueError("Backup verification failed.")
    fd, local_output = tempfile.mkstemp(suffix=".cbz", dir=original_copy.parent); os.close(fd)
    remote_output = None
    changed = 0
    try:
        dimensions = {}
        with zipfile.ZipFile(original_copy) as src, zipfile.ZipFile(local_output, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as dst:
            names = set()
            for entry in src.infolist():
                if entry.is_dir() or pathlib.PurePosixPath(entry.filename).name != entry.filename or chr(92) in entry.filename:
                    raise ValueError("Archive contains non-flat paths.")
                data = src.read(entry)
                name = entry.filename
                if pathlib.Path(name).suffix.lower() in IMAGE_TYPES and not name.lower().endswith(".avif"):
                    if len(data) > 128 * 1024 * 1024: raise ValueError("Image exceeds 128 MiB.")
                    with Image.open(io.BytesIO(data)) as image:
                        # Preserve animated pages rather than discarding animation.
                        if getattr(image, "n_frames", 1) == 1:
                            image.load(); size = image.size
                            if image.info.get("icc_profile"):
                                profile = ImageCms.ImageCmsProfile(io.BytesIO(image.info["icc_profile"]))
                                # Some scan files carry an ICC profile for a different pixel mode.
                                # Normalize the input mode to its declared profile before transforming.
                                space = profile.profile.xcolor_space.strip()
                                mode = {"GRAY": "L", "RGB": "RGB", "CMYK": "CMYK"}.get(space)
                                if mode is None: raise ValueError("Unsupported ICC colour space: " + space)
                                alpha = image.convert("RGBA").getchannel("A") if image.has_transparency_data else None
                                image = ImageCms.profileToProfile(image.convert(mode), profile, ImageCms.createProfile("sRGB"), outputMode="RGB")
                                if alpha is not None: image.putalpha(alpha)
                            else: image = image.convert("RGBA" if image.has_transparency_data else "RGB")
                            output = io.BytesIO()
                            image.save(output, format="AVIF", quality=args.quality, speed=6, subsampling="4:4:4", max_threads=2)
                            data = output.getvalue(); name = pathlib.Path(name).stem + ".avif"; dimensions[name] = size; changed += 1
                if name in names: raise ValueError("Duplicate archive entry after conversion.")
                names.add(name); dst.writestr(name, data)
        with zipfile.ZipFile(local_output) as test:
            if test.testzip() is not None: raise ValueError("ZIP integrity check failed.")
            for name, size in dimensions.items():
                with Image.open(io.BytesIO(test.read(name))) as image:
                    image.load()
                    if image.size != size: raise ValueError("Page dimensions changed.")
        if not changed:
            return dict(file=str(relative), status="unchanged", originalBytes=before.st_size, bytes=before.st_size, backup=str(original_copy))
        # Stage beside the original so the final rename stays on the same filesystem.
        fd, remote_output = tempfile.mkstemp(prefix=".avif-convert-", suffix=".part", dir=path.parent); os.close(fd)
        with open(local_output, "rb") as src, open(remote_output, "wb") as dst:
            shutil.copyfileobj(src, dst); dst.flush(); os.fsync(dst.fileno())
        if digest(pathlib.Path(remote_output)) != digest(pathlib.Path(local_output)):
            raise ValueError("Uploaded archive checksum mismatch.")
        current = path.stat()
        if current.st_size != before.st_size or current.st_mtime_ns != before.st_mtime_ns or digest(path) != original_hash:
            raise ValueError("Original changed during conversion; replacement skipped.")
        os.replace(remote_output, path); remote_output = None
        return dict(file=str(relative), status="converted", quality=args.quality, pagesConverted=changed, originalBytes=before.st_size, bytes=path.stat().st_size, backup=str(original_copy), originalSha256=original_hash)
    finally:
        if os.path.exists(local_output): os.unlink(local_output)
        if remote_output and os.path.exists(remote_output): os.unlink(remote_output)
def run(path):
    try: result = convert(path)
    except Exception as error: result = dict(file=str(path.relative_to(root)), status="failed", error=str(error))
    with lock:
        with log.open("a", encoding="utf8") as output: output.write(json.dumps(result) + "\n")
        print(json.dumps(result), flush=True)
    return result
started = time.monotonic()
with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool: results = list(pool.map(run, files))
summary = dict(chapters=len(results), converted=sum(r["status"]=="converted" for r in results), failed=sum(r["status"]=="failed" for r in results), originalBytes=sum(r.get("originalBytes", 0) for r in results), storedBytes=sum(r.get("bytes", 0) for r in results), seconds=round(time.monotonic()-started, 1))
print(json.dumps(summary, indent=2))
if summary["failed"]: sys.exit(1)
