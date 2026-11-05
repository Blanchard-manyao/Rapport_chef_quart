using System.Drawing;
using System.Windows.Forms;

namespace RapportQuart;

// ===== Theme : couleurs, polices et styles (pour changer l'allure de l'application) =====

/// <summary>Palette, polices et styles communs : pour changer l'allure de l'application, modifiez ce fichier.</summary>
public static class Theme
{
    // ---- Couleurs (R, V, B) ----
    public static readonly Color Fond = Color.FromArgb(243, 245, 249);        // fond de la fenêtre
    public static readonly Color FondCarte = Color.WhiteSmoke;                      // fond des sections
    public static readonly Color Entete = Color.FromArgb(39, 98 , 53);          // bandeau du haut
    public static readonly Color Accent = Color.FromArgb(37, 99, 235);         // bleu principal
    public static readonly Color AccentFonce = Color.FromArgb(29, 78, 216);    // bleu au survol
    public static readonly Color Texte = Color.FromArgb(30, 41, 59);
    public static readonly Color TexteDoux = Color.FromArgb(100, 116, 139);
    public static readonly Color Bordure = Color.FromArgb(226, 232, 240);
    public static readonly Color Calcule = Color.FromArgb(241, 245, 249);      // champs calculés
    public static readonly Color Succes = Color.FromArgb(22, 163, 74);
    public static readonly Color Alerte = Color.FromArgb(217, 119, 6);
    public static readonly Color Danger = Color.FromArgb(220, 38, 38);

    // ---- Polices ----
    public static readonly Font Police = new("Segoe UI", 9.5f);
    public static readonly Font PoliceGras = new("Segoe UI Semibold", 9.5f);
    public static readonly Font PoliceTitre = new("Segoe UI Semibold", 11f);

    // ---- Tableaux ----
    public const int HauteurLigne = 28;
    public const int HauteurEntete = 32;

    public static void Bouton(Button b, bool principal)
    {
        b.UseVisualStyleBackColor = false;
        b.FlatStyle = FlatStyle.Flat;
        b.Cursor = Cursors.Hand;
        b.Font = PoliceGras;
        b.FlatAppearance.BorderSize = principal ? 0 : 1;
        b.FlatAppearance.BorderColor = Bordure;
        b.BackColor = principal ? Accent : Color.White;
        b.ForeColor = principal ? Color.White : Texte;
        b.FlatAppearance.MouseOverBackColor = principal ? AccentFonce : Calcule;
        b.EnabledChanged += (s, e) =>
        {
            if (principal) b.BackColor = b.Enabled ? Accent : Color.FromArgb(148, 163, 184);
        };
    }

    public static void Grille(DataGridView g)
    {
        g.BorderStyle = BorderStyle.None;
        g.BackgroundColor = Color.WhiteSmoke;
        g.GridColor = Bordure;
        g.CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal;

        g.EnableHeadersVisualStyles = false;
        g.ColumnHeadersBorderStyle = DataGridViewHeaderBorderStyle.None;
        g.ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.DisableResizing;
        g.ColumnHeadersHeight = HauteurEntete;
        g.ColumnHeadersDefaultCellStyle.BackColor = Calcule;
        g.ColumnHeadersDefaultCellStyle.ForeColor = TexteDoux;
        g.ColumnHeadersDefaultCellStyle.Font = PoliceGras;
        g.ColumnHeadersDefaultCellStyle.SelectionBackColor = Calcule;
        g.ColumnHeadersDefaultCellStyle.SelectionForeColor = TexteDoux;

        g.RowHeadersDefaultCellStyle.BackColor = Color.White;
        g.RowHeadersDefaultCellStyle.SelectionBackColor = Color.White;
        g.RowTemplate.Height = HauteurLigne;
        g.DefaultCellStyle.BackColor = Color.White;
        g.DefaultCellStyle.ForeColor = Texte;
        g.DefaultCellStyle.SelectionBackColor = Color.FromArgb(219, 234, 254);
        g.DefaultCellStyle.SelectionForeColor = Texte;
        g.AlternatingRowsDefaultCellStyle.BackColor = Color.FromArgb(248, 250, 252);
    }

