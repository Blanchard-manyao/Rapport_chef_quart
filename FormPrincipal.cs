using System.Data;
using System.Drawing;
using System.Globalization;
using System.Windows.Forms;

namespace RapportQuart;

public class FormPrincipal : Form, IMessageFilter
{
    // ---------- Quart ----------
    readonly DateTimePicker dtDate = new() { Format = DateTimePickerFormat.Short, Value = DateTime.Today };
    readonly ComboBox cbQuart = Combo(Config.Quarts);
    readonly ComboBox cbEquipe = Combo(Config.Equipes.Keys.ToArray());
    readonly TextBox tbChef = Lecture();
    readonly Label lblAvert = new()
    {
        AutoSize = true, ForeColor = Theme.Alerte, Visible = false,
        Text = "Rapport déjà enregistré : il est affiché ci-dessous. Enregistrer le remplacera.",
    };

    // ---------- Effectif ----------
    readonly NumericUpDown nEffectif = Num(), nAbsent = Num(), nMalade = Num(), nPermission = Num(), nConge = Num();
    readonly TextBox tbPresent = Lecture();
    readonly Label lblEffectif = new()
    {
        AutoSize = true, ForeColor = Theme.Danger, Visible = false,
        Text = "Les absents, malades, permissions et congés dépassent l'effectif total.",
    };
    readonly NumericUpDown nAccident = Num();

    // ---------- Prélavage ----------
    readonly TextBox tbBoxPrelave = new();
    readonly NumericUpDown nGodets = Num(0, 99999);
    readonly TextBox tbTotalPrelave = Lecture();

    // 2e box prélavé : ajouté à la main quand deux box différents sont prélavés pendant le quart
    readonly TextBox tbBoxPrelave2 = new();
    readonly NumericUpDown nGodets2 = Num(0, 99999);
    readonly TextBox tbTotalPrelave2 = Lecture();
    readonly Button btnAjoutBox2 = new() { Text = "+ Ajouter un 2iem box prélavé", Size = new Size(500, 32), Margin = new Padding(0, 4, 0, 8) };
    readonly Button btnRetraitBox2 = new() { Text = "Retirer ce box", Size = new Size(250, 32), Margin = new Padding(8, 18, 0, 0) };
    readonly FlowLayoutPanel ligneBox2 = new() { AutoSize = true, WrapContents = false, Visible = false, Margin = Padding.Empty };
    readonly BlocArrets arrPrelavage = new("Prélavage");

    // ---------- Granulation ----------
    readonly TextBox tbBoxUsinage = new();
    readonly NumericUpDown nTitre = Num(1), nConsoAcide = Num(1);
    readonly NumericUpDown nPaniers = Num(0, 999);
    readonly BlocArrets arrL1 = new("Ligne 1"), arrL2 = new("Ligne 2");
    readonly TextBox tbAvance = new(), tbLave = new();

    // ---------- Séchoirs ----------
    readonly NumericUpDown nPaniersSeches = Num(0, 999);   // 3 chiffres max
    readonly TextBox tbPoidsMoyen = Lecture(), tbPoidsMoyen28 = Lecture();
    readonly NumericUpDown[] nCycle = { Num(0, 999), Num(0, 999), Num(0, 999) };
    readonly NumericUpDown[] nB1 = { Num(0, 999), Num(0, 999), Num(0, 999) };
    readonly NumericUpDown[] nB2 = { Num(0, 999), Num(0, 999), Num(0, 999) };
    readonly TextBox[] tbCompteur = { new(), new(), new() };   // saisie conservée telle quelle
    
    // compteur Gaz à deux valeurs : saisie conservée telle quelle (aucun arrondi)
    readonly TextBox[] tbGaz = { new(), new(), new() };
    readonly TextBox[] tbGaz2 = { new(), new(), new() };
    readonly BlocArrets[] arrSech =
    {
        new BlocArrets("Séchoir 1"), new BlocArrets("Séchoir 2"), new BlocArrets("Séchoir 3"),
    };

    // ---------- Conditionnement ----------
    readonly NumericUpDown nProduction = Num(0, 99999);
    readonly TextBox tbKg = Lecture();
    readonly NumericUpDown nBallesDebut = Num(), nBallesQuart = Num(), nBallesTraitees = Num(), nBallesFin = Num();
    readonly BlocArrets arrCond = new("Conditionnement");

    // ---------- Générateurs / autres ----------
    readonly BlocArrets arrGe2500 = new("GE 2500 KVA", false, true), arrGe2000 = new("GE 2000 KVA", false, true);
    readonly BlocArrets arrAutres = new("Autre", true);

    // ---------- Sortie ----------
    readonly TextBox tbRapport = new()
    {
        Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
        Font = new Font("Consolas", 9.5f), Width = 840, Height = 420,
    };
    readonly Button btnEnreg = new() { Text = "Enregistrer le rapport", Width = 210, Height = 38 };
    readonly Button btnCopier = new() { Text = "Copier le rapport", Width = 210, Height = 38 };
    readonly Label lblStatut = new() { AutoSize = true, ForeColor = Theme.Succes, Margin = new Padding(12, 12, 0, 0) };
    readonly Panel scroll = new PanelDefilement { Dock = DockStyle.Fill, AutoScroll = true };
    readonly FlowLayoutPanel page = new FlowDouble
    {
        FlowDirection = FlowDirection.TopDown,
        WrapContents = false,
        AutoSize = true,
        Location = new Point(0, 0),
    };

    // ---------- Historique ----------
    readonly DateTimePicker dtFiltre = new() { Format = DateTimePickerFormat.Short, ShowCheckBox = true, Checked = false };
    readonly CheckedListBox clbQuart = new() { CheckOnClick = true, Height = 70, Width = 150 };
    readonly CheckedListBox clbEquipe = new() { CheckOnClick = true, Height = 90, Width = 90 };
    readonly Label lblTotalHisto = new() { AutoSize = true, Font = Theme.PoliceGras, ForeColor = Theme.Texte };
    readonly DataGridView gridHisto = new();
    readonly DataGridView gridArretsHisto = new();
    readonly Button btnExcel = new() { Text = "Exporter sur Excel", Width = 250, Height = 36, Margin = new Padding(10, 16, 0, 0), Visible = false };
    readonly Button btnJournal = new() { Text = "Journal", Width = 110, Height = 36, Margin = new Padding(10, 16, 0, 0), Visible = false };
    readonly ToolStripMenuItem menuModeAdmin = new("Acces administrateur");
    DataTable _histo;
    bool _modeAdmin;

