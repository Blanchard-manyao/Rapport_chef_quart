"use strict";

const zonesArret = ["Prélavage", "Conditionnement", "Ligne 1", "Ligne 2", "Séchage", "Autre"];
const equipes = ["A", "B", "C", "D"];
const couleurs = ["#2563eb", "#f59e0b", "#ff2c2c", "#16a34a"];
const KG_PAR_COLIS = 1260;
const etat = { rapports: [], debut: "", fin: "", mois: new Date().toISOString().slice(0, 7), jour: "", onglet: "home", objectif: Number(localStorage.getItem("rapport-cq-production-objective")) || 0 };
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

function exporterXlsx(nom, nomFeuille, colonnes, lignes) {
  const feuille = XLSX.utils.aoa_to_sheet([colonnes, ...lignes]);
  feuille["!cols"] = colonnes.map((titre) => ({ wch: Math.min(48, Math.max(14, titre.length + 2)) }));
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, nomFeuille);
  XLSX.writeFile(classeur, nom);
}

function suffixePeriode() {
  if (etat.debut || etat.fin) return `${etat.debut || "sans-debut"}_au_${etat.fin || "sans-fin"}`;
  return `${etat.mois}${etat.jour ? `-${etat.jour}` : ""}`;
}

function exporterRapports() {
  const rapports = filtrerRapports();
  exporterXlsx(`rapports_${suffixePeriode()}.xlsx`, "Rapports",
    ["Date", "Quart", "Équipe", "Effectif total", "Effectif absent", "Production (colis)", "Tonnage (kg)", "Données complètes (JSON)"],
    rapports.map((rapport) => [rapport.date, rapport.quart, rapport.equipe, rapport.staff?.total,
      ["absent", "malade", "permission", "conge"].reduce((total, cle) => total + nombre(rapport.staff?.[cle]), 0),
      rapport.production?.paniers, nombre(rapport.production?.tonnageKg) || nombre(rapport.production?.paniers) * KG_PAR_COLIS, JSON.stringify(rapport)]),
  );
}

function exporterArrets(arrets) {
  exporterXlsx(`arrets_${suffixePeriode()}.xlsx`, "Arrêts",
    ["Jour", "Quart", "Équipe", "Type", "Zone", "Équipement", "Causes", "Heures", "Durée (minutes)"],
    arrets.map((arret) => [arret.date, arret.quart, arret.equipe, arret.impact === "equipment" ? "Panne équipement, zone en marche" : "Arrêt de zone", arret.zone, arret.equipment || "", arret.cause || "", `${arret.start || ""}–${arret.end || ""}`, arret.minutes]),
  );
}

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
    ...(rapport.stops || []).map((arret) => {
      const ancienSechoir = String(arret.zone || "").match(/^Séchoir ([123])$/i);
      return ancienSechoir
        ? { ...arret, zone: "Séchage", equipment: arret.equipment || `Séchoir ${ancienSechoir[1]}` }
        : arret;
    }),
    ...(rapport.drying?.sechoirs || []).flatMap((sechoir) => (sechoir.stops || []).map((arret) => ({ ...arret, zone: "Séchage", equipment: arret.equipment || `Séchoir ${sechoir.number}` }))),
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

function tonnageRapport(rapport) {
  return nombre(rapport.production?.tonnageKg) || nombre(rapport.production?.paniers) * KG_PAR_COLIS;
}

function joursFiltresGraphique(rapports) {
  if (etat.debut || etat.fin) {
    const dates = rapports.map((rapport) => rapport.date).filter(Boolean).sort();
    const debut = etat.debut || dates[0], fin = etat.fin || dates.at(-1);
    if (debut && fin) return Math.floor((Date.parse(`${fin}T00:00:00`) - Date.parse(`${debut}T00:00:00`)) / 86400000) + 1;
  }
  if (etat.jour) return 1;
  const [annee, mois] = etat.mois.split("-").map(Number);
  return annee && mois ? new Date(annee, mois, 0).getDate() : 1;
}

