using System.Drawing;
using System.Windows.Forms;

namespace RapportQuart;

/// <summary>Connexion : choix de l'équipe + mot de passe. Première utilisation d'une équipe : création de son mot de passe.</summary>
public class FormConnexion : Form
{
    readonly ComboBox cbEquipe = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 340 };
    readonly Label lblEquipe = new() { AutoSize = true, ForeColor = Theme.TexteDoux };
    readonly TextBox tbMdp = new() { UseSystemPasswordChar = true, Width = 340, MaxLength = 64 };
    readonly TextBox tbConfirm = new() { UseSystemPasswordChar = true, Width = 340, MaxLength = 64 };
    readonly Label lblMdp = new() { AutoSize = true, ForeColor = Theme.TexteDoux };
    readonly Label lblConfirm = new() { Text = "Confirmer le mot de passe", AutoSize = true, ForeColor = Theme.TexteDoux };
    readonly Label lblMessage = new() { AutoSize = false, Size = new Size(340, 50), ForeColor = Theme.Alerte };
    readonly LinkLabel lnkOublie = new() { Text = "Mot de passe oublié ?", AutoSize = true };
    bool _reset;   // clé de récupération validée : on peut redéfinir le mot de passe

    string Code() => ((string)cbEquipe.SelectedItem).Substring(0, 1);
    bool AdminSelectionne => string.Equals(cbEquipe.SelectedItem as string, "Administrateur", StringComparison.Ordinal);
    public bool EstAdministrateur { get; private set; }

    public FormConnexion()
    {
        Text = "Connexion - Rapport chef de quart";
        Font = Theme.Police;
        BackColor = Color.White;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(400, 390);

        foreach (var kv in Config.Equipes) cbEquipe.Items.Add($"{kv.Key} - {kv.Value}");
        cbEquipe.Items.Add("Administrateur");
        cbEquipe.SelectedIndex = Math.Max(0, Config.Equipes.Keys.ToList().IndexOf(Db.EquipeConnectee ?? "A"));

        var titre = new Label { Text = "Connexion de l'équipe", Font = Theme.PoliceTitre, ForeColor = Theme.Texte, AutoSize = true, Location = new Point(30, 20) };
        lblEquipe.Text = "Équipe";
        lblEquipe.Location = new Point(30, 62);
        cbEquipe.Location = new Point(30, 82);
        lblMdp.Location = new Point(30, 122);
        tbMdp.Location = new Point(30, 142);
        lblConfirm.Location = new Point(30, 180);
        tbConfirm.Location = new Point(30, 200);
        lblMessage.Location = new Point(30, 238);

        var btnOk = new Button { Text = "Se connecter", Size = new Size(170, 38), Location = new Point(30, 298) };
        var btnAnnuler = new Button { Text = "Quitter", Size = new Size(120, 38), Location = new Point(210, 298), DialogResult = DialogResult.Cancel };
        Theme.Bouton(btnOk, true);
        Theme.Bouton(btnAnnuler, false);
        lnkOublie.Location = new Point(30, 350);

        Controls.AddRange(new Control[] { titre, lblEquipe, cbEquipe, lblMdp, tbMdp, lblConfirm, tbConfirm, lblMessage, btnOk, btnAnnuler, lnkOublie });
        AcceptButton = btnOk;
        CancelButton = btnAnnuler;

        cbEquipe.SelectedIndexChanged += (s, e) => { _reset = false; MajMode(); };
        btnOk.Click += (s, e) => Valider();
        lnkOublie.LinkClicked += (s, e) => Oublie();
        Shown += (s, e) => tbMdp.Focus();
        MajMode();
    }

    void Info(string texte) { lblMessage.ForeColor = Theme.Alerte; lblMessage.Text = texte; }
    void Erreur(string texte) { lblMessage.ForeColor = Theme.Danger; lblMessage.Text = texte; }

    void MajMode()
    {
        if (AdminSelectionne)
        {
            _reset = false;
            lblEquipe.Text = "Profil";
            bool adminDefini = Acces.MotDePasseAdminDefini();
            lblConfirm.Visible = tbConfirm.Visible = false;
            lblMdp.Text = "Mot de passe administrateur";
            lnkOublie.Visible = false;
            tbMdp.Clear();
            tbConfirm.Clear();
            Info(adminDefini ? "Connectez-vous pour ouvrir le tableau de bord administrateur."
                : "Première connexion : le compte administrateur doit être initialisé avec la clé de récupération.");
            return;
        }
        lblEquipe.Text = "Équipe";
        bool defini;
        try { defini = Acces.MotDePasseDefini(Code()); }
        catch (Exception ex) { Journal.Erreur(ex, "lecture accès"); Erreur("Lecture impossible : " + ex.Message); return; }

        bool creation = !defini || _reset;
        lblConfirm.Visible = tbConfirm.Visible = creation;
        lblMdp.Text = creation ? $"Nouveau mot de passe ({Acces.MinCar} caractères minimum)" : "Mot de passe";
        lnkOublie.Visible = defini && !_reset;
        tbMdp.Clear();
        tbConfirm.Clear();
        Info(!defini ? "Première utilisation de cette équipe : choisissez son mot de passe."
            : _reset ? "Clé validée. Choisissez le nouveau mot de passe de l'équipe." : "");
    }

    void Valider()
    {
        if (AdminSelectionne)
        {
            try
            {
                if (!Acces.MotDePasseAdminDefini())
                {
                    if (!FormAccesAdministrateur.InitialiserDepuisConnexion(this)) return;
                }
                else
                {
                    var resultat = Acces.VerifierAdmin(tbMdp.Text, out var message);
                    if (resultat != Acces.Resultat.Ok) { Erreur(message); tbMdp.Clear(); tbMdp.Focus(); return; }
                }
                EstAdministrateur = true;
                Db.EquipeConnectee = null;
                Journal.Info("Connexion administrateur autorisee");
                DialogResult = DialogResult.OK;
            }
            catch (Exception ex)
            {
                Journal.Erreur(ex, "connexion administrateur");
                Erreur("Connexion administrateur impossible : " + ex.Message);
            }
            return;
        }

        var code = Code();
        try
        {
            if (!Acces.MotDePasseDefini(code) || _reset)
            {
                if (tbMdp.Text != tbConfirm.Text) { Erreur("Les deux mots de passe sont différents."); return; }
                var pb = Acces.Valider(tbMdp.Text);
                if (pb != null) { Erreur(pb); return; }
                Acces.Definir(code, tbMdp.Text);
            }
            else
            {
                var res = Acces.Verifier(code, tbMdp.Text, out var message);
                if (res != Acces.Resultat.Ok)
                {
                    Erreur(message);
                    tbMdp.Clear();
                    tbMdp.Focus();
                    return;
                }
            }
            Db.EquipeConnectee = code;
            DialogResult = DialogResult.OK;
        }
        catch (Exception ex)
        {
            Journal.Erreur(ex, "connexion");
            Erreur("Connexion impossible : " + ex.Message);
        }
    }

    void Oublie()
    {
        var saisie = Saisie.Demander(this, "Mot de passe oublié",
            "Saisissez la clé de récupération (remise à la première installation) :");
        if (saisie == null) return;
        if (!Acces.CleRecuperationOk(saisie))
        {
            Journal.Info($"Clé de récupération refusée (équipe {Code()})");
            Erreur("Clé de récupération incorrecte.");
            return;
        }
        _reset = true;
        MajMode();
    }
}


