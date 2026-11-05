namespace RapportQuart;

/// <summary>Journal des erreurs (ProgramData\RapportQuart\journal.log) : les détails techniques restent ici, pas à l'écran.</summary>
public static class Journal
{
    static readonly object Verrou = new();

    public static string Chemin => Path.Combine(Db.Dossier, "journal.log");

    public static void Info(string texte) => Ecrire("INFO", texte);

    public static void Erreur(Exception ex, string contexte = null) =>
        Ecrire("ERREUR", (contexte != null ? contexte + " | " : "") + ex);

    static void Ecrire(string niveau, string texte)
    {
        try
        {
            lock (Verrou)
            {
                Directory.CreateDirectory(Db.Dossier);
                var fi = new FileInfo(Chemin);
                if (fi.Exists && fi.Length > 1_000_000) File.Move(Chemin, Chemin + ".old", true);   // le journal ne grossit pas indéfiniment
                File.AppendAllText(Chemin,
                    $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{Environment.UserName}@{Environment.MachineName}] {niveau} {texte}{Environment.NewLine}");
            }
        }
        catch
        {
            // un problème de journal ne doit jamais bloquer l'application
        }
    }
}

public static class Securite
{
    /// <summary>
    /// Empêche l'« injection de formule » : un texte qui commence par = + - @ serait exécuté comme une formule par Excel.
    /// L'apostrophe devant force Excel à le traiter comme du texte simple.
    /// </summary>
    public static string Neutraliser(string s)
    {
        if (string.IsNullOrEmpty(s)) return s ?? "";
        return s[0] is '=' or '+' or '-' or '@' or '\t' or '\r' ? "'" + s : s;
    }
}

/// <summary>Clé SQLCipher protégée par DPAPI sur cet ordinateur.</summary>
public static class Cle
{
    static readonly byte[] Entropie = System.Text.Encoding.UTF8.GetBytes("RapportQuart.Cle.v1");
    static string Chemin => Path.Combine(Db.Dossier, "cle.dat");

    public static string Valeur { get; set; }

    public static bool Charger()
    {
        try
        {
            if (!File.Exists(Chemin)) return false;
            var claire = System.Security.Cryptography.ProtectedData.Unprotect(
                File.ReadAllBytes(Chemin), Entropie, System.Security.Cryptography.DataProtectionScope.LocalMachine);
            var texte = System.Text.Encoding.UTF8.GetString(claire);
            if (!TryParse(texte, out var cle)) return false;
            Valeur = cle;
            return true;
        }
        catch { Valeur = null; return false; }
    }

    public static string Generer()
    {
        Valeur = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(20));
        Enregistrer();
        return Valeur;
    }

    public static void Enregistrer()
    {
        if (!TryParse(Valeur, out var cle)) throw new InvalidOperationException("Clé de chiffrement invalide.");
        Directory.CreateDirectory(Db.Dossier);
        var protegee = System.Security.Cryptography.ProtectedData.Protect(
            System.Text.Encoding.UTF8.GetBytes(cle), Entropie, System.Security.Cryptography.DataProtectionScope.LocalMachine);
        var temporaire = Chemin + ".tmp";
        File.WriteAllBytes(temporaire, protegee);
        File.Move(temporaire, Chemin, true);
        Valeur = cle;
    }

    public static bool TryParse(string texte, out string cle)
    {
        cle = null;
        texte = (texte ?? "").Trim().Replace("-", "").Replace(" ", "").ToUpperInvariant();
        if (texte.Length != 40 || texte.Any(c => !Uri.IsHexDigit(c))) return false;
        cle = texte;
        return true;
    }
}

/// <summary>Mots de passe des équipes, hachés avec PBKDF2 et verrouillage temporaire après échecs.</summary>
public static class Acces
{
    public const int MinCar = 8;
    const int Iterations = 310_000;
    const int EchecsAvantBlocage = 5;
    static readonly TimeSpan DureeBlocage = TimeSpan.FromMinutes(15);
    public enum Resultat { Ok, Echec, Bloque }

    public static bool MotDePasseDefini(string code)
    {
        using var con = Db.Ouvrir();
        using var cmd = con.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM equipe_acces WHERE code = $code AND hash IS NOT NULL AND sel IS NOT NULL";
        cmd.Parameters.AddWithValue("$code", code);
        return Convert.ToInt32(cmd.ExecuteScalar()) > 0;
    }

