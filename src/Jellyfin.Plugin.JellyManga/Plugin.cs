using System.Reflection;
using System.Runtime.Loader;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace Jellyfin.Plugin.JellyManga;

public sealed class Plugin : BasePlugin<Configuration>, IHasWebPages
{
    public static Plugin Instance { get; private set; } = null!;
    public Plugin(IApplicationPaths paths, IXmlSerializer serializer) : base(paths, serializer) { Instance = this; }
    public override string Name => "JellyTome";
    public override Guid Id => Guid.Parse("165db579-6287-4f53-985b-7e503449eb33");
    public override string Description => "Manga discovery, chapter downloads, monitoring, and reading inside Jellyfin.";
    public IEnumerable<PluginPageInfo> GetPages()
    {
        yield return new() { Name = "JellyManga", DisplayName = Name, EnableInMainMenu = true, MenuIcon = "menu_book", EmbeddedResourcePath = "Jellyfin.Plugin.JellyManga.Web.config.html" };
    }
    public static string ReadResource(string name)
    {
        using var stream = typeof(Plugin).Assembly.GetManifestResourceStream("Jellyfin.Plugin.JellyManga." + name) ?? throw new FileNotFoundException(name);
        using var reader = new StreamReader(stream); return reader.ReadToEnd();
    }
}

public sealed class PatchPayload { public string? Contents { get; set; } }
public static class WebTransformation
{
    public static bool Registered { get; private set; }
    public static string IndexHtml(PatchPayload payload)
    {
        var html = payload.Contents ?? "";
        if (html.Contains("data-jellymanga-assets", StringComparison.Ordinal)) return html;
        var revision = typeof(Plugin).Assembly.ManifestModule.ModuleVersionId.ToString("N");
        return html.Replace("</head>", $"<link data-jellymanga-assets rel=\"stylesheet\" href=\"../JellyManga/assets/app.css?v={revision}\"></head>", StringComparison.Ordinal)
            .Replace("</body>", $"<script defer data-jellymanga-assets src=\"../JellyManga/assets/app.js?v={revision}\"></script></body>", StringComparison.Ordinal);
    }
    public static bool Register()
    {
        var type = AssemblyLoadContext.All.SelectMany(c => c.Assemblies).Select(a => a.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface")).FirstOrDefault(t => t != null);
        var method = type?.GetMethod("RegisterTransformation");
        if (method == null) return false;
        method.Invoke(null, [new JObject { ["id"] = "e4343710-6205-4e76-90ca-99b58753def0", ["fileNamePattern"] = "index.html", ["callbackAssembly"] = typeof(WebTransformation).Assembly.FullName, ["callbackClass"] = typeof(WebTransformation).FullName, ["callbackMethod"] = nameof(IndexHtml) }]);
        return Registered = true;
    }
}

public sealed class InjectionService(ILogger<InjectionService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        for (int i = 0; i < 60; i++)
        {
            try { if (WebTransformation.Register()) return; }
            catch (Exception ex) { logger.LogWarning(ex, "File Transformation registration failed"); }
            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
        logger.LogWarning("Install File Transformation and restart Jellyfin to enable Manga navigation.");
    }
}
