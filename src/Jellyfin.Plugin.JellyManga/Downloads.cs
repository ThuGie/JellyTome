using System.Collections.Concurrent;
using System.IO.Compression;
using System.Text;
using Jellyfin.Plugin.JellyManga.Sources;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyManga;

public sealed class LibraryStorage(Func<Configuration> config)
{
    private readonly SemaphoreSlim _commit = new(1);
    public LibraryStorage() : this(() => Plugin.Instance.Configuration) { }
    public string Root
    {
        get
        {
            if (string.IsNullOrWhiteSpace(config().StoragePath)) throw new ArgumentException("Configure a manga storage directory in the admin dashboard first.");
            return Path.GetFullPath(config().StoragePath);
        }
    }
    public string Absolute(string relative)
    {
        var root = Root; var path = Path.GetFullPath(Path.Combine(root, relative));
        if (!path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal)) throw new ArgumentException("Path escapes manga storage.");
        // Refuse symlinks/junctions, including ancestors of the configured directory.
        for (var current = new DirectoryInfo(Path.GetDirectoryName(path)!); current != null; current = current.Parent)
            if (current.Exists && current.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new ArgumentException("Manga storage must not traverse symbolic links or junctions.");
        if (File.Exists(path) && File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint)) throw new ArgumentException("Symbolic files are not allowed.");
        return path;
    }
    public long Used() => Directory.Exists(Root) ? Size(new DirectoryInfo(Root)) : 0;
    private static long Size(DirectoryInfo directory)
    {
        if (directory.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Symbolic links are not allowed in manga storage.");
        long size = 0;
        foreach (var item in directory.EnumerateFileSystemInfos())
        {
            if (item.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Symbolic links are not allowed in manga storage.");
            size += item is DirectoryInfo child ? Size(child) : ((FileInfo)item).Length;
        }
        return size;
    }
    public async Task Commit(string temporary, string relative, CancellationToken ct)
    {
        await _commit.WaitAsync(ct);
        try
        {
            var destination = Absolute(relative); var max = config().StorageLimitBytes;
            var replacedBytes = File.Exists(destination) ? new FileInfo(destination).Length : 0;
            if (max > 0 && Used() - replacedBytes > max) throw new IOException("Configured manga storage limit reached.");
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!); File.Move(temporary, destination, true);
        }
        finally { _commit.Release(); }
    }
    public static string ImageExtension(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 4 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff && bytes[^2] == 0xff && bytes[^1] == 0xd9) return ".jpg";
        if (bytes.Length >= 45 && bytes[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) && bytes.Slice(bytes.Length - 8, 4).SequenceEqual("IEND"u8)) return ".png";
        if (bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WEBP"u8) && System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(bytes.Slice(4, 4)) + 8L == bytes.Length) return ".webp";
        if (bytes.Length >= 14 && (bytes[..6].SequenceEqual("GIF87a"u8) || bytes[..6].SequenceEqual("GIF89a"u8)) && bytes[^1] == 0x3b) return ".gif";
        if (bytes.Length >= 24 && bytes.Slice(4, 4).SequenceEqual("ftyp"u8))
        {
            var size = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bytes[..4]);
            if (size >= 16 && size <= bytes.Length)
                for (var offset = 8; offset + 4 <= size; offset += 4)
                    if (offset != 12 && bytes.Slice(offset, 4).SequenceEqual("avif"u8)) return ".avif";
        }
        throw new InvalidDataException("Source returned an unsupported or invalid image (JPEG, PNG, WebP, GIF, AVIF required).");
    }
    public IReadOnlyList<string> Entries(DownloadJob job)
    {
        using var archive = ZipFile.OpenRead(Absolute(job.RelativePath ?? throw new FileNotFoundException()));
        var entries = archive.Entries.Where(e => e.Name != "ComicInfo.xml").OrderBy(e => e.FullName, StringComparer.Ordinal).ToList();
        if (entries.Count is 0 or > 2000 || entries.Any(e => e.FullName != e.Name || e.Length > 32 * 1024 * 1024)) throw new InvalidDataException("Invalid chapter archive.");
        return entries.Select(e => e.FullName).ToArray();
    }
    public async Task<byte[]> Page(DownloadJob job, int page, CancellationToken ct)
    {
        var names = Entries(job); if (page < 0 || page >= names.Count) throw new ArgumentException("Page index out of range.");
        using var archive = ZipFile.OpenRead(Absolute(job.RelativePath!)); var entry = archive.GetEntry(names[page])!;
        await using var input = entry.Open(); using var output = new MemoryStream(); await input.CopyToAsync(output, ct); return output.ToArray();
    }
}

