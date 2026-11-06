using Jellyfin.Plugin.JellyManga.Sources;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.JellyManga;

public sealed class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection services, IServerApplicationHost applicationHost)
    {
        services.AddSingleton<Store>();
        services.AddSingleton<ISourceHttp, SafeHttp>();
        services.AddSingleton<SourceRegistry>();
        services.AddSingleton<LibraryStorage>();
        services.AddSingleton<IPageEncoder, AvifEncoder>();
        services.AddSingleton<ChapterDownloader>();
        services.AddSingleton<MangaService>();
        services.AddSingleton<SourceTester>();
        services.AddSingleton<QueueService>();
        services.AddHostedService(provider => provider.GetRequiredService<QueueService>());
        services.AddHostedService<MonitorService>();
        services.AddHostedService<InjectionService>();
    }
}
