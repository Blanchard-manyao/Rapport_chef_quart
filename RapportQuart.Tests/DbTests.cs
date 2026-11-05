using System.Data;
using Microsoft.Data.Sqlite;
using Xunit;

namespace RapportQuart.Tests;

/// <summary>Caractérisation de la base : schéma, aller-retour Enregistrer/Lire, remplacement et migration.</summary>
public class DbTests
{
    public DbTests() => Db.Init();

    static Rapport Exemple(string date, string quart = "23h-07h", string equipe = "D") => new()
    {
        Date = date, Quart = quart, Equipe = equipe,
        EffectifTotal = 20, Present = 17, Absent = 1, Malade = 1, Permission = 1, Conge = 0, Accident = 1,
        BoxPrelave = "B12", Godets = 4, TotalPrelave = 6000,
        BoxPrelave2 = "B13", Godets2 = 2, TotalPrelave2 = 3000,
        Production = 10, Kg = 12600,
        BallesDebut = 3, BallesQuart = 5, BallesTraitees = 6, BallesFin = 2,
        BoxUsinage = "B7", TitreAcide = 2m, ConsoAcide = 20.5m, Paniers = 30, PaniersSeches = 40,
        AvancePanier = "P5", PanierLave = "P2",
    };

    static List<Sechoir> Sechoirs() => new()
    {
        new Sechoir { N = 1, Cycle = 55, Bruleur1 = 10, Bruleur2 = 12, ArretMin = 60, MarcheMin = 420,
                      Compteur = "007,50", Gaz = "00123", Gaz2 = "0045.5" },
        new Sechoir { N = 2, Cycle = 50, Bruleur1 = 8, Bruleur2 = 9, ArretMin = 0, MarcheMin = 480 },
        new Sechoir { N = 3, Cycle = 52, Bruleur1 = 0, Bruleur2 = 999, ArretMin = 0, MarcheMin = 480 },
    };

    static List<Arret> Arrets() => new()
    {
        new("Ligne 1", "01:00", "01:30", "bourrage"),
        new("Autre", "23:30", "00:15", "fuite", "Pompe"),
    };

    static List<Arret> Marche() => new() { new("GE 2500 KVA", "20:00", "21:30", "") };

    [Fact]
    public void Existe_et_Lire_pour_un_rapport_inconnu()
    {
        Assert.False(Db.Existe("inconnu_23h-07h_D"));
        Assert.Null(Db.Lire("inconnu_23h-07h_D"));
    }

    [Fact]
    public void Aller_retour_conserve_tous_les_champs()
    {
        var r = Exemple("2030-01-01");
        Db.Enregistrer(r, Sechoirs(), Arrets(), Marche());

        Assert.True(Db.Existe(r.Id));
        var c = Db.Lire(r.Id);
        Assert.NotNull(c);

        var x = c.R;
        Assert.Equal(("2030-01-01", "23h-07h", "D"), (x.Date, x.Quart, x.Equipe));
        Assert.Equal((20, 17, 1, 1, 1, 0, 1),
            (x.EffectifTotal, x.Present, x.Absent, x.Malade, x.Permission, x.Conge, x.Accident));
        Assert.Equal(("B12", 4, 6000), (x.BoxPrelave, x.Godets, x.TotalPrelave));
        Assert.Equal(("B13", 2, 3000), (x.BoxPrelave2, x.Godets2, x.TotalPrelave2));
        Assert.Equal((10, 12600L), (x.Production, x.Kg));
        Assert.Equal((3, 5, 6, 2), (x.BallesDebut, x.BallesQuart, x.BallesTraitees, x.BallesFin));
        Assert.Equal(("B7", 2m, 20.5m), (x.BoxUsinage, x.TitreAcide, x.ConsoAcide));
        Assert.Equal((30, 40), (x.Paniers, x.PaniersSeches));
        Assert.Equal(("P5", "P2"), (x.AvancePanier, x.PanierLave));
    }

    [Fact]
    public void Compteurs_gardent_la_saisie_telle_quelle()
    {
        var r = Exemple("2030-01-02");
        Db.Enregistrer(r, Sechoirs(), Arrets(), Marche());
        var c = Db.Lire(r.Id);

        Assert.Equal(3, c.Sech.Count);
        var s1 = c.Sech.Single(s => s.N == 1);
        Assert.Equal(("007,50", "00123", "0045.5"), (s1.Compteur, s1.Gaz, s1.Gaz2));
        Assert.Equal((55, 10, 12), (s1.Cycle, s1.Bruleur1, s1.Bruleur2));

        var s2 = c.Sech.Single(s => s.N == 2);
        Assert.Equal(("", "", ""), (s2.Compteur, s2.Gaz, s2.Gaz2));
        Assert.Equal(999, c.Sech.Single(s => s.N == 3).Bruleur2);
    }

