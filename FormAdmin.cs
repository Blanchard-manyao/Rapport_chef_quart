using System.Drawing;
using System.Windows.Forms;

namespace RapportQuart;

/// <summary>Authentifie les actions reservees a l'administrateur.</summary>
public static class FormAccesAdministrateur
{
    public static bool InitialiserDepuisConnexion(IWin32Window proprietaire)
    {
        var cle = Saisie.Demander(proprietaire, "Initialisation administrateur",
            "Pour créer le premier compte administrateur, saisissez la clé de récupération remise à l'installation :");
        if (cle == null) return false;
        if (!Acces.CleRecuperationOk(cle))
        {
            Journal.Info("Initialisation administrateur refusee : cle incorrecte");
            MessageBox.Show(proprietaire, "Clé de récupération incorrecte.", "Accès administrateur",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }
        using var creation = new FormCreationAdministrateur();
        if (creation.ShowDialog(proprietaire) != DialogResult.OK) return false;
        Journal.Info("Compte administrateur initialise");
        return true;
    }

    public static bool Autoriser(IWin32Window proprietaire)
    {
        if (!Acces.MotDePasseAdminDefini())
        {
            var cle = Saisie.Demander(proprietaire, "Initialisation administrateur",
                "Pour creer le premier compte administrateur, saisissez la cle de recuperation remise a l'installation :");
            if (cle == null) return false;
            if (!Acces.CleRecuperationOk(cle))
            {
                Journal.Info("Initialisation administrateur refusee : cle incorrecte");
                MessageBox.Show(proprietaire, "Cle de recuperation incorrecte.", "Acces administrateur",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            using var creation = new FormCreationAdministrateur();
            if (creation.ShowDialog(proprietaire) != DialogResult.OK) return false;
            Journal.Info("Compte administrateur initialise");
            return true;
        }

        using var connexion = new FormConnexionAdministrateur();
        if (connexion.ShowDialog(proprietaire) != DialogResult.OK)
        {
            Journal.Info("Acces administrateur refuse");
            return false;
        }
        Journal.Info("Acces administrateur autorise");
        return true;
    }
}

sealed class FormCreationAdministrateur : Form
{
    readonly TextBox tbMdp = new() { UseSystemPasswordChar = true, Width = 340, MaxLength = 64 };
    readonly TextBox tbConfirmation = new() { UseSystemPasswordChar = true, Width = 340, MaxLength = 64 };
    readonly Label lblMessage = new() { AutoSize = false, Size = new Size(340, 42), ForeColor = Theme.Danger };

    public FormCreationAdministrateur()
    {
        Text = "Creer le compte administrateur";
        Font = Theme.Police; BackColor = Color.White;
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false;
        ShowInTaskbar = false; StartPosition = FormStartPosition.CenterParent; ClientSize = new Size(400, 310);
        Controls.Add(new Label { Text = "Mot de passe administrateur (8 caracteres minimum)", AutoSize = true, Location = new Point(30, 25), ForeColor = Theme.TexteDoux });
        tbMdp.Location = new Point(30, 48); Controls.Add(tbMdp);
        Controls.Add(new Label { Text = "Confirmer le mot de passe", AutoSize = true, Location = new Point(30, 95), ForeColor = Theme.TexteDoux });
        tbConfirmation.Location = new Point(30, 118); Controls.Add(tbConfirmation);
        lblMessage.Location = new Point(30, 160); Controls.Add(lblMessage);
        var btnOk = new Button { Text = "Creer le compte", Size = new Size(180, 38), Location = new Point(30, 235) };
        var btnAnnuler = new Button { Text = "Annuler", Size = new Size(120, 38), Location = new Point(220, 235), DialogResult = DialogResult.Cancel };
        Theme.Bouton(btnOk, true); Theme.Bouton(btnAnnuler, false); Controls.AddRange(new Control[] { btnOk, btnAnnuler });
        AcceptButton = btnOk; CancelButton = btnAnnuler;
        btnOk.Click += (s, e) =>
        {
            if (tbMdp.Text != tbConfirmation.Text) { lblMessage.Text = "Les deux mots de passe sont differents."; return; }
            var erreur = Acces.Valider(tbMdp.Text);
            if (erreur != null) { lblMessage.Text = erreur; return; }
            try { Acces.DefinirAdmin(tbMdp.Text); DialogResult = DialogResult.OK; }
            catch (Exception ex) { lblMessage.Text = "Creation impossible : " + ex.Message; }
        };
        Shown += (s, e) => tbMdp.Focus();
    }
}

sealed class FormConnexionAdministrateur : Form
{
    readonly TextBox tbMdp = new() { UseSystemPasswordChar = true, Width = 340, MaxLength = 64 };
    readonly Label lblMessage = new() { AutoSize = false, Size = new Size(340, 50), ForeColor = Theme.Danger };

    public FormConnexionAdministrateur()
    {
        Text = "Acces administrateur";
        Font = Theme.Police; BackColor = Color.White;
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false;
        ShowInTaskbar = false; StartPosition = FormStartPosition.CenterParent; ClientSize = new Size(400, 230);
        Controls.Add(new Label { Text = "Mot de passe administrateur", AutoSize = true, Location = new Point(30, 28), ForeColor = Theme.TexteDoux });
        tbMdp.Location = new Point(30, 52); Controls.Add(tbMdp);
        lblMessage.Location = new Point(30, 88); Controls.Add(lblMessage);
        var btnOk = new Button { Text = "Valider", Size = new Size(160, 38), Location = new Point(30, 155) };
        var btnAnnuler = new Button { Text = "Annuler", Size = new Size(120, 38), Location = new Point(210, 155), DialogResult = DialogResult.Cancel };
        Theme.Bouton(btnOk, true); Theme.Bouton(btnAnnuler, false); Controls.AddRange(new Control[] { btnOk, btnAnnuler });
        AcceptButton = btnOk; CancelButton = btnAnnuler;
        btnOk.Click += (s, e) =>
        {
            try
            {
                var resultat = Acces.VerifierAdmin(tbMdp.Text, out var message);
                if (resultat != Acces.Resultat.Ok) { lblMessage.Text = message; tbMdp.Clear(); tbMdp.Focus(); return; }
                DialogResult = DialogResult.OK;
            }
            catch (Exception ex) { lblMessage.Text = "Verification impossible : " + ex.Message; }
        };
        Shown += (s, e) => tbMdp.Focus();
    }
}
