using System.Text.Json;

namespace Jellyfin.Plugin.JellyManga.Sources;

public sealed class SourceRegistry(Store store, ISourceHttp http)
{
    private readonly string _mangaPlusSession = LoadSession(store);
    private static string LoadSession(Store store)
    {
        var saved = store.Get<string>("source-session", "mangaplus");
        if (Guid.TryParse(saved, out _)) return saved!;
        var created = Guid.NewGuid().ToString(); store.Put("source-session", "mangaplus", created); return created;
    }
    private readonly List<SourceDefinition> _catalog = JsonSerializer.Deserialize<List<SourceDefinition>>(Plugin.ReadResource("Sources.catalog.json"), Store.Json)!;
    private readonly List<SourceDefinition> _legacy = JsonSerializer.Deserialize<List<SourceDefinition>>(Plugin.ReadResource("Sources.legacy-catalog-v0.1.0.3.json"), Store.Json)!;
    private static string Rules(SourceDefinition source) => JsonSerializer.Serialize(source with { Enabled = false, Removed = false, Priority = 100, Status = "" }, Store.Json);
    public IReadOnlyList<SourceDefinition> All()
    {
        var overrides = store.All<SourceDefinition>("source").ToDictionary(s => s.Id);
        var merged = new List<SourceDefinition>();
        foreach (var bundled in _catalog)
        {
            if (!overrides.Remove(bundled.Id, out var saved)) { merged.Add(bundled); continue; }
            var previous = _legacy.FirstOrDefault(s => s.Id == bundled.Id);
            // Old live checks persisted whole built-in definitions. Refresh unchanged legacy rules,
            // keeping administrator enable/remove/priority choices and preserving custom rules.
            if (previous != null && Rules(saved) == Rules(previous) && Rules(bundled) != Rules(previous))
                saved = bundled with { Enabled = saved.Enabled, Removed = saved.Removed, Priority = saved.Priority };
            merged.Add(saved);
        }
        merged.AddRange(overrides.Values); return merged.OrderBy(s => s.Priority).ThenBy(s => s.Name).ToList();
    }
    public SourceDefinition Get(string id, bool requireEnabled = true)
    {
        var definition = All().FirstOrDefault(s => s.Id == id) ?? throw new KeyNotFoundException("Unknown source.");
        if (requireEnabled && (!definition.Enabled || definition.Removed)) throw new ArgumentException("Source is disabled or removed.");
        return definition;
    }
    public IMangaSource Adapter(string id, bool requireEnabled = true)
    {
        var source = Get(id, requireEnabled);
        return source.Kind switch { "mangadex" => new MangaDexSource(source, http), "mangaplus" => new MangaPlusSource(source, http, _mangaPlusSession), "flame" => new FlameSource(source, http), "html" or "json" => new RuleSource(source, http), _ => throw new ArgumentException("This site needs a specialized adapter and is not supported yet.") };
    }
    public static void Validate(SourceDefinition source)
    {
        if (string.IsNullOrWhiteSpace(source.Id) || source.Id.Length > 80 || source.Id.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-')) throw new ArgumentException("Source ID must contain letters, numbers, or hyphens (maximum 80).");
        if (string.IsNullOrWhiteSpace(source.Name) || source.Name.Length > 150) throw new ArgumentException("Source name is required (maximum 150).");
        if (source.Kind is not ("html" or "json" or "mangadex" or "mangaplus" or "flame" or "unavailable")) throw new ArgumentException("Unknown source type.");
        SafeHttp.ValidateUri(new Uri(source.BaseUrl), source);
        if (source.AllowedHosts.Length > 30 || source.AllowedHosts.Any(h => Uri.CheckHostName(h) == UriHostNameType.Unknown || h.Contains('*'))) throw new ArgumentException("Use explicit CDN hostnames, without wildcards.");
        foreach (var host in source.AllowedHosts) SafeHttp.ValidateUri(new Uri("https://" + host), source);
        if (source.DelayMilliseconds is < 250 or > 60000 || source.MaxPagination is < 1 or > 100) throw new ArgumentException("Invalid rate limit or pagination limit.");
        if (source.ChaptersMethod is not ("GET" or "POST")) throw new ArgumentException("Chapter retrieval method must be GET or POST.");
        if (source.Kind == "mangadex" && (new Uri(source.BaseUrl).Host != "mangadex.org" || !source.AllowedHosts.Contains("api.mangadex.org"))) throw new ArgumentException("MangaDex adapter requires its canonical domain and API host.");
        if (source.Kind == "html")
        {
            if (source.ScriptImagePattern.Length > 1000) throw new ArgumentException("Image extraction pattern is too long.");
            if (source.ScriptImagePattern.Length > 0 && !new System.Text.RegularExpressions.Regex(source.ScriptImagePattern, System.Text.RegularExpressions.RegexOptions.Singleline, TimeSpan.FromSeconds(1)).GetGroupNames().Contains("images")) throw new ArgumentException("Image pattern needs a named 'images' capture containing an array.");
            var doc = new AngleSharp.Html.Parser.HtmlParser().ParseDocument("<html></html>");
            foreach (var selector in new[] { source.SearchItems, source.SearchLink, source.SearchCover, source.TitleSelector, source.DescriptionSelector, source.ChapterItems, source.ChapterLink, source.PagesSelector, source.NextSelector }.Where(s => s.Length > 0)) doc.QuerySelectorAll(selector);
        }
    }
    public void Save(SourceDefinition definition) { Validate(definition); store.Put("source", definition.Id, definition with { Status = "Untested" }); store.Delete("check", definition.Id); }
    public void Remove(string id) { var d = Get(id, false); store.Put("source", id, d with { Enabled = false, Removed = true }); }
    public SourceDefinition ImageDefinition(SourceDefinition definition, string url)
    {
        if (definition.Kind != "mangadex") return definition;
        var uri = new Uri(url);
        // MangaDex at-home returns image URLs; only its CDN domain family is eligible.
        if (uri.Host != "uploads.mangadex.org" && !uri.Host.EndsWith(".mangadex.network", StringComparison.OrdinalIgnoreCase) && !uri.Host.EndsWith(".mangadex.org", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Unrecognized MangaDex image host; add an explicit allowlist entry after review.");
        return definition with { AllowedHosts = definition.AllowedHosts.Append(uri.Host).Distinct().ToArray() };
    }
}