    /// <summary>Style des champs de saisie (bordure fine, champs calculés en gris clair).</summary>
    public static void Appliquer(Control racine)
    {
        foreach (Control c in racine.Controls)
        {
            switch (c)
            {
                case BlocArrets:
                    break;   // se style lui-même
                case NumericUpDown n:
                    n.BorderStyle = BorderStyle.FixedSingle;
                    break;
                case TextBox t:
                    t.BorderStyle = BorderStyle.FixedSingle;
                    if (t.ReadOnly)
                    {
                        t.BackColor = Calcule;
                        t.ForeColor = Texte;
                    }
                    break;
            }
            if (c is Panel) Appliquer(c);
        }
    }
}


// ===== Carte : section de l'écran =====

/// <summary>Section de l'écran : fond blanc, fine bordure, barre bleue à gauche et titre.</summary>
public class Carte : Panel
{
    public string Titre { get; }

    public Carte(string titre)
    {
        Titre = titre;
        DoubleBuffered = true;
        ResizeRedraw = true;
        BackColor = Theme.FondCarte;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(0, 0, 0, 16);
        Margin = new Padding(4, 4, 4, 14);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var bordure = new Pen(Theme.Bordure);
        e.Graphics.DrawRectangle(bordure, 0, 0, Width - 1, Height - 1);
        using var barre = new SolidBrush(Theme.Accent);
        e.Graphics.FillRectangle(barre, 0, 0, 4, Height);
        TextRenderer.DrawText(e.Graphics, Titre, Theme.PoliceTitre, new Point(18, 11), Theme.Texte);
    }
}


// ===== ChampNum : champ numérique vide à 0 =====

/// <summary>Champ numérique qui reste vide tant que sa valeur est 0 (la valeur interne reste 0).</summary>
public class ChampNum : NumericUpDown
{
    protected override void UpdateEditText()
    {
        if (Value == 0) Text = "";
        else base.UpdateEditText();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        if (Value == 0) Text = "";
    }
}


// ===== Défilement : panneaux sans scintillement =====

/// <summary>Panneau défilant sans scintillement, qui ne saute plus quand un tableau change de hauteur.</summary>
public class PanelDefilement : Panel
{
    public PanelDefilement()
    {
        DoubleBuffered = true;
        ResizeRedraw = true;
    }

    /// <summary>Ne repositionne la page que si le champ actif est hors de la zone visible.</summary>
    protected override Point ScrollToControl(Control activeControl)
    {
        var r = RectangleToClient(activeControl.RectangleToScreen(activeControl.ClientRectangle));
        if (ClientRectangle.IntersectsWith(r)) return DisplayRectangle.Location;
        return base.ScrollToControl(activeControl);
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x02000000;   // WS_EX_COMPOSITED
            return cp;
        }
    }

    // Pendant qu'on tire la barre, force le redessin à chaque position
    protected override void WndProc(ref Message m)
    {
        const int WM_VSCROLL = 0x0115;
        base.WndProc(ref m);
        if (m.Msg == WM_VSCROLL)
        {
            Invalidate(true);
            Update();
        }
    }
}
 
/// <summary>Conteneur des sections avec double buffering.</summary>
public class FlowDouble : FlowLayoutPanel
{
    public FlowDouble() => DoubleBuffered = true;
}


// ===== BlocArrets : tableau des arrêts =====

/// <summary>Liste d'arrêts : une ligne par arrêt, durée calculée automatiquement.</summary>
public class BlocArrets : UserControl
{
    readonly string _zone;
    readonly bool _libre;
    readonly bool _marche;   // générateurs : heure de démarrage / heure d'arrêt
    readonly DataGridView _grid = new();
    readonly Label _resume = new();
    bool _maj;

    public event EventHandler Modifie;

    // ---- Auto-complétion des pannes et des équipements (alimentée par les rapports déjà enregistrés) ----
    static int _versionSuggestions;
    readonly Dictionary<string, AutoCompleteStringCollection> _sources = new();
    int _versionChargee = -1;

    /// <summary>À appeler après un enregistrement : les listes de suggestions sont relues dans la base.</summary>
    public static void InvaliderSuggestions() => _versionSuggestions++;

    AutoCompleteStringCollection Source(string col)
    {
        if (_versionChargee != _versionSuggestions) { _sources.Clear(); _versionChargee = _versionSuggestions; }
        if (!_sources.TryGetValue(col, out var src))
        {
            src = new AutoCompleteStringCollection();
            try { src.AddRange(Db.Suggestions(col == "equip" ? "equipement" : "cause", _zone).ToArray()); }
            catch (Exception ex) { Journal.Erreur(ex, "suggestions de pannes"); }
            _sources[col] = src;
        }
        return src;
    }

