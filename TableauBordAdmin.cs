using System.Data;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Windows.Forms;

namespace RapportQuart;

/// <summary>Vue de synthèse réservée à l'administrateur.</summary>
public sealed class TableauBordAdmin : Form
{
    readonly DataGridView grilleRapports = new();
    readonly DataGridView grilleZone = new();
    readonly DataGridView grilleZoneAccueil = new();
    readonly DataGridView grilleQuart = new();
    readonly DataGridView grilleJour = new();
    readonly DataGridView grilleArretsRapport = new();
    readonly GraphiqueProduction graphique = new();
    readonly DateTimePicker filtreMois = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "MMMM yyyy", ShowUpDown = true, Width = 155 };
    readonly ComboBox filtreJour = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 115 };
    readonly System.Windows.Forms.Timer actualisationAuto = new() { Interval = 10000 };
    readonly TabControl onglets = new() { Dock = DockStyle.Fill, Appearance = TabAppearance.FlatButtons, SizeMode = TabSizeMode.Fixed, ItemSize = new Size(1, 1) };
    bool _miseAJourJours;
    readonly Label lblRapports = Carte("Rapports", "0");
    readonly Label lblProduction = Carte("Production du mois", "0 colis");
    readonly Label lblArrets = Carte("Temps d'arrêt", "0 h");

    public bool DeconnexionDemandee { get; private set; }

    public TableauBordAdmin()
    {
        Text = "Tableau de bord administrateur - Rapport chef de quart";
        Font = Theme.Police;
        BackColor = Theme.Fond;
        StartPosition = FormStartPosition.CenterParent;
        MinimumSize = new Size(1000, 740);
        Size = new Size(1200, 800);

        filtreMois.Value = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        filtreMois.Width = 150;
        var bandeau = new FlowLayoutPanel
        {
            Dock = DockStyle.Top, Height = 76, Padding = new Padding(18, 10, 12, 8),
            WrapContents = false, BackColor = Theme.Entete, FlowDirection = FlowDirection.LeftToRight,
        };
        Label Etiquette(string texte) => new()
        {
            Text = texte, AutoSize = true, ForeColor = Color.White,
            Font = Theme.PoliceGras, Margin = new Padding(8, 11, 4, 0),
        };
        filtreMois.Margin = new Padding(0, 4, 14, 0);
        filtreJour.Margin = new Padding(0, 4, 12, 0);
        var actualiser = new Button { Text = "Actualiser", Size = new Size(110, 36), Margin = new Padding(4, 1, 8, 0) };
        var exporterArrets = new Button { Text = "Exporter les arrêts XLSX", Size = new Size(190, 36), Margin = new Padding(4, 1, 8, 0) };
        Theme.Bouton(actualiser, true);
        Theme.Bouton(exporterArrets, false);
        bandeau.Controls.AddRange(new Control[]
        {
            Etiquette("Mois"), filtreMois,
            Etiquette("Jour"), filtreJour,
            actualiser, exporterArrets,
        });
        actualiser.Click += (s, e) => Charger();
        exporterArrets.Click += (s, e) => ExporterArretsXlsx();
        var navigation = new Panel
        {
            Dock = DockStyle.Right, Width = 220, Padding = new Padding(12, 20, 12, 12),
            BackColor = Theme.Entete,
        };
        var liens = new FlowLayoutPanel
        {
            Dock = DockStyle.Top, Height = 380, Padding = Padding.Empty,
            FlowDirection = FlowDirection.TopDown, WrapContents = false, BackColor = Theme.Entete,
        };
        var marque = new Label
        {
            Text = "USINE DE\nTRANSFORMATION", Width = 190, Height = 66,
            ForeColor = Color.White, Font = Theme.PoliceGras, TextAlign = ContentAlignment.MiddleLeft,
            Margin = new Padding(4, 0, 0, 20),
        };
        liens.Controls.Add(marque);
        Button LienNavigation(string libelle, int index)
        {
            var bouton = new Button
            {
                Text = libelle, Width = 190, Height = 46, TextAlign = ContentAlignment.MiddleLeft,
                Padding = new Padding(12, 0, 0, 0), Margin = new Padding(0, 0, 0, 8),
                FlatStyle = FlatStyle.Flat, BackColor = Theme.Entete, ForeColor = Color.White,
                Font = Theme.Police,
            };
            bouton.FlatAppearance.BorderSize = 0;
            if (index >= 0) bouton.Click += (s, e) => onglets.SelectedIndex = index;
            return bouton;
        }
        liens.Controls.Add(LienNavigation("Accueil", 0));
        liens.Controls.Add(LienNavigation("Rapports enregistrés", 1));
        liens.Controls.Add(LienNavigation("Temps d’arrêt par zone", 2));
        var journalNav = LienNavigation("Journal de modification", -1);
        journalNav.Click += (s, e) => { using var f = new FormJournal(); f.ShowDialog(this); };
        liens.Controls.Add(journalNav);
        var deconnecter = new Button
        {
            Text = "Déconnexion", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(12, 0, 0, 0), Margin = Padding.Empty,
            FlatStyle = FlatStyle.Flat, BackColor = Theme.Entete, ForeColor = Color.White,
            Font = Theme.Police,
        };
        deconnecter.FlatAppearance.BorderSize = 0;
        deconnecter.Click += (s, e) => Deconnecter();
        var zoneDeconnexion = new Panel { Dock = DockStyle.Bottom, Height = 58, Padding = new Padding(0, 4, 0, 0), BackColor = Theme.Entete };
        zoneDeconnexion.Controls.Add(deconnecter);
        navigation.Controls.Add(liens);
        navigation.Controls.Add(zoneDeconnexion);
        Controls.Add(onglets);
        Controls.Add(navigation);
        Controls.Add(bandeau);
        filtreMois.ValueChanged += (s, e) =>
        {
            RemplirJours();
            Charger();
        };
        filtreJour.SelectedIndexChanged += (s, e) => { if (!_miseAJourJours) Charger(); };
        grilleRapports.CellDoubleClick += (s, e) => { if (e.RowIndex >= 0) ConsulterRapportSelectionne(); };
        grilleZone.RowPrePaint += (s, e) =>
        {
            if (e.RowIndex < grilleZone.Rows.Count && grilleZone.Rows[e.RowIndex].Cells[0].Value is string secteur && !string.IsNullOrWhiteSpace(secteur))
            {
                grilleZone.Rows[e.RowIndex].DefaultCellStyle.Font = Theme.PoliceGras;
                grilleZone.Rows[e.RowIndex].DefaultCellStyle.BackColor = Color.FromArgb(226, 232, 240);
            }
        };
        Db.RapportEnregistre += ActualiserApresEnregistrement;
        actualisationAuto.Tick += (s, e) => Charger();
        actualisationAuto.Start();
        FormClosed += (s, e) => { Db.RapportEnregistre -= ActualiserApresEnregistrement; actualisationAuto.Stop(); actualisationAuto.Dispose(); };

        var cartes = new FlowLayoutPanel
        {
            Dock = DockStyle.Top, Height = 78, Padding = new Padding(12, 6, 12, 4),
            WrapContents = false, BackColor = Color.Transparent,
        };
        cartes.Controls.AddRange(new Control[] { lblRapports, lblProduction, lblArrets });

        ConfigurerGrille(grilleRapports);
        ConfigurerGrille(grilleZone);
        ConfigurerGrille(grilleZoneAccueil);
        ConfigurerGrille(grilleQuart);
        ConfigurerGrille(grilleJour);
        ConfigurerGrille(grilleArretsRapport);
        grilleRapports.SelectionChanged += (s, e) => ChargerArretsRapportSelectionne();
        foreach (var grille in new[] { grilleZone, grilleZoneAccueil, grilleQuart, grilleRapports, grilleArretsRapport })
            grille.CellFormatting += FormaterDureeArret;
        grilleRapports.MouseDown += (s, e) =>
        {
            if (e.Button != MouseButtons.Right) return;
            var hit = grilleRapports.HitTest(e.X, e.Y);
            if (hit.RowIndex >= 0)
                grilleRapports.CurrentCell = grilleRapports.Rows[hit.RowIndex].Cells.Cast<DataGridViewCell>().FirstOrDefault(c => c.Visible);
        };
        graphique.Dock = DockStyle.Fill;
        var pageTableau = new TabPage("Tableau de bord");
        var corpsTableau = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Padding = new Padding(8) };
        corpsTableau.RowStyles.Add(new RowStyle(SizeType.Absolute, 82));
        corpsTableau.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        corpsTableau.Controls.Add(cartes, 0, 0);
        var contenuAccueil = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1 };
        contenuAccueil.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 72));
        contenuAccueil.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 28));
        var arretsAccueil = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Padding = new Padding(8, 4, 4, 4) };
        arretsAccueil.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        arretsAccueil.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        arretsAccueil.Controls.Add(TitreSection("Temps d’arrêt par zone"), 0, 0);
        arretsAccueil.Controls.Add(grilleZoneAccueil, 0, 1);
        contenuAccueil.Controls.Add(graphique, 0, 0);
        contenuAccueil.Controls.Add(arretsAccueil, 1, 0);
        corpsTableau.Controls.Add(contenuAccueil, 0, 1);
        pageTableau.Controls.Add(corpsTableau);
        var tabRapports = new TabPage("Rapports enregistrés");
        var menuRapport = new ContextMenuStrip();
        menuRapport.Items.Add("Voir le rapport de quart", null, (s, e) => ConsulterRapportSelectionne());
        menuRapport.Items.Add("Voir la synthèse de quart", null, (s, e) => ConsulterSyntheseSelectionnee());
        grilleRapports.ContextMenuStrip = menuRapport;
        var panneauRapports = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, Padding = new Padding(8) };
        panneauRapports.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        panneauRapports.RowStyles.Add(new RowStyle(SizeType.Percent, 58));
        panneauRapports.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
        panneauRapports.RowStyles.Add(new RowStyle(SizeType.Percent, 42));
        panneauRapports.Controls.Add(TitreSection("Rapports enregistrés — clic droit pour consulter"), 0, 0);
        panneauRapports.Controls.Add(grilleRapports, 0, 1);
        panneauRapports.Controls.Add(TitreSection("Arrêts du rapport sélectionné"), 0, 2);
        panneauRapports.Controls.Add(grilleArretsRapport, 0, 3);
        tabRapports.Controls.Add(panneauRapports);
        var tabArrets = new TabPage("Temps d’arrêt par zone");
        var arrets = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 2, Padding = new Padding(8) };
        arrets.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 35));
        arrets.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 65));
        arrets.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
        arrets.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        arrets.Controls.Add(TitreSection("Temps d’arrêt par zone"), 0, 0);
        arrets.Controls.Add(TitreSection("Détail par jour et quart — un arrêt par ligne"), 1, 0);
        arrets.Controls.Add(grilleZone, 0, 1);
        arrets.Controls.Add(grilleQuart, 1, 1);
        tabArrets.Controls.Add(arrets);
        onglets.TabPages.AddRange(new[] { pageTableau, tabRapports, tabArrets });
        onglets.SelectedTab = pageTableau;
        RemplirJours();
        Charger();
    }

    DateTime? JourSelectionne
    {
        get
        {
            if (filtreJour.SelectedIndex <= 0 || !int.TryParse(Convert.ToString(filtreJour.SelectedItem), out int jour)) return null;
            return new DateTime(filtreMois.Value.Year, filtreMois.Value.Month, jour);
        }
    }

    void RemplirJours()
    {
        string selection = Convert.ToString(filtreJour.SelectedItem);
        _miseAJourJours = true;
        filtreJour.BeginUpdate();
        try
        {
            filtreJour.Items.Clear();
            filtreJour.Items.Add("Tous les jours");
            int nbJours = DateTime.DaysInMonth(filtreMois.Value.Year, filtreMois.Value.Month);
            for (int j = 1; j <= nbJours; j++) filtreJour.Items.Add(j.ToString("00", CultureInfo.InvariantCulture));
            int index = selection == null ? 0 : filtreJour.Items.IndexOf(selection);
            filtreJour.SelectedIndex = index >= 0 ? index : 0;
        }
        finally
        {
            filtreJour.EndUpdate();
            _miseAJourJours = false;
        }
    }

    void Deconnecter()
    {
        if (MessageBox.Show(this, "Voulez-vous fermer la session administrateur ?", "Déconnexion",
            MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        Journal.Info("Session administrateur fermee");
        DeconnexionDemandee = true;
        Close();
    }

    void ActualiserApresEnregistrement()
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke((Action)Charger); } catch (InvalidOperationException) { }
    }

    void ConsulterRapportSelectionne()
    {
        if (grilleRapports.CurrentRow?.DataBoundItem is not DataRowView row) return;
        try
        {
            using var formulaire = new FormPrincipal(Convert.ToString(row["id"]));
            formulaire.ShowDialog(this);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Impossible d'ouvrir ce rapport :\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    static Label Carte(string titre, string valeur) => new()
    {
        AutoSize = false, Size = new Size(260, 66), Margin = new Padding(0, 0, 14, 0),
        Text = titre + Environment.NewLine + valeur, TextAlign = ContentAlignment.MiddleLeft,
        Padding = new Padding(12, 0, 0, 0), BackColor = Color.White, ForeColor = Theme.Texte,
        Font = Theme.PoliceGras,
    };

    static Label TitreSection(string s) => new()
    {
        Text = s, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft,
        Font = Theme.PoliceGras, ForeColor = Theme.Texte,
    };

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

    void Charger()
    {
        try
        {
            var mois = filtreMois.Value.Date;
            var jourFiltre = JourSelectionne;
            var rapports = Db.RapportsAdmin(mois, jourFiltre);
            var production = Db.ProductionMoisAdmin(mois, jourFiltre);
            var arretsZone = Db.ArretsAdmin("zone", mois, jourFiltre);
            var zone = OrganiserArretsParSecteur(arretsZone);
            var detailsArrets = Db.ArretsDetailsAdmin(mois, jourFiltre);
            grilleRapports.DataSource = rapports;
            grilleZone.DataSource = zone;
            grilleZoneAccueil.DataSource = zone;
            grilleQuart.DataSource = detailsArrets;
            grilleJour.DataSource = null;
            Renommer(grilleRapports, new[] { "Identifiant", "Date", "Quart", "Équipe", "Production (colis)", "Poids (kg)" });
            Renommer(grilleZone, new[] { "Secteur", "Zone / équipement", "Arrêt" });
            Renommer(grilleZoneAccueil, new[] { "Secteur", "Zone / équipement", "Arrêt" });
            Renommer(grilleQuart, new[] { "Jour", "Quart", "Équipe", "Début", "Fin", "Zone", "Cause", "Durée" });

            long totalProduction = production.Rows.Cast<DataRow>().Sum(r => Convert.ToInt64(r["production"]));
            long totalArrets = arretsZone.Rows.Cast<DataRow>().Sum(r => Convert.ToInt64(r["minutes"]));
            lblRapports.Text = $"Rapports enregistrés\n{rapports.Rows.Count}";
            lblProduction.Text = $"Production de la période\n{totalProduction:N0} colis";
            lblArrets.Text = $"Temps d'arrêt par zone\nTotal : {totalArrets / 60} h {totalArrets % 60:00} min";
            graphique.Charger(production, mois, jourFiltre);
            ChargerArretsRapportSelectionne();
        }
        catch (Exception ex)
        {
            Journal.Erreur(ex, "chargement du tableau de bord administrateur");
            MessageBox.Show(this, "Impossible de charger les indicateurs :\n" + ex.Message,
                "Tableau de bord administrateur", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    void ChargerArretsRapportSelectionne()
    {
        if (grilleRapports.CurrentRow?.DataBoundItem is not DataRowView row)
        {
            grilleArretsRapport.DataSource = null;
            return;
        }
        try
        {
            grilleArretsRapport.DataSource = Db.ArretsDe(Convert.ToString(row["id"]));
            Renommer(grilleArretsRapport, new[] { "Zone", "Cause", "Durée" });
        }
        catch (Exception ex)
        {
            Journal.Erreur(ex, "chargement des arrêts du rapport sélectionné");
            grilleArretsRapport.DataSource = null;
        }
    }

    void ConsulterSyntheseSelectionnee()
    {
        if (grilleRapports.CurrentRow?.DataBoundItem is not DataRowView row) return;
        try
        {
            var rapport = Db.Lire(Convert.ToString(row["id"]));
            if (rapport == null) return;
            int Arret(string zone) => rapport.Arrets.Where(a => a.Zone == zone).Sum(a => a.Minutes);
            foreach (var sechoir in rapport.Sech) sechoir.ArretMin = Arret($"Séchoir {sechoir.N}");
            var generateurs = new Dictionary<string, int>
            {
                ["Ligne 1"] = Arret("Ligne 1"),
                ["Ligne 2"] = Arret("Ligne 2"),
            };
            using var synthese = new FormSynthese(rapport.R, rapport.Sech, generateurs);
            synthese.ShowDialog(this);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Impossible d’ouvrir la synthèse :\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    void ExporterArretsXlsx()
    {
        DataTable arrets;
        var mois = filtreMois.Value.Date;
        var jour = JourSelectionne;
        try { arrets = Db.ArretsDetailsAdmin(mois, jour); }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Impossible de préparer l’export des arrêts :\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        using var dlg = new SaveFileDialog
        {
            Filter = "Classeur Excel (*.xlsx)|*.xlsx",
            FileName = $"arrets_{mois:yyyy_MM}{(jour.HasValue ? "_" + jour.Value.ToString("dd") : "")}.xlsx",
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;

        string[] entetes = { "Jour", "Quart", "Équipe", "Début", "Fin", "Zone", "Cause", "Durée (h/min)" };
        var lignes = arrets.Rows.Cast<DataRow>().Select(row => new object[]
        {
            DateTime.TryParseExact(Convert.ToString(row["date"]), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
                ? date.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture) : Convert.ToString(row["date"]),
            Convert.ToString(row["quart"]), Convert.ToString(row["equipe"]),
            Convert.ToString(row["heure_debut"])?.Replace(':', 'H'), Convert.ToString(row["heure_fin"])?.Replace(':', 'H'),
            Convert.ToString(row["zone"]), Convert.ToString(row["cause"]),
            Config.Hm(Convert.ToInt32(row["minutes"])),
        }).ToList();

        try
        {
            ExcelMini.Ecrire(dlg.FileName, "Arrêts", entetes, lignes);
            MessageBox.Show(this, $"Export terminé : {lignes.Count} arrêt(s).", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Échec de l’export :\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    static void FormaterDureeArret(object sender, DataGridViewCellFormattingEventArgs e)
    {
        if (sender is not DataGridView grille || e.RowIndex < 0 || e.ColumnIndex < 0) return;
        var nom = grille.Columns[e.ColumnIndex].Name;
        if ((nom == "heure_debut" || nom == "heure_fin") && e.Value is string heure)
        {
            e.Value = heure.Replace(':', 'H');
            e.FormattingApplied = true;
            return;
        }
        if ((nom == "minutes" || nom == "duree_min") && e.Value != null && e.Value != DBNull.Value)
        {
            e.Value = Config.Hm(Convert.ToInt32(e.Value));
            e.FormattingApplied = true;
        }
    }

    static DataTable OrganiserArretsParSecteur(DataTable donnees)
    {
        var resultat = new DataTable();
        resultat.Columns.Add("secteur", typeof(string));
        resultat.Columns.Add("zone", typeof(string));
        resultat.Columns.Add("minutes", typeof(long));
        var durees = donnees.Rows.Cast<DataRow>().ToDictionary(
            r => Convert.ToString(r["groupe"]), r => Convert.ToInt64(r["minutes"]), StringComparer.OrdinalIgnoreCase);
        var secteurs = new (string Nom, string[] Zones)[]
        {
            ("GRANULATION", new[] { "Ligne 1", "Ligne 2" }),
            ("PRÉLAVAGE", new[] { "Prélavage" }),
            ("ZONE SÈCHE", new[] { "Séchoir 1", "Séchoir 2", "Séchoir 3" }),
            ("AUTRE ZONE", new[] { "Autre" }),
        };
        var connus = secteurs.SelectMany(s => s.Zones).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var secteur in secteurs)
        {
            long total = secteur.Zones.Sum(z => durees.GetValueOrDefault(z));
            resultat.Rows.Add(secteur.Nom, "TOTAL SECTEUR", total);
            foreach (string zone in secteur.Zones)
                resultat.Rows.Add("", zone.Equals("Autre", StringComparison.OrdinalIgnoreCase) ? "Autre zone" : zone, durees.GetValueOrDefault(zone));
        }
        foreach (var (zone, minutes) in durees.Where(p => !connus.Contains(p.Key)))
            resultat.Rows.Add("AUTRE ZONE", zone, minutes);
        return resultat;
    }

    static void Renommer(DataGridView g, string[] entetes)
    {
        for (int i = 0; i < g.Columns.Count && i < entetes.Length; i++)
        {
            g.Columns[i].HeaderText = entetes[i];
            if (g.Columns[i].Name == "id") g.Columns[i].Visible = false;
            if (g.Columns[i].Name == "minutes") g.Columns[i].DefaultCellStyle.Format = "N0";
        }
    }
}

/// <summary>Graphiques dessinés nativement pour éviter une dépendance de graphiques externe.</summary>
sealed class GraphiqueProduction : Control
{
    static readonly Color[] Couleurs = { Color.FromArgb(37, 99, 235), Color.FromArgb(22, 163, 74), Color.FromArgb(245, 158, 11), Color.FromArgb(147, 51, 234) };
    DataTable _donnees;
    DateTime _mois = DateTime.Today;
    DateTime? _jour;

    public GraphiqueProduction()
    {
        DoubleBuffered = true;
        ResizeRedraw = true;
        BackColor = Color.White;
        ForeColor = Theme.Texte;
        Font = Theme.Police;
    }

    public void Charger(DataTable donnees, DateTime mois, DateTime? jour)
    {
        _donnees = donnees;
        _mois = mois;
        _jour = jour;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Color.White);
        using var titre = new Font(Font, FontStyle.Bold);
        string periode = _mois.ToString("MMMM yyyy", CultureInfo.GetCultureInfo("fr-FR"));
        if (_jour.HasValue) periode += " - " + _jour.Value.ToString("dd/MM/yyyy");
        g.DrawString("Production par équipe - " + periode, titre, new SolidBrush(Theme.Texte), 24, 16);
        g.DrawString("Camembert : colis produits par équipe", titre, new SolidBrush(Theme.Texte), Math.Max(Width - 270, 20), 16);
        if (_donnees == null || _donnees.Rows.Count == 0)
        {
            g.DrawString("Aucune production enregistrée pour cette période.", Font, Brushes.Gray, 28, 70);
            return;
        }

        var totaux = new Dictionary<string, long>();
        var points = new Dictionary<string, Dictionary<int, long>>();
        foreach (DataRow row in _donnees.Rows)
        {
            string equipe = Convert.ToString(row["equipe"]);
            if (!DateTime.TryParseExact(Convert.ToString(row["date"]), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) continue;
            long valeur = Convert.ToInt64(row["production"]);
            totaux[equipe] = totaux.GetValueOrDefault(equipe) + valeur;
            if (!points.TryGetValue(equipe, out var jour)) points[equipe] = jour = new Dictionary<int, long>();
            jour[date.Day] = jour.GetValueOrDefault(date.Day) + valeur;
        }

        int largeurGraphe = Math.Max(360, Width - 375);
        var zone = new Rectangle(58, 62, largeurGraphe - 95, Math.Max(140, Height - 115));
        using var grille = new Pen(Color.FromArgb(225, 231, 239));
        using var axe = new Pen(Color.FromArgb(100, 116, 139), 1.5f);
        long max = Math.Max(1, points.Values.SelectMany(x => x.Values).DefaultIfEmpty(1).Max());
        int jours = DateTime.DaysInMonth(_mois.Year, _mois.Month);
        for (int i = 0; i <= 4; i++)
        {
            float y = zone.Bottom - zone.Height * i / 4f;
            g.DrawLine(grille, zone.Left, y, zone.Right, y);
            g.DrawString((max * i / 4).ToString("N0"), Font, Brushes.DimGray, 2, y - 8);
        }
        g.DrawLine(axe, zone.Left, zone.Top, zone.Left, zone.Bottom);
        g.DrawLine(axe, zone.Left, zone.Bottom, zone.Right, zone.Bottom);
        g.DrawString("1", Font, Brushes.DimGray, zone.Left - 4, zone.Bottom + 3);
        g.DrawString((jours / 2).ToString(), Font, Brushes.DimGray, zone.Left + zone.Width / 2 - 8, zone.Bottom + 3);
        g.DrawString(jours.ToString(), Font, Brushes.DimGray, zone.Right - 12, zone.Bottom + 3);
        int equipeIndex = 0;
        foreach (string equipe in Config.Equipes.Keys)
        {
            if (!points.TryGetValue(equipe, out var joursEquipe)) continue;
            using var stylo = new Pen(Couleurs[equipeIndex % Couleurs.Length], 2.5f);
            var coords = joursEquipe.OrderBy(p => p.Key).Select(p => new PointF(
                zone.Left + (p.Key - 1) * zone.Width / (float)Math.Max(jours - 1, 1),
                zone.Bottom - p.Value * zone.Height / (float)max)).ToArray();
            if (coords.Length > 1) g.DrawLines(stylo, coords);
            using var pointBrush = new SolidBrush(stylo.Color);
            foreach (var point in coords) g.FillEllipse(pointBrush, point.X - 3, point.Y - 3, 6, 6);
            int ly = zone.Bottom + 24 + (equipeIndex / 2) * 22;
            int lx = zone.Left + (equipeIndex % 2) * 125;
            g.FillRectangle(pointBrush, lx, ly + 3, 14, 4);
            g.DrawString("Équipe " + equipe, Font, Brushes.DimGray, lx + 19, ly - 3);
            equipeIndex++;
        }
        DrawPie(g, totaux, new Rectangle(Width - 235, 53, 145, 145));
    }

    void DrawPie(Graphics g, Dictionary<string, long> valeurs, Rectangle rect)
    {
        long total = valeurs.Values.Sum();
        if (total <= 0) { g.DrawString("Pas de données", Font, Brushes.Gray, rect.Left, rect.Bottom + 8); return; }
        float angle = -90;
        int i = 0;
        foreach (string equipe in Config.Equipes.Keys)
        {
            long valeur = valeurs.GetValueOrDefault(equipe);
            if (valeur <= 0) { i++; continue; }
            float sweep = 360f * valeur / total;
            using var b = new SolidBrush(Couleurs[i % Couleurs.Length]);
            g.FillPie(b, rect, angle, sweep);
            angle += sweep;
            int y = rect.Bottom + 5 + (i % Config.Equipes.Count) * 18;
            g.FillRectangle(b, rect.Left, y + 3, 11, 11);
            g.DrawString($"Équipe {equipe} : {valeur:N0} ({valeur * 100d / total:0.#} %)", Font, Brushes.DimGray, rect.Left + 17, y);
            i++;
        }
    }
}