public sealed class ChapterDownloader(SourceRegistry sources, ISourceHttp http, LibraryStorage storage, IPageEncoder? encoder = null)
{
    public async Task<(string Path, int Pages)> Download(DownloadJob job, CancellationToken ct, bool requireEnabled = true)
    {
        Identity.ValidId(job.Chapter.SeriesId); Identity.ValidId(job.Chapter.Id);
        var adapter = sources.Adapter(job.SourceId, requireEnabled); var pages = await adapter.Pages(job.Chapter, ct);
        if (pages.Count is 0 or > 2000) throw new InvalidDataException("Invalid chapter page count.");
        var relative = Path.Combine(job.Chapter.SeriesId, job.Chapter.Id + ".cbz");
        var temporary = storage.Absolute(Path.Combine(".staging", job.Chapter.Id + "-" + Guid.NewGuid().ToString("N") + ".part"));
        Directory.CreateDirectory(Path.GetDirectoryName(temporary)!);
        try
        {
            await using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 32768, true))
            {
                using var archive = new ZipArchive(file, ZipArchiveMode.Create, true);
                long total = 0, encodedTotal = 0;
                for (int i = 0; i < pages.Count; i++)
                {
                    ct.ThrowIfCancellationRequested(); var page = pages[i]; var definition = sources.ImageDefinition(adapter.Definition, page.Url);
                    var bytes = await http.Image(new Uri(page.Url), definition, page.Referer, ct); total += bytes.Length;
                    if (total > 512L * 1024 * 1024) throw new InvalidDataException("Chapter exceeds the 512 MiB limit.");
                    LibraryStorage.ImageExtension(bytes);
                    if (encoder != null) bytes = await encoder.Encode(bytes, Path.GetDirectoryName(temporary)!, ct);
                    encodedTotal += bytes.Length;
                    if (encodedTotal > 512L * 1024 * 1024) throw new InvalidDataException("Encoded chapter exceeds the 512 MiB limit.");
                    var entry = archive.CreateEntry(i.ToString("D5") + LibraryStorage.ImageExtension(bytes), CompressionLevel.NoCompression);
                    await using var output = entry.Open(); await output.WriteAsync(bytes, ct);
                }
                var metadata = archive.CreateEntry("ComicInfo.xml");
                await using var metaStream = metadata.Open();
                var xml = new System.Xml.Linq.XDocument(new System.Xml.Linq.XElement("ComicInfo", new System.Xml.Linq.XElement("Title", job.Chapter.Title), new System.Xml.Linq.XElement("Number", job.Chapter.Number), new System.Xml.Linq.XElement("LanguageISO", "en"), new System.Xml.Linq.XElement("Web", job.Chapter.Url), new System.Xml.Linq.XElement("PageCount", pages.Count)));
                await xml.SaveAsync(metaStream, System.Xml.Linq.SaveOptions.None, ct);
            }
            await storage.Commit(temporary, relative, ct); return (relative, pages.Count);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}

public sealed class MangaService(Store store, SourceRegistry sources)
{
    private readonly SemaphoreSlim _requests = new(1);
    public async Task<Subscription> Request(string sourceId, string url, string user, CancellationToken ct)
    {
        var adapter = sources.Adapter(sourceId); var series = await adapter.Details(url, ct);
        var chapters = await adapter.Chapters(series, ct);
        if (chapters.Count == 0) throw new InvalidDataException("No downloadable English chapters found.");
        await _requests.WaitAsync(ct);
        try
        {
            if (store.IsRemovingSeries(series.Id)) throw new ArgumentException("Finish removing this manga before requesting it again.");
            var subscription = new Subscription(series, true, DateTimeOffset.UtcNow);
            store.Put("series", series.Id, subscription);
            store.EnqueueChapters(chapters.Where(chapter => chapter.Language == "en"), sourceId, user);
            store.Put("request", Identity.For(user, series.Id), new { user, seriesId = series.Id, requestedAt = DateTimeOffset.UtcNow });
            store.Event("Request", $"{series.Title}: queued available English chapters from {sourceId} and enabled monitoring.");
            return subscription;
        }
        finally { _requests.Release(); }
    }
    public async Task Remove(string id, QueueService queue, LibraryStorage storage, CancellationToken ct)
    {
        Identity.ValidId(id);
        await _requests.WaitAsync(ct);
        try
        {
            if (store.Get<Subscription>("series", id) == null) throw new KeyNotFoundException("Manga not found.");
            store.Put("removing-series", id, id);
            store.UpdateSubscription(id, current => current with { Monitoring = false });
            var jobs = store.All<DownloadJob>("job").Where(job => job.Chapter.SeriesId == id).ToArray();
            await queue.StopDownloads(jobs.Select(job => job.Chapter.Id));
            var archives = jobs
                .Select(job =>
                {
                    Identity.ValidId(job.Chapter.Id);
                    var archive = storage.Absolute(Path.Combine(id, job.Chapter.Id + ".cbz"));
                    if (job.RelativePath != null && storage.Absolute(job.RelativePath) != archive)
                        throw new InvalidDataException("Chapter archive is outside its expected manga path.");
                    return archive;
                })
                .ToArray();
            foreach (var archive in archives)
            {
                try { File.Delete(archive); }
                catch (DirectoryNotFoundException) { }
            }
            store.ForgetSeries(id);
        }
        finally { _requests.Release(); }
    }

