using System.Collections.Concurrent;
using System.Net;
using Jellyfin.Plugin.JellyManga;
using Xunit;

namespace JellyManga.Tests;

public sealed class ConcurrencyTests
{
    [Fact]
    public async Task RequestStartsArePacedWhileImageBodiesOverlap()
    {
        var handler = new OverlapHandler(); using var http = new SafeHttp(handler);
        var source = new SourceDefinition { Id = "fixture", BaseUrl = "https://example.org", DelayMilliseconds = 250 };
        var first = http.Image(new Uri("https://example.org/1.png"), source, "", default);
        await handler.FirstBody.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var second = http.Image(new Uri("https://example.org/2.png"), source, "", default);
        try
        {
            await handler.SecondBody.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(first.IsCompleted);
            var starts = handler.Starts.ToArray(); Assert.Equal(2, starts.Length);
            Assert.True(starts[1] - starts[0] >= TimeSpan.FromMilliseconds(220));
        }
        finally { handler.Release.TrySetResult(); }
        Assert.Equal(FixtureHttp.Png, await first); Assert.Equal(FixtureHttp.Png, await second);
    }
    private sealed class OverlapHandler : HttpMessageHandler
    {
        public readonly ConcurrentQueue<DateTimeOffset> Starts = new();
        public readonly TaskCompletionSource FirstBody = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public readonly TaskCompletionSource SecondBody = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public readonly TaskCompletionSource Release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Starts.Enqueue(DateTimeOffset.UtcNow);
            var content = new StreamContent(new GatedStream(this, request.RequestUri!.AbsolutePath == "/1.png"));
            content.Headers.ContentType = new("image/png");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = content });
        }
        private sealed class GatedStream(OverlapHandler owner, bool first) : MemoryStream(FixtureHttp.Png)
        {
            public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
            {
                if (first) { owner.FirstBody.TrySetResult(); await owner.Release.Task.WaitAsync(ct); }
                else owner.SecondBody.TrySetResult();
                return await base.ReadAsync(buffer, ct);
            }
        }
    }
}
