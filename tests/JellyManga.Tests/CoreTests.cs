using System.IO.Compression;
using System.Net;
using Jellyfin.Plugin.JellyManga;
using Jellyfin.Plugin.JellyManga.Sources;
using Xunit;

namespace JellyManga.Tests;

public sealed class CoreTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "JellyManga-tests-" + Guid.NewGuid().ToString("N"));
    public CoreTests() { SQLitePCL.Batteries_V2.Init(); Directory.CreateDirectory(_root); }
    private Store Store() => new(Path.Combine(_root, "test.db"));
    private static Chapter Chapter(string title = "Chapter 1") => new(Identity.For("chapter", title), Identity.For("series"), "https://example.org/chapter/1", title, Extraction.ChapterNumber(title));
    private static SourceDefinition Source() => new() { Id = "fixture", Name = "Fixture", BaseUrl = "https://example.org", Enabled = true, SearchPath = "/search?q={query}", SearchItems = ".result", SearchLink = "a", TitleSelector = "h1", DescriptionSelector = ".description", ChapterItems = ".chapters a", PagesSelector = ".reader img", ImageAttribute = "data-src" };
    [Theory]
    [InlineData("Chapter 10.5", "10.5")]
    [InlineData("Vol 2 Chapter 13.1", "13.1")]
    [InlineData("Episode #7", "7")]
    [InlineData("Ch. 0.5", "0.5")]
    public void ChapterNumbersPreserveFractions(string title, string expected) => Assert.Equal(decimal.Parse(expected, System.Globalization.CultureInfo.InvariantCulture), Extraction.ChapterNumber(title));
    [Fact]
    public void QueueIsDurableDeduplicatedAndRecovers()
    {
        var store = Store(); var chapter = Chapter(); Parallel.For(0, 20, _ => store.Enqueue(chapter, "fixture", "user")); Assert.Single(store.All<DownloadJob>("job"));
        var claimed = store.Claim(new HashSet<string>(), new HashSet<string> { "fixture" }); Assert.Equal("Downloading", claimed!.Status);
        Assert.Null(store.Claim(new HashSet<string>(), new HashSet<string> { "fixture" }));
        var reopened = Store(); reopened.Recover(); Assert.Equal("Queued", reopened.Get<DownloadJob>("job", chapter.Id)!.Status);
    }
    [Fact]
    public void CancelledDownloadCannotBeCompletedByStaleWorker()
    {
        var store = Store(); var chapter = Chapter(); store.Enqueue(chapter, "fixture", "user"); var job = store.Claim(new HashSet<string>(), new HashSet<string> { "fixture" })!;
        store.Action(chapter.Id, "cancel"); Assert.False(store.Finish(job with { Status = "Complete" })); Assert.Equal("Cancelled", store.Get<DownloadJob>("job", chapter.Id)!.Status);
    }
    [Fact]
    public void ClaimRespectsSourceConcurrencyEnabledAndBackoff()
    {
        var store = Store(); store.Enqueue(Chapter(), "fixture", "user"); Assert.Null(store.Claim(new HashSet<string> { "fixture" }, new HashSet<string> { "fixture" })); Assert.Null(store.Claim(new HashSet<string>(), new HashSet<string>()));
        var job = store.Get<DownloadJob>("job", Chapter().Id)!; store.Put("job", job.Chapter.Id, job with { RetryAt = DateTimeOffset.UtcNow.AddHours(1) }); Assert.Null(store.Claim(new HashSet<string>(), new HashSet<string> { "fixture" }));
    }
    [Fact]
    public void ProgressIsIsolatedByUser()
    {
        var store = Store(); store.Put("progress:user-a", "chapter", new ReadingProgress("series", "chapter", 3, true, DateTimeOffset.UtcNow)); Assert.Empty(store.All<ReadingProgress>("progress:user-b")); Assert.Single(store.All<ReadingProgress>("progress:user-a"));
    }
    [Theory]
    [InlineData("127.0.0.1")][InlineData("10.1.1.1")][InlineData("172.16.1.1")][InlineData("192.168.0.1")][InlineData("169.254.169.254")][InlineData("100.64.0.1")][InlineData("::1")][InlineData("::ffff:127.0.0.1")][InlineData("fc00::1")][InlineData("2001:db8::1")][InlineData("0.0.0.0")]
    public void BlocksPrivateAndReservedAddresses(string address) => Assert.False(SafeHttp.IsPublic(IPAddress.Parse(address)));
    [Theory]
    [InlineData("8.8.8.8")][InlineData("1.1.1.1")][InlineData("192.0.77.2")][InlineData("2606:4700:4700::1111")]
    public void AllowsPublicAddresses(string address) => Assert.True(SafeHttp.IsPublic(IPAddress.Parse(address)));
    [Fact]
    public void RejectsUnlistedRedirectHostsAndSchemes()
    {
        Assert.Throws<ArgumentException>(() => SafeHttp.Resolve("https://other.org/page", "https://example.org", Source()));
        Assert.Throws<ArgumentException>(() => SafeHttp.Resolve("http://example.org/page", "https://example.org", Source()));
        Assert.Throws<ArgumentException>(() => SafeHttp.ValidateUri(new Uri("https://127.0.0.1"), Source() with { BaseUrl = "https://127.0.0.1" }));
    }
    [Fact]
    public void StorageRejectsTraversalAndBadImagePayloads()
    {
        var storage = new LibraryStorage(() => new() { StoragePath = _root }); Assert.Throws<ArgumentException>(() => storage.Absolute("../outside.cbz")); Assert.Throws<InvalidDataException>(() => LibraryStorage.ImageExtension("<html>challenge</html>"u8));
    }
    [Fact]
    public async Task HtmlSourceDownloadsCompleteValidatedArchive()
    {
        var store = Store(); var http = new FixtureHttp(); var registry = new SourceRegistry(store, http); registry.Save(Source());
        var adapter = registry.Adapter("fixture"); var search = await adapter.Search("Fixture", default); var series = await adapter.Details(Assert.Single(search).Url, default); var chapters = await adapter.Chapters(series, default); Assert.Equal(new decimal[] { 1, 10.5m }, chapters.Select(c => c.Number));
        var storage = new LibraryStorage(() => new() { StoragePath = _root, StorageLimitBytes = 1_000_000 }); var downloader = new ChapterDownloader(registry, http, storage);
        var result = await downloader.Download(new(chapters[0], "fixture", "user"), default); var job = new DownloadJob(chapters[0], "fixture", "user", "Complete", RelativePath: result.Path, Pages: result.Pages);
        Assert.Equal(2, result.Pages); Assert.Equal(2, storage.Entries(job).Count); Assert.Equal(FixtureHttp.Png, await storage.Page(job, 0, default));
        using var archive = ZipFile.OpenRead(storage.Absolute(result.Path)); Assert.NotNull(archive.GetEntry("ComicInfo.xml")); Assert.Empty(Directory.GetFiles(Path.Combine(_root, ".staging")));
    }
    [Fact]
    public async Task DiskBudgetFailureLeavesNoCompletedOrPartialArchive()
    {
        var store = Store(); var http = new FixtureHttp(); var registry = new SourceRegistry(store, http); registry.Save(Source());
        var storage = new LibraryStorage(() => new() { StoragePath = Path.Combine(_root, "library"), StorageLimitBytes = 1 }); var downloader = new ChapterDownloader(registry, http, storage);
        await Assert.ThrowsAsync<IOException>(() => downloader.Download(new(Chapter(), "fixture", "user"), default)); Assert.Empty(Directory.GetFiles(Path.Combine(_root, "library"), "*.cbz", SearchOption.AllDirectories)); Assert.Empty(Directory.GetFiles(Path.Combine(_root, "library", ".staging")));
    }
    [Fact]
    public async Task JsonSourceUsesConfiguredPaths()
    {
        var definition = Source() with { Kind = "json", JsonItemsPath = "data.items", JsonChaptersPath = "data.chapters", JsonPagesPath = "data.pages", JsonTitlePath = "name", JsonUrlPath = "link" };
        var adapter = new RuleSource(definition, new JsonFixtureHttp()); var series = Assert.Single(await adapter.Search("JSON", default)); Assert.Equal("JSON manga", series.Title); var chapters = await adapter.Chapters(series, default); Assert.Equal(2.5m, Assert.Single(chapters).Number); Assert.Single(await adapter.Pages(chapters[0], default));
    }
    [Fact]
    public void InjectionIsIdempotentAndUsesRelativeBasePath()
    {
        var html = WebTransformation.IndexHtml(new() { Contents = "<html><head></head><body></body></html>" }); Assert.Contains("../JellyManga/assets/app.js", html); Assert.Equal(html, WebTransformation.IndexHtml(new() { Contents = html }));
    }
    public void Dispose() { if (Directory.Exists(_root)) Directory.Delete(_root, true); }
}