function graphiqueComparaisonQuarts(rapports) {
  const quarts = ["07h-15h", "15h-23h", "23h-07h"];
  const dates = [...new Set(rapports.map(r => r.date).filter(Boolean))].sort();
  const donnees = dates.flatMap(date => quarts.flatMap(quart => equipes.map(equipe => ({ date, quart, equipe, valeur: somme(rapports.filter(r => r.date === date && r.quart === quart && r.equipe === equipe).map(r => r.production?.paniers)) })).filter(x => x.valeur > 0)));
  const maximum = Math.max(1, etat.objectif, ...donnees.map(x => x.valeur)), largeur = Math.max(650, dates.length * 250), hauteur = 290, gauche = 62, droite = largeur - 18, haut = 24, bas = 220;
  const y = (valeur) => bas - valeur / maximum * (bas - haut);
  const grille = Array.from({ length: 5 }, (_, index) => {
    const valeur = maximum * index / 4, position = y(valeur);
    return `<g class="grille-graphique"><line x1="${gauche}" y1="${position}" x2="${droite}" y2="${position}"/><text x="${gauche - 8}" y="${position + 4}" text-anchor="end">${Math.round(valeur).toLocaleString("fr-FR")}</text></g>`;
  }).join("");
  const groupes = dates.flatMap((date, di) => quarts.map((quart, qi) => ({ date, quart, di, qi })));
  const pas = (droite - gauche) / groupes.length;
  const bandes = groupes.map(g => {
    const groupe = donnees.filter(d => d.date === g.date && d.quart === g.quart), bw = Math.max(6, Math.min(26, (pas - 8) / Math.max(1, groupe.length) - 3));
    const bars = groupe.map((d, j) => { const x = gauche + g.di * 3 * pas + g.qi * pas + pas / 2 + (j - (groupe.length - 1) / 2) * (bw + 3) - bw / 2; return `<g><rect x="${x}" y="${y(d.valeur)}" width="${bw}" height="${bas-y(d.valeur)}" rx="3" fill="${couleurs[equipes.indexOf(d.equipe)]}"><title>${formaterDate(d.date)} · ${d.quart} · Équipe ${d.equipe} : ${formaterNombre(d.valeur)} colis</title></rect>${bas-y(d.valeur)>18 ? `<text class="code-equipe-bande" x="${x+bw/2}" y="${Math.min(bas-4,y(d.valeur)+14)}" text-anchor="middle">${d.equipe}</text>` : ""}</g>`; }).join("");
    return `${bars}<text class="date-graphique" x="${gauche + g.di*3*pas + g.qi*pas + pas/2}" y="239" text-anchor="middle">${g.quart}</text>${g.qi === 1 ? `<text class="date-graphique" x="${gauche + g.di*3*pas + 1.5*pas}" y="257" text-anchor="middle">${formaterDate(g.date)}</text>` : ""}`;
  }).join("");
  const objectif = etat.objectif > 0 ? `<line class="ligne-objectif" x1="${gauche}" y1="${y(etat.objectif)}" x2="${droite}" y2="${y(etat.objectif)}"/><text class="etiquette-objectif" x="${droite-2}" y="${y(etat.objectif)-5}" text-anchor="end">Objectif ${formaterNombre(etat.objectif)}</text>` : "";
  const legende = equipes.map((e,i)=>`<span><i style="background:${couleurs[i]}"></i>Équipe ${e}</span>`).join("");
  return `<div class="graphique-ligne-avec-legende"><div class="conteneur-graphique-ligne"><svg class="graphique-ligne graphique-bandes" style="min-width:${largeur}px" viewBox="0 0 ${largeur} ${hauteur}" role="img" aria-label="Production par quart et équipe">${grille}${objectif}${bandes}<text class="date-graphique" transform="translate(16 ${((haut+bas)/2)}) rotate(-90)" text-anchor="middle">Production (colis)</text><text class="date-graphique" x="${(gauche+droite)/2}" y="282" text-anchor="middle">Jour · Quart · Équipe</text></svg></div><div class="legende">${legende}</div></div>`;
}