    public async Task Monitor(CancellationToken ct)
    {
        foreach (var subscription in store.All<Subscription>("series").Where(s => s.Monitoring))
        {
            if (subscription.LastChecked?.AddMinutes(Plugin.Instance.Configuration.MonitorMinutes) > DateTimeOffset.UtcNow) continue;
            try
            {
                var adapter = sources.Adapter(subscription.Series.SourceId);
                var chapters = await adapter.Chapters(subscription.Series, ct);
                await _requests.WaitAsync(ct);
                try
                {
                    var id = subscription.Series.Id;
                    if (store.IsRemovingSeries(id) || store.Get<Subscription>("series", id)?.Monitoring != true) continue;
                    store.EnqueueChapters(chapters.Where(chapter => chapter.Language == "en"), adapter.Definition.Id, "monitor");
                    store.UpdateSubscription(id, current => current with { LastChecked = DateTimeOffset.UtcNow, Error = null });
                }
                finally { _requests.Release(); }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex) { store.UpdateSubscription(subscription.Series.Id, current => current with { LastChecked = DateTimeOffset.UtcNow, Error = ex.Message }); store.Event("Monitor error", subscription.Series.Title + ": " + ex.Message); }
        }
    }
}

public sealed class QueueService(Store store, SourceRegistry sources, ChapterDownloader downloader, ILogger<QueueService> logger) : BackgroundService
{
    private readonly ConcurrentDictionary<string, (string Source, CancellationTokenSource Cancel, Task Work)> _active = new();
    private readonly object _activeGate = new();
    public void Cancel(string id)
    {
        lock (_activeGate)
            if (_active.TryGetValue(id, out var active)) active.Cancel.Cancel();
    }

    public Task StopDownloads(IEnumerable<string> ids)
    {
        lock (_activeGate)
        {
            var tasks = new List<Task>();
            foreach (var id in ids)
            {
                if (!_active.TryGetValue(id, out var active)) continue;
                active.Cancel.Cancel();
                tasks.Add(active.Work);
            }
            return Task.WhenAll(tasks);
        }
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        store.Recover();
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                lock (_activeGate)
                {
                    foreach (var entry in _active.Where(e => e.Value.Work.IsCompleted).ToArray()) { if (_active.TryRemove(entry.Key, out var done)) done.Cancel.Dispose(); }
                    var config = Plugin.Instance.Configuration;
                    if (!config.Paused && !string.IsNullOrWhiteSpace(config.StoragePath))
                    {
                        var limits = sources.All().Where(s => s.Enabled && !s.Removed).ToDictionary(s => s.Id, s => Math.Clamp(s.MaxConcurrentDownloads, 1, 8));
                        while (_active.Count < config.DownloadConcurrency)
                        {
                            var counts = _active.Values.GroupBy(v => v.Source).ToDictionary(g => g.Key, g => g.Count()); var job = store.Claim(counts, limits, config.DownloadConcurrency); if (job == null) break;
                            var cancel = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                            var task = Run(job, cancel.Token); _active[job.Chapter.Id] = (job.SourceId, cancel, task);
                        }
                    }
                }
                await Task.Delay(1000, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally
        {
            await StopDownloads(_active.Keys);
            lock (_activeGate)
            {
                foreach (var active in _active.Values) active.Cancel.Dispose();
                _active.Clear();
            }
        }
    }
    private async Task Run(DownloadJob job, CancellationToken ct)
    {
        try
        {
            // Yield before work to register cancellation before any HTTP completes.
            await Task.Yield(); var result = await downloader.Download(job, ct);
            if (store.Finish(job with { Status = "Complete", RelativePath = result.Path, Pages = result.Pages, CompletedAt = DateTimeOffset.UtcNow }))
                store.Event("Downloaded", job.Chapter.Title + " · " + job.SourceId + " · " + result.Pages + " pages");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { store.Finish(job with { Status = "Queued", Error = "Interrupted; will retry." }); }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Chapter download failed: {Chapter}", job.Chapter.Id);
            store.Event("Download error", job.Chapter.Title + " · " + job.SourceId + ": " + ex.Message);
            store.Finish(job with { Status = job.Attempts >= 3 ? "Failed" : "Queued", Error = ex.Message, RetryAt = DateTimeOffset.UtcNow.AddMinutes(Math.Pow(2, job.Attempts)) });
        }
    }
}

public sealed class MonitorService(MangaService manga, ILogger<MonitorService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { if (!Plugin.Instance.Configuration.Paused) await manga.Monitor(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogError(ex, "Manga monitor failed"); }
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }
}