    public static string Valider(string motDePasse)
    {
        if (string.IsNullOrWhiteSpace(motDePasse) || motDePasse.Length < MinCar)
            return $"Le mot de passe doit contenir au moins {MinCar} caractères.";
        if (motDePasse.Length > 64) return "Le mot de passe ne peut pas dépasser 64 caractères.";
        if (motDePasse.Any(char.IsControl)) return "Le mot de passe contient un caractère non autorisé.";
        return null;
    }

    public static void Definir(string code, string motDePasse)
    {
        var erreur = Valider(motDePasse);
        if (erreur != null) throw new ArgumentException(erreur, nameof(motDePasse));
        var sel = System.Security.Cryptography.RandomNumberGenerator.GetBytes(16);
        var hash = Hacher(motDePasse, sel, Iterations);
        using var con = Db.Ouvrir();
        using var cmd = con.CreateCommand();
        cmd.CommandText = "INSERT INTO equipe_acces(code, sel, hash, iterations, echecs, bloque_jusqua) " +
                          "VALUES($code, $sel, $hash, $iterations, 0, NULL) " +
                          "ON CONFLICT(code) DO UPDATE SET sel=$sel, hash=$hash, iterations=$iterations, echecs=0, bloque_jusqua=NULL";
        cmd.Parameters.AddWithValue("$code", code);
        cmd.Parameters.AddWithValue("$sel", sel);
        cmd.Parameters.AddWithValue("$hash", hash);
        cmd.Parameters.AddWithValue("$iterations", Iterations);
        cmd.ExecuteNonQuery();
    }

    public static Resultat Verifier(string code, string motDePasse, out string message)
    {
        message = "Mot de passe incorrect.";
        byte[] sel, hashAttendu;
        int iterations, echecs;
        string bloqueJusqua;
        using (var con = Db.Ouvrir())
        using (var cmd = con.CreateCommand())
        {
            cmd.CommandText = "SELECT sel, hash, iterations, echecs, bloque_jusqua FROM equipe_acces WHERE code=$code";
            cmd.Parameters.AddWithValue("$code", code);
            using var rd = cmd.ExecuteReader();
            if (!rd.Read() || rd.IsDBNull(0) || rd.IsDBNull(1)) return Resultat.Echec;
            sel = (byte[])rd[0]; hashAttendu = (byte[])rd[1];
            iterations = rd.IsDBNull(2) ? Iterations : rd.GetInt32(2);
            echecs = rd.IsDBNull(3) ? 0 : rd.GetInt32(3);
            bloqueJusqua = rd.IsDBNull(4) ? null : rd.GetString(4);
        }
        if (DateTime.TryParse(bloqueJusqua, null, System.Globalization.DateTimeStyles.RoundtripKind, out var limite) && limite > DateTime.UtcNow)
        {
            message = $"Trop de tentatives. Réessayez après {limite.ToLocalTime():HH:mm}.";
            return Resultat.Bloque;
        }

        var valide = iterations >= 100_000 && iterations <= 1_000_000 &&
            System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(Hacher(motDePasse ?? "", sel, iterations), hashAttendu);
        using (var con = Db.Ouvrir())
        using (var cmd = con.CreateCommand())
        {
            if (valide)
            {
                cmd.CommandText = "UPDATE equipe_acces SET echecs=0, bloque_jusqua=NULL WHERE code=$code";
                message = "";
            }
            else
            {
                echecs++;
                var bloque = echecs >= EchecsAvantBlocage ? DateTime.UtcNow.Add(DureeBlocage).ToString("O") : null;
                cmd.CommandText = "UPDATE equipe_acces SET echecs=$echecs, bloque_jusqua=$bloque WHERE code=$code";
                cmd.Parameters.AddWithValue("$echecs", echecs);
                cmd.Parameters.AddWithValue("$bloque", (object)bloque ?? DBNull.Value);
                if (bloque != null) message = "Trop de tentatives. Réessayez dans 15 minutes.";
            }
            cmd.Parameters.AddWithValue("$code", code);
            cmd.ExecuteNonQuery();
        }
        return valide ? Resultat.Ok : Resultat.Echec;
    }

