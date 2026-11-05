using System.Windows.Forms;

namespace RapportQuart;

static class Program
{
    static Mutex _instanceUnique;

    [STAThread]
    static int Main(string[] args)
    {
        // Mode sans fenêtre : RapportQuart.exe /sauvegarde [dossier]  (utilisé par sauvegarder.bat)
        if (args.Length >= 1 && args[0].Equals("/sauvegarde", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                if (!Cle.Charger()) throw new InvalidOperationException("Clé de chiffrement introuvable sur ce PC.");
                Db.Init();
                Db.Sauvegarder(args.Length > 1 ? args[1] : Path.Combine(Db.Dossier, "Sauvegardes"), purger: args.Length <= 1);
                return 0;
            }
            catch (Exception ex)
            {
                Journal.Erreur(ex, "sauvegarde manuelle");
                return 1;
            }
        }

        // Une seule fenêtre par session Windows
        _instanceUnique = new Mutex(true, @"Local\RapportQuart_InstanceUnique", out bool premiere);
        if (!premiere)
        {
            MessageBox.Show("Rapport chef de quart est déjà ouvert.", "Rapport chef de quart",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        ApplicationConfiguration.Initialize();

        // Erreur imprévue : message simple pour l'utilisateur, détail technique dans le journal
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (s, e) =>
        {
            Journal.Erreur(e.Exception, "erreur interface");
            MessageBox.Show("Une erreur inattendue est survenue. Les rapports déjà enregistrés ne sont pas touchés.\n" +
                            "Le détail est dans : " + Journal.Chemin,
                "Rapport chef de quart", MessageBoxButtons.OK, MessageBoxIcon.Error);
        };
        AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            Journal.Erreur(e.ExceptionObject as Exception ?? new Exception("erreur fatale"), "erreur fatale");

        try
        {
            if (!InitialiserCle()) return 0;
            Db.Init();   // chiffre une ancienne base si besoin, vérifie l'intégrité, met à niveau
        }
        catch (Exception ex)
        {
            Journal.Erreur(ex, "ouverture de la base");
            MessageBox.Show("Impossible d'ouvrir la base de données :\n" + ex.Message,
                "Rapport chef de quart", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        // Une sauvegarde automatique par jour (30 dernières conservées)
        try { Db.SauvegarderAuto(); }
        catch (Exception ex) { Journal.Erreur(ex, "sauvegarde automatique"); }

        bool connexionAdmin;
        using (var connexion = new FormConnexion())
        {
            if (connexion.ShowDialog() != DialogResult.OK) return 0;
            connexionAdmin = connexion.EstAdministrateur;
        }

        // Le contexte de session repropose la connexion après une déconnexion d'équipe.
        Application.Run(new RapportApplicationContext(connexionAdmin));
        return 0;
    }

    /// <summary>Charge la clé de chiffrement, la crée à la première installation, ou la demande si elle est perdue.</summary>
    static bool InitialiserCle()
    {
        if (Cle.Charger()) return true;

        bool baseExiste = File.Exists(Db.Chemin) && new FileInfo(Db.Chemin).Length > 0;
        if (!baseExiste || Db.EstEnClair(Db.Chemin))
        {
            // Première installation, ou ancienne base non chiffrée : nouvelle clé, affichée une seule fois
            using var f = new FormCleRecuperation(Cle.Generer());
            f.ShowDialog();
            return true;
        }

        // Base chiffrée présente mais clé introuvable (PC remplacé, cle.dat supprimé) : clé de récupération
        while (true)
        {
            var saisie = Saisie.Demander(null, "Clé de récupération",
                "La clé de chiffrement de cette base est introuvable sur ce PC.\nSaisissez la clé de récupération notée à la première installation :");
            if (saisie == null) return false;
            if (!Cle.TryParse(saisie, out var v))
            {
                MessageBox.Show("Format incorrect : la clé contient 40 caractères (chiffres 0-9 et lettres A-F).",
                    "Rapport chef de quart", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                continue;
            }
            Cle.Valeur = v;
            if (Db.CleValide()) { Cle.Enregistrer(); return true; }
            Cle.Valeur = null;
            MessageBox.Show("Cette clé ne correspond pas à la base de données.",
                "Rapport chef de quart", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}

/// <summary>Enchaîne les sessions d'équipe sans arrêter le processus de l'application.</summary>
sealed class RapportApplicationContext : ApplicationContext
{
    public RapportApplicationContext(bool administrateur)
    {
        MainForm = administrateur ? new TableauBordAdmin() : new FormPrincipal();
        AfficherFenetrePrincipale();
    }

    void AfficherConnexion()
    {
        bool administrateur;
        using (var connexion = new FormConnexion())
        {
            connexion.Shown += (s, e) => { connexion.Activate(); connexion.BringToFront(); };
            if (connexion.ShowDialog() != DialogResult.OK)
            {
                ExitThread();
                return;
            }
            administrateur = connexion.EstAdministrateur;
        }

        // Ne pas activer la nouvelle fenêtre tant que la boîte modale existe encore.
        MainForm = administrateur ? new TableauBordAdmin() : new FormPrincipal();
        AfficherFenetrePrincipale();
    }

    void AfficherFenetrePrincipale()
    {
        if (MainForm == null || MainForm.IsDisposed) return;
        if (MainForm.WindowState == FormWindowState.Minimized)
            MainForm.WindowState = FormWindowState.Normal;
        if (!MainForm.Visible) MainForm.Show();
        MainForm.BringToFront();
        MainForm.Activate();
    }

    protected override void OnMainFormClosed(object sender, EventArgs e)
    {
        if (sender is FormPrincipal f && f.DeconnexionDemandee
            || sender is TableauBordAdmin admin && admin.DeconnexionDemandee)
        {
            MainForm = null;
            AfficherConnexion();
            return;
        }
        base.OnMainFormClosed(sender, e);
    }
}
