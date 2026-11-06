using System.Globalization;
using System.Text.Json;

namespace Jellyfin.Plugin.JellyManga.Sources;

public sealed class MangaDexSource(SourceDefinition definition, ISourceHttp http) : IMangaSource
{
    public SourceDefinition Definition => definition;
    private async Task<JsonDocument> Get(string path, CancellationToken ct) => JsonDocument.Parse(await http.Text(new Uri("https://api.mangadex.org" + path), definition, ct));
    private Series Series(JsonElement item)
    {
        var id = item.GetProperty("id").GetString()!; var attributes = item.GetProperty("attributes"); var titles = attributes.GetProperty("title");
        var title = titles.TryGetProperty("en", out var en) ? en.GetString()! : titles.EnumerateObject().First().Value.GetString()!;
        var description = attributes.GetProperty("description").TryGetProperty("en", out var d) ? d.GetString()! : "";
        return new(Identity.For(definition.Id, id), definition.Id, "https://mangadex.org/title/" + id, title, description);
    }
    private static string ExternalId(string url, string segment)
    {
        var uri = new Uri(url); var parts = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (uri.Host != "mangadex.org" || parts.Length < 2 || parts[0] != segment || !Guid.TryParse(parts[1], out _)) throw new ArgumentException("Invalid MangaDex URL.");
        return parts[1];
    }
    public async Task<IReadOnlyList<Series>> Search(string query, CancellationToken ct)
    {
        using var json = await Get("/manga?limit=50&availableTranslatedLanguage[]=en&title=" + Uri.EscapeDataString(query), ct);
        return json.RootElement.GetProperty("data").EnumerateArray().Select(Series).ToList();
    }
    public async Task<Series> Details(string url, CancellationToken ct)
    {
        using var json = await Get("/manga/" + ExternalId(url, "title"), ct); return Series(json.RootElement.GetProperty("data"));
    }
    public async Task<IReadOnlyList<Chapter>> Chapters(Series series, CancellationToken ct)
    {
        var output = new List<Chapter>();
        for (int offset = 0; offset < 10000; offset += 500)
        {
            using var json = await Get($"/manga/{ExternalId(series.Url, "title")}/feed?translatedLanguage[]=en&limit=500&offset={offset}&order[chapter]=asc&includeExternalUrl=0&includeEmptyPages=0", ct);
            foreach (var item in json.RootElement.GetProperty("data").EnumerateArray())
            {
                var a = item.GetProperty("attributes");
                if (a.TryGetProperty("externalUrl", out var external) && external.ValueKind == JsonValueKind.String) continue;
                if (a.TryGetProperty("pages", out var pages) && pages.GetInt32() == 0) continue;
                var id = item.GetProperty("id").GetString()!; var number = a.GetProperty("chapter").GetString() ?? "0";
                decimal.TryParse(number, NumberStyles.Number, CultureInfo.InvariantCulture, out var n);
                output.Add(new(Identity.For(series.Id, id), series.Id, "https://mangadex.org/chapter/" + id, "Chapter " + number + " " + (a.GetProperty("title").GetString() ?? ""), n));
            }
            if (offset + 500 >= json.RootElement.GetProperty("total").GetInt32()) break;
            if (offset == 9500) throw new InvalidDataException("MangaDex feed exceeds the supported 10,000-entry pagination window.");
        }
        // Keep distinct scanlation releases explicit; do not merge by chapter number.
        return output.DistinctBy(c => c.Id).OrderBy(c => c.Number).ToList();
    }
    public async Task<IReadOnlyList<PageImage>> Pages(Chapter chapter, CancellationToken ct)
    {
        using var json = await Get("/at-home/server/" + ExternalId(chapter.Url, "chapter"), ct);
        var root = json.RootElement; var baseUrl = root.GetProperty("baseUrl").GetString()!;
        var info = root.GetProperty("chapter"); var hash = info.GetProperty("hash").GetString();
        // At-home hosts are dynamic. The registry explicitly trusts MangaDex's returned HTTPS host,
        // while SafeHttp still rejects private destinations and pins DNS at connect time.
        return info.GetProperty("data").EnumerateArray().Select(p => new PageImage(baseUrl + "/data/" + hash + "/" + p.GetString(), chapter.Url)).ToList();
    }
}