/// <summary>Changement du mot de passe de l'équipe connectée.</summary>
public class FormChangerMdp : Form
{
    public FormChangerMdp(string code)
    {
        Text = $"Mot de passe de l'équipe {code}";
        Font = Theme.Police;
        BackColor = Color.White;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;
        ClientSize = new Size(400, 370);

        TextBox Champ(string libelle, int y)
        {
            Controls.Add(new Label { Text = libelle, AutoSize = true, ForeColor = Theme.TexteDoux, Location = new Point(30, y) });
            var tb = new TextBox { UseSystemPasswordChar = true, Width = 340, MaxLength = 64, Location = new Point(30, y + 20) };
            Controls.Add(tb);
            return tb;
        }
        var tbAncien = Champ("Mot de passe actuel", 24);
        var tbNouveau = Champ($"Nouveau mot de passe ({Acces.MinCar} caractères minimum)", 84);
        var tbConfirm = Champ("Confirmer le nouveau mot de passe", 144);
        var lblMessage = new Label { AutoSize = false, Size = new Size(340, 50), Location = new Point(30, 208), ForeColor = Theme.Danger };
        var btnOk = new Button { Text = "Modifier", Size = new Size(170, 38), Location = new Point(30, 290) };
        var btnAnnuler = new Button { Text = "Annuler", Size = new Size(120, 38), Location = new Point(210, 290), DialogResult = DialogResult.Cancel };
        Theme.Bouton(btnOk, true);
        Theme.Bouton(btnAnnuler, false);
        Controls.AddRange(new Control[] { lblMessage, btnOk, btnAnnuler });
        AcceptButton = btnOk;
        CancelButton = btnAnnuler;

        btnOk.Click += (s, e) =>
        {
            try
            {
                if (Acces.Verifier(code, tbAncien.Text, out var message) != Acces.Resultat.Ok) { lblMessage.Text = message; return; }
                if (tbNouveau.Text != tbConfirm.Text) { lblMessage.Text = "Les deux nouveaux mots de passe sont différents."; return; }
                var pb = Acces.Valider(tbNouveau.Text);
                if (pb != null) { lblMessage.Text = pb; return; }
                Acces.Definir(code, tbNouveau.Text);
                DialogResult = DialogResult.OK;
            }
            catch (Exception ex)
            {
                Journal.Erreur(ex, "changement de mot de passe");
                lblMessage.Text = "Modification impossible : " + ex.Message;
            }
        };
    }
}