function courbeProduction(rapports, mode) {
  const annee = etat.mois.slice(0, 4);
  const rapportsGraphique = mode === "month"
    ? etat.rapports.filter((rapport) => String(rapport.date || "").startsWith(annee))
    : rapports;
  const dates = [...new Set(rapportsGraphique.map((rapport) => String(rapport.date || "").slice(0, mode === "month" ? 7 : 10)).filter(Boolean))].sort();
  if (!dates.length) return '<p class="discret">Aucune production enregistrée pour cette période.</p>';
  const valeurs = equipes.map((equipe) => dates.map((date) => somme(rapportsGraphique.filter((rapport) => String(rapport.date || "").startsWith(date) && rapport.equipe === equipe).map((rapport) => rapport.production?.paniers))));
  const maximum = Math.max(1, etat.objectif, ...valeurs.flat());
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
  const objectif = etat.objectif > 0 ? `<line class="ligne-objectif" x1="${gauche}" y1="${y(etat.objectif)}" x2="${droite}" y2="${y(etat.objectif)}"/><text class="etiquette-objectif" x="${droite-2}" y="${y(etat.objectif)-5}" text-anchor="end">Objectif ${formaterNombre(etat.objectif)}</text>` : "";
  const legende = equipes.map((equipe) => `<span><i class="couleur-equipe-${equipe.toLowerCase()}"></i>Équipe ${equipe}</span>`).join("");
  return `<div class="graphique-ligne-avec-legende"><div class="conteneur-graphique-ligne"><svg class="graphique-ligne" style="min-width:${largeur}px" viewBox="0 0 ${largeur} ${hauteur}" role="img" aria-label="Évolution de la production par équipe ${mode === "month" ? "par mois" : "par jour"}">${grille}${objectif}${series}${libelles}</svg></div><div class="legende">${legende}</div></div>`;
}

function afficherTable(rapports) {
  return `<div class="tableau-defilement"><table><thead><tr><th>Date</th><th>Quart</th><th>Équipe</th><th>Production</th><th>Tonnage (kg)</th></tr></thead><tbody>${rapports.slice(0, 20).map((rapport) => `<tr><td>${formaterDate(rapport.date)}</td><td>${echapper(rapport.quart || "—")}</td><td>${rapport.equipe ? `Équipe ${echapper(rapport.equipe)}` : "—"}</td><td>${formaterNombre(nombre(rapport.production?.paniers))}</td><td>${formaterNombre(nombre(rapport.production?.tonnageKg))}</td></tr>`).join("")}</tbody></table></div>${rapports.length > 20 ? `<p class="discret">20 rapports affichés sur ${rapports.length} pour cette période.</p>` : ""}`;
}

