using Xunit;

namespace RapportQuart.Tests;

/// <summary>Caractérisation de Config : ces valeurs figent le comportement actuel.</summary>
public class ConfigTests
{
    static string Norm(string s) => new(s.Select(c => char.IsWhiteSpace(c) ? ' ' : c).ToArray());

    [Theory]
    [InlineData("7:30", 7, 30)]
    [InlineData("07:30", 7, 30)]
    [InlineData("7h30", 7, 30)]
    [InlineData("07H30", 7, 30)]
    [InlineData("7h", 7, 0)]
    [InlineData("7.30", 7, 30)]
    [InlineData(" 7h30 ", 7, 30)]
    [InlineData("23:59", 23, 59)]
    public void TryHeure_accepte_les_formats_de_saisie(string texte, int h, int m)
    {
        Assert.True(Config.TryHeure(texte, out var t));
        Assert.Equal(new TimeSpan(h, m, 0), t);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("abc")]
    [InlineData("25h00")]
    public void TryHeure_refuse_les_saisies_invalides(string texte) =>
        Assert.False(Config.TryHeure(texte, out _));

    [Fact]
    public void Heure_formate_hh_mm() =>
        Assert.Equal("07:30", Config.Heure(new TimeSpan(7, 30, 0)));

    [Theory]
    [InlineData("07:00", "07:45", 45)]
    [InlineData("07:00", "07:00", 0)]
    [InlineData("22:00", "06:00", 480)]
    [InlineData("23:30", "00:15", 45)]
    public void Minutes_gere_le_passage_de_minuit(string debut, string fin, int attendu)
    {
        Config.TryHeure(debut, out var d);
        Config.TryHeure(fin, out var f);
        Assert.Equal(attendu, Config.Minutes(d, f));
    }

    [Fact]
    public void Arret_Minutes_utilise_debut_et_fin() =>
        Assert.Equal(45, new Arret("Ligne 1", "23:30", "00:15", "x").Minutes);

    [Theory]
    [InlineData(0, "0 h 00 min")]
    [InlineData(5, "0 h 05 min")]
    [InlineData(95, "1 h 35 min")]
    [InlineData(480, "8 h 00 min")]
    public void Hm_formate_les_durees(int minutes, string attendu) =>
        Assert.Equal(attendu, Config.Hm(minutes));

    [Theory]
    [InlineData(0L, "0")]
    [InlineData(999L, "999")]
    [InlineData(12600L, "12 600")]
    [InlineData(1260000L, "1 260 000")]
    public void Milliers_separe_par_des_espaces(long n, string attendu) =>
        Assert.Equal(attendu, Config.Milliers(n));

    [Fact]
    public void PoidsMoyenPanier_sans_panier_seche_est_nul()
    {
        Assert.Null(Config.PoidsMoyenPanier(100, 0));
        Assert.Null(Config.PoidsMoyenPanierDiv28(100, 0));
    }

    [Fact]
    public void PoidsMoyenPanier_applique_la_formule()
    {
        // (colis x 36 / paniers) x 35
        Assert.Equal(315m, Config.PoidsMoyenPanier(10, 40));
        Assert.Equal(2520m, Config.PoidsMoyenPanier(100, 50));
        Assert.Equal(90m, Config.PoidsMoyenPanierDiv28(100, 50));
        Assert.Equal(11.25m, Config.PoidsMoyenPanierDiv28(10, 40));
    }

    [Fact]
    public void Decimal2_formate_a_la_francaise()
    {
        Assert.Equal("-", Config.Decimal2(null));
        Assert.Equal("90,00", Config.Decimal2(90m));
        Assert.Equal("11,25", Config.Decimal2(11.25m));
        Assert.Equal("2 520,00", Norm(Config.Decimal2(2520m)));
    }

    [Fact]
    public void Constantes_metier()
    {
        Assert.Equal(1260, Config.KgParUnite);
        Assert.Equal(1500, Config.PrelaveParGodet);
        Assert.Equal(480, Config.DureeQuart);
        Assert.Equal(new[] { "07h-15h", "15h-23h", "23h-07h" }, Config.Quarts);
        Assert.Equal(new[] { "GE 2500 KVA", "GE 2000 KVA" }, Config.Generateurs);
        Assert.Equal("TIA LOU EDWIGE", Config.Equipes["D"]);
    }
}