/// <summary>Petite fenêtre de saisie d'un texte (clé de récupération).</summary>
public static class Saisie
{
    public static string Demander(IWin32Window parent, string titre, string consigne)
    {
        using var f = new Form
        {
            Text = titre, Font = Theme.Police, BackColor = Color.White,
            FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false,
            ShowInTaskbar = false, StartPosition = parent == null ? FormStartPosition.CenterScreen : FormStartPosition.CenterParent,
            ClientSize = new Size(480, 180),
        };
        var lbl = new Label { Text = consigne, Location = new Point(20, 16), Size = new Size(440, 56), ForeColor = Theme.Texte };
        var tb = new TextBox { Location = new Point(20, 80), Width = 440, Font = new Font("Consolas", 11f), CharacterCasing = CharacterCasing.Upper };
        var ok = new Button { Text = "Valider", Location = new Point(20, 124), Size = new Size(140, 38), DialogResult = DialogResult.OK };
        var an = new Button { Text = "Annuler", Location = new Point(170, 124), Size = new Size(140, 38), DialogResult = DialogResult.Cancel };
        Theme.Bouton(ok, true);
        Theme.Bouton(an, false);
        f.Controls.AddRange(new Control[] { lbl, tb, ok, an });
        f.AcceptButton = ok;
        f.CancelButton = an;
        return f.ShowDialog(parent) == DialogResult.OK ? tb.Text : null;
    }
}


/// <summary>Affiche la clé de récupération une seule fois (première installation).</summary>
public class FormCleRecuperation : Form
{
    public FormCleRecuperation(string cle)
    {
        Text = "Clé de récupération";
        Font = Theme.Police;
        BackColor = Color.White;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ControlBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(600, 350);

        var titre = new Label { Text = "Notez cette clé de récupération", Font = Theme.PoliceTitre, ForeColor = Theme.Texte, AutoSize = true, Location = new Point(24, 18) };
        var texte = new Label
        {
            Text = "La base de données est chiffrée. Cette clé permet de la rouvrir sur un autre PC ou après une réinstallation, " +
                   "et de réinitialiser le mot de passe d'une équipe qui l'a oublié.\n\n" +
                   "Écrivez-la sur papier et confiez-la à un responsable (coffre, armoire fermée). Elle ne sera plus jamais affichée.",
            Location = new Point(24, 54), Size = new Size(552, 100), ForeColor = Theme.Texte,
        };
        var tb = new TextBox
        {
            Text = cle, ReadOnly = true, Font = new Font("Consolas", 14f, FontStyle.Bold),
            Location = new Point(24, 168), Width = 552, TextAlign = HorizontalAlignment.Center,
        };
        var btnCopier = new Button { Text = "Copier la clé", Size = new Size(160, 36), Location = new Point(24, 212) };
        var chk = new CheckBox { Text = "J'ai noté cette clé et je la range en lieu sûr", AutoSize = true, Location = new Point(24, 262) };
        var btnOk = new Button { Text = "Continuer", Size = new Size(160, 38), Location = new Point(24, 294), Enabled = false };
        Theme.Bouton(btnCopier, false);
        Theme.Bouton(btnOk, true);
        Controls.AddRange(new Control[] { titre, texte, tb, btnCopier, chk, btnOk });

        btnCopier.Click += (s, e) => { try { Clipboard.SetText(cle); } catch { } };
        chk.CheckedChanged += (s, e) => btnOk.Enabled = chk.Checked;
        btnOk.Click += (s, e) => DialogResult = DialogResult.OK;
        FormClosing += (s, e) => { if (DialogResult != DialogResult.OK) e.Cancel = true; };
    }
}
