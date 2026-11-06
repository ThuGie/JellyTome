using System.Text.Json;
using Jellyfin.Plugin.JellyManga;
using Jellyfin.Plugin.JellyManga.Sources;

if (!args.Contains("--live")) { Console.WriteLine("Opt-in live check: dotnet run --project tools/SourceProbe -- --live [--download] [--ids=mangadex,webtoon] [--query=One Piece]"); return; }
SQLitePCL.Batteries_V2.Init();
var root = Path.GetFullPath(args.FirstOrDefault(a => a.StartsWith("--output="))?[9..] ?? Path.Combine(Directory.GetCurrentDirectory(), "artifacts/source-probe"));
Directory.CreateDirectory(root);
var store = new Store(Path.Combine(root, "probe.db")); using var http = new SafeHttp(); var registry = new SourceRegistry(store, http);
var config = new Configuration { StoragePath = Path.Combine(root, "downloads"), StorageLimitBytes = 2L * 1024 * 1024 * 1024 };
var storage = new LibraryStorage(() => config); var downloader = new ChapterDownloader(registry, http, storage); var tester = new SourceTester(store, registry, downloader, storage);
var ids = args.FirstOrDefault(a => a.StartsWith("--ids="))?[6..].Split(','); var query = args.FirstOrDefault(a => a.StartsWith("--query="))?[8..] ?? "One Piece";
var checks = new List<SourceCheck>(); using var semaphore = new SemaphoreSlim(5);
var queriesFile = args.FirstOrDefault(a => a.StartsWith("--queries="))?[10..];
var queries = queriesFile == null ? new Dictionary<string, string>() : JsonSerializer.Deserialize<Dictionary<string, string>>(await File.ReadAllTextAsync(queriesFile))!;
var definitions = JsonSerializer.Deserialize<List<SourceDefinition>>(Plugin.ReadResource("Sources.catalog.json"), Store.Json)!;
await Task.WhenAll(definitions.Where(s => ids == null || ids.Contains(s.Id)).Select(async definition => {
    await semaphore.WaitAsync();
    try
    {
        var sourceQuery = queries.TryGetValue(definition.Id, out var configuredQuery) ? configuredQuery : args.Contains("--representative") ? store.Get<SourceCheck>("check", definition.Id)?.Title ?? query : query;
        registry.Save(definition with { Enabled = true, Removed = false });
        var minutes = double.TryParse(args.FirstOrDefault(a => a.StartsWith("--minutes="))?[10..], out var requestedMinutes) ? Math.Clamp(requestedMinutes, 1, 30) : 3;
        using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(minutes));
        SourceCheck check;
        if (definition.Kind == "unavailable")
        {
            string status;
            try { var text = await http.Text(new Uri(definition.BaseUrl), definition, deadline.Token); status = "Homepage reachable (" + text.Length + " characters); specialized adapter is missing. Not a verified download source."; }
            catch (Exception ex) { status = ex.Message; }
            check = new(definition.Id, DateTimeOffset.UtcNow, query, null, false, false, false, false, false, status);
        }
        else
        {
            try { check = await tester.Test(definition.Id, new(sourceQuery, Download: args.Contains("--download")), deadline.Token); }
            catch (Exception ex) { check = new(definition.Id, DateTimeOffset.UtcNow, query, null, false, false, false, false, false, ex.Message); }
        }
        store.Put("check", check.SourceId, check);
        lock (checks) checks.Add(check);
        Console.WriteLine($"{check.SourceId}: search={check.Search} details={check.Details} chapters={check.Chapters} pages={check.Pages} download={check.Download} {check.Error}");
    }
    finally { semaphore.Release(); }
}));
var previousFile = Path.Combine(root, "results.json");
if (File.Exists(previousFile)) checks.AddRange((JsonSerializer.Deserialize<List<SourceCheck>>(await File.ReadAllTextAsync(previousFile), Store.Json) ?? []).Where(c => checks.All(n => n.SourceId != c.SourceId)));
var sorted = checks.OrderBy(c => c.SourceId).ToArray();
await File.WriteAllTextAsync(Path.Combine(root, "results.json"), JsonSerializer.Serialize(sorted, new JsonSerializerOptions(Store.Json) { WriteIndented = true }));
var lines = new List<string> { "# Live source results", "", "Tested " + DateTimeOffset.UtcNow.ToString("u") + ". Query: " + query + ". Full download enabled: " + args.Contains("--download") + ".", "", "A source counts only if all five checks pass. Homepage reachability is not download support.", "", "| Source | Search | Details | Chapters | Pages | Full download | Result |", "|---|---|---|---|---|---|---|" };
lines.AddRange(sorted.Select(c => $"| {c.SourceId} | {c.Search} | {c.Details} | {c.Chapters} | {c.Pages} | {c.Download} | {(c.Error ?? c.Title ?? "OK").Replace('|', '/').Replace('\n', ' ')} |"));
await File.WriteAllLinesAsync(Path.Combine(root, "results.md"), lines);
Console.WriteLine("Verified download sources: " + sorted.Count(c => c.Search && c.Details && c.Chapters && c.Pages && c.Download));
Console.WriteLine("Report: " + Path.Combine(root, "results.md"));
