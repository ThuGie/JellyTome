using System.Security.Claims;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.JellyManga.Sources;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyManga;

public sealed class MangaExceptionFilter : ExceptionFilterAttribute
{
    public override void OnException(ExceptionContext context)
    {
        var status = context.Exception switch { UnauthorizedAccessException => 403, KeyNotFoundException or FileNotFoundException => 404, ArgumentException or InvalidDataException => 400, HttpRequestException => 502, OperationCanceledException => 408, _ => 500 };
        context.Result = new ObjectResult(new { error = status == 500 ? "Operation failed. See Jellyfin logs for diagnostics." : context.Exception.Message }) { StatusCode = status };
        context.ExceptionHandled = true;
        context.HttpContext.RequestServices.GetService<Microsoft.Extensions.Logging.ILogger<MangaExceptionFilter>>()?.LogWarning(context.Exception, "JellyTome request failed");
    }
}

public sealed record RequestBody(string SourceId, string Url);
public sealed record MonitorBody(bool Monitoring);
public sealed record TestBody(string Query, string? SeriesUrl = null, bool Download = false);

public sealed class MangaJsonFilter : ResultFilterAttribute
{
    public override void OnResultExecuting(ResultExecutingContext context)
    {
        // Jellyfin's global API casing is PascalCase; keep this plugin's documented wire format stable.
        if (context.Result is ObjectResult result) context.Result = new JsonResult(result.Value, Store.Json) { StatusCode = result.StatusCode ?? 200 };
    }
}

