using System.Data;
using System.Drawing;
using System.Windows.Forms;

namespace RapportQuart;

/// <summary>Fenêtre en lecture seule : les 500 dernières actions enregistrées.</summary>
public class FormJournal : Form
{
    public FormJournal()
    {
        Text = "Journal des enregistrements";
        Font = Theme.Police;
        Size = new Size(960, 520);
        StartPosition = FormStartPosition.CenterParent;
        ShowInTaskbar = false;

        var g = new DataGridView
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            RowHeadersVisible = false,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
        };
        Theme.Grille(g);
        try { g.DataSource = Db.JournalAudit(); }
        catch (Exception ex) { MessageBox.Show("Impossible de lire le journal :\n" + ex.Message); }

        string[] titres = { "Date et heure", "Utilisateur", "Action", "Rapport", "Détail" };
        for (int i = 0; i < g.Columns.Count && i < titres.Length; i++)
            g.Columns[i].HeaderText = titres[i];

        Controls.Add(g);
    }
}