function afficherTableauDeBord() {
  const rapports = filtrerRapports(), arrets = rapports.flatMap(arretsDuRapport);
  const moisDuGraphique = new Set(rapports.map((rapport) => String(rapport.date || "").slice(0, 7)).filter(Boolean));
  const modeGraphique = moisDuGraphique.size > 1 ? "month" : "day";
  const comparerQuarts = joursFiltresGraphique(rapports) <= 3;
  const production = somme(rapports.map((rapport) => rapport.production?.paniers));
  const tonnageKg = somme(rapports.map((rapport) => nombre(rapport.production?.tonnageKg) || nombre(rapport.production?.paniers) * KG_PAR_COLIS));
  const totauxEquipes = equipes.map((equipe) => somme(rapports.filter((rapport) => rapport.equipe === equipe).map((rapport) => rapport.production?.paniers)));
  const totalEquipes = somme(totauxEquipes);
  let angle = 0;
  const etiquettesSecteurs = [];
  const secteurs = totalEquipes ? totauxEquipes.map((total, index) => {
    if (!total) return "";
    const debut = angle, balayage = total / totalEquipes * 360;
    angle += balayage;
    if (balayage >= 359.999) {
      etiquettesSecteurs.push(`<text class="etiquette-equipe-camembert" x="50" y="54">${equipes[index]}</text>`);
      return `<circle cx="50" cy="50" r="50" fill="${couleurs[index]}"><title>Équipe ${equipes[index]} · ${formaterNombre(total)} colis</title></circle>`;
    }
    const radiansDebut = (debut - 90) * Math.PI / 180, radiansFin = (angle - 90) * Math.PI / 180;
    const x1 = 50 + 50 * Math.cos(radiansDebut), y1 = 50 + 50 * Math.sin(radiansDebut);
    const x2 = 50 + 50 * Math.cos(radiansFin), y2 = 50 + 50 * Math.sin(radiansFin);
    const milieu = (debut + balayage / 2 - 90) * Math.PI / 180;
    const xEtiquette = 50 + 31 * Math.cos(milieu), yEtiquette = 50 + 31 * Math.sin(milieu) + 3;
    etiquettesSecteurs.push(`<text class="etiquette-equipe-camembert" x="${xEtiquette}" y="${yEtiquette}">${equipes[index]}</text>`);
    return `<path d="M50 50 L${x1} ${y1} A50 50 0 ${balayage > 180 ? 1 : 0} 1 ${x2} ${y2} Z" fill="${couleurs[index]}"><title>Équipe ${equipes[index]} · ${formaterNombre(total)} colis</title></path>`;
  }).join("") : '<circle cx="50" cy="50" r="50" fill="#dbe5ef"/>';
  const zones = zonesArret.filter((zone) => zone !== "Séchage").map((zone) => ({ nom: zone, minutes: somme(arrets.filter((arret) => arret.zone === zone && arret.impact !== "equipment").map((arret) => arret.minutes)) }))
    .concat([1, 2, 3].map((number) => ({ nom: `Séchoir ${number}`, minutes: somme(arrets.filter((arret) => arret.zone === "Séchage" && arret.equipment === `Séchoir ${number}` && arret.impact !== "equipment").map((arret) => arret.minutes)) })));
  const repartition = equipes.map((equipe, index) => {
    const part = totalEquipes ? (totauxEquipes[index] / totalEquipes * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "0";
    return `<div class="ligne-zone"><span><i class="point couleur-equipe-${equipe.toLowerCase()}"></i>Équipe ${equipe} · ${part} %</span><b>${formaterNombre(totauxEquipes[index])} colis</b></div>`;
  }).join("");

  elements.contenu.innerHTML = `<div class="cartes"><div class="carte"><span>Rapports enregistrés</span><b>${formaterNombre(rapports.length)}</b></div><div class="carte"><span>Nombre de colis</span><b>${formaterNombre(production)}</b></div><div class="carte"><span>Tonnage réalisé</span><b>${formaterNombre(tonnageKg)} kg</b></div></div>
    <div class="grille-deux resume-accueil"><section class="panneau zones-accueil"><h2>Temps d’arrêt par zone</h2><div class="grille-zones">${zones.map(({ nom, minutes }) => `<article class="carte-zone"><span>${echapper(nom)}</span><b>${duree(minutes)}</b></article>`).join("")}</div></section>
    <section class="panneau repartition-accueil"><h2>Répartition de la production par équipe</h2><div class="disposition-camembert"><svg class="camembert" viewBox="0 0 100 100" role="img" aria-label="Répartition de la production entre les équipes">${secteurs}${etiquettesSecteurs.join("")}</svg><div>${repartition}</div></div></section></div>
    <section class="panneau tendance-accueil"><div class="entete-tableau"><h2>${comparerQuarts ? "Production par Quart" : `Évolution de la production par équipe — ${modeGraphique === "month" ? "par mois" : "par jour"}`}</h2><label class="objectif-production">Objectif (colis/quart)<input id="objectifProduction" type="number" min="0" step="1" value="${etat.objectif || ""}" placeholder="Saisir un objectif"></label></div>${comparerQuarts ? graphiqueComparaisonQuarts(rapports) : courbeProduction(rapports, modeGraphique)}</section>`;
  const objectifInput = document.querySelector("#objectifProduction");
  objectifInput.addEventListener("change", () => { etat.objectif = Math.max(0, Number(objectifInput.value) || 0); localStorage.setItem("rapport-cq-production-objective", String(etat.objectif)); afficherTableauDeBord(); });
}

function afficherRapportsEnregistres() {
  const rapports = filtrerRapports();
  const lignes = rapports.map((rapport) => {
    const staff = rapport.staff || {};
    const presents = nombre(staff.total) - ["absent", "malade", "permission", "conge"].reduce((total, cle) => total + nombre(staff[cle]), 0);
    return `<tr><td>${formaterDate(rapport.date)}</td><td>${echapper(rapport.quart || "—")}</td><td>${echapper(rapport.equipe || "—")}</td><td>${presents}</td><td>${formaterNombre(nombre(rapport.production?.paniers))}</td><td>${formaterNombre(tonnageRapport(rapport))}</td><td><button class="bouton secondaire" type="button" data-voir-rapport="${echapper(rapport.id)}">Voir le rapport</button></td></tr>`;
  }).join("");
  elements.contenu.innerHTML = `<section class="panneau"><div class="entete-tableau"><h2>Rapports enregistrés</h2><button class="bouton secondaire" id="exporterRapports" type="button">Exporter les rapports Excel</button></div><p class="discret">${rapports.length} rapport(s) pour la période sélectionnée.</p><div class="tableau-defilement"><table><thead><tr><th>Date</th><th>Quart</th><th>Équipe</th><th>Effectif présent</th><th>Production</th><th>Tonnage (kg)</th><th>Rapport</th></tr></thead><tbody>${lignes || '<tr><td colspan="7">Aucun rapport enregistré pour cette période.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector("#exporterRapports").onclick = exporterRapports;
  document.querySelectorAll("[data-voir-rapport]").forEach((button) => {
    button.onclick = () => ouvrirRapportEnLigne(rapports.find((rapport) => rapport.id === button.dataset.voirRapport));
  });
}

function heureEnMinutes(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})\s*[:hH.]\s*(\d{1,2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function ouvrirRapportEnLigne(rapport) {
  if (!rapport) return;
  document.querySelector(".fenetre-rapport-admin")?.remove();
  const format = (label, value) => '<div class="ligne-zone"><span>' + echapper(label) + '</span><b>' + echapper(value ?? "—") + '</b></div>';
  const arrets = arretsDuRapport(rapport);
  const detailsArrets = arrets.length
    ? '<div class="tableau-defilement"><table><thead><tr><th>Zone</th><th>Équipement</th><th>Type</th><th>Cause</th><th>Heures</th><th>Durée</th></tr></thead><tbody>' + arrets.map((arret) => {
      const zone = arret.zone === "Séchage" && arret.equipment ? arret.equipment : arret.zone;
      return '<tr><td>' + echapper(zone) + '</td><td>' + echapper(arret.equipment || "—") + '</td><td>' + (arret.impact === "equipment" ? "Panne équipement, zone en marche" : "Arrêt de zone") + '</td><td>' + echapper(arret.cause || "—") + '</td><td>' + echapper(arret.start || "—") + "–" + echapper(arret.end || "—") + '</td><td>' + duree(arret.minutes) + '</td></tr>';
    }).join("") + '</tbody></table></div>'
    : "<p>Aucun arrêt enregistré.</p>";
  const groupes = Object.entries(rapport.generators || {}).map(([nom, periodes]) => {
    const minutes = (periodes || []).reduce((sum, periode) => {
      const debut = heureEnMinutes(periode.start), fin = heureEnMinutes(periode.end);
      return sum + (debut === null || fin === null ? 0 : (fin - debut + 1440) % 1440);
    }, 0);
    const liste = (periodes || []).map((periode) => echapper(periode.start || "—") + "–" + echapper(periode.end || "—")).join(" · ") || "Aucune période";
    return '<section><h4>' + echapper(nom) + '</h4><p>Périodes : ' + liste + '</p><p>Temps de fonctionnement : <b>' + duree(minutes) + '</b></p></section>';
  }).join("");
  const staff = rapport.staff || {};
  const presents = nombre(staff.total) - ["absent", "malade", "permission", "conge"].reduce((sum, key) => sum + nombre(staff[key]), 0);
  const modal = document.createElement("div");
  modal.className = "fenetre-rapport-admin";
  modal.innerHTML = '<section class="rapport-admin-fiche panneau" role="dialog" aria-modal="true" aria-label="Rapport de quart">' +
    '<header><div><h2>Rapport de quart</h2><p>' + formaterDate(rapport.date) + ' · ' + echapper(rapport.quart) + ' · Équipe ' + echapper(rapport.equipe) + '</p></div><button class="bouton secondaire" type="button" data-fermer-rapport>Fermer</button></header>' +
    '<section><h3>Effectif</h3><div class="grille-zones">' + format("Total", staff.total) + format("Présents", presents) + format("Absents", staff.absent) + format("Malades", staff.malade) + format("Permissions", staff.permission) + format("Congés", staff.conge) + format("Accidents", staff.accidents) + '</div></section>' +
    '<section><h3>Prélavage</h3><div class="grille-zones">' + format("Box 1", rapport.prelavage?.box) + format("Godets", rapport.prelavage?.buckets) + format("Tour de bennes", rapport.prelavage?.tourBennes) + format("Box 2", rapport.prelavage?.secondBox) + format("Godets box 2", rapport.prelavage?.secondBuckets) + '</div></section>' +
    '<section><h3>Granulation</h3><div class="grille-zones">' + format("Box usinage", rapport.granulation?.box) + format("Titre acide (g/l)", rapport.granulation?.acidTitre) + format("Consommation acide (kg)", rapport.granulation?.acidConsumption) + format("Paniers granulés", rapport.granulation?.baskets) + format("Paniers lavés", rapport.granulation?.basketsWashed) + '</div></section>' +
    '<section><h3>Séchage et production</h3><div class="grille-zones">' + format("Paniers séchés", rapport.drying?.basketsDry) + format("Production (colis)", rapport.production?.paniers) + format("Tonnage réalisé", formaterNombre(tonnageRapport(rapport)) + " kg") + format("Balles début / quart / traitées / fin", [rapport.production?.balesStart, rapport.production?.balesquart, rapport.production?.balesProcessed, rapport.production?.balesEnd].join(" / ")) + '</div>' +
    (rapport.drying?.sechoirs || []).map((sechoir) => '<p>Séchoir ' + echapper(sechoir.number) + ' · Cycle ' + echapper(sechoir.cycle) + ' s · Brûleurs ' + echapper(sechoir.bruleur1) + ' / ' + echapper(sechoir.bruleur2) + ' · Compteur ' + echapper(sechoir.counter || "—") + ' · Gaz ' + echapper(sechoir.gas1 || "—") + ' / ' + echapper(sechoir.gas2 || "—") + '</p>').join("") + '</section>' +
    '<section><h3>Arrêts du quart</h3>' + detailsArrets + '</section><section><h3>Groupes électrogènes</h3>' + (groupes || "<p>Aucun groupe électrogène enregistré.</p>") + '</section></section>';
  modal.querySelector("[data-fermer-rapport]").onclick = () => modal.remove();
  modal.addEventListener("click", (event) => { if (event.target === modal) modal.remove(); });
  document.body.append(modal);
}

function afficherTempsArret() {
  const arrets = filtrerRapports().flatMap((rapport) => arretsDuRapport(rapport).map((arret) => ({
    ...arret, date: rapport.date, quart: rapport.quart, equipe: rapport.equipe,
  }))).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.quart).localeCompare(String(b.quart)) || String(a.equipe).localeCompare(String(b.equipe)));
  const totaux = zonesArret.filter((zone) => zone !== "Séchage").map((zone) => ({ zone, minutes: somme(arrets.filter((arret) => arret.zone === zone && arret.impact !== "equipment").map((arret) => arret.minutes)) }))
    .concat([1, 2, 3].map((number) => ({ zone: `Séchoir ${number}`, minutes: somme(arrets.filter((arret) => arret.zone === "Séchage" && arret.equipment === `Séchoir ${number}` && arret.impact !== "equipment").map((arret) => arret.minutes)) })));
  const cartes = totaux.map(({ zone, minutes }) => `<article class="carte-zone"><span>${echapper(zone)}</span><b>${duree(minutes)}</b></article>`).join("");
  const totauxEquipements = Object.entries(arrets.reduce((totaux, arret) => { if (arret.impact !== "equipment") return totaux; const cle = `${arret.zone} — ${arret.equipment || "Équipement non précisé"}`; totaux[cle] = (totaux[cle] || 0) + arret.minutes; return totaux; }, {}));
  const cartesEquipements = totauxEquipements.length ? totauxEquipements.map(([nom, minutes]) => `<article class="carte-zone"><span>${echapper(nom)} · panne sans arrêt de zone</span><b>${duree(minutes)}</b></article>`).join("") : '<p class="discret">Aucune panne d’équipement sans arrêt de zone pour cette période.</p>';
  const lignes = arrets.map((arret, index) => {
    const precedent = arrets[index - 1];
    const separation = !precedent || precedent.date !== arret.date ? "separation-jour" : precedent.quart !== arret.quart ? "separation-quart" : "";
    const zoneAffichee = arret.zone === "Séchage" && /^Séchoir [123]$/i.test(arret.equipment || "") ? arret.equipment : arret.zone;
    return `<tr class="${separation}"><td>${formaterDate(arret.date)}</td><td>${echapper(arret.quart || "—")}</td><td>${echapper(arret.equipe || "—")}</td><td>${arret.impact === "equipment" ? "Panne équipement, zone en marche" : "Arrêt de zone"}</td><td>${echapper(zoneAffichee || "—")}</td><td>${echapper(arret.equipment || "—")}</td><td>${echapper(arret.cause || "—")}</td><td>${echapper(arret.start || "—")}–${echapper(arret.end || "—")}</td><td>${duree(arret.minutes)}</td></tr>`;
  }).join("");
  elements.contenu.innerHTML = `<section class="panneau resume-arrets"><div class="entete-tableau"><h2>Temps d’arrêt des zones et séchoirs</h2><button class="bouton secondaire" id="exporterArrets" type="button">Exporter les arrêts Excel</button></div><div class="grille-zones">${cartes}</div></section><section class="panneau resume-arrets"><h2>Pannes d’équipement — zone en marche</h2><div class="grille-zones">${cartesEquipements}</div></section><section class="panneau details-arrets"><h2>Détail par jour et quart — un arrêt distinct par ligne</h2><div class="tableau-defilement"><table><thead><tr><th>Jour</th><th>Quart</th><th>Équipe</th><th>Type</th><th>Zone</th><th>Équipement</th><th>Causes</th><th>Heures</th><th>Durée</th></tr></thead><tbody>${lignes || '<tr><td colspan="9">Aucun arrêt enregistré pour cette période.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector("#exporterArrets").onclick = () => exporterArrets(arrets);
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
  const bouton = elements.formulaire.querySelector('button[type="submit"]'), erreur = document.querySelector("#erreurMotDePasse");
  bouton.disabled = true; bouton.textContent = "Connexion…"; erreur.textContent = "";
  try {
    await demander("/api/admin/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
    elements.formulaire.reset();
    await chargerRapports();
  } catch (error) { if (/identifiant|mot de passe/i.test(error.message)) erreur.textContent = error.message; else message(error.message); }
  finally { bouton.disabled = false; bouton.textContent = "Se connecter"; }
});

elements.actualiser.addEventListener("click", chargerRapports);
document.querySelectorAll("[data-onglet]").forEach((bouton) => bouton.addEventListener("click", () => { etat.onglet = bouton.dataset.onglet; afficherOnglet(); }));
elements.mois.addEventListener("change", () => { etat.mois = elements.mois.value; etat.jour = ""; afficherOnglet(); synchroniserFiltres(); });
elements.jour.addEventListener("change", () => { etat.jour = elements.jour.value; afficherOnglet(); });
elements.debut.addEventListener("change", () => { etat.debut = elements.debut.value; if (etat.fin && etat.debut > etat.fin) etat.fin = etat.debut; afficherOnglet(); synchroniserFiltres(); });
elements.fin.addEventListener("change", () => { etat.fin = elements.fin.value; if (etat.debut && etat.fin < etat.debut) etat.debut = etat.fin; afficherOnglet(); synchroniserFiltres(); });
document.querySelector("#effacerPeriode").addEventListener("click", () => { etat.debut = ""; etat.fin = ""; afficherOnglet(); synchroniserFiltres(); });
elements.deconnexion.addEventListener("click", async () => {
  if (!window.confirm("Voulez-vous vraiment vous déconnecter ?")) return;
  await demander("/api/admin/logout", { method: "POST", body: "{}" });
  elements.tableau.classList.add("masque"); elements.deconnexion.classList.add("masque");
  elements.connexion.classList.remove("masque"); document.querySelector("#entetePortail").classList.remove("masque");
  document.body.classList.remove("connecte"); message("");
});

window.addEventListener("beforeunload", (event) => {
  if (!document.body.classList.contains("connecte")) return;
  event.preventDefault(); event.returnValue = "";
});

chargerRapports();
