using System.Text.Json;
using Jellyfin.Plugin.JellyManga;
using Jellyfin.Plugin.JellyManga.Sources;
using Xunit;
namespace JellyManga.Tests;
public sealed class MangaDexCoverTests
{
    [Fact]
    public async Task SearchAndDetailsIncludeCoverArtRelationship()
    {
        var http = new DexCoverHttp();
        var source = new MangaDexSource(new() { Id = "mangadex", BaseUrl = "https://mangadex.org", AllowedHosts = ["api.mangadex.org", "uploads.mangadex.org"] }, http);
        var series = Assert.Single(await source.Search("Fixture", default));
        Assert.Equal("https://uploads.mangadex.org/covers/11111111-1111-1111-1111-111111111111/cover.jpg.256.jpg", series.CoverUrl);
        Assert.Equal(series.CoverUrl, (await source.Details(series.Url, default)).CoverUrl);
    }
}
internal sealed class DexCoverHttp : ISourceHttp
{
    public Task<string> Text(Uri uri, SourceDefinition source, CancellationToken ct)
    {
        Assert.Contains("includes[]=cover_art", Uri.UnescapeDataString(uri.Query));
        const string item = """{"id":"11111111-1111-1111-1111-111111111111","attributes":{"title":{"en":"Fixture"},"description":{}},"relationships":[{"type":"cover_art","attributes":{"fileName":"cover.jpg"}}]}""";
        using var document = JsonDocument.Parse(item); return Task.FromResult(JsonSerializer.Serialize(new { data = uri.AbsolutePath == "/manga" ? (object)new[] { document.RootElement } : document.RootElement }));
    }
    public Task<byte[]> Image(Uri uri, SourceDefinition source, string referer, CancellationToken ct) => throw new NotImplementedException();
}