[ApiController, Route("JellyManga"), Authorize, MangaExceptionFilter, MangaJsonFilter]
public sealed class MangaController(Store store, SourceRegistry sources, CoverService covers, MangaService manga, LibraryStorage storage, QueueService queue, SourceTester tester, IUserManager users, ILibraryManager libraries) : ControllerBase
{
    private Guid UserId()
    {
        var claims = User.Claims.Where(c => c.Type.Equals("Jellyfin-UserId", StringComparison.OrdinalIgnoreCase)).Select(c => Guid.TryParse(c.Value, out var id) ? id : Guid.Empty).Distinct().ToArray();
        if (claims.Length != 1 || claims[0] == Guid.Empty || users.GetUserById(claims[0]) == null) throw new UnauthorizedAccessException("A Jellyfin user session is required.");
        return claims[0];
    }
    private bool Admin() => users.GetUserById(UserId())!.Permissions.Any(p => p.Kind == PermissionKind.IsAdministrator && p.Value);
    private IEnumerable<Jellyfin.Database.Implementations.Entities.User> ListUsers()
    {
        // 10.11.11 changed IUserManager.Users into GetUsers without changing the assembly version.
        var type = typeof(IUserManager);
        var value = type.GetMethod("GetUsers", Type.EmptyTypes)?.Invoke(users, null) ?? type.GetProperty("Users")?.GetValue(users);
        return value is System.Collections.IEnumerable list ? list.Cast<Jellyfin.Database.Implementations.Entities.User>() : [];
    }
    private void Access()
    {
        var id = UserId(); var user = users.GetUserById(id)!; if (user.Permissions.Any(p => p.Kind == PermissionKind.IsAdministrator && p.Value)) return;
        var config = Plugin.Instance.Configuration;
        if (config.DeniedUsers.Contains(id.ToString("N"), StringComparer.OrdinalIgnoreCase) || config.DeniedUsers.Contains(id.ToString(), StringComparer.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("Manga access is disabled for your account.");
        if (!Guid.TryParse(config.LibraryId, out var libraryId) || libraries.GetItemById(libraryId) is not { } library || !library.IsVisible(user)) throw new UnauthorizedAccessException("You need access to the configured manga library.");
    }
    [HttpGet("assets/{name}"), AllowAnonymous]
    public ActionResult Asset(string name) => name switch {
        "icon.png" => File(typeof(Plugin).Assembly.GetManifestResourceStream("Jellyfin.Plugin.JellyManga.Web.icon.png")!, "image/png"),
        "app.js" => Content(Plugin.ReadResource("Web.app.js"), "application/javascript"),
        "app.css" => Content(Plugin.ReadResource("Web.app.css"), "text/css"),
        _ => NotFound()
    };
    [HttpGet("session")]
    public ActionResult Session() { Access(); return Ok(new { userId = UserId(), admin = Admin(), version = typeof(Plugin).Assembly.GetName().Version?.ToString() }); }
    [HttpGet("sources")]
    public ActionResult Sources() { Access(); return Ok(sources.All().Where(s => s.Enabled && !s.Removed).Select(s => new { s.Id, s.Name, s.Status, s.Priority })); }
    [HttpGet("search")]
    public async Task<ActionResult> Search([FromQuery] string query, [FromQuery] string? sourceId, CancellationToken ct)
    {
        Access(); if (query.Length is < 2 or > 200) throw new ArgumentException("Enter between 2 and 200 characters.");
        var selected = sources.All().Where(s => s.Enabled && !s.Removed && (sourceId == null || s.Id == sourceId)).ToArray();
        var results = new List<Series>(); var errors = new List<object>();
        using var concurrency = new SemaphoreSlim(3);
        await Task.WhenAll(selected.Select(async source => {
            await concurrency.WaitAsync(ct);
            try { var found = await sources.Adapter(source.Id).Search(query, ct); lock (results) results.AddRange(found); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex) { lock (errors) errors.Add(new { sourceId = source.Id, error = ex.Message }); }
            finally { concurrency.Release(); }
        }));
        foreach (var series in results) covers.Remember(series);
        return Ok(new { results, errors });
    }
    [HttpPost("requests")]
    public async Task<ActionResult> CreateRequest([FromBody] RequestBody request, CancellationToken ct)
    {
        Access(); var result = await manga.Request(request.SourceId, request.Url, UserId().ToString("N"), ct); return Ok(result);
    }
    [HttpGet("library")]
    public ActionResult Library()
    {
        Access(); var jobs = store.All<DownloadJob>("job"); var progress = store.All<ReadingProgress>("progress:" + UserId().ToString("N"));
        return Ok(store.All<Subscription>("series").Select(s => new { s.Series, s.Monitoring, s.LastChecked, s.Error, downloaded = jobs.Count(j => j.Chapter.SeriesId == s.Series.Id && j.Status == "Complete"), progress = progress.Where(p => p.SeriesId == s.Series.Id).OrderByDescending(p => p.UpdatedAt).FirstOrDefault() }));
    }
    [HttpGet("covers/{id}")]
    public async Task<ActionResult> Cover(string id, CancellationToken ct)
    {
        Access(); var bytes = await covers.Get(id, ct); var extension = LibraryStorage.ImageExtension(bytes);
        Response.Headers.CacheControl = "private, max-age=300";
        return File(bytes, extension switch { ".jpg" => "image/jpeg", ".png" => "image/png", ".webp" => "image/webp", ".avif" => "image/avif", _ => "image/gif" });
    }
    [HttpGet("library/{id}/chapters")]
    public ActionResult Chapters(string id) { Access(); return Ok(store.All<DownloadJob>("job").Where(j => j.Chapter.SeriesId == id).OrderBy(j => j.Chapter.Number)); }
    [HttpGet("downloads")]
    public ActionResult Downloads() { Access(); return Ok(store.All<DownloadJob>("job").Select(j => new { j.Chapter, j.SourceId, j.Status, j.Attempts, j.Error, j.RetryAt, j.Pages })); }
    [HttpGet("chapters/{id}/manifest")]
    public ActionResult Manifest(string id) { Access(); var job = Complete(id); return Ok(new { job.Chapter, pages = storage.Entries(job).Count }); }
    [HttpGet("chapters/{id}/pages/{page:int}")]
    public async Task<ActionResult> Page(string id, int page, CancellationToken ct)
    {
        Access(); var bytes = await storage.Page(Complete(id), page, ct); var extension = LibraryStorage.ImageExtension(bytes);
        Response.Headers.CacheControl = "private, max-age=3600";
        return File(bytes, extension switch { ".jpg" => "image/jpeg", ".png" => "image/png", ".webp" => "image/webp", ".avif" => "image/avif", _ => "image/gif" });
    }
    private DownloadJob Complete(string id) { var job = store.Get<DownloadJob>("job", id); return job?.Status == "Complete" ? job : throw new KeyNotFoundException("Chapter is not downloaded."); }
    [HttpGet("progress")]
    public ActionResult Progress() { Access(); return Ok(store.All<ReadingProgress>("progress:" + UserId().ToString("N"))); }
    [HttpPut("progress")]
    public ActionResult Progress([FromBody] ReadingProgress progress)
    {
        Access(); var chapter = Complete(progress.ChapterId);
        if (progress.SeriesId != chapter.Chapter.SeriesId || progress.Page < 0 || progress.Page >= chapter.Pages) throw new ArgumentException("Invalid reading progress.");
        store.Put("progress:" + UserId().ToString("N"), progress.ChapterId, progress with { UpdatedAt = DateTimeOffset.UtcNow }); return NoContent();
    }
    [HttpGet("admin/overview"), Authorize(Policy = "RequiresElevation")]
    public ActionResult Overview()
    {
        var config = Plugin.Instance.Configuration; string? storageError = null; long? used = null;
        try { used = storage.Used(); } catch (Exception ex) { storageError = ex.Message; }
        return Ok(new { injection = WebTransformation.Registered, config.Paused, usedBytes = used, storageError, downloads = store.All<DownloadJob>("job").GroupBy(j => j.Status).ToDictionary(g => g.Key, g => g.Count()), monitored = store.All<Subscription>("series"), checks = store.All<SourceCheck>("check"), libraries = libraries.GetVirtualFolders().Select(v => new { v.Name, v.ItemId, v.Locations }), users = ListUsers().Select(u => new { u.Id, u.Username }) });
    }
    [HttpGet("admin/settings"), Authorize(Policy = "RequiresElevation")]
    public ActionResult Settings() => Ok(Plugin.Instance.Configuration);
    [HttpGet("admin/logs"), Authorize(Policy = "RequiresElevation")]
    public ActionResult Logs() => Ok(store.All<DiagnosticEvent>("event").OrderByDescending(e => e.At).Take(200));
    [HttpPut("admin/settings"), Authorize(Policy = "RequiresElevation")]
    public ActionResult Settings([FromBody] Configuration config)
    {
        if (config.AvifQuality is < 1 or > 100) throw new ArgumentException("AVIF quality must be 1–100.");
        if (config.DownloadConcurrency is < 1 or > 8 || config.MonitorMinutes is < 15 or > 10080 || config.StorageLimitBytes < 0) throw new ArgumentException("Concurrency must be 1–8, monitoring 15–10080 minutes, and storage limit nonnegative.");
        if (!Guid.TryParse(config.LibraryId, out var libraryId) || !libraries.GetVirtualFolders().Any(v => Guid.TryParse(v.ItemId, out var id) && id == libraryId)) throw new ArgumentException("Select an existing Jellyfin library.");
        if (string.IsNullOrWhiteSpace(config.StoragePath) || !Path.IsPathFullyQualified(config.StoragePath)) throw new ArgumentException("An absolute storage path is required.");
        var active = store.All<DownloadJob>("job").Any(j => j.Status == "Downloading");
        if (!string.Equals(config.StoragePath, Plugin.Instance.Configuration.StoragePath, StringComparison.Ordinal))
        {
            if (store.All<DownloadJob>("job").Any(j => j.Status == "Complete") || active) throw new ArgumentException("Storage cannot change while downloads exist. Move the library offline before migrating storage.");
        }
        var probeStorage = new LibraryStorage(() => config); var probe = probeStorage.Absolute(".write-probe-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(config.StoragePath); System.IO.File.WriteAllText(probe, "ok"); System.IO.File.Delete(probe);
        config.DeniedUsers = config.DeniedUsers.Select(id => Guid.TryParse(id, out var value) ? value.ToString("N") : throw new ArgumentException("Invalid user identifier.")).Distinct().ToArray();
        Plugin.Instance.UpdateConfiguration(config); store.Event("Settings", "Administrator updated manga settings."); return NoContent();
    }
    [HttpGet("admin/sources"), Authorize(Policy = "RequiresElevation")]
    public ActionResult AdminSources() => Ok(sources.All());
    [HttpPut("admin/sources/{id}"), Authorize(Policy = "RequiresElevation")]
    public ActionResult Source(string id, [FromBody] SourceDefinition source) { if (id != source.Id) throw new ArgumentException("Source identifier mismatch."); sources.Save(source); return NoContent(); }
    [HttpPut("admin/sources/{id}/downloads"), Authorize(Policy = "RequiresElevation")]
    public ActionResult SourceDownloads(string id, [FromBody] SourceDownloadSettings settings) { sources.SetDownloadLimit(id, settings.MaxConcurrentDownloads); return NoContent(); }
    [HttpDelete("admin/sources/{id}"), Authorize(Policy = "RequiresElevation")]
    public ActionResult RemoveSource(string id) { sources.Remove(id); return NoContent(); }
    [HttpPost("admin/sources/import"), Authorize(Policy = "RequiresElevation")]
    public ActionResult Import([FromBody] SourceDefinition[] definitions)
    {
        if (definitions.Length > 100) throw new ArgumentException("Import at most 100 sources at once.");
        foreach (var definition in definitions) SourceRegistry.Validate(definition);
        foreach (var definition in definitions) sources.Save(definition with { Enabled = false, Removed = false }); return NoContent();
    }
    [HttpPost("admin/sources/{id}/test"), Authorize(Policy = "RequiresElevation")]
    public async Task<ActionResult> Test(string id, [FromBody] TestBody body, CancellationToken ct) => Ok(await tester.Test(id, body, ct));
    [HttpPost("admin/downloads/{id}/{action}"), Authorize(Policy = "RequiresElevation")]
    public ActionResult DownloadAction(string id, string action) { store.Action(id, action); if (action is "cancel" or "pause") queue.Cancel(id); return NoContent(); }
    [HttpPut("admin/series/{id}"), Authorize(Policy = "RequiresElevation")]
    public ActionResult Monitor(string id, [FromBody] MonitorBody body)
    {
        if (store.Get<Subscription>("series", id) == null) throw new KeyNotFoundException(); store.UpdateSubscription(id, current => current with { Monitoring = body.Monitoring }); return NoContent();
    }
    [HttpPost("admin/series/{id}/check"), Authorize(Policy = "RequiresElevation")]
    public ActionResult CheckNow(string id)
    {
        if (store.Get<Subscription>("series", id) == null) throw new KeyNotFoundException(); store.UpdateSubscription(id, current => current with { LastChecked = null }); return Accepted(new { message = "Series scheduled for the next monitor pass (within one minute when monitoring is enabled)." });
    }
}
