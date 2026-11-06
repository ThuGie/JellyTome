using System.Text;
using Jellyfin.Plugin.JellyManga;
using Jellyfin.Plugin.JellyManga.Sources;
using Xunit;

namespace JellyManga.Tests;

public sealed class MangaPlusTests
{
    [Fact]
    public async Task AnonymousSessionIsReusedAcrossRequestsAndRegistryRestarts()
    {
        SQLitePCL.Batteries_V2.Init();
        var folder = Path.Combine(Path.GetTempPath(), "jellytome-session-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(folder);
        try
        {
            var store = new Store(Path.Combine(folder, "test.db")); var http = new MangaPlusFixture();
            var adapter = new SourceRegistry(store, http).Adapter("mangaplus", false);
            var series = Assert.Single(await adapter.Search("One Piece", default));
            Assert.Equal("One Piece", (await adapter.Details(series.Url, default)).Title);
            Assert.Single(await adapter.Chapters(series, default));
            await new SourceRegistry(store, http).Adapter("mangaplus", false).Search("One Piece", default);
            Assert.Equal(4, http.Sessions.Count); Assert.Single(http.Sessions.Distinct()); Assert.True(Guid.TryParse(http.Sessions[0], out _));
        }
        finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
    }
    [Fact]
    public async Task ProviderSessionRejectionDoesNotClaimAPersonalAccountWasBanned()
    {
        var http = new MangaPlusFixture { Reject = true };
        var adapter = new MangaPlusSource(new() { Id = "mangaplus" }, http, Guid.NewGuid().ToString());
        var exception = await Assert.ThrowsAsync<HttpRequestException>(() => adapter.Search("One Piece", default));
        Assert.Contains("anonymous API session", exception.Message); Assert.Contains("not a check of your personal", exception.Message);
        Assert.DoesNotContain("You have been banned", exception.Message);
    }
}

internal sealed class MangaPlusFixture : ISourceHttp
{
    public List<string> Sessions { get; } = [];
    public bool Reject { get; init; }
    public Task<string> Text(Uri uri, SourceDefinition source, CancellationToken ct) => throw new NotSupportedException();
    public Task<byte[]> Image(Uri uri, SourceDefinition source, string referer, CancellationToken ct) => throw new NotSupportedException();
    public Task<byte[]> Data(Uri uri, SourceDefinition source, IReadOnlyDictionary<string, string> headers, CancellationToken ct)
    {
        Assert.Equal("jumpg-webapi.tokyo-cdn.com", uri.Host); Assert.True(headers.TryGetValue("SESSION-TOKEN", out var session)); Sessions.Add(session!);
        if (Reject) return Task.FromResult(Message(2, Message(2, Join(TextField(1, "Account Banned"), TextField(2, "You have been banned")))));
        var title = Join(Number(1, 100020), TextField(2, "One Piece"), Number(7, 0));
        if (uri.AbsolutePath.Contains("allV2")) return Task.FromResult(Message(1, Message(25, Message(1, Message(2, title)))));
        var chapter = Join(Number(2, 100001), TextField(3, "Chapter 1"));
        return Task.FromResult(Message(1, Message(8, Join(Message(1, title), TextField(3, "Fixture description"), Message(28, Message(2, chapter))))));
    }
    private static byte[] Join(params byte[][] parts) => parts.SelectMany(p => p).ToArray();
    private static byte[] Varint(ulong n) { var bytes = new List<byte>(); do { var b = (byte)(n & 127); n >>= 7; bytes.Add((byte)(b | (n == 0 ? 0 : 128))); } while (n != 0); return bytes.ToArray(); }
    private static byte[] Number(int field, ulong n) => Join(Varint((ulong)(field << 3)), Varint(n));
    private static byte[] TextField(int field, string value) => Message(field, Encoding.UTF8.GetBytes(value));
    private static byte[] Message(int field, byte[] bytes) => Join(Varint((ulong)((field << 3) | 2)), Varint((ulong)bytes.Length), bytes);
}
