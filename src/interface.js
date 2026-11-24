"use strict";
// Interface utilisateur : navigation, filtres, tableaux et graphiques.
const racineInterface = document.querySelector("#interface"),
  reglesMetier = window.ReglesMetier;
const etatInterface = {
  rapports: [],
  utilisateur: null,
  administrateur: false,
  onglet: "home",
  mois: new Date().toISOString().slice(0, 7),
  jour: "",
  debutPeriode: "",
  finPeriode: "",
  ancienneBaseDisponible: false,
  ancienneBaseConnectee: false,
  questionAncienneBaseAffichee: false,
  minuteurActualisation: null,
  versionSession: 0,
  identifiantRapportArretsSelectionne: null,
  cibleArretsSelectionnee: null,
};
const selectionner = (s, root = document) => root.querySelector(s),
  echapperTexteHtml = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const formaterDate = (x) =>
  x ? new Date(x + "T00:00:00").toLocaleDateString("fr-FR") : "";
// jetonFiltreDate : traduit le filtre de dates en suffixe lisible pour le fichier exporté.
function jetonFiltreDate(datePrecise = "") {
  const compact = (date) => String(date || "").replaceAll("-", "");
  if (datePrecise) return compact(datePrecise);
  if (etatInterface.debutPeriode || etatInterface.finPeriode)
    return `${compact(etatInterface.debutPeriode) || "sans-debut"}_au_${compact(etatInterface.finPeriode) || "sans-fin"}`;
  if (etatInterface.mois && etatInterface.jour) return compact(`${etatInterface.mois}-${etatInterface.jour}`);
  if (etatInterface.mois) return compact(etatInterface.mois);
  return "toutes-dates";
}
window.addEventListener("focus", () => {
  const password = selectionner("#formulaireConnexion input[name='motDePasse']");
  if (password && document.activeElement !== password)
    password.focus({ preventScroll: true });
  if (etatInterface.administrateur && etatInterface.onglet === "home" && !document.querySelector(".fenetre-modale"))
    actualiserDonneesAdmin();
});
function afficherNotification(s) {
  const e = document.createElement("div");
  e.className = "notification";
  e.textContent = s;
  document.body.append(e);
  setTimeout(() => e.remove(), 3200);
}
async function rechargerDonnees(versionAttendue = etatInterface.versionSession) {
  const x = await rapportQuart.chargerDonneesInitiales();
  if (versionAttendue !== etatInterface.versionSession) return false;
  etatInterface.rapports = x.reports || [];
  etatInterface.utilisateurs = x.users || [];
  etatInterface.administrateurInitialise = x.adminSet;
  etatInterface.cleRecuperation = x.recoveryKey;
  etatInterface.cleInitialisationAdministrateur = x.recoveryKeyForSetup;
  etatInterface.ancienneBaseDisponible = x.legacyAvailable;
  etatInterface.ancienneBaseConnectee = x.legacyConnected;
  return true;
}
let actualisationEnCours = false;
// Actualise l’interface admin quand un autre processus a enregistré un rapport.
async function actualiserDonneesAdmin() {
  if (!etatInterface.administrateur || actualisationEnCours || document.querySelector(".fenetre-modale")) return;
  actualisationEnCours = true;
  const previousReports = JSON.stringify(etatInterface.rapports);
  try {
    await rechargerDonnees();
    if (etatInterface.administrateur && JSON.stringify(etatInterface.rapports) !== previousReports) afficherEcran();
  } catch (error) {
    console.error("Actualisation des rapports impossible :", error);
  } finally {
    actualisationEnCours = false;
  }
}
function afficherConnexion(refocaliserApresConnexion = false) {
  racineInterface.innerHTML = `<main class="connexion panneau">
    <h1>Rapport Chef de Quart</h1>
    <p class="discret">Connexion</p>
    <form id="formulaireConnexion">
      <label class="champ">Profil
        <select name="profil">
          <option value="A">Équipe A — ${echapperTexteHtml(reglesMetier.EQUIPES.A)}</option>
          <option value="B">Équipe B — ${echapperTexteHtml(reglesMetier.EQUIPES.B)}</option>
          <option value="C">Équipe C — ${echapperTexteHtml(reglesMetier.EQUIPES.C)}</option>
          <option value="D">Équipe D — ${echapperTexteHtml(reglesMetier.EQUIPES.D)}</option>
          <option value="Administrateur">Administrateur</option>
        </select>
      </label>
      <label class="champ">Mot de passe
        <input name="motDePasse" type="password" required maxlength="64" autocomplete="current-password">
      </label>
      <label class="champ" id="conteneurConfirmation">Confirmer le mot de passe
        <input name="confirmation" type="password" maxlength="64" autocomplete="new-password">
      </label>
      <p class="discret" id="messageConnexion"></p>
      <div class="actions actions-connexion">
        <button type="submit">Se connecter</button>
        <button type="button" id="motDePasseOublie" class="secondaire">Mot de passe oublié ?</button>
      </div>
    </form>
  </main>`;
  const form = selectionner("#formulaireConnexion"),
    profil = form.elements.profil;
  const mode = () => {
    const admin = profil.value === "Administrateur",
      exists = etatInterface.utilisateurs.includes(profil.value);
    selectionner("#conteneurConfirmation").classList.toggle("masque", exists);
    const confirmation = selectionner("#conteneurConfirmation").querySelector("input");
    confirmation.required = !exists;
    confirmation.disabled = exists;
    if (exists) confirmation.value = "";
    selectionner("#messageConnexion").textContent = admin
      ? etatInterface.administrateurInitialise
        ? "Connectez-vous pour ouvrir le tableau de bord administrateur."
        : "Première connexion : le compte administrateur doit être initialisé avec la clé de récupération."
      : exists
        ? ""
        : "Première utilisation : choisissez et confirmez un mot de passe (6 caractères minimum).";
  };
  profil.onchange = mode;
  mode();
  const focusPassword = () => {
    const password = form.elements.motDePasse;
    if (!password.isConnected) return;
    window.focus();
    password.focus({ preventScroll: true });
    rapportQuart.activerApplication()
      .catch(() => false)
      .then(() => {
        if (!password.isConnected) return;
        window.focus();
        password.focus({ preventScroll: true });
      });
  };
  requestAnimationFrame(focusPassword);
  if (refocaliserApresConnexion) {
    setTimeout(focusPassword, 100);
    setTimeout(focusPassword, 350);
    setTimeout(focusPassword, 700);
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const sessionVersion = ++etatInterface.versionSession;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const f = new FormData(form);
    let res;
    try {
      res = await rapportQuart.connecterUtilisateur({
        user: f.get("profil"),
        password: f.get("motDePasse"),
        confirmation: f.get("confirmation"),
        recoveryKey: etatInterface.administrateurInitialise ? "" : etatInterface.cleInitialisationAdministrateur,
      });
    } catch (error) {
      selectionner("#messageConnexion").textContent = `Connexion impossible : ${error.message}`;
      submitButton.disabled = false;
      return;
    }
    if (!res.ok) {
      selectionner("#messageConnexion").textContent = res.message;
      submitButton.disabled = false;
      return;
    }
    etatInterface.utilisateur = res.user;
    etatInterface.administrateur = res.user === "Administrateur";
    etatInterface.onglet = etatInterface.administrateur ? "home" : "create";
    window.utilisateurActif = etatInterface.utilisateur;
    try {
      if (!(await rechargerDonnees(sessionVersion))) return;
    } catch (error) {
      etatInterface.utilisateur = null;
      etatInterface.administrateur = false;
      window.utilisateurActif = null;
      await rapportQuart.deconnecterUtilisateur();
      selectionner("#messageConnexion").textContent = `Connexion interrompue : ${error.message}`;
      submitButton.disabled = false;
      return;
    }
    if (etatInterface.administrateur && !etatInterface.minuteurActualisation)
      etatInterface.minuteurActualisation = setInterval(actualiserDonneesAdmin, 5000);
    afficherEcran();
    afficherNotification(res.first ? "Mot de passe initialisé." : "Connexion établie.");
    if (
      etatInterface.administrateur &&
      etatInterface.ancienneBaseDisponible &&
      !etatInterface.ancienneBaseConnectee &&
      !etatInterface.questionAncienneBaseAffichee
    ) {
      etatInterface.questionAncienneBaseAffichee = true;
      try {
        const result = await rapportQuart.importerAncienneBase({ automatic: true });
        if (result) {
          await rechargerDonnees();
          afficherEcran();
          afficherNotification(
            `${result.imported} rapport(s) importé(s) depuis l’ancienne base.`,
          );
        }
      } catch (error) {
        alert(`Import de l’ancienne base impossible : ${error.message}`);
      }
    }
  };
  selectionner("#motDePasseOublie").onclick = () => dialogueReinitialisationMotDePasse(user.value);
}
function dialogueReinitialisationMotDePasse(user) {
  if (user === "Administrateur") {
    afficherNotification(
      "Pour réinitialiser l’administrateur, utilisez la clé de récupération au premier paramétrage.",
    );
    return;
  }
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="fenetre-modale"><section class="panneau"><h2>Réinitialiser le mot de passe</h2><form id="formulaireReinitialisation"><label class="champ">Équipe<select name="profil">${Object.keys(
      reglesMetier.EQUIPES,
    )
      .map(
        (t) =>
          `<option value="${t}" ${t === user ? "selected" : ""}>Équipe ${t}</option>`,
      )
      .join(
        "",
      )}</select></label><label class="champ">Clé de récupération<input name="cleRecuperation" required></label><label class="champ">Nouveau mot de passe<input name="nouveau" type="password" minlength="6" maxlength="64" required></label><label class="champ">Confirmer le mot de passe<input name="confirmation" type="password" required></label><p id="erreurReinitialisation" class="discret"></p><div class="actions"><button>Réinitialiser</button><button type="button" class="secondaire" onclick="this.closest('.fenetre-modale').remove()">Annuler</button></div></form></section></div>`,
  );
  selectionner("#formulaireReinitialisation").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await rapportQuart.reinitialiserMotDePasseEquipe({
        user: f.get("profil"),
        recoveryKey: f.get("cleRecuperation"),
        next: f.get("nouveau"),
        confirmation: f.get("confirmation"),
      });
      document.querySelector(".fenetre-modale").remove();
      await rechargerDonnees();
      afficherConnexion();
      afficherNotification("Mot de passe réinitialisé.");
    } catch (x) {
      selectionner("#erreurReinitialisation").textContent = x.message;
    }
  };
}
function afficherStructureApplication() {
  const rangeActive = Boolean(etatInterface.debutPeriode || etatInterface.finPeriode);
  const tabs = [
    ["home", "Tableau de bord"],
    ...(!etatInterface.administrateur ? [["create", "Créer un rapport"]] : []),
    ["reports", "Rapports enregistrés"],
    ...(!etatInterface.administrateur ? [["history", "Historique"]] : []),
    ["stops", "Temps d’arrêt par zone"],
  ];
  const [year, month] = etatInterface.mois.split("-").map(Number),
    count = Number.isFinite(year) && month ? new Date(year, month, 0).getDate() : 31,
    showFilters = Boolean(etatInterface.utilisateur);
  const titles = {
    home: "Tableau de bord",
    create: "Créer un rapport",
    reports: "Rapports enregistrés",
    history: "Historique",
    stops: "Temps d’arrêt par zone",
  };
  const equipeActions = etatInterface.administrateur
    ? ""
    : '<button id="changerEquipe" class="secondaire">Changer d’équipe</button>';
  const peutSynchroniser = etatInterface.administrateur || ["A", "B", "C", "D"].includes(etatInterface.utilisateur);
  return `<div class="coquille"><aside class="barre-laterale"><div class="usine">EXAT Missehi<br><small>Rapport de quart</small></div>${peutSynchroniser ? '<button id="synchroniserRapports" class="bouton-synchronisation">⇧ Synchroniser les rapports</button>' : ""}${tabs.map(([k, t]) => `<button data-onglet="${k}" class="${etatInterface.onglet === k ? "actif" : ""}">${t}</button>`).join("")}${equipeActions}<button id="motDePasse" class="secondaire">Changer le mot de passe</button><button id="deconnexion" class="deconnexion">Déconnexion</button></aside><section class="principal"><header class="entete"><h1>${titles[etatInterface.onglet]}</h1>${
    showFilters
      ? `<div class="filtres"><label>Mois <input id="mois" type="month" value="${etatInterface.mois}" ${rangeActive ? "disabled" : ""}></label><label>Jour <select id="jour" ${rangeActive ? "disabled" : ""}><option value="">Tous les jours</option>${Array.from(
          { length: count },
          (_, i) => String(i + 1).padStart(2, "0"),
        )
          .map(
            (d) =>
              `<option value="${d}" ${etatInterface.jour === d ? "selected" : ""}>${d}</option>`,
          )
          .join(
            "",
          )}</select></label>${etatInterface.administrateur ? `<fieldset class="filtre-periode"><legend>Période</legend><label>Du <input id="debutPeriode" type="date" value="${etatInterface.debutPeriode}"></label><label>Au <input id="finPeriode" type="date" value="${etatInterface.finPeriode}"></label>${rangeActive ? '<button type="button" id="effacerPeriode" class="secondaire">Effacer</button>' : ""}</fieldset>` : ""}<button id="actualiser" class="secondaire">Actualiser</button></div>`
      : ""
  }</header><main class="contenu" id="vue"></main></section></div>`;
}
function afficherEcran() {
  racineInterface.innerHTML = afficherStructureApplication();
  document.querySelectorAll("[data-onglet]").forEach(
    (b) =>
      (b.onclick = () => {
        etatInterface.onglet = b.dataset.onglet;
        afficherEcran();
      }),
  );
  selectionner("#deconnexion").onclick = () => confirmerFermetureSession(
    "Voulez-vous vraiment vous déconnecter ?",
  );
  selectionner("#motDePasse").onclick = dialogueMotDePasse;
  if (selectionner("#synchroniserRapports"))
    selectionner("#synchroniserRapports").onclick = dialogueSynchronisationDistante;
  if (!etatInterface.administrateur)
    selectionner("#changerEquipe").onclick = () => confirmerFermetureSession(
      "Voulez-vous vous déconnecter pour changer d’équipe ?",
    );
  if (selectionner("#actualiser"))
    selectionner("#actualiser").onclick = async () => {
      await rechargerDonnees();
      afficherEcran();
    };
  if (selectionner("#mois"))
    selectionner("#mois").onchange = (e) => {
      etatInterface.mois = e.target.value;
      etatInterface.jour = "";
      afficherEcran();
    };
  if (selectionner("#jour"))
    selectionner("#jour").onchange = (e) => {
      etatInterface.jour = e.target.value;
      afficherEcran();
    };
  if (selectionner("#debutPeriode"))
    selectionner("#debutPeriode").onchange = (e) => {
      etatInterface.debutPeriode = e.target.value;
      if (etatInterface.finPeriode && etatInterface.debutPeriode > etatInterface.finPeriode)
        etatInterface.finPeriode = etatInterface.debutPeriode;
      afficherEcran();
    };
  if (selectionner("#finPeriode"))
    selectionner("#finPeriode").onchange = (e) => {
      etatInterface.finPeriode = e.target.value;
      if (etatInterface.debutPeriode && etatInterface.finPeriode < etatInterface.debutPeriode)
        etatInterface.debutPeriode = etatInterface.finPeriode;
      afficherEcran();
    };
  if (selectionner("#effacerPeriode"))
    selectionner("#effacerPeriode").onclick = () => {
      etatInterface.debutPeriode = "";
      etatInterface.finPeriode = "";
      afficherEcran();
    };
  const view = selectionner("#vue");
  (
    ({
      home: afficherAccueil,
      create: afficherCreation,
      reports: afficherRapports,
      history: afficherHistorique,
      stops: afficherVueArrets,
    })[etatInterface.onglet] || afficherCreation
  )(view);
  if (etatInterface.identifiantRapportArretsSelectionne && etatInterface.cibleArretsSelectionnee) {
    const target = selectionner(`#${etatInterface.cibleArretsSelectionnee}`);
    if (target) afficherArrets(etatInterface.identifiantRapportArretsSelectionne, etatInterface.cibleArretsSelectionnee);
  }
}
async function fermerSession() {
  const sessionVersion = ++etatInterface.versionSession;
  if (etatInterface.minuteurActualisation) clearInterval(etatInterface.minuteurActualisation);
  etatInterface.minuteurActualisation = null;
  etatInterface.utilisateur = null;
  etatInterface.administrateur = false;
  etatInterface.onglet = "home";
  etatInterface.rapports = [];
  etatInterface.debutPeriode = "";
  etatInterface.finPeriode = "";
  window.utilisateurActif = null;
  document.querySelectorAll(".fenetre-modale, .tiroir-synthese, .menu-ligne").forEach((el) => el.remove());
  try {
    await rapportQuart.deconnecterUtilisateur();
  } catch (error) {
    console.error("Fermeture de session interrompue :", error);
  } finally {
    if (sessionVersion === etatInterface.versionSession) afficherConnexion(true);
  }
}
// Confirmation intégrée : une boîte native pouvait conserver le focus clavier
// après sa fermeture et empêcher la saisie du mot de passe dans Electron.
function confirmerFermetureSession(message) {
  const modal = document.createElement("div");
  modal.className = "fenetre-modale";
  modal.innerHTML = `<section class="panneau"><h2>Fermer la session</h2><p>${echapperTexteHtml(message)}</p><div class="actions"><button type="button" class="confirmation-session">Se déconnecter</button><button type="button" class="secondaire annuler-session">Annuler</button></div></section>`;
  document.body.append(modal);
  modal.querySelector(".annuler-session").onclick = () => modal.remove();
  modal.querySelector(".confirmation-session").onclick = async () => {
    modal.remove();
    await fermerSession();
  };
  modal.querySelector(".confirmation-session").focus();
}
function dialogueMotDePasse() {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="fenetre-modale"><section class="panneau"><h2>Changer le mot de passe</h2><form id="formulaireMotDePasse"><label class="champ">Mot de passe actuel<input name="actuel" type="password" required maxlength="64"></label><label class="champ">Nouveau mot de passe<input name="nouveau" type="password" required maxlength="64"></label><label class="champ">Confirmer le nouveau mot de passe<input name="confirmation" type="password" required maxlength="64"></label><div class="actions"><button>Enregistrer</button><button type="button" class="secondaire" onclick="this.closest('.fenetre-modale').remove()">Annuler</button></div><p class="discret" id="erreurMotDePasse"></p></form></section></div>`,
  );
  selectionner("#formulaireMotDePasse").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get("nouveau") !== f.get("confirmation")) {
      selectionner("#erreurMotDePasse").textContent =
        "Les deux mots de passe sont différents.";
      return;
    }
    try {
      await rapportQuart.changerMotDePasse({
        current: f.get("actuel"),
        next: f.get("nouveau"),
      });
      document.querySelector(".fenetre-modale").remove();
      await rechargerDonnees();
      afficherNotification("Mot de passe modifié.");
    } catch (x) {
      selectionner("#erreurMotDePasse").textContent = x.message;
    }
  };
}
function dialogueSynchronisationDistante() {
  const rapportsUtilisateur = etatInterface.administrateur
    ? etatInterface.rapports
    : etatInterface.rapports.filter((rapport) => rapport.equipe === etatInterface.utilisateur);
  const total = rapportsUtilisateur.length;
  const modal = document.createElement("div");
  modal.className = "fenetre-modale";
  const portee = etatInterface.administrateur ? "tous les rapports locaux" : `les rapports de l’équipe ${etatInterface.utilisateur}`;
  modal.innerHTML = `<section class="panneau"><h2>Synchroniser les rapports</h2><p>${total} rapport(s) (${portee}) seront envoyés vers le portail administrateur Vercel par connexion HTTPS. Les rapports déjà présents seront actualisés. Les identifiants du portail ne seront pas enregistrés sur ce poste.</p><form id="formulaireSynchronisation"><label class="champ">Identifiant du portail<input name="username" required maxlength="100" autocomplete="username"></label><label class="champ">Mot de passe du portail<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label><p class="discret" id="etatSynchronisation"></p><div class="actions"><button type="submit" ${total ? "" : "disabled"}>Envoyer ${total} rapport(s)</button><button type="button" class="secondaire" onclick="this.closest('.fenetre-modale').remove()">Annuler</button></div></form></section>`;
  document.body.append(modal);
  const form = modal.querySelector("#formulaireSynchronisation");
  const status = modal.querySelector("#etatSynchronisation");
  const submit = form.querySelector('button[type="submit"]');
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!etatInterface.administrateur && !["A", "B", "C", "D"].includes(etatInterface.utilisateur)) {
      modal.remove();
      return;
    }
    const values = new FormData(form);
    const username = String(values.get("username") || "");
    const password = String(values.get("password") || "");
    submit.disabled = true;
    status.textContent = "Synchronisation en cours…";
    try {
      const result = await rapportQuart.synchroniserRapportsDistants({ username, password });
      form.elements.password.value = "";
      status.textContent = `${result.synced} rapport(s) synchronisé(s) sur ${result.total}.`;
      form.querySelector('button[type="button"]').textContent = "Fermer";
    } catch (error) {
      form.elements.password.value = "";
      status.textContent = error.message || "Synchronisation impossible.";
      submit.disabled = !etatInterface.rapports.length;
    }
  };
  form.elements.username.focus();
}
// periode : applique les filtres de date et respecte l’historique complet des équipes.
function rapportsPeriode() {
  if (!etatInterface.administrateur && etatInterface.onglet === "history") return etatInterface.rapports;
  const ranged = Boolean(etatInterface.debutPeriode || etatInterface.finPeriode);
  return etatInterface.rapports.filter((r) => {
    const date = String(r.date || "");
    if (ranged)
      return (!etatInterface.debutPeriode || date >= etatInterface.debutPeriode) &&
        (!etatInterface.finPeriode || date <= etatInterface.finPeriode);
    return date.startsWith(etatInterface.mois) &&
      (!etatInterface.jour || date.slice(8, 10) === etatInterface.jour);
  });
}
// arretsDuRapport : rassemble les arrêts du rapport et ceux de ses trois séchoirs.
function arretsDuRapport(r) {
  return [
    ...(r.stops || []),
    ...(r.drying?.sechoirs || []).flatMap((x) =>
      (x.stops || []).map((s) => ({ ...s, zone: `Séchoir ${x.number}` })),
    ),
  ].map((s) => ({
    ...s,
    minutes: reglesMetier.dureeArret(s),
    date: r.date,
    quart: r.quart,
    equipe: r.equipe,
    id: r.id,
  }));
}
function tousLesArrets(rs = rapportsPeriode()) {
  return rs.flatMap(arretsDuRapport);
}
function calculerSomme(a) {
  return a.reduce((n, x) => n + (Number(x) || 0), 0);
}
function courbeProduction(reports, mode = "day") {
  const year = etatInterface.mois.slice(0, 4),
    chartReports =
      mode === "month"
        ? etatInterface.rapports.filter((r) => String(r.date || "").startsWith(year))
        : reports,
    dates =
      mode === "month"
        ? [...new Set(chartReports.map((r) => String(r.date).slice(0, 7)))].sort()
        : [...new Set(chartReports.map((r) => r.date))].sort();
  if (!dates.length)
    return '<p class="discret">Aucune production enregistrée pour cette période.</p>';

  const equipes = Object.keys(reglesMetier.EQUIPES);
  const colors = ["#2563eb", "#f59e0b", "#FF2C2C", "#16a34a"];
  const values = equipes.map((equipe) =>
    dates.map((date) =>
      calculerSomme(
        chartReports
          .filter((r) => String(r.date || "").startsWith(date) && r.equipe === equipe)
          .map((r) => r.production?.paniers),
      ),
    ),
  );
  const max = Math.max(1, ...values.flat());
  const width = Math.max(720, dates.length * 48);
  const height = 260;
  const left = 58;
  const right = width - 18;
  const top = 18;
  const bottom = 218;
  const xAt = (index) =>
    dates.length === 1
      ? (left + right) / 2
      : left + (index / (dates.length - 1)) * (right - left);
  const yAt = (value) => bottom - (value / max) * (bottom - top);
  const compact = (value) => Math.round(value).toLocaleString("fr-FR");

  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = (max / 4) * index;
    const y = yAt(value);
    return `<g class="grille-graphique"><line x1="${left}" y1="${y}" x2="${right}" y2="${y}"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${compact(value)}</text></g>`;
  }).join("");

  const series = values
    .map((points, equipeIndex) => {
      const coords = points.map((value, index) => [xAt(index), yAt(value)]);
      const path =
        coords.length === 1
          ? `M${coords[0][0]},${coords[0][1]}`
          : coords.slice(1).reduce((commands, [x, y], index) => {
              const [previousX, previousY] = coords[index];
              const controlOffset = (x - previousX) / 3;
              return `${commands} C${previousX + controlOffset},${previousY} ${x - controlOffset},${y} ${x},${y}`;
            }, `M${coords[0][0]},${coords[0][1]}`);
      const markers = coords
        .map(
          ([x, y], index) =>
          `<circle cx="${x}" cy="${y}" r="4" fill="${colors[equipeIndex]}"><title>Équipe ${equipes[equipeIndex]} · ${dates[index]} : ${compact(points[index])} colis</title></circle>`,
        )
        .join("");
      return `<g class="serie-graphique"><path d="${path}" stroke="${colors[equipeIndex]}"/>${markers}</g>`;
    })
    .join("");

  const labels = dates
    .map(
      (date, index) =>
        `<text class="date-graphique" x="${xAt(index)}" y="244" text-anchor="middle">${mode === "month" ? new Date(`${date}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) : date.slice(8, 10)}</text>`,
    )
    .join("");
  const legend = equipes
    .map(
      (equipe, index) =>
        `<span><i style="background:${colors[index]}"></i>Équipe ${equipe}</span>`,
    )
    .join("");

  return `<div class="graphique-ligne-avec-legende"><div class="conteneur-graphique-ligne"><svg class="graphique-ligne" viewBox="0 0 ${width} ${height}" role="img" aria-label="Évolution de la production par équipe ${mode === "month" ? "par mois" : "par jour"}">${grid}${series}${labels}</svg></div><div class="legende">${legend}</div></div>`;
}
function rapportModifiable(report) {
  if (!report || etatInterface.administrateur || report.equipe !== etatInterface.utilisateur || !report.createdAt)
    return false;
  const created = Date.parse(report.createdAt);
  return Number.isFinite(created) && Date.now() - created <= 8 * 60 * 60 * 1000;
}
function tableauRapports(rs, avecActions = false, actionsHistorique = false) {
  return `<div class="conteneur-tableau"><table><thead><tr><th>Date</th><th>Quart</th><th>Équipe</th><th>Effectif présent</th><th>Production</th><th>Tonnage (kg)</th>${avecActions ? "<th>Action</th>" : ""}</tr></thead><tbody>${rs
    .map((r) => {
      const d = reglesMetier.calculerIndicateurs(r);
      const action = actionsHistorique
        ? rapportModifiable(r)
          ? `<button data-modifier="${echapperTexteHtml(r.id)}">Revoir / modifier</button>`
          : `<button class="secondaire" data-ouvrir="${echapperTexteHtml(r.id)}">Voir</button>`
        : `<button class="secondaire" data-ouvrir="${echapperTexteHtml(r.id)}">Voir</button> <button data-synthese="${echapperTexteHtml(r.id)}">Synthèse</button>`;
      return `<tr class="ligne-rapport" data-identifiant="${echapperTexteHtml(r.id)}"><td>${formaterDate(r.date)}</td><td>${echapperTexteHtml(r.quart)}</td><td>${echapperTexteHtml(r.equipe)}</td><td>${d.present}</td><td>${Number(r.production?.paniers || 0)}</td><td>${d.kg.toLocaleString("fr-FR")}</td>${avecActions ? `<td>${action}</td>` : ""}</tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function lierBoutonsRapport(root = document) {
  root
    .querySelectorAll("[data-ouvrir]")
    .forEach((b) => (b.onclick = (event) => {
      event.stopPropagation();
      ouvrirRapport(b.dataset.ouvrir);
    }));
  root
    .querySelectorAll("[data-synthese]")
    .forEach((b) => (b.onclick = (event) => {
      event.stopPropagation();
      afficherSynthese(b.dataset.synthese);
    }));
  root
    .querySelectorAll("[data-modifier]")
    .forEach((b) => (b.onclick = (event) => {
      event.stopPropagation();
      const report = etatInterface.rapports.find((item) => item.id === b.dataset.modifier);
      if (!rapportModifiable(report)) {
        afficherNotification("Le délai de modification de 8 heures est dépassé.");
        return;
      }
      creerRapport(report);
    }));
}
// afficherAccueil : construit les indicateurs, les six zones, le camembert et la courbe.
function afficherAccueil(el) {
  const rs = rapportsPeriode(),
    st = tousLesArrets(rs),
    prod = calculerSomme(rs.map((r) => r.production?.paniers)),
    zones = reglesMetier.ZONES_ARRET.map((zone) => ({
      name: zone,
      minutes: calculerSomme(st.filter((stop) => stop.zone === zone).map((stop) => stop.minutes)),
    })),
    colors = ["#2563eb", "#f59e0b", "#FF2C2C", "#16a34a"],
    equipes = Object.keys(reglesMetier.EQUIPES),
    totals = equipes.map((equipe) =>
      calculerSomme(rs.filter((r) => r.equipe === equipe).map((r) => r.production?.paniers)),
    );
  const productionTotal = calculerSomme(totals);
  let angle = 0;
  const slices = totals
    .map((value, index) => {
      const start = angle;
      angle += productionTotal ? (value / productionTotal) * 360 : 0;
      return `${colors[index]} ${start}deg ${angle}deg`;
    })
    .join(",");
  angle = 0;
  // Place la lettre de chaque équipe et sa part sur le secteur correspondant.
  const pieLabels = productionTotal
    ? equipes
        .map((equipe, index) => {
          const sweep = (totals[index] / productionTotal) * 360;
          const middle = angle + sweep / 2;
          angle += sweep;

          const radians = (middle - 90) * (Math.PI / 180);
          const x = 50 + Math.cos(radians) * 28;
          const y = 50 + Math.sin(radians) * 28;
          const percent = ((totals[index] / productionTotal) * 100).toLocaleString(
            "fr-FR",
            { maximumFractionDigits: 1 },
          );

          return `<span class="etiquette-camembert" style="left:${x}%;top:${y}%">${equipe}<br>${percent} %</span>`;
        })
        .join("")
    : "";

  const chartMonths = new Set(rs.map((r) => String(r.date || "").slice(0, 7)).filter(Boolean)),
    chartMode = chartMonths.size > 1 ? "month" : "day",
    chartTitle = chartMode === "month" ? "par mois" : "par jour";

  el.innerHTML = `<div class="cartes">
    <div class="carte">Rapports enregistrés<b>${rs.length}</b></div>
    <div class="carte">Production de la période<b>${prod.toLocaleString("fr-FR")} colis</b></div>
  </div>
  <div class="grille-deux resume-accueil">
    <section class="panneau zones-accueil">
      <h2>Temps d’arrêt par zone</h2>
      <div class="grille-zones">${zones.map(({ name, minutes }) =>
        `<article class="carte-zone"><span>${echapperTexteHtml(name)}</span><b>${reglesMetier.formaterDuree(minutes)}</b></article>`,
      ).join("")}</div>
    </section>
    <section class="panneau repartition-accueil">
      <h2>Répartition de la production par équipe</h2>
      <div class="disposition-camembert">
        <div class="camembert" style="background:conic-gradient(${slices || "#dbe5ef 0deg 360deg"})">${pieLabels}</div>
        <div>${equipes.map((equipe, index) => {
          const percent = productionTotal
            ? ((totals[index] / productionTotal) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })
            : "0";
          return `<div class="ligne-zone"><span><i class="point" style="background:${colors[index]}"></i>Équipe ${equipe} · ${percent} %</span><b>${totals[index].toLocaleString("fr-FR")} colis</b></div>`;
        }).join("")}</div>
      </div>
    </section>
  </div>
  <section class="panneau tendance-accueil">
    <h2>Évolution de la production par équipe — ${chartTitle}</h2>
    ${courbeProduction(rs, chartMode)}
  </section>`;
}
function afficherCreation(el) {
  el.innerHTML = `<section class="panneau"><h2>Nouveau rapport de quart</h2><p class="discret">Créez ou complétez le rapport de votre équipe. Les rapports enregistrés restent consultables dans l’historique.</p><button id="demarrerRapport">Créer un rapport</button></section>`;
  selectionner("#demarrerRapport").onclick = () => creerRapport();
}
function afficherRapports(el) {
  const rs = rapportsPeriode();
  const exportButton = etatInterface.administrateur ? '<div class="actions"><button id="exporterRapports" class="secondaire">Exporter Excel</button></div>' : "";
  el.innerHTML = `<section class="panneau"><h2>Rapports enregistrés</h2>${tableauRapports(rs, true)}${exportButton}<h3>Arrêts du rapport sélectionné</h3><div id="arretsRapport" class="discret">Sélectionnez un rapport dans le tableau.</div></section>`;
  lierBoutonsRapport();
  document.querySelectorAll("tbody tr[data-identifiant]").forEach((tr) => {
    tr.onclick = () => afficherArrets(tr.dataset.identifiant);
    tr.ondblclick = () => afficherArrets(tr.dataset.identifiant);
    tr.oncontextmenu = (e) => {
      e.preventDefault();
      afficherActionsContextuelles(tr.dataset.identifiant, e.clientX, e.clientY);
    };
  });
  if (etatInterface.administrateur) selectionner("#exporterRapports").onclick = () => exporterRapports(rs);
}
function afficherHistorique(el) {
  el.innerHTML = `<section class="panneau"><h2>Historique</h2><div class="actions"><label>Date <input type="date" id="filtreDate"></label><label>Quart <select id="filtreQuart"><option value="">Tous</option>${reglesMetier.QUARTS.map((x) => `<option>${x}</option>`).join("")}</select></label><label>Équipe <select id="filtreEquipe"><option value="">Toutes</option>${Object.keys(
    reglesMetier.EQUIPES,
  )
    .map((x) => `<option value="${x}">${x}</option>`)
    .join(
      "",
    )}</select></label><button id="effacerFiltres" class="secondaire">Effacer les filtres</button>${etatInterface.administrateur ? '<button id="exporterHistorique">Exporter Excel</button>' : ""}</div><div id="tableauHistorique">${tableauRapports(rapportsPeriode(), !etatInterface.administrateur, !etatInterface.administrateur)}</div><h3>Arrêts du rapport sélectionné</h3><div id="arretsHistorique" class="discret">Sélectionnez un rapport.</div></section>`;
  const apply = () => {
    let list = rapportsPeriode();
    const date = selectionner("#filtreDate").value,
      quart = selectionner("#filtreQuart").value,
      equipe = selectionner("#filtreEquipe").value;
    list = list.filter(
      (r) =>
        (!date || r.date === date) &&
        (!quart || r.quart === quart) &&
        (!equipe || r.equipe === equipe),
    );
    selectionner("#tableauHistorique").innerHTML = tableauRapports(
      list,
      !etatInterface.administrateur,
      !etatInterface.administrateur,
    );
    document
      .querySelectorAll("#tableauHistorique tbody tr[data-identifiant]")
      .forEach((tr) => {
        tr.onclick = () => afficherArrets(tr.dataset.identifiant, "historyStops");
        tr.ondblclick = () => afficherSynthese(tr.dataset.identifiant);
      });
    lierBoutonsRapport(selectionner("#tableauHistorique"));
    if (etatInterface.administrateur)
      selectionner("#exporterHistorique").onclick = () =>
        exporterRapports(list, selectionner("#filtreDate").value);
  };
  ["filtreDate", "filtreQuart", "filtreEquipe"].forEach(
    (id) => (selectionner("#" + id).onchange = apply),
  );
  selectionner("#effacerFiltres").onclick = () => {
    selectionner("#filtreDate").value = "";
    selectionner("#filtreQuart").value = "";
    selectionner("#filtreEquipe").value = "";
    apply();
  };
  apply();
}
function afficherActionsContextuelles(id, x, y) {
  document.querySelector(".menu-ligne")?.remove();
  const m = document.createElement("div");
  m.className = "menu-ligne";
  m.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:8;background:white;border:1px solid #cbd5e1;border-radius:8px;padding:6px;box-shadow:0 5px 20px #0003`;
  m.innerHTML =
    '<button class="secondaire" data-action="open">Voir le rapport de quart</button><button data-action="synth">Voir la synthèse de quart</button>';
  document.body.append(m);
  m.onclick = (e) => {
    const a = e.target.dataset.action;
    m.remove();
    if (a === "open") ouvrirRapport(id);
    if (a === "synth") afficherSynthese(id);
  };
  setTimeout(
    () => document.addEventListener("click", () => m.remove(), { once: true }),
    0,
  );
}
function afficherArrets(id, target = "reportStops") {
  const r = etatInterface.rapports.find((x) => x.id === id);
  if (!r) return;
  const stops = arretsDuRapport(r);
  etatInterface.identifiantRapportArretsSelectionne = id;
  etatInterface.cibleArretsSelectionnee = target;
  const box = selectionner(`#${target}`);
  if (!stops.length) {
    box.innerHTML = "<p>Aucun arrêt enregistré pour ce rapport.</p>";
    return;
  }
  box.innerHTML = `<div class="conteneur-tableau"><table><thead><tr><th>Zone</th><th>Début</th><th>Fin</th><th>Cause</th><th>Durée</th></tr></thead><tbody>${stops.map((s) => `<tr><td>${echapperTexteHtml(s.zone)}</td><td>${echapperTexteHtml(reglesMetier.formaterHeure(s.start))}</td><td>${echapperTexteHtml(reglesMetier.formaterHeure(s.end))}</td><td>${echapperTexteHtml(s.cause)}</td><td>${reglesMetier.formaterDuree(s.minutes)}</td></tr>`).join("")}</tbody></table></div>`;
}
function afficherVueArrets(el) {
  const st = tousLesArrets().sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      reglesMetier.QUARTS.indexOf(a.quart) - reglesMetier.QUARTS.indexOf(b.quart) ||
      a.equipe.localeCompare(b.equipe) ||
      (reglesMetier.lireHeureEnMinutes(a.start) ?? 0) - (reglesMetier.lireHeureEnMinutes(b.start) ?? 0),
  );
  const zoneTotals = reglesMetier.ZONES_ARRET.map((zone) => ({
    name: zone,
    minutes: calculerSomme(st.filter((stop) => stop.zone === zone).map((stop) => stop.minutes)),
  }));
  const zoneCards = zoneTotals
    .map(
      ({ name, minutes }) =>
        `<article class="carte-zone"><span>${echapperTexteHtml(name)}</span><b>${reglesMetier.formaterDuree(minutes)}</b></article>`,
    )
    .join("");
  const rows = st
    .map((s, i) => {
      const prev = st[i - 1],
        startGroup =
          !prev ||
          `${prev.date}|${prev.quart}|${prev.equipe}` !==
            `${s.date}|${s.quart}|${s.equipe}`;
      return `<tr class="${startGroup ? "debut-groupe-arrets" : ""}"><td>${formaterDate(s.date)}</td><td>${echapperTexteHtml(s.quart)}</td><td>${echapperTexteHtml(s.equipe)}</td><td>${echapperTexteHtml(s.zone)}</td><td>${echapperTexteHtml(reglesMetier.formaterHeure(s.start))}–${echapperTexteHtml(reglesMetier.formaterHeure(s.end))}</td><td>${echapperTexteHtml(s.cause)}</td><td>${reglesMetier.formaterDuree(s.minutes)}</td></tr>`;
    })
    .join("");
  el.innerHTML = `<div class="actions"><button id="exporterArrets">Exporter les arrêts XLSX</button></div><section class="panneau resume-arrets"><h2>Temps d’arrêt par zone</h2><div class="grille-zones">${zoneCards}</div></section><section class="panneau details-arrets"><h2>Détail par jour et quart — un arrêt distinct par ligne</h2><div class="conteneur-tableau"><table><thead><tr><th>Jour</th><th>Quart</th><th>Équipe</th><th>Zone</th><th>Heures</th><th>Cause</th><th>Durée</th></tr></thead><tbody>${rows || '<tr><td colspan="7">Aucun arrêt enregistré pour cette période.</td></tr>'}</tbody></table></div></section>`;
  selectionner("#exporterArrets").onclick = async () => {
    const rows = [
      ["Jour", "Quart", "Équipe", "Zone", "Début", "Fin", "Cause", "Durée"],
      ...st.map((s) => [
        formaterDate(s.date),
        s.quart,
        s.equipe,
        s.zone,
        reglesMetier.formaterHeure(s.start),
        reglesMetier.formaterHeure(s.end),
        s.cause,
        reglesMetier.formaterDuree(s.minutes),
      ]),
    ];
    if (
      await rapportQuart.exporterClasseurExcel({
        name: `temps-arret_${jetonFiltreDate()}.xlsx`,
        rows,
      })
    )
      afficherNotification("Export XLSX terminé");
  };
}
function creerRapport(rapportExistant = null) {
  const hits = {};
  etatInterface.rapports.forEach((r) =>
    arretsDuRapport(r).forEach((s) => {
      if (!s.cause) return;
      const k = s.zone || "Autre";
      hits[k] ||= {};
      hits[k][s.cause] = (hits[k][s.cause] || 0) + 1;
    }),
  );
  window.suggestionsArret = Object.fromEntries(
    Object.entries(hits).map(([z, m]) => [
      z,
      Object.entries(m)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([cause]) => cause),
    ]),
  );
  FormulaireRapport.afficherFormulaire(rapportExistant, async (r) => {
    try {
      const errors = reglesMetier.validerRapport(r);
      if (errors.length) throw new Error(errors.join("\n"));
      // Le même créneau ne peut appartenir qu’à une seule équipe.
      const reportId = `${r.date}_${r.quart}_${r.equipe}`;
      const duplicate = etatInterface.rapports.find(
        (saved) => saved.date === r.date && saved.quart === r.quart && saved.id !== reportId,
      );
      if (duplicate)
        throw new Error(
          `Un rapport existe déjà pour cette date et ce quart (équipe ${duplicate.equipe}).`,
        );
      await rapportQuart.enregistrerRapport(r);
      await rechargerDonnees();
      afficherEcran();
      afficherNotification("Rapport enregistré.");
      // Ouvre immédiatement la synthèse du rapport tout juste sauvegardé.
      const saved = etatInterface.rapports.find(
        (item) => item.date === r.date && item.quart === r.quart && item.equipe === r.equipe,
      );
      if (saved) {
        afficherSynthese(saved.id);
        try {
          const capturePath = await capturerTableauSynthese(saved);
          afficherEtatCapture(`Capture effectuée. Fichier enregistré ici : ${capturePath}`);
          afficherNotification(`Synthèse capturée : ${capturePath}`);
        } catch (captureError) {
          // Le rapport est déjà sauvegardé : une erreur de capture ne doit pas
          // laisser croire à l’opérateur que l’enregistrement a échoué.
          console.error("Capture automatique de la synthèse impossible :", captureError);
          afficherEtatCapture(`La capture n’a pas pu être effectuée : ${captureError.message}`);
          afficherNotification(`Rapport enregistré, capture impossible : ${captureError.message}`);
        }
      }
      return true;
    } catch (e) {
      alert(e.message);
      return false;
    }
  });
}
function ouvrirRapport(id) {
  const r = etatInterface.rapports.find((x) => x.id === id);
  if (!r) return;
  const d = reglesMetier.calculerIndicateurs(r),
    fmt = (k, v) =>
      `<div class="ligne-zone"><span>${echapperTexteHtml(k)}</span><b>${v == null || v === "" ? "—" : echapperTexteHtml(v)}</b></div>`,
    stops = arretsDuRapport(r);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="fenetre-modale"><section class="panneau rapport-lecture-seule"><h2 class="titre-rapport"><span>Rapport de quart</span><button type="button" class="secondaire" onclick="this.closest('.fenetre-modale').remove()">Fermer</button></h2><p>${formaterDate(r.date)} · ${echapperTexteHtml(r.quart)} · Équipe ${echapperTexteHtml(r.equipe)} — ${echapperTexteHtml(reglesMetier.EQUIPES[r.equipe])}</p><h3>Effectif</h3>${fmt("Total", r.staff?.total)}${fmt("Présents", d.present)}${fmt("Absents", r.staff?.absent)}${fmt("Malades", r.staff?.malade)}${fmt("Permissions", r.staff?.permission)}${fmt("Congés", r.staff?.conge)}${fmt("Accidents", r.staff?.accidents)}<h3>Prélavage</h3>${fmt("Box 1", r.prelavage?.box)}${fmt("Godets", r.prelavage?.buckets)}${fmt("Total prélavé", `${reglesMetier.calculerIndicateurs(r).prelavageTotal.toLocaleString("fr-FR")} kg`)}${fmt("Box 2", r.prelavage?.secondBox)}${fmt("Godets box 2", r.prelavage?.secondBuckets)}<h3>Granulation</h3>${fmt("Box usinage", r.granulation?.box)}${fmt("Titre acide (g/l)", r.granulation?.acidTitre)}${fmt("Consommation acide (kg)", r.granulation?.acidConsumption)}${fmt("Paniers granulés", r.granulation?.baskets)}${fmt("Avance paniers", r.granulation?.basketAdvance)}${fmt("Paniers lavés", r.granulation?.basketsWashed)}<h3>Séchage et production</h3>${fmt("Paniers séchés", r.drying?.basketsDry)}${fmt("Production (colis)", r.production?.paniers)}${fmt("Tonnage (kg)", d.kg)}${fmt("Balles début / quart / traitées / fin", [r.production?.balesStart, r.production?.balesquart, r.production?.balesProcessed, r.production?.balesEnd].join(" / "))}${(r.drying?.sechoirs || []).map((x) => `<h4>Séchoir ${x.number}</h4>${fmt("Cycle / brûleurs 1–2", `${x.cycle} sec / ${x.bruleur1} / ${x.bruleur2}`)}${fmt("Compteur / gaz", `${x.counter || "—"} / ${x.gas1 || "—"} / ${x.gas2 || "—"}`)}`).join("")}<h3>Arrêts du quart</h3>${stops.length ? `<div class="conteneur-tableau"><table><thead><tr><th>Zone</th><th>Début</th><th>Fin</th><th>Cause</th><th>Durée</th></tr></thead><tbody>${stops.map((s) => `<tr><td>${echapperTexteHtml(s.zone)}</td><td>${reglesMetier.formaterHeure(s.start)}</td><td>${reglesMetier.formaterHeure(s.end)}</td><td>${echapperTexteHtml(s.cause)}</td><td>${reglesMetier.formaterDuree(s.minutes)}</td></tr>`).join("")}</tbody></table></div>` : "<p>Aucun arrêt.</p>"}<h3>Groupes électrogènes</h3>${Object.entries(
      r.generators || {},
    )
      .map(([name, items]) =>
        fmt(
          name,
          (items || [])
            .map((x) => `${reglesMetier.formaterHeure(x.start)}–${reglesMetier.formaterHeure(x.end)}`)
            .join(", ") || "Aucune période",
        ),
      )
      .join(
        "",
      )}<div class="actions"><button class="secondaire" onclick="this.closest('.fenetre-modale').remove()">Fermer</button></div></section></div>`,
  );
}
// afficherSynthese : affiche les lignes calculées par le modèle métier dans le tableau de quart.
function afficherSynthese(id) {
  const r = etatInterface.rapports.find((x) => x.id === id);
  if (!r) return;
  const current = document.querySelector(".tiroir-synthese");
  if (current?.dataset.rapport === id) {
    current.closest(".fenetre-synthese")?.remove();
    return;
  }
  const rows = reglesMetier.lignesSynthese(r);
  current?.closest(".fenetre-synthese")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="fenetre-modale fenetre-synthese"><section class="tiroir-synthese panneau" data-rapport="${echapperTexteHtml(id)}">
      <div class="capture-synthese" id="captureSynthese">
        <div class="titre-synthese"><h2>Synthèse de la production du quart</h2></div>
        <p class="infos-synthese">${formaterDate(r.date)} · ${echapperTexteHtml(r.quart)} · Équipe ${echapperTexteHtml(r.equipe)} — ${echapperTexteHtml(reglesMetier.EQUIPES[r.equipe])}</p>
        <div class="conteneur-tableau-synthese"><table class="tableau-synthese">
          <thead><tr><th>Information</th><th>Valeur</th></tr></thead>
          <tbody>${rows.map((row) => {
            const value = row.value == null || row.value === ""
              ? "—"
              : typeof row.value === "number"
                ? row.value.toLocaleString("fr-FR")
                : row.value;
            const ton = row.tone === "danger" ? "ton-alerte" : row.tone ? "ton-reussite" : "";
            return `<tr class="${ton}"><td>${echapperTexteHtml(row.label)}</td><td class="${row.highlight ? "mise-en-evidence" : ""}">${echapperTexteHtml(value)}</td></tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>
      <div class="actions-synthese">
        <div class="boutons-synthese"><button id="capturerSynthese" class="secondaire">Capturer le tableau</button><button id="ouvrirCaptures" class="secondaire">Ouvrir le dossier de capture</button>
        <button type="button" class="secondaire fermer-synthese">Fermer</button>
        </div><p class="etat-synthese" id="etatCapture" role="status" aria-live="polite"></p>
      </div>
    </section></div>`,
  );
  selectionner(".fermer-synthese").onclick = () =>
    document.querySelector(".fenetre-synthese")?.remove();
  selectionner("#capturerSynthese").onclick = async () => {
    try {
      const file = await capturerTableauSynthese(r);
      afficherEtatCapture(`Capture effectuée. Fichier enregistré ici : ${file}`);
      afficherNotification("Capture de la synthèse enregistrée.");
    } catch (e) {
      afficherEtatCapture(`La capture n’a pas pu être effectuée : ${e.message}`);
    }
  };
  selectionner("#ouvrirCaptures").onclick = async () => {
    const error = await rapportQuart.ouvrirDossierCaptures();
    if (error) afficherEtatCapture(`Ouverture du dossier impossible : ${error}`);
  };
}
function afficherEtatCapture(message) {
  const status = document.querySelector("#etatCapture");
  if (status) status.textContent = message;
}
// Capture le tableau entier, en levant temporairement le défilement interne.
async function capturerTableauSynthese(report) {
  const node = document.querySelector("#captureSynthese");
  if (!node) throw new Error("La synthèse n’est pas affichée.");
  const modal = node.closest(".fenetre-synthese");
  const drawer = node.closest(".tiroir-synthese");
  const wrap = node.querySelector(".conteneur-tableau-synthese");
  const table = node.querySelector(".tableau-synthese");
  const cells = node.querySelectorAll(".tableau-synthese th, .tableau-synthese td");
  const savedStyles = [modal, drawer, node, wrap, table].map((element) => element.style.cssText);
  const savedCellStyles = [...cells].map((cell) => cell.style.cssText);
  try {
    drawer.style.height = "auto";
    drawer.style.maxHeight = "none";
    drawer.style.overflow = "visible";
    node.style.flex = "none";
    node.style.minHeight = "auto";
    wrap.style.height = "auto";
    wrap.style.maxHeight = "none";
    wrap.style.flex = "none";
    wrap.style.overflow = "visible";
    table.style.height = "auto";
    // Ajuste la hauteur des lignes pour faire tenir toutes les données dans
    // la fenêtre, y compris sur les petits écrans.
    const rowHeight = Math.max(
      12,
      Math.min(32, (window.innerHeight * 0.82 - 170) / table.rows.length),
    );
    cells.forEach((cell) => {
      cell.style.height = `${rowHeight}px`;
      cell.style.fontSize = `${Math.max(9, Math.min(13, rowHeight * 0.46))}px`;
    });
    // Deux frames laissent Chromium recalculer la taille réelle du tableau.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const bounds = node.getBoundingClientRect();
    const safeName = String(report.quart || "Quart").replace(/[^\w-]+/g, "-");
    return await rapportQuart.capturerSynthese({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      reportId: report.id,
      name: `Synthese_${report.date}_${safeName}.png`,
    });
  } finally {
    [modal, drawer, node, wrap, table].forEach((element, index) => {
      element.style.cssText = savedStyles[index];
    });
    [...cells].forEach((cell, index) => {
      cell.style.cssText = savedCellStyles[index];
    });
  }
}
// exporterRapports : exporte les rapports visibles en reprenant la date du filtre.
async function exporterRapports(rs, datePrecise = "") {
  const rows = [
    [
      "Date",
      "Quart",
      "Équipe",
      "Effectif présent",
      "Production",
      "Tonnage (kg)",
    ],
    ...rs.map((r) => {
      const d = reglesMetier.calculerIndicateurs(r);
      return [
        formaterDate(r.date),
        r.quart,
        r.equipe,
        d.present,
        r.production?.paniers,
        d.kg,
      ];
    }),
  ];
  if (
    await rapportQuart.exporterClasseurExcel({
      name: `rapports-quart_${jetonFiltreDate(datePrecise)}.xlsx`,
      rows,
    })
  )
    afficherNotification("Export Excel terminé");
}
async function initialiserApplication() {
  await rechargerDonnees();
  if (etatInterface.cleRecuperation) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="fenetre-modale fenetre-recuperation"><section class="panneau"><h2>Notez la clé de récupération</h2><p>Elle permet d'initialiser l'administrateur, de réinitialiser un mot de passe d'équipe et de déplacer une sauvegarde. Conservez-la en lieu sûr.</p><p class="code-recuperation">${echapperTexteHtml(etatInterface.cleRecuperation)}</p><button id="copierCleRecuperation" class="secondaire">Copier la clé</button><label class="champ confirmation-recuperation"><input type="checkbox" id="cleRecuperationEnregistree"> J'ai noté cette clé et je la range en lieu sûr</label><button id="confirmerRecuperation" disabled>Continuer</button></section></div>`,
    );
    selectionner("#copierCleRecuperation").onclick = async () => {
      try {
        await navigator.clipboard.writeText(etatInterface.cleRecuperation);
        afficherNotification("Clé copiée.");
      } catch {
        afficherNotification("Copie indisponible : notez la clé affichée.");
      }
    };
    selectionner("#cleRecuperationEnregistree").onchange = (e) =>
      (selectionner("#confirmerRecuperation").disabled = !e.target.checked);
    selectionner("#confirmerRecuperation").onclick = async () => {
      await rapportQuart.confirmerCleRecuperation();
      document.querySelector(".fenetre-recuperation").remove();
      etatInterface.cleRecuperation = null;
      afficherConnexion();
    };
  }
}
initialiserApplication()
  .then(afficherConnexion)
  .catch((e) => {
    racineInterface.textContent = "Erreur de démarrage : " + e.message;
  });