    // ---------- Navigation ----------
    readonly Panel pageRapport = new() { Dock = DockStyle.Fill, BackColor = Theme.Fond, Padding = new Padding(16, 12, 16, 8) };
    readonly Panel pageHisto = new() { Dock = DockStyle.Fill, BackColor = Theme.Fond, Padding = new Padding(16) };
    readonly Button navRapport = new() { Text = "Nouveau rapport", Size = new Size(170, 38), Location = new Point(330, 19) };
    readonly Button navHisto = new() { Text = "Historique", Size = new Size(140, 38), Location = new Point(560, 19) };
    readonly Button navAdmin = new() { Text = "Tableau administrateur", Size = new Size(165, 38), Location = new Point(725, 19), Visible = false };
    readonly Button navEquipe = new() { Size = new Size(190, 38), Location = new Point(900, 19) };

    readonly Button btnDeverrouiller = new() { Text = "Déverrouiller (administrateur)", Size = new Size(260, 32), Visible = false, Margin = new Padding(8, 18, 0, 0) };
    readonly List<Control> _saisies = new();   // champs de saisie à passer en lecture seule quand le rapport est verrouillé
    bool _verrouille, _verrouAffiche;          // délai de modification dépassé
    DateTime? _limite;                         // date de verrouillage du rapport affiché
    string _idDeverrouille;                    // rapport déverrouillé par l’administrateur (cette session)

    bool _calc;
    string _idVerifie;
    bool _existe;
    bool _charge;   // le formulaire affiche un rapport relu dans la base
    bool _consultationAdmin;

    public bool DeconnexionDemandee { get; private set; }

    public FormPrincipal()
    {
        Text = "RAPPORT CHEF DE QUART";
        Font = Theme.Police;
        BackColor = Theme.Fond;
        Width = 1100;
        Height = 1040;
        StartPosition = FormStartPosition.CenterScreen;
        FormClosing += (s, e) =>
        {
            if (DeconnexionDemandee || _consultationAdmin) return;
            var choix = MessageBox.Show(this,
                "Voulez-vous vraiment fermer l'application ? Les donn\u00e9es non enregistr\u00e9es seront perdues.",
                "Confirmer la fermeture", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (choix != DialogResult.Yes) e.Cancel = true;
        };

        // Icône de la fenêtre et de la barre des tâches : exat_agri_fb.ico (intégrée à l'exe)
        using (var flux = typeof(FormPrincipal).Assembly.GetManifestResourceStream("icone.ico"))
            if (flux != null) Icon = new Icon(flux);

        cbQuart.SelectedIndex = 2;   // 23h-07h par défaut
        cbEquipe.SelectedItem = Db.EquipeConnectee ?? Config.Equipes.Keys.First();
        lblAvert.MaximumSize = new Size(780, 0);
        cbEquipe.Enabled = false;   // l'équipe est celle du mot de passe saisi à la connexion

        // Bandeau du haut : titre + boutons de navigation
        var entete = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Entete, Margin = Padding.Empty };
        entete.Controls.Add(new Label
        {
            Text = "Rapport chef de quart", AutoSize = true, ForeColor = Color.White,
            Font = new Font("Segoe UI Semibold", 15f), Location = new Point(20, 8),
        });
        entete.Controls.Add(new Label
        {
            Text = "USINE MISSEHI", AutoSize = true, ForeColor = Color.FromArgb(226, 232, 240),
            Font = new Font("Segoe UI Semibold", 11f), Location = new Point(22, 44),
        });
        entete.Controls.Add(navRapport);
        entete.Controls.Add(navHisto);
        entete.Controls.Add(navAdmin);
        navEquipe.Text = $"Équipe {Db.EquipeConnectee}  ▾";
        StyleNav(navEquipe, false);
        entete.Controls.Add(navEquipe);
        var menuEquipe = new ContextMenuStrip { Font = Theme.Police };
        menuEquipe.Items.Add("Changer d'équipe", null, (s, e) => ChangerEquipe());
        menuEquipe.Items.Add("Changer le mot de passe", null, (s, e) => ChangerMotDePasse());
        menuEquipe.Items.Add("Déconnecter", null, (s, e) => Deconnecter());
        menuEquipe.Items.Add(new ToolStripSeparator());
        menuModeAdmin.Click += (s, e) => BasculerModeAdministrateur();
        menuEquipe.Items.Add(menuModeAdmin);
        navEquipe.Click += (s, e) => menuEquipe.Show(navEquipe, new Point(0, navEquipe.Height));
        navAdmin.Click += (s, e) => OuvrirTableauAdministrateur();

        var contenu = new Panel { Dock = DockStyle.Fill, Margin = Padding.Empty };
        contenu.Controls.Add(pageRapport);
        contenu.Controls.Add(pageHisto);

        var racine = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
        racine.RowStyles.Add(new RowStyle(SizeType.Absolute, 78));
        racine.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        racine.Controls.Add(entete, 0, 0);
        racine.Controls.Add(contenu, 0, 1);
        Controls.Add(racine);

        ConstruireRapport(pageRapport);
        foreach (var tb in tbCompteur.Concat(tbGaz).Concat(tbGaz2))
        {
            tb.MaxLength = 20;
            tb.KeyPress += (s, e) =>
            {
                if (!char.IsControl(e.KeyChar) && !char.IsDigit(e.KeyChar) && e.KeyChar != ',' && e.KeyChar != '.')
                    e.Handled = true;   // chiffres, virgule et point seulement
            };
        }
        // Longueur maximale des champs texte libres (évite les saisies démesurées)
        foreach (var tb in new[] { tbBoxPrelave, tbBoxPrelave2, tbBoxUsinage, tbAvance, tbLave })
            tb.MaxLength = 100;
        ConstruireHistorique(pageHisto);
        Brancher(pageRapport);
        Theme.Appliquer(pageRapport);
        Theme.Appliquer(pageHisto);

        navRapport.Click += (s, e) => Afficher(false);
        navHisto.Click += (s, e) => Afficher(true);
        Afficher(false);

        CollecterSaisies(pageRapport);
        Recalculer();
    }