    /// <summary>Une panne tapée une fois est proposée tout de suite pour les lignes suivantes, même avant l'enregistrement.</summary>
    void Memoriser(string col, string texte)
    {
        texte = (texte ?? "").Trim();
        if (texte.Length == 0) return;
        var src = Source(col);
        for (int i = src.Count - 1; i >= 0; i--)
            if (string.Equals(src[i], texte, StringComparison.OrdinalIgnoreCase)) src.RemoveAt(i);
        src.Insert(0, texte);
    }

    public BlocArrets(string zone, bool libre = false, bool marche = false)
    {
        _zone = zone;
        _libre = libre;
        _marche = marche;
        Width = 840;
        Margin = new Padding(3, 3, 3, 8);

        var titre = new Label
        {
            Text = libre ? "Autres arrêts :"
                : marche ? $"{zone} : heure de démarrage et heure d'arrêt (format 07H30)"
                : $"Arrêts {zone} (une ligne par arrêt, heures au format 07H30)",
            AutoSize = true,
            Font = Theme.PoliceGras,
            ForeColor = Theme.Texte,
            Margin = new Padding(0, 0, 0, 3),
        };

        _resume.AutoSize = true;
        _resume.ForeColor = Theme.TexteDoux;
        _resume.Margin = new Padding(0, 3, 0, 0);

        _grid.Dock = DockStyle.Fill;
        _grid.AllowUserToAddRows = true;
        _grid.AllowUserToDeleteRows = true;
        _grid.MultiSelect = false;
        _grid.RowHeadersWidth = 28;
        _grid.BackgroundColor = SystemColors.Window;
        _grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        _grid.ScrollBars = ScrollBars.Vertical;
        Theme.Grille(_grid);   // style moderne (à faire avant d'ajouter les colonnes)

        if (libre)
        {
            _grid.Columns.Add(new DataGridViewComboBoxColumn
            {
                Name = "zone", HeaderText = "Zone", DataSource = Config.Zones, FillWeight = 15,
            });
            _grid.Columns.Add(new DataGridViewTextBoxColumn
            {
                Name = "equip", HeaderText = "Équipement", FillWeight = 25, MaxInputLength = 100,
            });
        }
        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "debut", HeaderText = marche ? "Démarrage" : "Début", FillWeight = 15,
        });
        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "fin", HeaderText = marche ? "Arrêt" : "Fin", FillWeight = 15,
        });
        if (!marche)
        {
            _grid.Columns.Add(new DataGridViewTextBoxColumn
            {
                Name = "cause", HeaderText = libre ? "Cause" : "Panne", FillWeight = 40, MaxInputLength = 200,
            });
        }
        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "duree", HeaderText = "Durée", ReadOnly = true, FillWeight = 18,
        });

        _grid.DataError += (s, e) => e.ThrowException = false;
        _grid.DefaultValuesNeeded += (s, e) =>
        {
            if (_libre) e.Row.Cells["zone"].Value = Config.Zones[0];
        };
        _grid.CellEndEdit += (s, e) =>
        {
            var col = _grid.Columns[e.ColumnIndex].Name;
            if (col == "cause" || col == "equip")
                Memoriser(col, Convert.ToString(_grid.Rows[e.RowIndex].Cells[e.ColumnIndex].Value));
            Actualiser();
        };
        _grid.EditingControlShowing += (s, e) =>
        {
            if (e.Control is not TextBox tb) return;
            var col = _grid.CurrentCell?.OwningColumn?.Name;
            if (col == "cause" || col == "equip")
            {
                // liste proposée pendant la frappe ; rien n'est ajouté tant que l'utilisateur ne choisit pas une suggestion
                tb.AutoCompleteMode = AutoCompleteMode.SuggestAppend;
                tb.AutoCompleteSource = AutoCompleteSource.CustomSource;
                tb.AutoCompleteCustomSource = Source(col);
            }
            else
            {
                tb.AutoCompleteMode = AutoCompleteMode.None;
            }
        };
        _grid.RowsRemoved += (s, e) => { if (IsHandleCreated) BeginInvoke(new Action(Actualiser)); };
        _grid.RowsAdded += (s, e) => AjusterHauteur();
        _grid.CurrentCellDirtyStateChanged += (s, e) =>
        {
            if (_grid.IsCurrentCellDirty && _grid.CurrentCell is DataGridViewComboBoxCell)
                _grid.CommitEdit(DataGridViewDataErrorContexts.Commit);
        };

        var tl = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = libre ? 2 : 3 };
        tl.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        tl.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        if (!libre) tl.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        tl.Controls.Add(titre, 0, 0);
        tl.Controls.Add(_grid, 0, 1);
        if (!libre) tl.Controls.Add(_resume, 0, 2);
        Controls.Add(tl);

        AjusterHauteur();
        Actualiser();
    }

    bool _verrou;

    /// <summary>Rapport verrouillé : le tableau devient en lecture seule (plus d'ajout, de suppression ni de modification).</summary>
    public void Verrouiller(bool verrouille)
    {
        if (verrouille == _verrou) return;
        _verrou = verrouille;
        _grid.ReadOnly = verrouille;
        _grid.AllowUserToAddRows = !verrouille;
        _grid.AllowUserToDeleteRows = !verrouille;
        AjusterHauteur();
    }

    void AjusterHauteur()
    {
        int lignes = Math.Max(_grid.Rows.Count, 2);
        Height = 26 + (_libre ? 0 : 26) + Theme.HauteurEntete + Theme.HauteurLigne * lignes + 10;
    }

    bool Lire(DataGridViewRow row, out Arret a)
    {
        a = null;
        var d = Convert.ToString(row.Cells["debut"].Value);
        var f = Convert.ToString(row.Cells["fin"].Value);
        if (!Config.TryHeure(d, out var td) || !Config.TryHeure(f, out var tf)) return false;

        string zone = _zone;
        string equip = null;
        if (_libre)
        {
            zone = Convert.ToString(row.Cells["zone"].Value);
            if (string.IsNullOrEmpty(zone)) zone = Config.Zones[0];
            equip = Convert.ToString(row.Cells["equip"].Value);
            if (string.IsNullOrWhiteSpace(equip)) equip = null; else equip = equip.Trim();
        }
        var cause = _marche ? "" : (Convert.ToString(row.Cells["cause"].Value) ?? "").Trim();
        a = new Arret(zone, Config.Heure(td), Config.Heure(tf), cause, equip);
        return true;
    }

    /// <summary>Remplace le contenu du tableau par une liste d'arrêts enregistrés.</summary>
    public void Charger(IEnumerable<Arret> liste)
    {
        _grid.Rows.Clear();
        foreach (var a in liste)
        {
            int i = _grid.Rows.Add();
            var row = _grid.Rows[i];
            if (_libre)
            {
                row.Cells["zone"].Value = string.IsNullOrEmpty(a.Zone) ? Config.Zones[0] : a.Zone;
                row.Cells["equip"].Value = a.Equipement;
            }
            row.Cells["debut"].Value = a.Debut?.Replace(':', 'H');
            row.Cells["fin"].Value = a.Fin?.Replace(':', 'H');
            if (!_marche) row.Cells["cause"].Value = a.Cause;
        }
        Actualiser();
    }

    /// <summary>Arrêts complets (heure de début et de fin valides).</summary>
    public List<Arret> Arrets()
    {
        var liste = new List<Arret>();
        foreach (DataGridViewRow row in _grid.Rows)
        {
            if (row.IsNewRow) continue;
            if (Lire(row, out var a)) liste.Add(a);
        }
        return liste;
    }

    public int Total => Arrets().Sum(a => a.Minutes);

    void Actualiser()
    {
        if (_maj) return;
        _maj = true;
        try
        {
            foreach (DataGridViewRow row in _grid.Rows)
            {
                if (row.IsNewRow) continue;
                foreach (var nom in new[] { "debut", "fin" })
                {
                    var c = row.Cells[nom];
                    var txt = Convert.ToString(c.Value)?.Trim();
                    if (string.IsNullOrEmpty(txt)) { c.ErrorText = ""; continue; }
                    if (Config.TryHeure(txt, out var t)) { c.Value = Config.Heure(t).Replace(':', 'H'); c.ErrorText = ""; }
                    else c.ErrorText = "Heure invalide (format 07H30, par exemple)";
                }
                row.Cells["duree"].Value = Lire(row, out var a) ? Config.Hm(a.Minutes) : "";
            }
            int total = Total;
            _resume.Text = _marche
                ? $"Temps de fonctionnement : {Config.Hm(total)}"
                : $"Total arrêts : {Config.Hm(total)}   |   Temps de fonctionnement (8 h − arrêts) : " +
                  Config.Hm(Math.Max(Config.DureeQuart - total, 0));
            AjusterHauteur();
        }
        finally
        {
            _maj = false;
        }
        Modifie?.Invoke(this, EventArgs.Empty);
    }
}