    public static bool MotDePasseAdminDefini()
    {
        using var con = Db.Ouvrir();
        using var cmd = con.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM administrateur_acces WHERE id=1 AND hash IS NOT NULL AND sel IS NOT NULL";
        return Convert.ToInt32(cmd.ExecuteScalar()) > 0;
    }

    public static void DefinirAdmin(string motDePasse)
    {
        var erreur = Valider(motDePasse);
        if (erreur != null) throw new ArgumentException(erreur, nameof(motDePasse));
        var sel = System.Security.Cryptography.RandomNumberGenerator.GetBytes(16);
        var hash = Hacher(motDePasse, sel, Iterations);
        using var con = Db.Ouvrir();
        using var cmd = con.CreateCommand();
        cmd.CommandText = "INSERT INTO administrateur_acces(id,sel,hash,iterations,echecs,bloque_jusqua) " +
                          "VALUES(1,$sel,$hash,$iterations,0,NULL) " +
                          "ON CONFLICT(id) DO UPDATE SET sel=$sel,hash=$hash,iterations=$iterations,echecs=0,bloque_jusqua=NULL";
        cmd.Parameters.AddWithValue("$sel", sel);
        cmd.Parameters.AddWithValue("$hash", hash);
        cmd.Parameters.AddWithValue("$iterations", Iterations);
        cmd.ExecuteNonQuery();
    }

    public static Resultat VerifierAdmin(string motDePasse, out string message)
    {
        message = "Mot de passe administrateur incorrect.";
        byte[] sel, hashAttendu;
        int iterations, echecs;
        string bloqueJusqua;
        using (var con = Db.Ouvrir())
        using (var cmd = con.CreateCommand())
        {
            cmd.CommandText = "SELECT sel,hash,iterations,echecs,bloque_jusqua FROM administrateur_acces WHERE id=1";
            using var rd = cmd.ExecuteReader();
            if (!rd.Read()) return Resultat.Echec;
            sel = (byte[])rd[0]; hashAttendu = (byte[])rd[1];
            iterations = rd.GetInt32(2); echecs = rd.GetInt32(3);
            bloqueJusqua = rd.IsDBNull(4) ? null : rd.GetString(4);
        }
        if (DateTime.TryParse(bloqueJusqua, null, System.Globalization.DateTimeStyles.RoundtripKind, out var limite) && limite > DateTime.UtcNow)
        {
            message = $"Trop de tentatives. Réessayez après {limite.ToLocalTime():HH:mm}.";
            return Resultat.Bloque;
        }
        var valide = iterations >= 100_000 && iterations <= 1_000_000 &&
            System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(Hacher(motDePasse ?? "", sel, iterations), hashAttendu);
        using (var con = Db.Ouvrir())
        using (var cmd = con.CreateCommand())
        {
            if (valide)
            {
                cmd.CommandText = "UPDATE administrateur_acces SET echecs=0,bloque_jusqua=NULL WHERE id=1";
                message = "";
            }
            else
            {
                echecs++;
                var bloque = echecs >= EchecsAvantBlocage ? DateTime.UtcNow.Add(DureeBlocage).ToString("O") : null;
                cmd.CommandText = "UPDATE administrateur_acces SET echecs=$echecs,bloque_jusqua=$bloque WHERE id=1";
                cmd.Parameters.AddWithValue("$echecs", echecs);
                cmd.Parameters.AddWithValue("$bloque", (object)bloque ?? DBNull.Value);
                if (bloque != null) message = "Trop de tentatives. Réessayez dans 15 minutes.";
            }
            cmd.ExecuteNonQuery();
        }
        return valide ? Resultat.Ok : Resultat.Echec;
    }

    public static bool CleRecuperationOk(string saisie) =>
        Cle.TryParse(saisie, out var cle) && !string.IsNullOrEmpty(Cle.Valeur) &&
        System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.ASCII.GetBytes(cle), System.Text.Encoding.ASCII.GetBytes(Cle.Valeur));

    static byte[] Hacher(string texte, byte[] sel, int iterations) =>
        System.Security.Cryptography.Rfc2898DeriveBytes.Pbkdf2(
            System.Text.Encoding.UTF8.GetBytes(texte), sel, iterations,
            System.Security.Cryptography.HashAlgorithmName.SHA256, 32);
}