    /// <summary>Ouvre le formulaire complet d'un rapport enregistré en lecture seule, pour l'administrateur.</summary>
    public FormPrincipal(string idRapport) : this()
    {
        var rapport = Db.Lire(idRapport) ?? throw new InvalidOperationException("Le rapport sélectionné n'existe plus dans la base.");
        _consultationAdmin = true;
        Text = $"Consultation du rapport - {rapport.R.Date} - {rapport.R.Quart} - Équipe {rapport.R.Equipe}";
        _calc = true;
        try
        {
            dtDate.Value = DateTime.ParseExact(rapport.R.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            cbQuart.SelectedItem = rapport.R.Quart;
            cbEquipe.SelectedItem = rapport.R.Equipe;
            Remplir(rapport);
            _idVerifie = rapport.R.Id;
            _charge = true;
            _existe = true;
        }
        finally { _calc = false; }

        Recalculer();
        dtDate.Enabled = cbQuart.Enabled = cbEquipe.Enabled = false;
        btnEnreg.Enabled = false;
        btnDeverrouiller.Visible = false;
        navRapport.Visible = navHisto.Visible = navAdmin.Visible = navEquipe.Visible = false;
        AppliquerVerrou(true);
        StartPosition = FormStartPosition.CenterParent;
        ShowInTaskbar = false;
    }

    /// <summary>Reconnexion avec une autre équipe : le formulaire non enregistré est vidé.</summary>
    void ChangerEquipe()
    {
        var rep = MessageBox.Show("Changer d'équipe ?\nLes données saisies et non enregistrées seront effacées.",
            "Changer d'équipe", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (rep != DialogResult.Yes) return;

        using var f = new FormConnexion();
        if (f.ShowDialog(this) != DialogResult.OK) return;

        _calc = true;
        try { Remplir(new RapportComplet()); _charge = false; }
        finally { _calc = false; }
        _idVerifie = null;
        _modeAdmin = false;
        ActualiserModeAdministrateur();
        cbEquipe.SelectedItem = Db.EquipeConnectee;
        navEquipe.Text = $"Équipe {Db.EquipeConnectee}  ▾";
        lblStatut.Text = "";
        Afficher(false);
        Recalculer();
    }

    void BasculerModeAdministrateur()
    {
        if (_modeAdmin)
        {
            _modeAdmin = false;
            Journal.Info("Session administrateur fermee");
        }
        else
        {
            if (!FormAccesAdministrateur.Autoriser(this)) return;
            _modeAdmin = true;
            Journal.Info("Session administrateur ouverte");
        }
        ActualiserModeAdministrateur();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        BringToFront();
        Activate();
    }

    void ActualiserModeAdministrateur()
    {
        btnExcel.Visible = _modeAdmin;
        btnJournal.Visible = _modeAdmin;
        navAdmin.Visible = _modeAdmin;
        menuModeAdmin.Text = _modeAdmin ? "Quitter le mode administrateur" : "Acces administrateur";
        navEquipe.Text = $"Équipe {Db.EquipeConnectee}{(_modeAdmin ? " - Administrateur" : "")}  ▾";
    }

    void Deconnecter()
    {
        var choix = MessageBox.Show(this,
            "Voulez-vous vous déconnecter de cette équipe ? Les données non enregistrées seront perdues.",
            "Déconnexion", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (choix != DialogResult.Yes) return;
        if (_modeAdmin) Journal.Info("Session administrateur fermee");
        Journal.Info($"Déconnexion de l'équipe {Db.EquipeConnectee}");
        Db.EquipeConnectee = null;
        DeconnexionDemandee = true;
        Close();
    }

    void OuvrirTableauAdministrateur()
    {
        if (!_modeAdmin) return;
        using var f = new TableauBordAdmin();
        f.ShowDialog(this);
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        BringToFront();
        Activate();
    }

    void ChangerMotDePasse()
    {
        using var f = new FormChangerMdp(Db.EquipeConnectee);
        if (f.ShowDialog(this) == DialogResult.OK)
        {
            lblStatut.ForeColor = Theme.Succes;
            lblStatut.Text = "Mot de passe modifié.";
        }
    }

    /// <summary>Repère les champs de saisie (hors date, quart et équipe) pour pouvoir les verrouiller.</summary>
    void CollecterSaisies(Control parent)
    {
        foreach (Control x in parent.Controls)
        {
            if (x == dtDate || x == cbQuart || x == cbEquipe || x == tbRapport) continue;
            switch (x)
            {
                case BlocArrets: _saisies.Add(x); break;
                case NumericUpDown: _saisies.Add(x); break;
                case TextBox t when !t.ReadOnly: _saisies.Add(x); break;
                case Button b when b == btnAjoutBox2 || b == btnRetraitBox2: _saisies.Add(x); break;
            }
            if (x is Panel) CollecterSaisies(x);
        }
    }

    void AppliquerVerrou(bool verrouille)
    {
        foreach (var c in _saisies)
        {
            switch (c)
            {
                case BlocArrets b: b.Verrouiller(verrouille); break;
                case NumericUpDown n: n.ReadOnly = verrouille; break;
                case TextBox t: t.ReadOnly = verrouille; break;
                case Button bt: bt.Enabled = !verrouille; break;
            }
        }
    }

    /// <summary>Seul l'administrateur peut rouvrir un rapport verrouille.</summary>
    void Deverrouiller()
    {
        if (!_modeAdmin && !FormAccesAdministrateur.Autoriser(this)) return;
        if (!_modeAdmin) { _modeAdmin = true; ActualiserModeAdministrateur(); }
        Journal.Info($"Rapport deverrouille par administrateur : {_idVerifie}");
        _idDeverrouille = _idVerifie;
        _verrouille = false;
        Recalculer();
    }

    static void StyleNav(Button b, bool actif)
    {
        b.UseVisualStyleBackColor = false;
        b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderSize = 0;
        b.Cursor = Cursors.Hand;
        b.Font = Theme.PoliceGras;
        b.BackColor = actif ? Theme.Accent : Theme.Entete;
        b.ForeColor = actif ? Color.White : Color.FromArgb(203, 213, 225);
        b.FlatAppearance.MouseOverBackColor = actif ? Theme.AccentFonce : Color.FromArgb(30, 41, 59);
    }

    void Afficher(bool historique)
    {
        pageRapport.Visible = !historique;
        pageHisto.Visible = historique;
        StyleNav(navRapport, !historique);
        StyleNav(navHisto, historique);
        if (historique) ChargerHistorique();
    }

    /// <summary>Adapte la fenêtre à la taille réelle de l'écran (zone utile, sans la barre des tâches).</summary>
    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        var zone = Screen.FromControl(this).WorkingArea;
        Width = Math.Min(Width, zone.Width);
        Height = Math.Min(Height, zone.Height);
        Location = new Point(zone.Left + (zone.Width - Width) / 2, zone.Top + (zone.Height - Height) / 2);
    }

    // =====================================================================
    // Fabrique de contrôles
    // =====================================================================
    static ChampNum Num(int decimales = 0, decimal max = 9999999) => new()
    {
        Maximum = max,
        DecimalPlaces = decimales,
        Increment = decimales == 0 ? 1m : 0.1m,
    };

    static ComboBox Combo(string[] items)
    {
        var c = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList };
        c.Items.AddRange(items);
        return c;
    }

    static TextBox Lecture() => new() { ReadOnly = true, BackColor = SystemColors.Control };

    /// <summary>Deux compteurs Gaz à 2 valeurs de 8 chiffres au plus, séparés par « / ».</summary>
    static Control Paire(TextBox a, TextBox b)
    {
        var p = new Panel { Size = new Size(290, 26) };
        a.Width = 124; a.Location = new Point(0, 0);
        b.Width = 124; b.Location = new Point(166, 0);
        p.Controls.Add(a);
        p.Controls.Add(new Label { Text = "/", AutoSize = true, Location = new Point(138, 3) });
        p.Controls.Add(b);
        return p;
    }

    static Control Champ(string libelle, Control c, int largeur = 120)
    {
        int w = TextRenderer.MeasureText(libelle, Theme.Police).Width;
        c.Width = largeur;
        c.Location = new Point(0, 20);
        var p = new Panel { Size = new Size(Math.Max(largeur, w) + 10, 50), Margin = new Padding(0, 0, 8, 4) };
        p.Controls.Add(new Label { Text = libelle, AutoSize = true, ForeColor = Theme.TexteDoux, Location = new Point(0, 0) });
        p.Controls.Add(c);
        return p;
    }

    static Carte Section(string titre, params Control[] enfants)
    {
        var flow = new FlowLayoutPanel
        {
            AutoSize = true,
            MaximumSize = new Size(850, 0),
            Location = new Point(18, 44),
            WrapContents = true,
            FlowDirection = FlowDirection.LeftToRight,
        };
        flow.Controls.AddRange(enfants);
        foreach (var c in enfants)
            if (c.Tag is "saut") flow.SetFlowBreak(c, true);   // ce bloc occupe sa propre ligne
        var g = new Carte(titre) { MinimumSize = new Size(880, 0) };
        g.Controls.Add(flow);
        return g;
    }

    // =====================================================================
    // Onglet "Nouveau rapport"
    // =====================================================================
    void ConstruireRapport(Control tp)
    {
        page.Controls.Add(Section("QUART",
            Champ("Date", dtDate, 120),
            Champ("Quart", cbQuart, 100),
            Champ("Équipe", cbEquipe, 70),
            Champ("Chef de quart", tbChef, 220),
            lblAvert, btnDeverrouiller));

        page.Controls.Add(Section("EFFECTIF",
            Champ("Effectif total", nEffectif, 100),
            Champ("Absent", nAbsent, 80),
            Champ("Malade", nMalade, 80),
            Champ("Permission", nPermission, 80),
            Champ("Congé", nConge, 80),
            Champ("Effectif présent ", tbPresent, 150),
            Champ("Accident de travail ", nAccident, 150),
            lblEffectif));

        // PRÉLAVAGE : un 1er box, et un 2e box que l'utilisateur ajoute à la main (bouton +)
        var ligneBox1 = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = Padding.Empty, Tag = "saut" };
        ligneBox1.Controls.Add(Champ("Box prélavé", tbBoxPrelave, 200));
        ligneBox1.Controls.Add(Champ("Nombre de godets", nGodets, 120));
        ligneBox1.Controls.Add(Champ("Total prélavé (kg)", tbTotalPrelave, 200));

        ligneBox2.Controls.Add(Champ("2e box prélavé", tbBoxPrelave2, 200));
        ligneBox2.Controls.Add(Champ("Nombre de godets", nGodets2, 120));
        ligneBox2.Controls.Add(Champ("Total prélavé (kg)", tbTotalPrelave2, 200));
        ligneBox2.Controls.Add(btnRetraitBox2);
        var zoneBox2 = new FlowLayoutPanel
        {
            AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false,
            Margin = Padding.Empty, Tag = "saut",
        };
        zoneBox2.Controls.Add(ligneBox2);
        zoneBox2.Controls.Add(btnAjoutBox2);
        Theme.Bouton(btnAjoutBox2, false);
        Theme.Bouton(btnRetraitBox2, false);
        btnAjoutBox2.Click += (s, e) => { MontrerBox2(true); tbBoxPrelave2.Focus(); };
        btnRetraitBox2.Click += (s, e) => { tbBoxPrelave2.Text = ""; nGodets2.Value = 0; MontrerBox2(false); };

        page.Controls.Add(Section("PRÉLAVAGE", ligneBox1, zoneBox2, arrPrelavage));

        page.Controls.Add(Section("GRANULATION",
            Champ("Box en cours d'usinage", tbBoxUsinage, 200),
            Champ("Titre acide (g/l)", nTitre, 150),
            Champ("Conso acide (kg)", nConsoAcide, 120),
            Champ("Paniers granulés", nPaniers, 150),
            arrL1, arrL2,
            Champ("Avance panier : fin", tbAvance, 200),
            Champ("Panier lavé", tbLave, 200)));

        page.Controls.Add(Section("SÉCHOIRS",
            Champ("Paniers séchés", nPaniersSeches, 100),
            Champ("Poids moyen d'un panier", tbPoidsMoyen, 200),
            Champ("Poids moyen d'un pain", tbPoidsMoyen28, 200)));

        for (int i = 0; i < 3; i++)
        {
            page.Controls.Add(Section($"Séchoir {i + 1}",
                Champ("Cycle (sec)", nCycle[i], 100),
                Champ("Brûleur 1", nB1[i], 90),
                Champ("Brûleur 2", nB2[i], 90),
                Champ("Compteur séchoir", tbCompteur[i], 290),
                Champ("Compteur gaz", Paire(tbGaz[i], tbGaz2[i]), 290),
                arrSech[i]));
        }

        page.Controls.Add(Section("CONDITIONNEMENT",
            Champ("Colis produits", nProduction, 150),
            Champ($"Kg produits", tbKg, 200),
            Champ("Balles détectées : début", nBallesDebut, 140),
            Champ("Pendant le quart", nBallesQuart, 130),
            Champ("balles traitées", nBallesTraitees, 130),
            Champ("Fin de quart", nBallesFin, 110),
            arrCond));

        page.Controls.Add(Section("GÉNÉRATEURS", arrGe2500, arrGe2000));
        page.Controls.Add(Section("Autres arrêts machine", arrAutres));
        page.Controls.Add(Section("Rapport à copier", tbRapport));

        scroll.Controls.Add(page);
        scroll.SizeChanged += (s, e) => AdapterLargeur();
        AdapterLargeur();

        Theme.Bouton(btnEnreg, true);
        Theme.Bouton(btnDeverrouiller, false);
        btnDeverrouiller.Click += (s, e) => Deverrouiller();
        Theme.Bouton(btnCopier, false);
        var barre = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(12, 9, 0, 0), Margin = Padding.Empty,
        };
        barre.Controls.Add(btnEnreg);
        barre.Controls.Add(btnCopier);
        barre.Controls.Add(lblStatut);

