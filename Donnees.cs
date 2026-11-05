using Microsoft.Data.Sqlite;
using System.Data;
using System.Globalization;
using System.Reflection;
using System.Text.Json;

namespace RapportQuart;

// ===== Modèles =====

public class Rapport
{
    public string Date, Quart, Equipe;
    public int EffectifTotal, Present, Absent, Malade, Permission, Conge, Accident;
    public string BoxPrelave;
    public int Godets, TotalPrelave;
    public string BoxPrelave2;          // 2e box prélavé (facultatif)
    public int Godets2, TotalPrelave2;
    public int Production;
    public long Kg;
    public int BallesDebut, BallesQuart, BallesTraitees, BallesFin;
    public string BoxUsinage;
    public decimal TitreAcide, ConsoAcide;
    public int Paniers;
    public int PaniersSeches;   // paniers séchés (3 chiffres max)
    public string AvancePanier, PanierLave;

    public string Id => $"{Date}_{Quart}_{Equipe}";
}

/// <summary>Rapport relu dans la base, avec ses séchoirs et ses arrêts.</summary>
public class RapportComplet
{
    public Rapport R = new();
    public List<Sechoir> Sech = new();
    public List<Arret> Arrets = new();
    public List<Arret> Marche = new();
}

public class Sechoir
{
    public int N, Cycle, Bruleur1, Bruleur2, ArretMin, MarcheMin;
    public string Compteur;  // compteur séchoir : saisie conservée telle quelle (décimales comprises)
    public string Gaz, Gaz2; // compteur GAZ à 2 valeurs : saisie conservée telle quelle (décimales comprises)
}

public record Arret(string Zone, string Debut, string Fin, string Cause, string Equipement = null)
{
    public int Minutes
    {
        get
        {
            Config.TryHeure(Debut, out var d);
            Config.TryHeure(Fin, out var f);
            return Config.Minutes(d, f);
        }
    }
}


// ===== Config : réglages et fonctions de calcul =====

public static class Config
{
    public static readonly Dictionary<string, string> Equipes = new()
    {
        ["A"] = "KONAN LUC",
        ["B"] = "EYO NESTOR",
        ["C"] = "DAMEY JEAN-BAPTISTE",
        ["D"] = "TIA LOU EDWIGE",
    };

    public const int KgParUnite = 1260;      // kg par unité produite
    public const int PrelaveParGodet = 1500; // total prélavé = 1500 x godets
    public const int DureeQuart = 480;       // minutes (8 h)

    public static readonly string[] Generateurs = { "GE 2500 KVA", "GE 2000 KVA" };
    public static readonly string[] Quarts = { "07h-15h", "15h-23h", "23h-07h" };
    public static readonly string[] Zones = { "Autre" };

    /// <summary>Poids moyen d'un panier = (colis x 36 / paniers séchés) x 35. Null si aucun panier séché.</summary>
    public static decimal? PoidsMoyenPanier(int colis, int paniersSeches) =>
        paniersSeches <= 0 ? null : (decimal)colis * 36 / paniersSeches * 35;

    /// <summary>Poids moyen d'un panier/ 28. Null si le poids moyen n'est pas calculable.</summary>
    public static decimal? PoidsMoyenPanierDiv28(int colis, int paniersSeches) =>
        PoidsMoyenPanier(colis, paniersSeches) / 28;

    /// <summary>Nombre à 2 décimales avec virgule, ou "-" si non calculable.</summary>
    public static string Decimal2(decimal? v) =>
        v.HasValue ? v.Value.ToString("#,0.00", CultureInfo.GetCultureInfo("fr-FR")) : "-";

    public static string Hm(int m) => $"{m / 60} h {m % 60:00} min";

    public static string Milliers(long n) =>
        n.ToString("#,0", CultureInfo.InvariantCulture).Replace(",", " ");

    /// <summary>Accepte 7:30, 07:30, 7h30, 7h.</summary>
    public static bool TryHeure(string texte, out TimeSpan t)
    {
        t = default;
        if (string.IsNullOrWhiteSpace(texte)) return false;
        var s = texte.Trim().Replace('h', ':').Replace('H', ':').Replace('.', ':');
        if (s.EndsWith(":")) s += "00";
        return TimeSpan.TryParseExact(s, @"h\:mm", CultureInfo.InvariantCulture, out t);
    }

    public static string Heure(TimeSpan t) => t.ToString(@"hh\:mm");

    /// <summary>Durée en minutes, passage de minuit géré.</summary>
    public static int Minutes(TimeSpan debut, TimeSpan fin)
    {
        int m = (int)(fin - debut).TotalMinutes;
        return m < 0 ? m + 1440 : m;
    }
}


// ===== Db : base de données SQLite =====

public static class Db
{
    public static readonly string Dossier;
    public static readonly string Chemin;

    /// <summary>Code de l'équipe connectée (A à D) : seule cette équipe peut enregistrer ou remplacer ses rapports.</summary>
    public static string EquipeConnectee { get; set; }
    public static event Action RapportEnregistre;

