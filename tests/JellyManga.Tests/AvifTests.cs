using Jellyfin.Plugin.JellyManga;
using Xunit;
namespace JellyManga.Tests;
public sealed class AvifTests
{
    [Fact]
    public void DefaultsAndAvifContainerValidation()
    {
        Assert.True(new Configuration().ConvertToAvif); Assert.Equal(65, new Configuration().AvifQuality);
        var header = new byte[24]; header[3] = 24; "ftyp"u8.CopyTo(header.AsSpan(4)); "avif"u8.CopyTo(header.AsSpan(8));
        Assert.Equal(".avif", LibraryStorage.ImageExtension(header));
        "heic"u8.CopyTo(header.AsSpan(8)); Assert.Throws<InvalidDataException>(() => LibraryStorage.ImageExtension(header));
        "avif"u8.CopyTo(header.AsSpan(16)); Assert.Equal(".avif", LibraryStorage.ImageExtension(header));
        header[3] = 100; Assert.Throws<InvalidDataException>(() => LibraryStorage.ImageExtension(header));
    }
    [Fact]
    public async Task DisabledConversionRetainsOriginalWithoutLaunchingEncoder()
    {
        var encoder = new AvifEncoder(() => new() { ConvertToAvif = false }, () => throw new Exception("Should not launch"));
        Assert.Same(FixtureHttp.Png, await encoder.Encode(FixtureHttp.Png, Path.GetTempPath(), default));
    }
    [Fact]
    public async Task OptInRealFfmpegConversionAndDecode()
    {
        var executable = Environment.GetEnvironmentVariable("JELLYTOME_TEST_FFMPEG");
        if (string.IsNullOrEmpty(executable)) return; // Explicit local integration check; CI has no Jellyfin FFmpeg.
        var folder = Path.Combine(Path.GetTempPath(), "JellyTome-avif-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(folder);
        try
        {
            var encoder = new AvifEncoder(() => new(), () => executable);
            var bytes = await encoder.Encode(FixtureHttp.Png, folder, default);
            Assert.Equal(".avif", LibraryStorage.ImageExtension(bytes)); Assert.Empty(Directory.GetFiles(folder));
            Assert.Same(bytes, await encoder.Encode(bytes, folder, default));
        }
        finally { Directory.Delete(folder, true); }
    }
}
