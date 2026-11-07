using System.IO.Compression;
using Jellyfin.Plugin.JellyManga;
using Jellyfin.Plugin.JellyManga.Sources;
using Xunit;
namespace JellyManga.Tests;
public sealed class CoverTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "JellyTome-cover-" + Guid.NewGuid().ToString("N"));
    public CoverTests() { SQLitePCL.Batteries_V2.Init(); Directory.CreateDirectory(root); }
    private (Store Store, SourceRegistry Sources, LibraryStorage Storage, Series Series) Setup(CoverHttp http)
    {
        var store = new Store(Path.Combine(root, "test.db")); var sources = new SourceRegistry(store, http);
        sources.Save(new() { Id = "fixture", Name = "Fixture", BaseUrl = "https://example.org", TitleSelector = "h1", Enabled = true });
        var series = new Series(Identity.For("fixture", "https://example.org/series"), "fixture", "https://example.org/series", "Fixture title");
        store.Put("series", series.Id, new Subscription(series, false));
        return (store, sources, new LibraryStorage(() => new() { StoragePath = root }), series);
    }
    [Fact]
    public async Task MissingCoverBackfillsExistingLibraryAndCachesAcrossRequests()
    {
        var http = new CoverHttp(); var x = Setup(http);
        var service = new CoverService(x.Store, x.Sources, http, x.Storage, Path.Combine(root, "covers"));
        var results = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => service.Get(x.Series.Id, default)));
        Assert.All(results, b => Assert.Equal(FixtureHttp.Png, b)); Assert.Equal(1, http.Details); Assert.Equal(1, http.Images);
        var saved = x.Store.Get<Subscription>("series", x.Series.Id)!; Assert.EndsWith("/cover.png", saved.Series.CoverUrl); Assert.False(saved.Monitoring);
        var reopened = new CoverService(x.Store, x.Sources, http, x.Storage, Path.Combine(root, "covers"));
        Assert.Equal(FixtureHttp.Png, await reopened.Get(x.Series.Id, default)); Assert.Equal(1, http.Images);
    }
    [Fact]
    public async Task MissingRemoteCoverUsesDownloadedPageAndRetriesLater()
    {
        var http = new CoverHttp { HasCover = false }; var x = Setup(http);
        var chapter = new Chapter(Identity.For("chapter"), x.Series.Id, "https://example.org/chapter", "Chapter 1", 1);
        using (var zip = ZipFile.Open(Path.Combine(root, "chapter.cbz"), ZipArchiveMode.Create))
        { var e = zip.CreateEntry("00000.png"); using var stream = e.Open(); stream.Write(FixtureHttp.Png); }
        x.Store.Put("job", chapter.Id, new DownloadJob(chapter, "fixture", "user", "Complete", RelativePath: "chapter.cbz", Pages: 1));
        var service = new CoverService(x.Store, x.Sources, http, x.Storage, Path.Combine(root, "covers"));
        Assert.Equal(FixtureHttp.Png, await service.Get(x.Series.Id, default)); await service.Get(x.Series.Id, default); Assert.Equal(1, http.Details);
        http.HasCover = true; x.Store.Put("cover-failure", x.Series.Id, new CoverFailure(DateTimeOffset.UtcNow.AddSeconds(-1)));
        await service.Get(x.Series.Id, default); Assert.Equal(2, http.Details); Assert.Equal(1, http.Images);
    }
    [Fact]
    public async Task CoverDestinationCannotTargetPrivateHostsOrEscapeCache()
    {
        var http = new CoverHttp(); var x = Setup(http); x.Store.Put("series", x.Series.Id, new Subscription(x.Series with { CoverUrl = "https://127.0.0.1/secret" }, true));
        var service = new CoverService(x.Store, x.Sources, http, x.Storage, Path.Combine(root, "covers"));
        await Assert.ThrowsAsync<FileNotFoundException>(() => service.Get(x.Series.Id, default)); Assert.Equal(0, http.Images);
        await Assert.ThrowsAsync<ArgumentException>(() => service.Get("../outside", default));
    }
    [Fact]
    public async Task StaleImageUrlRefreshesDetails()
    {
        var http = new CoverHttp(); var x = Setup(http); x.Store.Put("series", x.Series.Id, new Subscription(x.Series with { CoverUrl = "https://example.org/old.png" }, true));
        var service = new CoverService(x.Store, x.Sources, http, x.Storage, Path.Combine(root, "covers"));
        Assert.Equal(FixtureHttp.Png, await service.Get(x.Series.Id, default)); Assert.Equal(1, http.Details); Assert.Equal(2, http.Images);
    }
    public void Dispose() => Directory.Delete(root, true);
}
internal sealed class CoverHttp : ISourceHttp
{
    public int Details, Images; public bool HasCover = true;
    public Task<string> Text(Uri uri, SourceDefinition source, CancellationToken ct)
    { Interlocked.Increment(ref Details); return Task.FromResult("<h1>Fixture title</h1>" + (HasCover ? "<meta property='og:image' content='https://example.org/cover.png'>" : "")); }
    public Task<byte[]> Image(Uri uri, SourceDefinition source, string referer, CancellationToken ct)
    { Interlocked.Increment(ref Images); if (uri.AbsolutePath == "/old.png") throw new HttpRequestException("Expired image"); return Task.FromResult(FixtureHttp.Png); }
}
