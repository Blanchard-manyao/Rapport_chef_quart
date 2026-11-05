using System.Runtime.CompilerServices;
using Xunit;

// Les tests partagent une seule base SQLite : pas d'exécution en parallèle.
[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace RapportQuart.Tests;

static class Initialisation
{
    /// <summary>Redirige la base vers un dossier temporaire AVANT le premier accès à Db (jamais la vraie base).</summary>
    [ModuleInitializer]
    internal static void Run() =>
        Environment.SetEnvironmentVariable("RAPPORT_QUART_DONNEES",
            Path.Combine(Path.GetTempPath(), "RapportQuartTests_" + Guid.NewGuid().ToString("N")));
}