internal sealed class FixtureHttp : ISourceHttp
{
    public static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=");
    public Task<string> Text(Uri uri, SourceDefinition source, CancellationToken ct) => Task.FromResult(uri.AbsolutePath.StartsWith("/search") ? "<div class=result><a href=/series>Fixture manga</a></div>" : uri.AbsolutePath == "/series" ? "<h1>Fixture manga</h1><div class=description>Description</div><div class=chapters><a href=/chapter/10>Chapter 10.5</a><a href=/chapter/1>Chapter 1</a></div>" : "<div class=reader><img data-src='/page1.png'><img data-src='/page2.png'></div>");
    public Task<byte[]> Image(Uri uri, SourceDefinition source, string referer, CancellationToken ct) => Task.FromResult(Png);
}
internal sealed class JsonFixtureHttp : ISourceHttp
{
    public Task<string> Text(Uri uri, SourceDefinition source, CancellationToken ct) => Task.FromResult("""{"data":{"items":[{"name":"JSON manga","link":"/series"}],"chapters":[{"name":"Chapter 2.5","link":"/chapter/1"}],"pages":["/image.png"]}}""");
    public Task<byte[]> Image(Uri uri, SourceDefinition source, string referer, CancellationToken ct) => Task.FromResult(FixtureHttp.Png);
}
