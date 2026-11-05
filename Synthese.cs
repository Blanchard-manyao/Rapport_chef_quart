using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Globalization;
using System.Text;
using System.Windows.Forms;

namespace RapportQuart;

/// <summary>
/// Tableau « SYNTHESE DE LA PRODUCTION DU QUART » généré à partir du rapport enregistré.
/// S'affiche automatiquement après l'enregistrement.
/// </summary>
public class FormSynthese : Form
{
    record Ligne(string Libelle, string Valeur, Color? Fond = null, Color? Texte = null);

    static readonly Color Jaune = Color.FromArgb(255, 255, 0);
    static readonly Color VertEntete = Color.FromArgb(55, 86, 35);

    readonly List<Ligne> _lignes;
    readonly string _titre = "SYNTHÈSE DE LA PRODUCTION DU QUART";
    readonly string _infoquart;
    readonly string _nomFichier;
    readonly Label _statut = new();

    /// <summary>Durée en minutes au format hh:mm:ss.</summary>
    static string Hms(int minutes) => $"{minutes / 60:00}:{minutes % 60:00}:00";

    static string Nombre(int n) => n.ToString(CultureInfo.InvariantCulture);

    /// <param name="captureAuto">true : la capture d'écran est faite toute seule dès que le tableau s'affiche (après un enregistrement).</param>
    public FormSynthese(Rapport r, List<Sechoir> sech, Dictionary<string, int> gen, bool captureAuto = false)
    {
        // ---- Données du tableau (même ordre que la feuille Excel) ----
        Sechoir S(int n) => sech.FirstOrDefault(x => x.N == n) ?? new Sechoir();
        Ligne LigneArret(string libelle, int minutes) =>
            new(libelle, Hms(minutes), null, minutes > 0 ? Theme.Danger : Theme.Succes);

        _lignes = new List<Ligne>
        {
            new("Nbre de Paniers", Nombre(r.PaniersSeches)),
            new("Nbre de Colis", Nombre(r.Production)),
            new("Cycle du séchoir n°1 (secondes)", Nombre(S(1).Cycle)),
            new("Cycle du séchoir n°2 (secondes)", Nombre(S(2).Cycle)),
            new("Cycle du séchoir n°3 (secondes)", Nombre(S(3).Cycle)),
            new("Production du quart (kg)", Config.Decimal2(r.Kg), Jaune),
            new("Poids moyen Paniers (kg)", Config.Decimal2(Config.PoidsMoyenPanier(r.Production, r.PaniersSeches)), Jaune),
            new("Poids moyen Pains (kg)", Config.Decimal2(Config.PoidsMoyenPanierDiv28(r.Production, r.PaniersSeches)), Jaune),
            LigneArret("Tps d'arrêt séchoir n°1 (h:mn:s)", S(1).ArretMin),
            LigneArret("Tps d'arrêt séchoir n°2 (h:mn:s)", S(2).ArretMin),
            LigneArret("Tps d'arrêt séchoir n°3 (h:mn:s)", S(3).ArretMin),
            LigneArret("Tps d'arrêt Granulation Ligne n°1 (h:mn:s)", gen.GetValueOrDefault("Ligne 1")),
            LigneArret("Tps d'arrêt Granulation Ligne n°2 (h:mn:s)", gen.GetValueOrDefault("Ligne 2")),
            new("Avances Paniers", r.AvancePanier ?? ""),
            new("Balles détectées durant le quart", Nombre(r.BallesQuart)),
            new("Balles détectées traitées", Nombre(r.BallesTraitees)),
            new("Paniers lavés", r.PanierLave ?? ""),
            new("Consommation Acide (Kg)", r.ConsoAcide.ToString("0.#", CultureInfo.GetCultureInfo("fr-FR"))),
            new("Effectif présent", Nombre(r.Present), null, Theme.Succes),
        };

        string date = DateTime.TryParseExact(r.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture,
        DateTimeStyles.None, out var d) ? d.ToString("dd-MM-yyyy") : r.Date;
        _infoquart = $"{r.Date}  °°  {r.Quart.ToUpperInvariant()} °° ÉQUIPE {r.Equipe} : {Config.Equipes.GetValueOrDefault(r.Equipe, "")}";
        var nom = $"Synthese_{date}_{r.Quart.ToUpperInvariant()}_{r.Equipe}.png";
        foreach (var c in Path.GetInvalidFileNameChars()) nom = nom.Replace(c, '-');
        _nomFichier = nom;

        // ---- Fenêtre ----
        Text = "Synthèse de la production du quart";
        Font = Theme.Police;
        BackColor = Theme.Fond;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;

        var titre = new Label
        {
            Text = _titre, Dock = DockStyle.Top, Height = 46,
            TextAlign = ContentAlignment.MiddleCenter,
            BackColor = Theme.Entete, ForeColor = Color.White,
            Font = new Font("Segoe UI Semibold", 13f),
        };

        var info = new Panel { Dock = DockStyle.Top, Height = 38, BackColor = Theme.Fond };
        info.Controls.Add(new Label
        {
            Text = _infoquart, AutoSize = true, Font = Theme.PoliceGras, ForeColor = Theme.Texte,
            Anchor = AnchorStyles.Top | AnchorStyles.Right, Location = new Point(400, 10),
        });

        var grille = ConstruireGrille();

        var btnCapture = new Button { Text = "Capturer le tableau", Width = 200, Height = 38, Location = new Point(14, 9) };
        var btnDossier = new Button { Text = "Ouvrir le dossier", Width = 160, Height = 38, Location = new Point(224, 9) };
        Theme.Bouton(btnCapture, true);
        Theme.Bouton(btnDossier, false);
        btnDossier.Click += (s, e) =>
        {
            Directory.CreateDirectory(DossierCaptures);
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{DossierCaptures}\"") { UseShellExecute = true });
        };
        btnCapture.Click += (s, e) => Capturer();

        _statut.AutoSize = false;
        _statut.Size = new Size(630, 22);
        _statut.Location = new Point(14, 52);
        _statut.ForeColor = Theme.Succes;
        _statut.Font = Theme.Police;

        var barre = new Panel { Dock = DockStyle.Bottom, Height = 80, BackColor = Color.White };
        barre.Controls.Add(btnCapture);
        barre.Controls.Add(btnDossier);
        barre.Controls.Add(_statut);

        // L'ordre d'ajout compte pour le Dock : grille (Fill) d'abord, puis les bandes
        Controls.Add(grille);
        Controls.Add(info);
        Controls.Add(titre);
        Controls.Add(barre);

        int hauteurGrille = Theme.HauteurEntete + _lignes.Count * 34 + 3;
        int hauteur = 46 + 38 + hauteurGrille + 80;
        var zone = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1024, 768);
        ClientSize = new Size(660, Math.Min(hauteur, zone.Height - 60));

        // Capture automatique : dès que la fenêtre est affichée, sans cliquer
        if (captureAuto) Shown += (s, e) => Capturer();
    }

    DataGridView ConstruireGrille()
    {
        var g = new DataGridView
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            AllowUserToResizeRows = false,
            AllowUserToResizeColumns = false,
            RowHeadersVisible = false,
            ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.DisableResizing,
            ColumnHeadersHeight = Theme.HauteurEntete,
            EnableHeadersVisualStyles = false,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
            ScrollBars = ScrollBars.Vertical,
            BackgroundColor = Color.White,
            BorderStyle = BorderStyle.None,
            CellBorderStyle = DataGridViewCellBorderStyle.Single,
            GridColor = Color.FromArgb(30, 41, 59),
            TabStop = false,
        };

        g.ColumnHeadersDefaultCellStyle.BackColor = VertEntete;
        g.ColumnHeadersDefaultCellStyle.ForeColor = Color.White;
        g.ColumnHeadersDefaultCellStyle.SelectionBackColor = VertEntete;
        g.ColumnHeadersDefaultCellStyle.SelectionForeColor = Color.White;
        g.ColumnHeadersDefaultCellStyle.Font = Theme.PoliceTitre;
        g.ColumnHeadersDefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleCenter;
        g.RowTemplate.Height = 34;
        g.DefaultCellStyle.Font = new Font("Segoe UI Semibold", 10.5f);
        g.DefaultCellStyle.ForeColor = Theme.Texte;
        g.DefaultCellStyle.BackColor = Color.White;

        g.Columns.Add(new DataGridViewTextBoxColumn { Name = "lib", HeaderText = "Désignation", FillWeight = 68 });
        g.Columns.Add(new DataGridViewTextBoxColumn { Name = "val", HeaderText = "Résultats", FillWeight = 32 });
        foreach (DataGridViewColumn c in g.Columns) c.SortMode = DataGridViewColumnSortMode.NotSortable;

        foreach (var l in _lignes)
        {
            int i = g.Rows.Add(l.Libelle, l.Valeur);
            var cellule = g.Rows[i].Cells[1];
            cellule.Style.Alignment = DataGridViewContentAlignment.MiddleCenter;
            cellule.Style.Font = new Font("Segoe UI Semibold", 12f);
            if (l.Fond is Color f) cellule.Style.BackColor = f;
            if (l.Texte is Color t) cellule.Style.ForeColor = t;
            // pas de surbrillance de sélection : le tableau reste lisible
            foreach (DataGridViewCell c in g.Rows[i].Cells)
            {
                c.Style.SelectionBackColor = c.Style.BackColor.IsEmpty ? Color.White : c.Style.BackColor;
                c.Style.SelectionForeColor = c.Style.ForeColor.IsEmpty ? Theme.Texte : c.Style.ForeColor;
            }
        }
        g.ClearSelection();
        g.SelectionChanged += (s, e) => g.ClearSelection();
        return g;
    }

    // ===== Capture d'écran du tableau =====

    const int Larg = 660, HTitre = 46, HInfo = 38, HEntete = 32, HLigne = 34;

    /// <summary>Dessine le tableau complet dans une image (indépendante de la taille de la fenêtre).</summary>
    Bitmap Rendu()
    {
        const float echelle = 2f;   // image nette (double résolution)
        int haut = HTitre + HInfo + HEntete + _lignes.Count * HLigne + 2;
        var bmp = new Bitmap((int)(Larg * echelle), (int)(haut * echelle));
        using var g = Graphics.FromImage(bmp);
        g.ScaleTransform(echelle, echelle);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        g.Clear(Color.White);

        var centre = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        var gauche = new StringFormat { Alignment = StringAlignment.Near, LineAlignment = StringAlignment.Center };
        var droite = new StringFormat { Alignment = StringAlignment.Far, LineAlignment = StringAlignment.Center };

        using var fTitre = new Font("Segoe UI Semibold", 13f);
        using var fGras = new Font("Segoe UI Semibold", 9.5f);
        using var fEntete = new Font("Segoe UI Semibold", 11f);
        using var fLib = new Font("Segoe UI Semibold", 10.5f);
        using var fVal = new Font("Segoe UI Semibold", 12f);
        using var bordure = new Pen(Color.FromArgb(30, 41, 59));

        // titre
        g.FillRectangle(new SolidBrush(Theme.Entete), 0, 0, Larg, HTitre);
        g.DrawString(_titre, fTitre, Brushes.White, new RectangleF(0, 0, Larg, HTitre), centre);

        // date / équipe
        g.FillRectangle(new SolidBrush(Theme.Fond), 0, HTitre, Larg, HInfo);
        using var bTexte = new SolidBrush(Theme.Texte);
        g.DrawString(_infoquart, fGras, bTexte, new RectangleF(Larg / 2f, HTitre, Larg / 2f - 14, HInfo), droite);

        // en-tête du tableau
        float c1 = Larg * 0.68f;
        float y = HTitre + HInfo;
        g.FillRectangle(new SolidBrush(VertEntete), 0, y, Larg, HEntete);
        g.DrawString("Désignation", fEntete, Brushes.White, new RectangleF(0, y, c1, HEntete), centre);
        g.DrawString("Résultats", fEntete, Brushes.White, new RectangleF(c1, y, Larg - c1, HEntete), centre);
        y += HEntete;

        // lignes
        foreach (var l in _lignes)
        {
            var cLib = new RectangleF(0, y, c1, HLigne);
            var cVal = new RectangleF(c1, y, Larg - c1 - 1, HLigne);
            if (l.Fond is Color f) g.FillRectangle(new SolidBrush(f), cVal);
            g.DrawString(l.Libelle, fLib, bTexte, new RectangleF(8, y, c1 - 8, HLigne), gauche);
            using var bVal = new SolidBrush(l.Texte ?? Theme.Texte);
            g.DrawString(l.Valeur, fVal, bVal, cVal, centre);
            g.DrawRectangle(bordure, cLib.X, cLib.Y, cLib.Width, cLib.Height);
            g.DrawRectangle(bordure, cVal.X, cVal.Y, cVal.Width, cVal.Height);
            y += HLigne;
        }
        return bmp;
    }

    static string DossierCaptures => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "RapportQuart", "Captures");

    /// <summary>Image PNG enregistrée dans Documents\RapportQuart\Captures et copiée dans le presse-papiers.</summary>
    void Capturer()
    {
        try
        {
            using var image = Rendu();
            Directory.CreateDirectory(DossierCaptures);
            string chemin = Path.Combine(DossierCaptures, _nomFichier);
            image.Save(chemin, System.Drawing.Imaging.ImageFormat.Png);

            bool copie = true;
            try { Clipboard.SetImage(image); } catch { copie = false; }   // presse-papiers parfois occupé

            _statut.ForeColor = Theme.Succes;
            _statut.Text = (copie ? "Capture enregistrée et copiée : " : "Capture enregistrée : ") + _nomFichier;
        }
        catch (Exception ex)
        {
            _statut.ForeColor = Theme.Danger;
            _statut.Text = "Capture impossible : " + ex.Message;
        }
    }

    /// <summary>Texte séparé par des tabulations : se colle directement dans Excel.</summary>
    string VersTexte()
    {
        var sb = new StringBuilder();
        sb.AppendLine(_titre);
        sb.AppendLine($"{_infoquart}");
        sb.AppendLine("Libellé\tRésultats");
        foreach (var l in _lignes) sb.AppendLine($"{l.Libelle}\t{l.Valeur}");
        return sb.ToString();
    }
}