    static Db()
    {
        SQLitePCL.Batteries_V2.Init();   // moteur SQLite chiffré (SQLCipher)
        var perso = Environment.GetEnvironmentVariable("RAPPORT_QUART_DONNEES");
        Dossier = !string.IsNullOrEmpty(perso)
            ? perso
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "RapportQuart");
        Chemin = Path.Combine(Dossier, "rapports_quart.db");
    }

    static string ConnStrPour(string chemin) => new SqliteConnectionStringBuilder
    {
        DataSource = chemin,
        ForeignKeys = true,
        DefaultTimeout = 30,
        Password = Cle.Valeur,   // base chiffrée (AES-256 par SQLCipher)
    }.ToString();

    public static SqliteConnection Ouvrir()
    {
        if (string.IsNullOrEmpty(Cle.Valeur))
            throw new InvalidOperationException("La clé de chiffrement n'est pas chargée.");
        var c = new SqliteConnection(ConnStrPour(Chemin));
        c.Open();
        return c;
    }

    static string Schema()
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("schema.sql")
            ?? throw new InvalidOperationException("Schéma SQL introuvable dans l'exécutable.");
        using var r = new StreamReader(s);
        return r.ReadToEnd();
    }

    public static void Init()
    {
        Directory.CreateDirectory(Dossier);

        // Mise à niveau : une base créée par une ancienne version (non chiffrée) est chiffrée automatiquement
        if (File.Exists(Chemin) && new FileInfo(Chemin).Length == 0) File.Delete(Chemin);
        if (File.Exists(Chemin) && EstEnClair(Chemin)) ChiffrerFichier(Chemin);
        ChiffrerAnciennesSauvegardes();

        using var con = Ouvrir();
        using var chk = con.CreateCommand();
        chk.CommandText = "SELECT 1 FROM sqlite_master WHERE name = 'rapport'";
        if (chk.ExecuteScalar() == null)
        {
            using var cmd = con.CreateCommand();
            cmd.CommandText = Schema();
            cmd.ExecuteNonQuery();
        }

        // Contrôle d'intégrité AVANT toute modification : on ne touche pas à une base endommagée
        using (var q = con.CreateCommand())
        {
            q.CommandText = "PRAGMA quick_check";
            var res = Convert.ToString(q.ExecuteScalar());
            if (!string.Equals(res, "ok", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    "La base de données est endommagée (" + res + ").\n" +
                    "Ne la supprimez pas : restaurez la dernière sauvegarde du dossier " +
                    Path.Combine(Dossier, "Sauvegardes") + ".");
        }
        Migrer(con);
    }

    /// <summary>Copie cohérente de la base (même si elle est en cours d'utilisation), via l'API de sauvegarde SQLite.</summary>
    public static string Sauvegarder(string dossier, bool purger = false)
    {
        Directory.CreateDirectory(dossier);
        var chemin = Path.Combine(dossier, $"rapports_quart_{DateTime.Now:yyyyMMdd_HHmmss}.db");
        using (var src = Ouvrir())
        using (var dst = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = chemin, Password = Cle.Valeur }.ToString()))
        {
            dst.Open();
            src.BackupDatabase(dst);
        }
        SqliteConnection.ClearAllPools();   // libère le fichier (sinon il reste verrouillé)
        if (purger)
            foreach (var f in Directory.GetFiles(dossier, "rapports_quart_*.db").OrderByDescending(x => x).Skip(30))
                try { File.Delete(f); } catch { }
        return chemin;
    }

    /// <summary>Vrai si le fichier est une base SQLite lisible sans clé (ancienne version, non chiffrée).</summary>
    public static bool EstEnClair(string chemin)
    {
        try
        {
            using var c = new SqliteConnection(new SqliteConnectionStringBuilder
                { DataSource = chemin, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT count(*) FROM sqlite_master";
            cmd.ExecuteScalar();
            return true;
        }
        catch (SqliteException)
        {
            return false;
        }
    }

    /// <summary>Vrai si la clé chargée ouvre bien la base.</summary>
    public static bool CleValide()
    {
        try
        {
            using var c = Ouvrir();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT count(*) FROM sqlite_master";
            cmd.ExecuteScalar();
            return true;
        }
        catch (SqliteException)
        {
            return false;
        }
        finally
        {
            SqliteConnection.ClearAllPools();
        }
    }

    static long NbTables(string chemin, bool avecCle)
    {
        var b = new SqliteConnectionStringBuilder { DataSource = chemin, Pooling = false };
        if (avecCle) b.Password = Cle.Valeur;
        using var c = new SqliteConnection(b.ToString());
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM sqlite_master WHERE type = 'table'";
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    /// <summary>Chiffre une base existante : copie chiffrée, vérification, puis effacement de l'original en clair.</summary>
    static void ChiffrerFichier(string chemin)
    {
        var tmp = chemin + ".chiffre";
        if (File.Exists(tmp)) File.Delete(tmp);

        using (var c = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = chemin, Pooling = false }.ToString()))
        {
            c.Open();
            Exec(c, null, $"ATTACH DATABASE '{tmp.Replace("'", "''")}' AS chiffre KEY '{Cle.Valeur}'");
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT sqlcipher_export('chiffre')";
            cmd.ExecuteScalar();
            Exec(c, null, "DETACH DATABASE chiffre");
        }

        if (NbTables(chemin, false) != NbTables(tmp, true))
        {
            EffacerFichier(tmp);
            throw new InvalidOperationException("Le chiffrement de la base a échoué : la base d'origine est conservée intacte.");
        }
        EffacerFichier(chemin);
        File.Move(tmp, chemin);
        Journal.Info("Base chiffrée : " + Path.GetFileName(chemin));
    }

    /// <summary>Écrase le contenu avec des zéros avant de supprimer (limite les restes de données en clair sur le disque).</summary>
    static void EffacerFichier(string chemin)
    {
        try
        {
            long taille = new FileInfo(chemin).Length;
            using var fs = new FileStream(chemin, FileMode.Open, FileAccess.Write);
            var zeros = new byte[81920];
            for (long ecrit = 0; ecrit < taille;)
            {
                int n = (int)Math.Min(zeros.Length, taille - ecrit);
                fs.Write(zeros, 0, n);
                ecrit += n;
            }
            fs.Flush(true);
        }
        catch { }
        File.Delete(chemin);
    }

    static void ChiffrerAnciennesSauvegardes()
    {
        var dossier = Path.Combine(Dossier, "Sauvegardes");
        if (!Directory.Exists(dossier)) return;
        foreach (var f in Directory.GetFiles(dossier, "rapports_quart_*.db"))
            try { if (EstEnClair(f)) ChiffrerFichier(f); }
            catch (Exception ex) { Journal.Erreur(ex, "chiffrement d'une ancienne sauvegarde"); }
    }

    /// <summary>Sauvegarde automatique : au plus une par jour, dans ProgramData\RapportQuart\Sauvegardes.</summary>
    public static void SauvegarderAuto()
    {
        var dossier = Path.Combine(Dossier, "Sauvegardes");
        Directory.CreateDirectory(dossier);
        if (Directory.GetFiles(dossier, $"rapports_quart_{DateTime.Now:yyyyMMdd}_*.db").Length > 0) return;
        Sauvegarder(dossier, purger: true);
    }

    /// <summary>Met à niveau une base créée par une version précédente (sans perdre les rapports).</summary>
    static void Migrer(SqliteConnection con)
    {
        Exec(con, null,
            "CREATE TABLE IF NOT EXISTS generateur_marche (" +
            "id INTEGER PRIMARY KEY, " +
            "rapport_id TEXT NOT NULL REFERENCES rapport(id) ON DELETE CASCADE, " +
            "generateur TEXT NOT NULL, heure_demarrage TIME NOT NULL, heure_arret TIME NOT NULL)");
        Exec(con, null,
            "CREATE VIEW IF NOT EXISTS generateur_duree AS " +
            "SELECT rapport_id, generateur, heure_demarrage, heure_arret, " +
            "CASE WHEN heure_arret >= heure_demarrage " +
            "THEN (strftime('%s', heure_arret) - strftime('%s', heure_demarrage)) / 60 " +
            "ELSE (strftime('%s', heure_arret) - strftime('%s', heure_demarrage)) / 60 + 1440 END AS duree_min " +
            "FROM generateur_marche");
        // Mots de passe des équipes (hachés avec sel ; jamais stockés en clair)
        Exec(con, null,
            "CREATE TABLE IF NOT EXISTS equipe_acces (" +
            "code CHAR(1) PRIMARY KEY REFERENCES equipe(code), sel BLOB, hash BLOB, iterations INT, " +
            "echecs INT NOT NULL DEFAULT 0, bloque_jusqua TEXT)");
        Exec(con, null,
            "CREATE TABLE IF NOT EXISTS administrateur_acces (" +
            "id INTEGER PRIMARY KEY CHECK(id=1), sel BLOB NOT NULL, hash BLOB NOT NULL, iterations INT NOT NULL, " +
            "echecs INT NOT NULL DEFAULT 0, bloque_jusqua TEXT)");
        // Journal d'audit : qui a créé / remplacé un rapport, quand, et l'ancien contenu (pour pouvoir le retrouver)
        Exec(con, null,
            "CREATE TABLE IF NOT EXISTS journal_audit (" +
            "id INTEGER PRIMARY KEY, horodatage TEXT NOT NULL, utilisateur TEXT NOT NULL, machine TEXT NOT NULL, " +
            "action TEXT NOT NULL, rapport_id TEXT NOT NULL, ancien_contenu TEXT)");
        Exec(con, null,
            "CREATE TRIGGER IF NOT EXISTS audit_pas_modifiable BEFORE UPDATE ON journal_audit " +
            "BEGIN SELECT RAISE(ABORT, 'Journal d''audit en lecture seule'); END");
        Exec(con, null,
            "CREATE TRIGGER IF NOT EXISTS audit_pas_supprimable BEFORE DELETE ON journal_audit " +
            "BEGIN SELECT RAISE(ABORT, 'Journal d''audit en lecture seule'); END");
        if (!ColonneExiste(con, "rapport", "balles_traitees"))
            Exec(con, null, "ALTER TABLE rapport ADD COLUMN balles_traitees INT");
        if (!ColonneExiste(con, "rapport", "paniers_seches"))
            Exec(con, null, "ALTER TABLE rapport ADD COLUMN paniers_seches INT");
        if (!ColonneExiste(con, "arret", "equipement"))
            Exec(con, null, "ALTER TABLE arret ADD COLUMN equipement TEXT");
        foreach (var (col, typ) in new[] { ("box_prelave2", "TEXT"), ("godets2", "INT"), ("total_prelave2", "INT") })
            if (!ColonneExiste(con, "rapport", col))
                Exec(con, null, $"ALTER TABLE rapport ADD COLUMN {col} {typ}");
        foreach (var col in new[] {"gaz2" })
            if (!ColonneExiste(con, "sechoir_releve", col))
                Exec(con, null, $"ALTER TABLE sechoir_releve ADD COLUMN {col} TEXT");

        // Migration compatible : renommer la colonne en place évite de recopier les lignes
        // référencées et préserve les contraintes de clé étrangère.
        bool aCycleSec = ColonneExiste(con, "sechoir_releve", "cycle_sec");
        bool aCycleMin = ColonneExiste(con, "sechoir_releve", "cycle_min");
        if (!aCycleSec && aCycleMin)
            Exec(con, null, "ALTER TABLE sechoir_releve RENAME COLUMN cycle_min TO cycle_sec");
        else if (!aCycleSec && !aCycleMin)
            Exec(con, null, "ALTER TABLE sechoir_releve ADD COLUMN cycle_sec INT");
        // Les compteurs doivent garder les chiffres tels que saisis : colonnes TEXT (pas d'arrondi ni de zéros perdus)
        if (TypeColonne(con, "sechoir_releve", "gaz").StartsWith("INT", StringComparison.OrdinalIgnoreCase)
            || TypeColonne(con, "sechoir_releve", "gaz2").StartsWith("INT", StringComparison.OrdinalIgnoreCase)
            || TypeColonne(con, "sechoir_releve", "compteur").StartsWith("INT", StringComparison.OrdinalIgnoreCase))
        {
            using var tx = con.BeginTransaction();
            Exec(con, tx,
                "CREATE TABLE sechoir_releve_new (" +
                "rapport_id TEXT NOT NULL REFERENCES rapport(id) ON DELETE CASCADE, " +
                "sechoir INT NOT NULL CHECK (sechoir IN (1, 2, 3)), " +
                "cycle_sec INT, bruleur1 INT CHECK (bruleur1 BETWEEN 0 AND 999), " +
                "bruleur2 INT CHECK (bruleur2 BETWEEN 0 AND 999), " +
                "arret_min INT, marche_min INT, compteur TEXT, gaz TEXT, gaz2 TEXT, " +
                "PRIMARY KEY (rapport_id, sechoir))");
            Exec(con, tx,
                "INSERT INTO sechoir_releve_new (rapport_id, sechoir, cycle_sec, bruleur1, bruleur2, arret_min, marche_min, compteur, gaz, gaz2) " +
                "SELECT rapport_id, sechoir, cycle_sec, bruleur1, bruleur2, arret_min, marche_min, " +
                "CAST(compteur AS TEXT), CAST(gaz AS TEXT), CAST(gaz2 AS TEXT) FROM sechoir_releve");
            Exec(con, tx, "DROP TABLE sechoir_releve");
            Exec(con, tx, "ALTER TABLE sechoir_releve_new RENAME TO sechoir_releve");
            tx.Commit();
        }
    }

    static string TypeColonne(SqliteConnection con, string table, string colonne)
    {
        using var cmd = con.CreateCommand();
        cmd.CommandText = $"PRAGMA table_info({table})";
        using var rd = cmd.ExecuteReader();
        while (rd.Read())
            if (string.Equals(rd.GetString(1), colonne, StringComparison.OrdinalIgnoreCase)) return rd.GetString(2) ?? "";
        return "";
    }

    static bool ColonneExiste(SqliteConnection con, string table, string colonne)
    {
        using var cmd = con.CreateCommand();
        cmd.CommandText = $"PRAGMA table_info({table})";
        using var rd = cmd.ExecuteReader();
        while (rd.Read())
            if (string.Equals(rd.GetString(1), colonne, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    internal static void Exec(SqliteConnection con, SqliteTransaction tx, string sql, params (string Nom, object Valeur)[] p)
    {
        using var cmd = con.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        foreach (var x in p)
            cmd.Parameters.AddWithValue("$" + x.Nom, x.Valeur ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    public static bool Existe(string id)
    {
        using var con = Ouvrir();
        using var cmd = con.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM rapport WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        return cmd.ExecuteScalar() != null;
    }

    /// <summary>Délai (en heures) pendant lequel un rapport reste modifiable après son premier enregistrement.</summary>
    public const int DelaiModificationHeures = 8;

    /// <summary>Date et heure du premier enregistrement du rapport (null si inconnu).</summary>
    public static DateTime? PremierEnregistrement(string id)
    {
        using var con = Ouvrir();
        using var cmd = con.CreateCommand();
        cmd.Parameters.AddWithValue("$id", id);

        cmd.CommandText = "SELECT MIN(horodatage) FROM journal_audit WHERE rapport_id = $id AND action = 'CREATION'";
        if (cmd.ExecuteScalar() is string s
            && DateTime.TryParseExact(s, "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
            return d;

        // Rapport enregistré avant l'ajout du journal : on prend sa date d'enregistrement (stockée en UTC)
        cmd.CommandText = "SELECT cree_le FROM rapport WHERE id = $id";
        if (cmd.ExecuteScalar() is string s2
            && DateTime.TryParse(s2, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var u))
            return u.ToLocalTime();
        return null;
    }

    /// <summary>Vrai si le délai de modification est dépassé. « limite » = date de verrouillage.</summary>
    public static bool EstVerrouille(string id, out DateTime? limite)
    {
        limite = PremierEnregistrement(id)?.AddHours(DelaiModificationHeures);
        return limite.HasValue && DateTime.Now >= limite.Value;
    }

    public static void Enregistrer(Rapport r, List<Sechoir> sech, List<Arret> arrets, List<Arret> marche, bool forcer = false)
    {
        // Seule l'équipe connectée peut enregistrer ou remplacer SES rapports
        if (EquipeConnectee == null || r.Equipe != EquipeConnectee)
            throw new UnauthorizedAccessException(
                "Ce rapport appartient à l'équipe " + r.Equipe + " : connectez-vous avec le mot de passe de cette équipe.");

        // Avant de remplacer un rapport, on garde son ancien contenu complet dans le journal d'audit
        string ancien = null;
        var existant = Lire(r.Id);
        if (existant != null && !forcer && EstVerrouille(r.Id, out var limite))
            throw new InvalidOperationException(
                $"Ce rapport est verrouillé : le délai de modification de {DelaiModificationHeures} h est dépassé (depuis le {limite:dd/MM/yyyy HH:mm}).");
        if (existant != null)
            ancien = JsonSerializer.Serialize(existant, new JsonSerializerOptions { IncludeFields = true });

        using var con = Ouvrir();
        using var tx = con.BeginTransaction();

        Exec(con, tx,
            "INSERT OR REPLACE INTO rapport (id, date, quart, equipe, effectif_total, present, absent, malade, " +
            "permission, conge, accident, box_prelave, godets, total_prelave, box_prelave2, godets2, total_prelave2, production, kg, balles_debut, " +
            "balles_quart, balles_traitees, balles_fin, box_usinage, titre_acide, conso_acide, paniers_granules, paniers_seches, avance_panier, panier_lave) " +
            "VALUES ($id, $date, $quart, $equipe, $effectif, $present, $absent, $malade, $permission, $conge, " +
            "$accident, $box_prelave, $godets, $total_prelave, $box_prelave2, $godets2, $total_prelave2, $production, $kg, $balles_debut, $balles_quart, " +
            "$balles_traitees, $balles_fin, $box_usinage, $titre, $conso, $paniers, $paniers_seches, $avance, $lave)",
            ("id", r.Id), ("date", r.Date), ("quart", r.Quart), ("equipe", r.Equipe),
            ("effectif", r.EffectifTotal), ("present", r.Present), ("absent", r.Absent),
            ("malade", r.Malade), ("permission", r.Permission), ("conge", r.Conge),
            ("accident", r.Accident), ("box_prelave", r.BoxPrelave), ("godets", r.Godets),
            ("total_prelave", r.TotalPrelave), ("box_prelave2", r.BoxPrelave2), ("godets2", r.Godets2),
            ("total_prelave2", r.TotalPrelave2), ("production", r.Production), ("kg", r.Kg),
            ("balles_debut", r.BallesDebut), ("balles_quart", r.BallesQuart), ("balles_traitees", r.BallesTraitees), ("balles_fin", r.BallesFin),
            ("box_usinage", r.BoxUsinage), ("titre", (double)r.TitreAcide), ("conso", (double)r.ConsoAcide),
            ("paniers", r.Paniers), ("paniers_seches", r.PaniersSeches), ("avance", r.AvancePanier), ("lave", r.PanierLave));

        Exec(con, tx, "DELETE FROM sechoir_releve WHERE rapport_id = $id", ("id", r.Id));
        Exec(con, tx, "DELETE FROM arret WHERE rapport_id = $id", ("id", r.Id));
        Exec(con, tx, "DELETE FROM generateur_marche WHERE rapport_id = $id", ("id", r.Id));

        foreach (var s in sech)
        {
            Exec(con, tx,
                "INSERT INTO sechoir_releve (rapport_id, sechoir, cycle_sec, bruleur1, bruleur2, arret_min, " +
                "marche_min, compteur, gaz, gaz2) VALUES ($id, $n, $cycle, $b1, $b2, $arret, $marche, " +
                "$compteur, $gaz, $gaz2)", 
                ("id", r.Id), ("n", s.N), ("cycle", s.Cycle), ("b1", s.Bruleur1), ("b2", s.Bruleur2),
                ("arret", s.ArretMin), ("marche", s.MarcheMin), ("compteur", s.Compteur),
                ("gaz", s.Gaz), ("gaz2", s.Gaz2));
        }

        foreach (var a in arrets)
        {
            Exec(con, tx,
                "INSERT INTO arret (rapport_id, zone, heure_debut, heure_fin, cause, equipement) " +
                "VALUES ($id, $zone, $debut, $fin, $cause, $equip)",
                ("id", r.Id), ("zone", a.Zone), ("debut", a.Debut),
                ("fin", a.Fin), ("cause", a.Cause), ("equip", a.Equipement));
        }

        foreach (var m in marche)
        {
            Exec(con, tx,
                "INSERT INTO generateur_marche (rapport_id, generateur, heure_demarrage, heure_arret) " +
                "VALUES ($id, $gen, $deb, $fin)",
                ("id", r.Id), ("gen", m.Zone), ("deb", m.Debut), ("fin", m.Fin));
        }

        Exec(con, tx,
            "INSERT INTO journal_audit (horodatage, utilisateur, machine, action, rapport_id, ancien_contenu) " +
            "VALUES ($h, $u, $m, $a, $id, $ancien)",
            ("h", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)),
            ("u", Environment.UserName + " (équipe " + EquipeConnectee + ")"), ("m", Environment.MachineName),
            ("a", ancien == null ? "CREATION" : forcer ? "REMPLACEMENT_DEVERROUILLE" : "REMPLACEMENT"), ("id", r.Id), ("ancien", ancien));

        tx.Commit();
        try { RapportEnregistre?.Invoke(); }
        catch (Exception ex) { Journal.Erreur(ex, "actualisation après enregistrement"); }
    }

    /// <summary>Relit un rapport enregistré (null s'il n'existe pas).</summary>
    public static RapportComplet Lire(string id)
    {
        using var con = Ouvrir();
        var c = new RapportComplet();

        static int I(SqliteDataReader rd, string col)
        {
            int o = rd.GetOrdinal(col);
            return rd.IsDBNull(o) ? 0 : Convert.ToInt32(rd.GetValue(o), CultureInfo.InvariantCulture);
        }
        static decimal D(SqliteDataReader rd, string col)
        {
            int o = rd.GetOrdinal(col);
            return rd.IsDBNull(o) ? 0m : Convert.ToDecimal(rd.GetValue(o), CultureInfo.InvariantCulture);
        }
        static string S(SqliteDataReader rd, string col)
        {
            int o = rd.GetOrdinal(col);
            return rd.IsDBNull(o) ? "" : Convert.ToString(rd.GetValue(o), CultureInfo.InvariantCulture);
        }
        void Requete(string sql, Action<SqliteDataReader> lire)
        {
            using var cmd = con.CreateCommand();
            cmd.CommandText = sql;
            cmd.Parameters.AddWithValue("$id", id);
            using var rd = cmd.ExecuteReader();
            while (rd.Read()) lire(rd);
        }

        bool trouve = false;
        Requete("SELECT * FROM rapport WHERE id = $id", rd =>
        {
            trouve = true;
            c.R = new Rapport
            {
                Date = S(rd, "date"), Quart = S(rd, "quart"), Equipe = S(rd, "equipe"),
                EffectifTotal = I(rd, "effectif_total"), Present = I(rd, "present"), Absent = I(rd, "absent"),
                Malade = I(rd, "malade"), Permission = I(rd, "permission"), Conge = I(rd, "conge"),
                Accident = I(rd, "accident"), BoxPrelave = S(rd, "box_prelave"), Godets = I(rd, "godets"),
                TotalPrelave = I(rd, "total_prelave"), Production = I(rd, "production"),
                BoxPrelave2 = S(rd, "box_prelave2"), Godets2 = I(rd, "godets2"), TotalPrelave2 = I(rd, "total_prelave2"),
                Kg = Convert.ToInt64(D(rd, "kg")),
                BallesDebut = I(rd, "balles_debut"), BallesQuart = I(rd, "balles_quart"),
                BallesTraitees = I(rd, "balles_traitees"), BallesFin = I(rd, "balles_fin"),
                BoxUsinage = S(rd, "box_usinage"), TitreAcide = D(rd, "titre_acide"), ConsoAcide = D(rd, "conso_acide"),
                Paniers = I(rd, "paniers_granules"), PaniersSeches = I(rd, "paniers_seches"),
                AvancePanier = S(rd, "avance_panier"), PanierLave = S(rd, "panier_lave"),
            };
        });
        if (!trouve) return null;

        Requete("SELECT sechoir, cycle_sec, bruleur1, bruleur2, compteur, gaz, gaz2 FROM sechoir_releve " +
                "WHERE rapport_id = $id ORDER BY sechoir", rd =>
            c.Sech.Add(new Sechoir
            {
                N = I(rd, "sechoir"), Cycle = I(rd, "cycle_sec"), Bruleur1 = I(rd, "bruleur1"),
                Bruleur2 = I(rd, "bruleur2"), Compteur = S(rd, "compteur"), Gaz = S(rd, "gaz"), Gaz2 = S(rd, "gaz2"),
            }));

        Requete("SELECT zone, heure_debut, heure_fin, cause, equipement FROM arret " +
                "WHERE rapport_id = $id ORDER BY id", rd =>
            c.Arrets.Add(new Arret(S(rd, "zone"), S(rd, "heure_debut"), S(rd, "heure_fin"), S(rd, "cause"),
                string.IsNullOrWhiteSpace(S(rd, "equipement")) ? null : S(rd, "equipement"))));

        Requete("SELECT generateur, heure_demarrage, heure_arret FROM generateur_marche " +
                "WHERE rapport_id = $id ORDER BY id", rd =>
            c.Marche.Add(new Arret(S(rd, "generateur"), S(rd, "heure_demarrage"), S(rd, "heure_arret"), "")));

        return c;
    }

    /// <summary>Pannes (ou équipements) déjà saisies pour une zone, les plus fréquentes d'abord : sert à l'auto-complétion.</summary>
    public static List<string> Suggestions(string colonne, string zone)
    {
        if (colonne != "cause" && colonne != "equipement") throw new ArgumentException("colonne inconnue");
        var liste = new List<string>();
        using var con = Ouvrir();
        using var cmd = con.CreateCommand();
        cmd.CommandText =
            $"SELECT TRIM({colonne}) AS t, COUNT(*) AS n FROM arret " +
            $"WHERE zone = $z AND {colonne} IS NOT NULL AND TRIM({colonne}) <> '' " +
            "GROUP BY LOWER(TRIM(" + colonne + ")) ORDER BY n DESC, t LIMIT 300";
        cmd.Parameters.AddWithValue("$z", zone);
        using var rd = cmd.ExecuteReader();
        while (rd.Read()) liste.Add(rd.GetString(0));
        return liste;
    }

    static DataTable Charger(string sql, string[] noms, Type[] types, params (string Nom, object Valeur)[] p)
    {
        using var con = Ouvrir();
        using var cmd = con.CreateCommand();
        cmd.CommandText = sql;
        foreach (var x in p)
            cmd.Parameters.AddWithValue("$" + x.Nom, x.Valeur ?? DBNull.Value);

        var dt = new DataTable();
        for (int i = 0; i < noms.Length; i++) dt.Columns.Add(noms[i], types[i]);

        using var rd = cmd.ExecuteReader();
        while (rd.Read())
        {
            var row = dt.NewRow();
            for (int i = 0; i < noms.Length; i++)
            {
                row[i] = rd.IsDBNull(i)
                    ? DBNull.Value
                    : Convert.ChangeType(rd.GetValue(i), types[i], CultureInfo.InvariantCulture);
            }
            dt.Rows.Add(row);
        }
        return dt;
    }

    public static DataTable Historique() => Charger(
        "SELECT id, date, quart, equipe, present AS effectif_present, production, kg AS tonnage " +
        "FROM rapport ORDER BY date DESC, quart",
        new[] { "id", "jour", "quart", "equipe", "effectif_present", "production", "tonnage" },
        new[] { typeof(string), typeof(string), typeof(string), typeof(string),
                typeof(long), typeof(long), typeof(long) });

        // Compatibilité avec l'ancienne fenêtre de journal : affiche le journal d'audit de la version sécurisée.
    public static DataTable JournalAudit() => Charger(
        "SELECT horodatage AS date_heure, utilisateur, action, rapport_id, COALESCE(ancien_contenu, '') AS detail " +
        "FROM journal_audit ORDER BY id DESC LIMIT 500",
        new[] { "date_heure", "utilisateur", "action", "rapport_id", "detail" },
        new[] { typeof(string), typeof(string), typeof(string), typeof(string), typeof(string) });
public static DataTable ArretsDe(string id) => Charger(
        "SELECT zone, cause, duree_min FROM arret_duree WHERE rapport_id = $id",
        new[] { "zone", "cause", "duree_min" },
        new[] { typeof(string), typeof(string), typeof(long) },
        ("id", id));

    /// <summary>Rapports enregistrés pour le tableau de bord administrateur.</summary>
    public static DataTable RapportsAdmin(DateTime mois, DateTime? jour = null) => Charger(
        "SELECT id, date, quart, equipe, production, kg FROM rapport " +
        "WHERE date >= $debut AND date < $fin AND ($jour IS NULL OR date = $jour) ORDER BY date DESC, quart, equipe",
        new[] { "id", "date", "quart", "equipe", "production", "kg" },
        new[] { typeof(string), typeof(string), typeof(string), typeof(string), typeof(long), typeof(long) },
        ("debut", new DateTime(mois.Year, mois.Month, 1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
        ("fin", new DateTime(mois.Year, mois.Month, 1).AddMonths(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
        ("jour", jour?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)));

    /// <summary>Temps d'arrêt agrégé par zone, quart ou jour.</summary>
    public static DataTable ArretsAdmin(string regroupement, DateTime mois, DateTime? jour = null)
    {
        string groupe = regroupement switch
        {
            // La vue arret_duree est déclarée avec l'alias « d » dans la requête ci-dessous.
            "zone" => "d.zone",
            "quart" => "r.quart",
            "jour" => "r.date",
            _ => throw new ArgumentException("Regroupement inconnu.", nameof(regroupement)),
        };
        return Charger(
            $"SELECT {groupe} AS groupe, SUM(d.duree_min) AS minutes FROM arret_duree d " +
            "JOIN rapport r ON r.id = d.rapport_id " +
            "WHERE r.date >= $debut AND r.date < $fin AND ($jour IS NULL OR r.date = $jour) " +
            "GROUP BY " + groupe + " ORDER BY minutes DESC",
            new[] { "groupe", "minutes" }, new[] { typeof(string), typeof(long) },
            ("debut", new DateTime(mois.Year, mois.Month, 1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
            ("fin", new DateTime(mois.Year, mois.Month, 1).AddMonths(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
            ("jour", jour?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)));
    }

    /// <summary>Détail individuel des arrêts, trié par date puis par quart.</summary>
    public static DataTable ArretsDetailsAdmin(DateTime mois, DateTime? jour = null) => Charger(
        "SELECT r.date, r.quart, r.equipe, a.heure_debut, a.heure_fin, a.zone, " +
        "COALESCE(NULLIF(a.cause, ''), 'Cause non précisée') AS cause, " +
        "CASE WHEN a.heure_fin >= a.heure_debut " +
        "THEN (strftime('%s', a.heure_fin) - strftime('%s', a.heure_debut)) / 60 " +
        "ELSE (strftime('%s', a.heure_fin) - strftime('%s', a.heure_debut)) / 60 + 1440 END AS minutes " +
        "FROM arret a JOIN rapport r ON r.id = a.rapport_id " +
        "WHERE r.date >= $debut AND r.date < $fin AND ($jour IS NULL OR r.date = $jour) " +
        "ORDER BY r.date DESC, r.quart, r.equipe, a.heure_debut, a.heure_fin",
        new[] { "date", "quart", "equipe", "heure_debut", "heure_fin", "zone", "cause", "minutes" },
        new[] { typeof(string), typeof(string), typeof(string), typeof(string), typeof(string), typeof(string), typeof(string), typeof(long) },
        ("debut", new DateTime(mois.Year, mois.Month, 1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
        ("fin", new DateTime(mois.Year, mois.Month, 1).AddMonths(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
        ("jour", jour?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)));

    /// <summary>Production par jour et par équipe pour le mois sélectionné.</summary>
    public static DataTable ProductionMoisAdmin(DateTime mois, DateTime? jour = null) => Charger(
        "SELECT date, equipe, SUM(production) AS production FROM rapport " +
        "WHERE date >= $debut AND date < $fin AND ($jour IS NULL OR date = $jour) GROUP BY date, equipe ORDER BY date, equipe",
        new[] { "date", "equipe", "production" },
        new[] { typeof(string), typeof(string), typeof(long) },
        ("debut", new DateTime(mois.Year, mois.Month, 1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
        ("fin", new DateTime(mois.Year, mois.Month, 1).AddMonths(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
        ("jour", jour?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)));
}


// ===== Texte : construction du rapport à copier =====

public static class Texte
{
    public static string Construire(Rapport r, List<Sechoir> sech, List<Arret> arrets, Dictionary<string, int> gen, List<Arret> marche)
    {
        static string Fonct(int arret) => Config.Hm(Math.Max(Config.DureeQuart - arret, 0));
        static string Ou(string s) => string.IsNullOrWhiteSpace(s) ? "-" : s;
        string Ligne(string nom) => $"{nom} : arrêts {Config.Hm(gen[nom])} | fonctionnement {Fonct(gen[nom])}";

        var L = new List<string>
        {
            "RAPPORT CHEF DE QUART",
            $"{r.Date} - Quart {r.Quart} - Équipe {r.Equipe}",
            $"Chef de quart : {Config.Equipes[r.Equipe]}",
            "=================================================================================",
            $"EFFECTIF : {r.EffectifTotal} | Présent {r.Present} | Absent {r.Absent} | Malade {r.Malade} | Permission {r.Permission} | congé : {r.Conge} ",
            $"ACCIDENT DE TRAVAIL : {r.Accident}",
            "=================================================================================",
        };
        L.Add($"Paniers séchés : {r.PaniersSeches} | Production {r.Production} colis, soit {Config.Milliers(r.Kg)} kg ");
        L.Add($"Poids moyen d'un panier : {Config.Decimal2(Config.PoidsMoyenPanier(r.Production, r.PaniersSeches))} | Poids moyen d'un pain : {Config.Decimal2(Config.PoidsMoyenPanierDiv28(r.Production, r.PaniersSeches))}");
        L.Add($"Box en cours d'usinage : {Ou(r.BoxUsinage)}");
        L.Add($"Paniers granulés : {r.Paniers} | Titre d'acide : {r.TitreAcide} g/l | Conso acide : {r.ConsoAcide} kg");
        L.Add($"Box Prélavé: ({Ou(r.BoxPrelave)}) | {r.Godets} godets | total prélavé {r.TotalPrelave} KG");
        if (r.Godets2 > 0 || !string.IsNullOrWhiteSpace(r.BoxPrelave2))
            L.Add($"2e box prélavé: ({Ou(r.BoxPrelave2)}) | {r.Godets2} godets | total prélavé {r.TotalPrelave2} KG");
        L.Add(Ligne("Ligne 1"));
        L.Add(Ligne("Ligne 2"));
        L.Add($"Avance panier fin : {Ou(r.AvancePanier)} ");
        L.Add($"=================================================================================");

        foreach (var s in sech)
        {
            L.Add($"Séchoir {s.N} : cycle {s.Cycle} sec | brûleurs {s.Bruleur1}/{s.Bruleur2} | arrêt {Config.Hm(s.ArretMin)} | marche {Config.Hm(s.MarcheMin)}");
        }
        L.Add("=================================================================================");
        L.Add($"Balles détectées : début {r.BallesDebut} | Pendant le quart {r.BallesQuart} | Balles traitées {r.BallesTraitees} | Fin de quart {r.BallesFin}");
        L.Add($"Paniers lavés : {Ou(r.PanierLave)}");
        L.Add($"=================================================================================");
        L.Add("LES ARRÊTS DU QUART");
        if (arrets.Count > 0)
        {
            foreach (var a in arrets)
            {
                var cause = string.IsNullOrEmpty(a.Cause) ? "cause non précisée" : a.Cause;
                var zone = string.IsNullOrEmpty(a.Equipement) ? a.Zone : $"{a.Zone} ({a.Equipement})";
                L.Add($"- {zone} | {a.Debut} - {a.Fin} : {cause} | {Config.Hm(a.Minutes)}");
            }
        }
        else
        {
            L.Add("Aucun");
        }
        L.Add($"=================================================================================");
        L.Add($"GÉNÉRATEURS (Fonctionnement)");
        foreach (var g in Config.Generateurs)
        {
            var per = marche.Where(a => a.Zone == g).ToList();
            var detail = per.Count == 0 ? "" : " (démarrage-arrêt : " + string.Join(", ", per.Select(a => $"{a.Debut}-{a.Fin}")) + ")";
            L.Add($"{g} : {Config.Hm(gen[g])}{detail}");
        }
        return string.Join("\n", L);
    }
    
} 