        btnEnreg.Click += (s, e) => Enregistrer();
        btnCopier.Click += (s, e) =>
        {
            Clipboard.SetText(tbRapport.Text);
            lblStatut.Text = "Rapport copié dans le presse-papiers.";
        };

        var tl = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
        tl.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        tl.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
        scroll.BackColor = Theme.Fond;
        tl.Controls.Add(scroll, 0, 0);
        tl.Controls.Add(barre, 0, 1);
        tp.Controls.Add(tl);
    }

    /// Étire les sections sur toute la largeur disponible de la fenêtre.</summary>
    int _largeurAppliquee;

    void AdapterLargeur()
    {
        int w = Math.Max(scroll.ClientSize.Width - 30, 880);
        if (w == _largeurAppliquee) return;   // évite les recalculs inutiles (et le va-et-vient de la barre de défilement)
        _largeurAppliquee = w;
        page.SuspendLayout();
        foreach (Control c in page.Controls)
        {
            if (c is not Carte g) continue;
            g.MinimumSize = new Size(w, 0);
            foreach (Control f in g.Controls)
            {
                if (f is not FlowLayoutPanel flow) continue;
                flow.MaximumSize = new Size(w - 30, 0);
                foreach (Control x in flow.Controls)
                {
                    if (x is BlocArrets b) b.Width = w - 40;
                    else if (x is TextBox t && t.Multiline) t.Width = w - 40;
                }
            }
        }
        page.ResumeLayout(true);
    }

    /// Relie tous les champs au recalcul automatique
    void Brancher(Control parent)
    {
        foreach (Control x in parent.Controls)
        {
            switch (x)
            {
                case BlocArrets b:
                    b.Modifie += (s, e) => Recalculer();
                    break;
                case NumericUpDown n:
                    n.ValueChanged += (s, e) => Recalculer();
                    break;
                case ComboBox cb:
                    cb.SelectedIndexChanged += (s, e) => Recalculer();
                    break;
                case DateTimePicker d:
                    d.ValueChanged += (s, e) => Recalculer();
                    break;
                case TextBox t when !t.ReadOnly:
                    t.TextChanged += (s, e) => Recalculer();
                    break;
            }
            if (x is Panel) Brancher(x);
        }
    }

    /// <summary>
    /// La molette fait toujours défiler la page (sur n'importe quel champ ou tableau),
    /// sans modifier une valeur par erreur. Exceptions : liste déroulante ouverte et zone « Rapport à copier ».
    /// </summary>
    const int WM_MOUSEWHEEL = 0x020A;

    public bool PreFilterMessage(ref Message m)
    {
        if (m.Msg != WM_MOUSEWHEEL || ActiveForm != this || !pageRapport.Visible) return false;
        if (ActiveControl is ComboBox cb && cb.DroppedDown) return false;

        var pos = Cursor.Position;
        if (tbRapport.RectangleToScreen(tbRapport.ClientRectangle).Contains(pos)) return false;
        if (!scroll.RectangleToScreen(scroll.ClientRectangle).Contains(pos)) return false;

        short delta = unchecked((short)(((long)m.WParam >> 16) & 0xFFFF));
        var p = scroll.AutoScrollPosition;
        scroll.AutoScrollPosition = new Point(-p.X, -p.Y - delta);
        return true;
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Application.AddMessageFilter(this);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        Application.RemoveMessageFilter(this);
        base.OnFormClosed(e);
    }

    // =====================================================================
    // Calculs et collecte
    // =====================================================================
    (Rapport r, List<Sechoir> sech, List<Arret> arrets, Dictionary<string, int> gen, List<Arret> marche) Collecte()
    {
        int total = (int)nEffectif.Value, absent = (int)nAbsent.Value, malade = (int)nMalade.Value;
        int permission = (int)nPermission.Value, conge = (int)nConge.Value;
        int godets = (int)nGodets.Value;
        int godets2 = (int)nGodets2.Value;
        int production = (int)nProduction.Value;

        var r = new Rapport
        {
            Date = dtDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            Quart = (string)cbQuart.SelectedItem,
            Equipe = (string)cbEquipe.SelectedItem,
            EffectifTotal = total,
            Absent = absent,
            Malade = malade,
            Permission = permission,
            Conge = conge,
            Present = total - absent - malade - permission - conge,
            Accident = (int)nAccident.Value,
            BoxPrelave = tbBoxPrelave.Text.Trim(),
            Godets = godets,
            TotalPrelave = godets * Config.PrelaveParGodet,
            BoxPrelave2 = tbBoxPrelave2.Text.Trim(),
            Godets2 = godets2,
            TotalPrelave2 = godets2 * Config.PrelaveParGodet,
            Production = production,
            Kg = (long)production * Config.KgParUnite,
            BallesDebut = (int)nBallesDebut.Value,
            BallesQuart = (int)nBallesQuart.Value,
            BallesTraitees = (int)nBallesTraitees.Value,
            BallesFin = (int)nBallesFin.Value,
            BoxUsinage = tbBoxUsinage.Text.Trim(),
            TitreAcide = nTitre.Value,
            ConsoAcide = nConsoAcide.Value,
            Paniers = (int)nPaniers.Value,
            PaniersSeches = (int)nPaniersSeches.Value,
            AvancePanier = tbAvance.Text.Trim(),
            PanierLave = tbLave.Text.Trim(),
        };

        var sech = new List<Sechoir>();
        for (int i = 0; i < 3; i++)
        {
            int tot = arrSech[i].Total;
            sech.Add(new Sechoir
            {
                N = i + 1,
                Cycle = (int)nCycle[i].Value,
                Bruleur1 = (int)nB1[i].Value,
                Bruleur2 = (int)nB2[i].Value,
                Compteur = string.IsNullOrWhiteSpace(tbCompteur[i].Text) ? null : tbCompteur[i].Text.Trim(),
                Gaz = string.IsNullOrWhiteSpace(tbGaz[i].Text) ? null : tbGaz[i].Text.Trim(),
                Gaz2 = string.IsNullOrWhiteSpace(tbGaz2[i].Text) ? null : tbGaz2[i].Text.Trim(),
                ArretMin = tot,
                MarcheMin = Math.Max(Config.DureeQuart - tot, 0),
            });
        }

        var gen = new Dictionary<string, int>
        {
            ["CONDITIONNEMENT "] = arrCond.Total,
            ["GE 2500 KVA"] = arrGe2500.Total,
            ["GE 2000 KVA"] = arrGe2000.Total,
            ["Ligne 1"] = arrL1.Total,
            ["Ligne 2"] = arrL2.Total,
        };

        var arrets = new List<Arret>();
        arrets.AddRange(arrPrelavage.Arrets());
        arrets.AddRange(arrCond.Arrets());
        arrets.AddRange(arrL1.Arrets());
        arrets.AddRange(arrL2.Arrets());
        foreach (var a in arrSech) arrets.AddRange(a.Arrets());
        arrets.AddRange(arrAutres.Arrets());

        // Générateurs : périodes de fonctionnement (démarrage / arrêt), pas des arrêts
        var marche = new List<Arret>();
        marche.AddRange(arrGe2500.Arrets());
        marche.AddRange(arrGe2000.Arrets());

        return (r, sech, arrets, gen, marche);
    }

    /// <summary>Affiche ou masque la ligne du 2e box prélavé (le bouton + prend sa place quand elle est masquée).</summary>
    void MontrerBox2(bool visible)
    {
        ligneBox2.Visible = visible;
        btnAjoutBox2.Visible = !visible;
    }

    static void Fixer(NumericUpDown n, decimal v) => n.Value = Math.Min(Math.Max(v, n.Minimum), n.Maximum);

    /// <summary>Affiche un rapport dans le formulaire (date, quart et équipe restent inchangés).</summary>
    void Remplir(RapportComplet c)
    {
        var r = c.R;
        Fixer(nEffectif, r.EffectifTotal); Fixer(nAbsent, r.Absent); Fixer(nMalade, r.Malade);
        Fixer(nPermission, r.Permission); Fixer(nConge, r.Conge); Fixer(nAccident, r.Accident);
        tbBoxPrelave.Text = r.BoxPrelave ?? "";
        Fixer(nGodets, r.Godets);
        tbBoxPrelave2.Text = r.BoxPrelave2 ?? "";
        Fixer(nGodets2, r.Godets2);
        MontrerBox2(r.Godets2 > 0 || !string.IsNullOrWhiteSpace(r.BoxPrelave2));
        tbBoxUsinage.Text = r.BoxUsinage ?? "";
        Fixer(nTitre, r.TitreAcide); Fixer(nConsoAcide, r.ConsoAcide); Fixer(nPaniers, r.Paniers);
        tbAvance.Text = r.AvancePanier ?? "";
        tbLave.Text = r.PanierLave ?? "";
        Fixer(nPaniersSeches, r.PaniersSeches);
        Fixer(nProduction, r.Production);
        Fixer(nBallesDebut, r.BallesDebut); Fixer(nBallesQuart, r.BallesQuart);
        Fixer(nBallesTraitees, r.BallesTraitees); Fixer(nBallesFin, r.BallesFin);

        for (int i = 0; i < 3; i++)
        {
            var s = c.Sech.FirstOrDefault(x => x.N == i + 1) ?? new Sechoir();
            Fixer(nCycle[i], s.Cycle); Fixer(nB1[i], s.Bruleur1); Fixer(nB2[i], s.Bruleur2);
            tbCompteur[i].Text = s.Compteur ?? "";
            tbGaz[i].Text = s.Gaz ?? ""; tbGaz2[i].Text = s.Gaz2 ?? "";
            arrSech[i].Charger(c.Arrets.Where(a => a.Zone == $"Séchoir {i + 1}"));
        }

        arrPrelavage.Charger(c.Arrets.Where(a => a.Zone == "Prélavage"));
        arrCond.Charger(c.Arrets.Where(a => a.Zone == "Conditionnement"));
        arrL1.Charger(c.Arrets.Where(a => a.Zone == "Ligne 1"));
        arrL2.Charger(c.Arrets.Where(a => a.Zone == "Ligne 2"));
        string[] connues = { "Prélavage", "Conditionnement", "Ligne 1", "Ligne 2", "Séchoir 1", "Séchoir 2", "Séchoir 3" };
        arrAutres.Charger(c.Arrets.Where(a => !connues.Contains(a.Zone)));
        arrGe2500.Charger(c.Marche.Where(a => a.Zone == "GE 2500 KVA"));
        arrGe2000.Charger(c.Marche.Where(a => a.Zone == "GE 2000 KVA"));
    }

    void Recalculer()
    {
        if (_calc) return;
        _calc = true;
        try
        {
            tbChef.Text = Config.Equipes[(string)cbEquipe.SelectedItem];

            // Date, quart ou équipe modifiés : afficher directement le rapport déjà enregistré
            string id = $"{dtDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}_{cbQuart.SelectedItem}_{cbEquipe.SelectedItem}";
            if (id != _idVerifie)
            {
                _idVerifie = id;
                RapportComplet trouve = null;
                try { trouve = Db.Lire(id); } catch { }
                _existe = trouve != null;
                if (_idDeverrouille != id) _idDeverrouille = null;
                _verrouille = false;
                _limite = null;
                if (trouve != null)
                {
                    try { _verrouille = Db.EstVerrouille(id, out _limite) && _idDeverrouille != id; }
                    catch (Exception ex) { Journal.Erreur(ex, "calcul du verrouillage"); }
                }
                if (trouve != null) { Remplir(trouve); _charge = true; }
                else if (_charge) { Remplir(new RapportComplet()); _charge = false; }   // nouveau rapport : formulaire vide
            }

            var (r, sech, arrets, gen, marche) = Collecte();

            tbPresent.Text = r.EffectifTotal == 0 ? "" : Math.Max(r.Present, 0).ToString();
            lblEffectif.Visible = r.Present < 0;
            tbTotalPrelave.Text = r.Godets == 0 ? "" : r.TotalPrelave.ToString();
            tbTotalPrelave2.Text = r.Godets2 == 0 ? "" : r.TotalPrelave2.ToString();
            tbKg.Text = r.Production == 0 ? "" : Config.Milliers(r.Kg) + " kg";
            tbPoidsMoyen.Text = Config.Decimal2(Config.PoidsMoyenPanier(r.Production, r.PaniersSeches));
            tbPoidsMoyen28.Text = Config.Decimal2(Config.PoidsMoyenPanierDiv28(r.Production, r.PaniersSeches));
            btnEnreg.Enabled = r.Present >= 0 && !_verrouille;

            lblAvert.Visible = _existe;
            if (_verrouille)
            {
                lblAvert.ForeColor = Theme.Danger;
                lblAvert.Text = $"Rapport verrouillé : plus aucune modification possible ({Db.DelaiModificationHeures} h après le premier enregistrement, depuis le {_limite:dd/MM/yyyy HH:mm}).";
            }
            else
            {
                lblAvert.ForeColor = Theme.Alerte;
                lblAvert.Text = "Rapport déjà enregistré : il est affiché ci-dessous. Enregistrer le remplacera." +
                                (_limite.HasValue ? $" Modifiable jusqu'au {_limite:dd/MM/yyyy HH:mm}." : "");
            }
            btnDeverrouiller.Visible = _verrouille;
            if (_verrouille != _verrouAffiche) { AppliquerVerrou(_verrouille); _verrouAffiche = _verrouille; }

            tbRapport.Text = Texte.Construire(r, sech, arrets, gen, marche).Replace("\n", "\r\n");
        }
        finally
        {
            _calc = false;
        }
    }

    void Enregistrer()
    {
        var (r, sech, arrets, gen, marche) = Collecte();
        if (r.Present < 0) return;

        bool existeAvant = Db.Existe(r.Id);
        if (existeAvant)
        {
            var rep = MessageBox.Show(
                "Un rapport existe déjà pour cette date, ce quart et cette équipe.\nVoulez-vous le remplacer ?",
                "Remplacer le rapport ?", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (rep != DialogResult.Yes) return;
        }

        bool enregistre = false;
        try
        {
            Db.Enregistrer(r, sech, arrets, marche, forcer: _idDeverrouille == r.Id);
            _idVerifie = r.Id;      // le rapport affiché est celui qui vient d'être enregistré
            _existe = true;
            _charge = true;
            lblStatut.ForeColor = Theme.Succes;
            lblStatut.Text = "Rapport enregistré dans la base.";
            Recalculer();
            enregistre = true;
            BlocArrets.InvaliderSuggestions();   // les nouvelles pannes sont proposées aux prochaines saisies
        }
        catch (Exception ex)
        {
            lblStatut.ForeColor = Theme.Danger;
            lblStatut.Text = "Échec de l'enregistrement.";
            MessageBox.Show("Erreur lors de l'enregistrement :\n" + ex.Message,
                "Rapport chef de quart", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        // Le tableau de synthèse apparaît automatiquement une fois le rapport enregistré
        if (enregistre)
        {
            if (!existeAvant)
            {
                var limite = Db.PremierEnregistrement(r.Id)?.AddHours(Db.DelaiModificationHeures);
                string jusqua = limite?.ToString("dd/MM/yyyy 'à' HH:mm") ?? "dans les 8 heures suivant cet enregistrement";
                MessageBox.Show(
                    $"Rapport enregistré avec succès.\nVous pourrez le modifier jusqu'au {jusqua}.",
                    "Délai de modification", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            using var synthese = new FormSynthese(r, sech, gen, captureAuto: true);
            synthese.ShowDialog(this);
        }
    }

    // =====================================================================
    // Onglet "Historique"
    // =====================================================================
    void ConstruireHistorique(Control tp)
    {
        clbQuart.Items.AddRange(Config.Quarts);
        clbEquipe.Items.AddRange(Config.Equipes.Keys.ToArray());

        var filtres = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(6) };
        filtres.Controls.Add(Champ("Date", dtFiltre, 170));
        var pq = new Panel { Size = new Size(164, 94) };
        pq.Controls.Add(new Label { Text = "Quart", AutoSize = true });
        clbQuart.Location = new Point(0, 20);
        pq.Controls.Add(clbQuart);
        filtres.Controls.Add(pq);
        var pe = new Panel { Size = new Size(104, 114) };
        pe.Controls.Add(new Label { Text = "Équipe", AutoSize = true });
        clbEquipe.Location = new Point(0, 20);
        pe.Controls.Add(clbEquipe);
        filtres.Controls.Add(pe);


        Theme.Bouton(btnExcel, false);
        btnExcel.Click += (s, e) => { if (_modeAdmin) ExporterXlsx(); };
        filtres.Controls.Add(btnExcel);

        Theme.Bouton(btnJournal, false);
        btnJournal.Click += (s, e) =>
        {
            if (!_modeAdmin) return;
            using var f = new FormJournal(); f.ShowDialog(this);
        };
        filtres.Controls.Add(btnJournal);
        var btnSynth = new Button { Text = "Voir la synthèse", Width = 160, Height = 36, Margin = new Padding(10, 16, 0, 0) };
        Theme.Bouton(btnSynth, false);
        btnSynth.Click += (s, e) => VoirSynthese();
        filtres.Controls.Add(btnSynth);

        dtFiltre.ValueChanged += (s, e) => AppliquerFiltre();
        clbQuart.ItemCheck += (s, e) => BeginInvoke(new Action(AppliquerFiltre));
        clbEquipe.ItemCheck += (s, e) => BeginInvoke(new Action(AppliquerFiltre));

        ConfigurerGrille(gridHisto);
        ConfigurerGrille(gridArretsHisto);
        gridHisto.SelectionChanged += (s, e) => ChargerArretsSelection();
        gridArretsHisto.CellFormatting += (s, e) =>
        {
            if (e.RowIndex < 0 || e.ColumnIndex < 0 || gridArretsHisto.Columns[e.ColumnIndex].Name != "duree_min" || e.Value == null || e.Value == DBNull.Value) return;
            e.Value = Config.Hm(Convert.ToInt32(e.Value));
            e.FormattingApplied = true;
        };
        gridHisto.CellDoubleClick += (s, e) => { if (e.RowIndex >= 0) VoirSynthese(); };   // double-clic = synthèse

        var titreArrets = new Label
        {
            Text = "Arrêts du rapport sélectionné", AutoSize = true,
            Font = Theme.PoliceGras, ForeColor = Theme.Texte, Margin = new Padding(6, 6, 0, 3),
        };
        lblTotalHisto.Margin = new Padding(6, 4, 0, 4);

        var tl = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5 };
        tl.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        tl.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        tl.RowStyles.Add(new RowStyle(SizeType.Percent, 60));
        tl.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        tl.RowStyles.Add(new RowStyle(SizeType.Percent, 40));
        tl.Controls.Add(filtres, 0, 0);
        tl.Controls.Add(lblTotalHisto, 0, 1);
        tl.Controls.Add(gridHisto, 0, 2);
        tl.Controls.Add(titreArrets, 0, 3);
        tl.Controls.Add(gridArretsHisto, 0, 4);
        tp.Controls.Add(tl);
    }

    static void ConfigurerGrille(DataGridView g)
    {
        g.Dock = DockStyle.Fill;
        g.ReadOnly = true;
        g.AllowUserToAddRows = false;
        g.AllowUserToDeleteRows = false;
        g.MultiSelect = false;
        g.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        g.RowHeadersVisible = false;
        g.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        Theme.Grille(g);
    }

    void ChargerHistorique()
    {
        try { _histo = Db.Historique(); }
        catch (Exception ex)
        {
            MessageBox.Show("Impossible de lire l'historique :\n" + ex.Message);
            return;
        }
        AppliquerFiltre();
    }

    DataView VueFiltree()
    {
        var f = new List<string>();
        if (dtFiltre.Checked)
            f.Add("jour = '" + dtFiltre.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "'");
        if (clbQuart.CheckedItems.Count > 0)
            f.Add("quart IN (" + string.Join(",", clbQuart.CheckedItems.Cast<string>().Select(q => $"'{q}'")) + ")");
        if (clbEquipe.CheckedItems.Count > 0)
            f.Add("equipe IN (" + string.Join(",", clbEquipe.CheckedItems.Cast<string>().Select(q => $"'{q}'")) + ")");

        return new DataView(_histo)
        {
            RowFilter = string.Join(" AND ", f),
            Sort = "jour DESC, quart",
        };
    }

    void AppliquerFiltre()
    {
        if (_histo == null) return;
        var vue = VueFiltree();
        gridHisto.DataSource = vue;

        string[] titres = { "Id", "Date", "Quart", "Équipe", "Effectif présent", "Production", "Tonnage (kg)" };
        for (int i = 0; i < gridHisto.Columns.Count && i < titres.Length; i++)
            gridHisto.Columns[i].HeaderText = titres[i];
        gridHisto.Columns["id"].Visible = false;

        long kg = vue.Cast<DataRowView>().Sum(v => v["tonnage"] == DBNull.Value ? 0L : Convert.ToInt64(v["tonnage"]));
        lblTotalHisto.Text = $"{vue.Count} rapport(s) - total {Config.Milliers(kg)} kg";
        ChargerArretsSelection();
    }

    void ChargerArretsSelection()
    {
        if (gridHisto.CurrentRow?.DataBoundItem is DataRowView v)
        {
            var dt = Db.ArretsDe((string)v["id"]);
            gridArretsHisto.DataSource = dt;
            string[] titres = { "Zone", "Cause", "Durée (h/min)" };
            for (int i = 0; i < gridArretsHisto.Columns.Count && i < titres.Length; i++)
                gridArretsHisto.Columns[i].HeaderText = titres[i];
        }
        else
        {
            gridArretsHisto.DataSource = null;
        }
    }

    /// <summary>Ouvre le tableau de synthèse du rapport sélectionné dans l'historique.</summary>
    void VoirSynthese()
    {
        if (gridHisto.CurrentRow?.DataBoundItem is not DataRowView v)
        {
            MessageBox.Show("Sélectionnez d'abord un rapport dans la liste.", "Rapport chef de quart");
            return;
        }

        RapportComplet c;
        try { c = Db.Lire((string)v["id"]); }
        catch (Exception ex)
        {
            MessageBox.Show("Impossible de lire le rapport :\n" + ex.Message);
            return;
        }
        if (c == null) return;

        int Arret(string zone) => c.Arrets.Where(a => a.Zone == zone).Sum(a => a.Minutes);
        foreach (var sc in c.Sech) sc.ArretMin = Arret($"Séchoir {sc.N}");   // durées recalculées à partir des arrêts
        var gen = new Dictionary<string, int> { ["Ligne 1"] = Arret("Ligne 1"), ["Ligne 2"] = Arret("Ligne 2") };

        using var f = new FormSynthese(c.R, c.Sech, gen);
        f.ShowDialog(this);
    }

    void ExporterXlsx()
    {
        if (_histo == null) ChargerHistorique();
        if (_histo == null) return;

        using var dlg = new SaveFileDialog
        {
            Filter = "Classeur Excel (*.xlsx)|*.xlsx",
            FileName = "rapports-chef-de-quart.xlsx",
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;

        var vue = VueFiltree();
        string[] colonnes = { "jour", "quart", "equipe", "effectif_present", "production", "tonnage" };
        string[] entetes = { "Date", "Quart", "Équipe", "Effectif présent", "Production", "Tonnage (kg)" };
        var lignes = new List<object[]>();
        foreach (DataRowView row in vue)
            lignes.Add(colonnes.Select(c => row[c] == DBNull.Value ? null : row[c]).ToArray());

        try
        {
            ExcelMini.Ecrire(dlg.FileName, "Rapports", entetes, lignes);
            MessageBox.Show("Export terminé.", "Rapport chef de quart");
        }
        catch (Exception ex)
        {
            MessageBox.Show("Échec de l'export :\n" + ex.Message);
        }
    }

}

