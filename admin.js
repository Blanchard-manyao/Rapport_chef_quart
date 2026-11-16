"use strict";

const zonesArret = ["Prélavage", "Conditionnement", "Ligne 1", "Ligne 2", "Séchoir 1", "Séchoir 2", "Séchoir 3", "Autre"];
const equipes = ["A", "B", "C", "D"];
const couleurs = ["#2563eb", "#f59e0b", "#ff2c2c", "#16a34a"];
const etat = { rapports: [], debut: "", fin: "", mois: new Date().toISOString().slice(0, 7), jour: "", onglet: "home" };
const elements = {
  connexion: document.querySelector("#connexion"), tableau: document.querySelector("#tableauDeBord"),
  formulaire: document.querySelector("#formulaireConnexion"), message: document.querySelector("#message"),
  deconnexion: document.querySelector("#deconnexion"), actualiser: document.querySelector("#actualiser"),
  contenu: document.querySelector("#contenu"), titre: document.querySelector("#titreVue"), mois: document.querySelector("#mois"), jour: document.querySelector("#jour"),
  debut: document.querySelector("#debutPeriode"), fin: document.querySelector("#finPeriode"),
};

function message(texte) {
  elements.message.textContent = texte;
  elements.message.classList.toggle("masque", !texte);
}

async function demander(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "La requête a échoué.");
  return result;
}

