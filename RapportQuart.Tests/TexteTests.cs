using Xunit;

namespace RapportQuart.Tests;

/// <summary>Caractérisation du rapport à copier (Texte.Construire).</summary>
public class TexteTests
{
    static Rapport Exemple() => new()
    {
        Date = "2026-10-17", Quart = "23h-07h", Equipe = "D",
        EffectifTotal = 20, Present = 17, Absent = 1, Malade = 1, Permission = 1, Conge = 0, Accident = 0,
        BoxPrelave = "B12", Godets = 4, TotalPrelave = 6000,
        Production = 10, Kg = 12600,
        BallesDebut = 3, BallesQuart = 5, BallesTraitees = 6, BallesFin = 2,
        BoxUsinage = "B7", TitreAcide = 2m, ConsoAcide = 20m, Paniers = 30, PaniersSeches = 40,
        AvancePanier = "P5", PanierLave = "P2",
    };

    static List<Sechoir> Sechoirs() => new()
    {
        new Sechoir { N = 1, Cycle = 55, Bruleur1 = 10, Bruleur2 = 12, ArretMin = 60, MarcheMin = 420 },
        new Sechoir { N = 2, Cycle = 50, Bruleur1 = 8, Bruleur2 = 9, ArretMin = 0, MarcheMin = 480 },
    };

    static Dictionary<string, int> Gen(int l1 = 30, int ge2500 = 90) => new()
    {
        ["Ligne 1"] = l1, ["Ligne 2"] = 0, ["GE 2500 KVA"] = ge2500, ["GE 2000 KVA"] = 0,
    };

    static string[] Lignes(Rapport r, List<Arret> arrets = null, List<Arret> marche = null, Dictionary<string, int> gen = null) =>
        Texte.Construire(r, Sechoirs(), arrets ?? new List<Arret>(), gen ?? Gen(), marche ?? new List<Arret>())
             .Split('\n').Select(l => l.TrimEnd()).ToArray();

    /// <summary>Comme Assert.Contains, mais affiche toutes les lignes produites en cas d'échec.</summary>
    static void Dans(string attendu, string[] lignes) =>
        Assert.True(lignes.Contains(attendu),
            $"Ligne absente : « {attendu} »\n--- Lignes produites ---\n{string.Join("\n", lignes)}");

    [Fact]
    public void Entete_effectif_et_production()
    {
        var l = Lignes(Exemple());
        Assert.Equal("RAPPORT CHEF DE QUART", l[0]);
        Assert.Equal("2026-10-17 - Quart 23h-07h - Équipe D", l[1]);
        Assert.Equal("Chef de quart : TIA LOU EDWIGE", l[2]);
        Dans("EFFECTIF : 20 | Présent 17 | Absent 1 | Malade 1 | Permission 1 | congé : 0", l);
        Dans("ACCIDENT DE TRAVAIL : 0", l);
        Dans("Paniers séchés : 40 | Production 10 colis, soit 12 600 kg", l);
        Dans("Poids moyen d'un panier : 315,00 | Poids moyen d'un pain : 11,25", l);
    }

    [Fact]
    public void Granulation_prelavage_et_lignes()
    {
        var l = Lignes(Exemple());
        Dans("Box en cours d'usinage : B7", l);
        Dans("Paniers granulés : 30 | Titre d'acide : 2 g/l | Conso acide : 20 kg", l);
        Dans("Box Prélavé: (B12) | 4 godets | total prélavé 6000 KG", l);
        Dans("Ligne 1 : arrêts 0 h 30 min | fonctionnement 7 h 30 min", l);
        Dans("Ligne 2 : arrêts 0 h 00 min | fonctionnement 8 h 00 min", l);
        Dans("Avance panier fin : P5", l);
    }

    [Fact]
    public void Deuxieme_box_absent_par_defaut_et_present_si_renseigne()
    {
        Assert.DoesNotContain(Lignes(Exemple()), x => x.StartsWith("2e box"));

        var r = Exemple();
        r.BoxPrelave2 = "B13"; r.Godets2 = 2; r.TotalPrelave2 = 3000;
        Dans("2e box prélavé: (B13) | 2 godets | total prélavé 3000 KG", Lignes(r));
    }

    [Fact]
    public void Champs_vides_sont_remplaces_par_un_tiret()
    {
        var r = Exemple();
        r.BoxUsinage = ""; r.BoxPrelave = null; r.AvancePanier = " "; r.PanierLave = null;
        var l = Lignes(r);
        Dans("Box en cours d'usinage : -", l);
        Dans("Box Prélavé: (-) | 4 godets | total prélavé 6000 KG", l);
        Dans("Avance panier fin : -", l);
        Dans("Paniers lavés : -", l);
    }

    [Fact]
    public void Sechoirs_balles_et_paniers_laves()
    {
        var l = Lignes(Exemple());
        Dans("Séchoir 1 : cycle 55 secondes | brûleurs 10/12 | arrêt 1 h 00 min | marche 7 h 00 min", l);
        Dans("Séchoir 2 : cycle 50 secondes | brûleurs 8/9 | arrêt 0 h 00 min | marche 8 h 00 min", l);
        Dans("Balles détectées : début 3 | Pendant le quart 5 | Balles traitées 6 | Fin de quart 2", l);
        Dans("Paniers lavés : P2", l);
    }

    [Fact]
    public void Arrets_listes_avec_zone_equipement_et_cause()
    {
        var arrets = new List<Arret>
        {
            new("Ligne 1", "01:00", "01:30", "bourrage"),
            new("Autre", "02:00", "02:10", "", "Pompe"),
        };
        var l = Lignes(Exemple(), arrets);
        Dans("- Ligne 1 | 01:00 - 01:30 : bourrage | 0 h 30 min", l);
        Dans("- Autre (Pompe) | 02:00 - 02:10 : cause non précisée | 0 h 10 min", l);
    }

    [Fact]
    public void Sans_arret_affiche_Aucun()
    {
        var l = Lignes(Exemple()).ToList();
        int i = l.IndexOf("LES ARRÊTS DU QUART");
        Assert.True(i >= 0);
        Assert.Equal("Aucun", l[i + 1]);
    }

    [Fact]
    public void Generateurs_avec_et_sans_periode()
    {
        var marche = new List<Arret> { new("GE 2500 KVA", "20:00", "21:30", "") };
        var l = Lignes(Exemple(), marche: marche);
        Dans("GÉNÉRATEURS (Fonctionnement)", l);
        Dans("GE 2500 KVA : 1 h 30 min (démarrage-arrêt : 20:00-21:30)", l);
        Dans("GE 2000 KVA : 0 h 00 min", l);
    }

    [Fact]
    public void Ordre_des_sections()
    {
        var l = Lignes(Exemple()).ToList();
        string[] ordre =
        {
            "RAPPORT CHEF DE QUART", "ACCIDENT DE TRAVAIL : 0", "Box en cours d'usinage : B7",
            "Avance panier fin : P5", "Paniers lavés : P2", "LES ARRÊTS DU QUART", "GÉNÉRATEURS (Fonctionnement)",
        };
        int prec = -1;
        foreach (var o in ordre)
        {
            int i = l.IndexOf(o);
            Assert.True(i > prec, $"« {o} » absent ou mal placé");
            prec = i;
        }
    }
}