    [Fact]
    public void Arrets_et_marche_generateurs_sont_relus_dans_l_ordre()
    {
        var r = Exemple("2030-01-03");
        Db.Enregistrer(r, Sechoirs(), Arrets(), Marche());
        var c = Db.Lire(r.Id);

        Assert.Equal(2, c.Arrets.Count);
        Assert.Equal(new Arret("Ligne 1", "01:00", "01:30", "bourrage", null), c.Arrets[0]);
        Assert.Equal(new Arret("Autre", "23:30", "00:15", "fuite", "Pompe"), c.Arrets[1]);

        var m = Assert.Single(c.Marche);
        Assert.Equal(("GE 2500 KVA", "20:00", "21:30"), (m.Zone, m.Debut, m.Fin));
    }

    [Fact]
    public void Enregistrer_deux_fois_remplace_sans_doublon()
    {
        var r = Exemple("2030-01-04");
        Db.Enregistrer(r, Sechoirs(), Arrets(), Marche());

        r.Production = 99; r.Kg = 99L * 1260;
        Db.Enregistrer(r, Sechoirs().Take(1).ToList(), Arrets().Take(1).ToList(), new List<Arret>());

        var c = Db.Lire(r.Id);
        Assert.Equal(99, c.R.Production);
        Assert.Single(c.Sech);
        Assert.Single(c.Arrets);
        Assert.Empty(c.Marche);
        Assert.Equal(1, Db.Historique().Rows.Cast<DataRow>().Count(x => (string)x["id"] == r.Id));
    }

    [Fact]
    public void Historique_et_duree_des_arrets_avec_passage_de_minuit()
    {
        var r = Exemple("2030-01-05");
        Db.Enregistrer(r, Sechoirs(), Arrets(), Marche());

        var ligne = Db.Historique().Rows.Cast<DataRow>().Single(x => (string)x["id"] == r.Id);
        Assert.Equal("2030-01-05", (string)ligne["jour"]);
        Assert.Equal(12600L, (long)ligne["kg"]);

        var arrets = Db.ArretsDe(r.Id).Rows.Cast<DataRow>().ToList();
        Assert.Equal(30L, (long)arrets.Single(a => (string)a["zone"] == "Ligne 1")["duree_min"]);
        Assert.Equal(45L, (long)arrets.Single(a => (string)a["zone"] == "Autre")["duree_min"]);
    }

    [Fact]
    public void Un_rapport_est_unique_par_date_quart_equipe()
    {
        // Même clé (date, quart, équipe) = même id : un seul rapport.
        var r = Exemple("2030-01-06", "07h-15h", "A");
        Db.Enregistrer(r, Sechoirs(), new List<Arret>(), new List<Arret>());
        Db.Enregistrer(r, Sechoirs(), new List<Arret>(), new List<Arret>());
        Assert.Equal(1, Db.Historique().Rows.Cast<DataRow>().Count(x => (string)x["id"] == "2030-01-06_07h-15h_A"));
    }

    // ---------- Migration d'une ancienne base ----------