const nombre = (valeur) => Number(valeur) || 0;
const somme = (valeurs) => valeurs.reduce((total, valeur) => total + nombre(valeur), 0);
const echapper = (valeur) => String(valeur ?? "").replace(/[&<>"']/g, (caractere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[caractere]);
const formaterDate = (date) => date ? new Date(`${date}T00:00:00`).toLocaleDateString("fr-FR") : "—";
const formaterNombre = (valeur) => valeur.toLocaleString("fr-FR");

function filtrerRapports() {
  const plageActive = Boolean(etat.debut || etat.fin);
  return etat.rapports.filter((rapport) => {
    const date = String(rapport.date || "");
    if (plageActive) return (!etat.debut || date >= etat.debut) && (!etat.fin || date <= etat.fin);
    return date.startsWith(etat.mois) && (!etat.jour || date.slice(8, 10) === etat.jour);
  });
}

function arretsDuRapport(rapport) {
  const arrets = [
    ...(rapport.stops || []),
    ...(rapport.drying?.sechoirs || []).flatMap((sechoir) => (sechoir.stops || []).map((arret) => ({ ...arret, zone: `Séchoir ${sechoir.number}` }))),
  ];
  return arrets.map((arret) => {
    const heure = (valeur) => {
      const correspondance = String(valeur ?? "").trim().match(/^(\d{1,2})\s*[:hH.]\s*(\d{0,2})$/);
      if (!correspondance || Number(correspondance[1]) > 23 || Number(correspondance[2] || 0) > 59) return null;
      return Number(correspondance[1]) * 60 + Number(correspondance[2] || 0);
    };
    const debut = heure(arret.start), fin = heure(arret.end);
    const duree = debut === null || fin === null ? 0 : (fin - debut + 1440) % 1440;
    return { ...arret, minutes: duree };
  });
}

function duree(minutes) {
  const n = Math.max(0, Math.trunc(minutes));
  return `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, "0")} min`;
}

function courbeProduction(rapports, mode) {
  const annee = etat.mois.slice(0, 4);
  const rapportsGraphique = mode === "month"
    ? etat.rapports.filter((rapport) => String(rapport.date || "").startsWith(annee))
    : rapports;
  const dates = [...new Set(rapportsGraphique.map((rapport) => String(rapport.date || "").slice(0, mode === "month" ? 7 : 10)).filter(Boolean))].sort();
  if (!dates.length) return '<p class="discret">Aucune production enregistrée pour cette période.</p>';
  const valeurs = equipes.map((equipe) => dates.map((date) => somme(rapportsGraphique.filter((rapport) => String(rapport.date || "").startsWith(date) && rapport.equipe === equipe).map((rapport) => rapport.production?.paniers))));
  const maximum = Math.max(1, ...valeurs.flat());
  const largeur = Math.max(720, dates.length * 48), hauteur = 260, gauche = 58, droite = largeur - 18, haut = 18, bas = 218;
  const x = (index) => dates.length === 1 ? (gauche + droite) / 2 : gauche + index / (dates.length - 1) * (droite - gauche);
  const y = (valeur) => bas - valeur / maximum * (bas - haut);
  const grille = Array.from({ length: 5 }, (_, index) => {
    const valeur = maximum / 4 * index, position = y(valeur);
    return `<g class="grille-graphique"><line x1="${gauche}" y1="${position}" x2="${droite}" y2="${position}"/><text x="${gauche - 8}" y="${position + 4}" text-anchor="end">${formaterNombre(Math.round(valeur))}</text></g>`;
  }).join("");
  const series = valeurs.map((points, index) => {
    const coordonnees = points.map((valeur, point) => [x(point), y(valeur)]);
    const chemin = coordonnees.length === 1 ? `M${coordonnees[0][0]},${coordonnees[0][1]}` : coordonnees.slice(1).reduce((commande, [px, py], point) => {
      const [precedentX, precedentY] = coordonnees[point], offset = (px - precedentX) / 3;
      return `${commande} C${precedentX + offset},${precedentY} ${px - offset},${py} ${px},${py}`;
    }, `M${coordonnees[0][0]},${coordonnees[0][1]}`);
    const pointsSvg = coordonnees.map(([px, py], point) => `<circle cx="${px}" cy="${py}" r="4" fill="${couleurs[index]}"><title>Équipe ${equipes[index]} · ${formaterDate(dates[point])} : ${formaterNombre(points[point])} colis</title></circle>`).join("");
    return `<g class="serie-graphique equipe-${equipes[index].toLowerCase()}"><path d="${chemin}"/>${pointsSvg}</g>`;
  }).join("");
  const libelles = dates.map((date, index) => `<text class="date-graphique" x="${x(index)}" y="244" text-anchor="middle">${mode === "month" ? new Date(`${date}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) : date.slice(8, 10)}</text>`).join("");
  const legende = equipes.map((equipe) => `<span><i class="couleur-equipe-${equipe.toLowerCase()}"></i>Équipe ${equipe}</span>`).join("");
  return `<div class="graphique-ligne-avec-legende"><div class="conteneur-graphique-ligne"><svg class="graphique-ligne" viewBox="0 0 ${largeur} ${hauteur}" role="img" aria-label="Évolution de la production par équipe ${mode === "month" ? "par mois" : "par jour"}">${grille}${series}${libelles}</svg></div><div class="legende">${legende}</div></div>`;
}

function afficherTable(rapports) {
  return `<div class="tableau-defilement"><table><thead><tr><th>Date</th><th>Quart</th><th>Équipe</th><th>Production</th><th>Tonnage (kg)</th></tr></thead><tbody>${rapports.slice(0, 20).map((rapport) => `<tr><td>${formaterDate(rapport.date)}</td><td>${echapper(rapport.quart || "—")}</td><td>${rapport.equipe ? `Équipe ${echapper(rapport.equipe)}` : "—"}</td><td>${formaterNombre(nombre(rapport.production?.paniers))}</td><td>${formaterNombre(nombre(rapport.production?.tonnageKg))}</td></tr>`).join("")}</tbody></table></div>${rapports.length > 20 ? `<p class="discret">20 rapports affichés sur ${rapports.length} pour cette période.</p>` : ""}`;
}

function afficherTableauDeBord() {
  const rapports = filtrerRapports(), arrets = rapports.flatMap(arretsDuRapport);
  const moisDuGraphique = new Set(rapports.map((rapport) => String(rapport.date || "").slice(0, 7)).filter(Boolean));
  const modeGraphique = moisDuGraphique.size > 1 ? "month" : "day";
  const production = somme(rapports.map((rapport) => rapport.production?.paniers));
  const totauxEquipes = equipes.map((equipe) => somme(rapports.filter((rapport) => rapport.equipe === equipe).map((rapport) => rapport.production?.paniers)));
  const totalEquipes = somme(totauxEquipes);
  let angle = 0;
  const secteurs = totalEquipes ? totauxEquipes.map((total, index) => {
    if (!total) return "";
    const debut = angle, balayage = total / totalEquipes * 360;
    angle += balayage;
    if (balayage >= 359.999) return `<circle cx="50" cy="50" r="50" fill="${couleurs[index]}"/>`;
    const radiansDebut = (debut - 90) * Math.PI / 180, radiansFin = (angle - 90) * Math.PI / 180;
    const x1 = 50 + 50 * Math.cos(radiansDebut), y1 = 50 + 50 * Math.sin(radiansDebut);
    const x2 = 50 + 50 * Math.cos(radiansFin), y2 = 50 + 50 * Math.sin(radiansFin);
    return `<path d="M50 50 L${x1} ${y1} A50 50 0 ${balayage > 180 ? 1 : 0} 1 ${x2} ${y2} Z" fill="${couleurs[index]}"/>`;
  }).join("") : '<circle cx="50" cy="50" r="50" fill="#dbe5ef"/>';
  const zones = zonesArret.map((zone) => ({ nom: zone, minutes: somme(arrets.filter((arret) => arret.zone === zone).map((arret) => arret.minutes)) }));
  const repartition = equipes.map((equipe, index) => {
    const part = totalEquipes ? (totauxEquipes[index] / totalEquipes * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "0";
    return `<div class="ligne-zone"><span><i class="point couleur-equipe-${equipe.toLowerCase()}"></i>Équipe ${equipe} · ${part} %</span><b>${formaterNombre(totauxEquipes[index])} colis</b></div>`;
  }).join("");

  elements.contenu.innerHTML = `<div class="cartes"><div class="carte">Rapports enregistrés<b>${formaterNombre(rapports.length)}</b></div><div class="carte">Production de la période<b>${formaterNombre(production)} colis</b></div></div>
    <div class="grille-deux resume-accueil"><section class="panneau zones-accueil"><h2>Temps d’arrêt par zone</h2><div class="grille-zones">${zones.map(({ nom, minutes }) => `<article class="carte-zone"><span>${echapper(nom)}</span><b>${duree(minutes)}</b></article>`).join("")}</div></section>
    <section class="panneau repartition-accueil"><h2>Répartition de la production par équipe</h2><div class="disposition-camembert"><svg class="camembert" viewBox="0 0 100 100" role="img" aria-label="Répartition de la production entre les équipes">${secteurs}</svg><div>${repartition}</div></div></section></div>
    <section class="panneau tendance-accueil"><h2>Évolution de la production par équipe — ${modeGraphique === "month" ? "par mois" : "par jour"}</h2>${courbeProduction(rapports, modeGraphique)}</section>`;
}

function afficherRapportsEnregistres() {
  const rapports = filtrerRapports();
  const lignes = rapports.map((rapport) => {
    const staff = rapport.staff || {};
    const presents = nombre(staff.total) - ["absent", "malade", "permission", "conge"].reduce((total, cle) => total + nombre(staff[cle]), 0);
    return \`<tr><td>\${formaterDate(rapport.date)}</td><td>\${echapper(rapport.quart || "—")}</td><td>\${echapper(rapport.equipe || "—")}</td><td>\${presents}</td><td>\${formaterNombre(nombre(rapport.production?.paniers))}</td><td>\${formaterNombre(nombre(rapport.production?.tonnageKg))}</td></tr>\`;
  }).join("");
  elements.contenu.innerHTML = \`<section class="panneau"><h2>Rapports enregistrés</h2><p class="discret">\${rapports.length} rapport(s) pour la période sélectionnée.</p><div class="tableau-defilement"><table><thead><tr><th>Date</th><th>Quart</th><th>Équipe</th><th>Effectif présent</th><th>Production</th><th>Tonnage (kg)</th></tr></thead><tbody>\${lignes || '<tr><td colspan="6">Aucun rapport enregistré pour cette période.</td></tr>'}</tbody></table></div></section>\`;
}

function afficherTempsArret() {
  const arrets = filtrerRapports().flatMap((rapport) => arretsDuRapport(rapport).map((arret) => ({
    ...arret, date: rapport.date, quart: rapport.quart, equipe: rapport.equipe,
  }))).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.quart).localeCompare(String(b.quart)) || String(a.equipe).localeCompare(String(b.equipe)));
  const totaux = zonesArret.map((zone) => ({ zone, minutes: somme(arrets.filter((arret) => arret.zone === zone).map((arret) => arret.minutes)) }));
  const cartes = totaux.map(({ zone, minutes }) => \`<article class="carte-zone"><span>\${echapper(zone)}</span><b>\${duree(minutes)}</b></article>\`).join("");
  const lignes = arrets.map((arret) => \`<tr><td>\${formaterDate(arret.date)}</td><td>\${echapper(arret.quart || "—")}</td><td>\${echapper(arret.equipe || "—")}</td><td>\${echapper(arret.zone || "—")}</td><td>\${echapper(arret.start || "—")}–\${echapper(arret.end || "—")}</td><td>\${echapper(arret.cause || "—")}</td><td>\${duree(arret.minutes)}</td></tr>\`).join("");
  elements.contenu.innerHTML = \`<section class="panneau resume-arrets"><h2>Temps d’arrêt par zone</h2><div class="grille-zones">\${cartes}</div></section><section class="panneau details-arrets"><h2>Détail par jour et quart — un arrêt distinct par ligne</h2><div class="tableau-defilement"><table><thead><tr><th>Jour</th><th>Quart</th><th>Équipe</th><th>Zone</th><th>Heures</th><th>Cause</th><th>Durée</th></tr></thead><tbody>\${lignes || '<tr><td colspan="7">Aucun arrêt enregistré pour cette période.</td></tr>'}</tbody></table></div></section>\`;
}

function afficherOnglet() {
  const titres = { home: "Tableau de bord", reports: "Rapports enregistrés", stops: "Temps d’arrêt par zone" };
  elements.titre.textContent = titres[etat.onglet];
  document.querySelectorAll("[data-onglet]").forEach((bouton) => bouton.classList.toggle("actif", bouton.dataset.onglet === etat.onglet));
  if (etat.onglet === "reports") afficherRapportsEnregistres();
  else if (etat.onglet === "stops") afficherTempsArret();
  else afficherTableauDeBord();
}

function synchroniserFiltres() {
  elements.mois.value = etat.mois;
  elements.debut.value = etat.debut;
  elements.fin.value = etat.fin;
  const plageActive = Boolean(etat.debut || etat.fin);
  elements.mois.disabled = plageActive;
  elements.jour.disabled = plageActive;
  const [annee, mois] = etat.mois.split("-").map(Number);
  const jours = Number.isFinite(annee) && mois ? new Date(annee, mois, 0).getDate() : 31;
  elements.jour.innerHTML = '<option value="">Tous les jours</option>' + Array.from({ length: jours }, (_, index) => String(index + 1).padStart(2, "0")).map((jour) => `<option value="${jour}" ${jour === etat.jour ? "selected" : ""}>${jour}</option>`).join("");
  document.querySelector("#effacerPeriode").classList.toggle("masque", !plageActive);
}

async function chargerRapports() {
  message("");
  try {
    const { reports } = await demander("/api/admin/reports");
    etat.rapports = reports || [];
    elements.connexion.classList.add("masque");
    elements.tableau.classList.remove("masque");
    elements.deconnexion.classList.remove("masque");
    document.querySelector("#entetePortail").classList.add("masque");
    document.body.classList.add("connecte");
    synchroniserFiltres();
    afficherOnglet();
  } catch (error) {
    if (error.message.includes("Session administrateur")) {
      elements.connexion.classList.remove("masque");
      elements.tableau.classList.add("masque");
      elements.deconnexion.classList.add("masque");
      return;
    }
    message(error.message);
  }
}

elements.formulaire.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(elements.formulaire);
  try {
    await demander("/api/admin/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
    elements.formulaire.reset();
    await chargerRapports();
  } catch (error) { message(error.message); }
});

elements.actualiser.addEventListener("click", chargerRapports);
document.querySelectorAll("[data-onglet]").forEach((bouton) => bouton.addEventListener("click", () => { etat.onglet = bouton.dataset.onglet; afficherOnglet(); }));
elements.mois.addEventListener("change", () => { etat.mois = elements.mois.value; etat.jour = ""; afficherOnglet(); synchroniserFiltres(); });
elements.jour.addEventListener("change", () => { etat.jour = elements.jour.value; afficherOnglet(); });
elements.debut.addEventListener("change", () => { etat.debut = elements.debut.value; if (etat.fin && etat.debut > etat.fin) etat.fin = etat.debut; afficherOnglet(); synchroniserFiltres(); });
elements.fin.addEventListener("change", () => { etat.fin = elements.fin.value; if (etat.debut && etat.fin < etat.debut) etat.debut = etat.fin; afficherOnglet(); synchroniserFiltres(); });
document.querySelector("#effacerPeriode").addEventListener("click", () => { etat.debut = ""; etat.fin = ""; afficherOnglet(); synchroniserFiltres(); });
elements.deconnexion.addEventListener("click", async () => {
  await demander("/api/admin/logout", { method: "POST", body: "{}" });
  elements.tableau.classList.add("masque"); elements.deconnexion.classList.add("masque");
  elements.connexion.classList.remove("masque"); document.querySelector("#entetePortail").classList.remove("masque");
  document.body.classList.remove("connecte"); message("");
});

chargerRapports();