    const string AncienSchema = @"
CREATE TABLE equipe (code CHAR(1) PRIMARY KEY, chef TEXT NOT NULL);
INSERT INTO equipe (code, chef) VALUES ('A','KONAN LUC'),('B','EYO NESTOR'),('C','DAMEY JEAN-BAPTISTE'),('D','TIA LOU EDWIGE');
CREATE TABLE rapport (
  id TEXT PRIMARY KEY, date DATE NOT NULL, quart TEXT NOT NULL,
  equipe CHAR(1) NOT NULL REFERENCES equipe(code),
  effectif_total INT, present INT, absent INT, malade INT, permission INT, conge INT,
  accident INT DEFAULT 0, box_prelave TEXT, godets INT, total_prelave INT,
  production INT, kg INT, balles_debut INT, balles_quart INT, balles_fin INT,
  causes_conditionnement TEXT, box_usinage TEXT, titre_acide REAL, conso_acide REAL,
  paniers_granules INT CHECK (paniers_granules BETWEEN 0 AND 999),
  avance_panier TEXT, panier_lave TEXT,
  cree_le TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE (date, quart, equipe));
CREATE TABLE sechoir_releve (
  rapport_id TEXT NOT NULL REFERENCES rapport(id) ON DELETE CASCADE,
  sechoir INT NOT NULL CHECK (sechoir IN (1, 2, 3)), cycle_sec INT CHECK ( BETWEEN 0 AND 999),
  bruleur1 INT CHECK (bruleur1 BETWEEN 0 AND 999), bruleur2 INT CHECK (bruleur2 BETWEEN 0 AND 999),
  arret_min INT, marche_min INT, compteur INT, gaz INT, PRIMARY KEY (rapport_id, sechoir));
CREATE TABLE arret (
  id INTEGER PRIMARY KEY, rapport_id TEXT NOT NULL REFERENCES rapport(id) ON DELETE CASCADE,
  zone TEXT NOT NULL, heure_debut TIME NOT NULL, heure_fin TIME NOT NULL, cause TEXT);
CREATE VIEW arret_duree AS
SELECT rapport_id, zone, cause,
       CASE WHEN heure_fin >= heure_debut
            THEN (strftime('%s', heure_fin) - strftime('%s', heure_debut)) / 60
            ELSE (strftime('%s', heure_fin) - strftime('%s', heure_debut)) / 60 + 1440 END AS duree_min
FROM arret;
INSERT INTO rapport (id, date, quart, equipe, effectif_total, present, production, kg, paniers_granules)
VALUES ('2020-01-01_23h-07h_D', '2020-01-01', '23h-07h', 'D', 20, 18, 5, 6300, 12);
INSERT INTO sechoir_releve (rapport_id, sechoir, cycle_sec, bruleur1, bruleur2, arret_min, marche_min, compteur, gaz)
VALUES ('2020-01-01_23h-07h_D', 1, 50, 5, 6, 0, 480, 7, 123);
INSERT INTO arret (rapport_id, zone, heure_debut, heure_fin, cause)
VALUES ('2020-01-01_23h-07h_D', 'Ligne 1', '01:00', '01:20', 'ancien arret');
";

    static void RepartirDeZero()
    {
        SqliteConnection.ClearAllPools();
        if (File.Exists(Db.Chemin)) File.Delete(Db.Chemin);
    }

    [Fact]
    public void Migration_d_une_ancienne_base_conserve_les_rapports_et_ajoute_les_colonnes()
    {
        try
        {
            RepartirDeZero();
            Directory.CreateDirectory(Db.Dossier);
            using (var ancienne = new SqliteConnection($"Data Source={Db.Chemin}"))
            {
                ancienne.Open();
                using var cmd = ancienne.CreateCommand();
                cmd.CommandText = AncienSchema;
                cmd.ExecuteNonQuery();
            }
            SqliteConnection.ClearAllPools();

            Db.Init();   // doit migrer sans perdre l'ancien rapport

            var ancien = Db.Lire("2020-01-01_23h-07h_D");
            Assert.NotNull(ancien);
            Assert.Equal((5, 6300L, 12), (ancien.R.Production, ancien.R.Kg, ancien.R.Paniers));
            Assert.Equal(0, ancien.R.PaniersSeches);
            Assert.Equal("", ancien.R.BoxPrelave2);
            var s = Assert.Single(ancien.Sech);
            Assert.Equal(("7", "123", ""), (s.Compteur, s.Gaz, s.Gaz2));   // INT -> TEXT, gaz2 ajouté
            var a = Assert.Single(ancien.Arrets);
            Assert.Equal(("Ligne 1", "ancien arret"), (a.Zone, a.Cause));
            Assert.Null(a.Equipement);

            // La base migrée accepte les nouveaux champs
            var r = Exemple("2030-02-01");
            Db.Enregistrer(r, Sechoirs(), Arrets(), Marche());
            var neuf = Db.Lire(r.Id);
            Assert.Equal("0045.5", neuf.Sech.Single(x => x.N == 1).Gaz2);
            Assert.Equal("Pompe", neuf.Arrets[1].Equipement);
            Assert.Single(neuf.Marche);

            using (var con = Db.Ouvrir())
            {
                using var cmd = con.CreateCommand();
                cmd.CommandText = "SELECT COUNT(*) FROM generateur_duree";
                Assert.Equal(1L, (long)cmd.ExecuteScalar());
            }

            Db.Init();   // idempotent : une 2e migration ne change rien
            Assert.NotNull(Db.Lire("2020-01-01_23h-07h_D"));
        }
        finally
        {
            RepartirDeZero();
            Db.Init();
        }
    }
}
