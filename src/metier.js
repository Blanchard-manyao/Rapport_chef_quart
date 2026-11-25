// Modèle métier JavaScript porté de Donnees.cs / FormPrincipal.cs.
// Les fonctions ci-dessous traduisent les calculs de production en règles réutilisables.
"use strict";

const EQUIPES = Object.freeze({
  A: "KONAN LUC",
  B: "EYO NESTOR",
  C: "DAMEY JEAN-BAPTISTE",
  D: "TIA LOU EDWIGE",
});
const QUARTS = Object.freeze(["07h-15h", "15h-23h", "23h-07h"]);
const ZONES_ARRET = Object.freeze([
  "Prélavage",
  "Conditionnement",
  "Ligne 1",
  "Ligne 2",
  "Séchoir 1",
  "Séchoir 2",
  "Séchoir 3",
  "Autre",
]);
const KG_PAR_COLIS = 1260;
const KG_PAR_GODET = 1500;
const MINUTES_PAR_QUART = 480;

function creerRapportVide() {
  return {
    date: new Date().toISOString().slice(0, 10),
    quart: QUARTS[2],
    equipe: "A",
    staff: {
      total: 0,
      absent: 0,
      malade: 0,
      permission: 0,
      conge: 0,
      accidents: 0,
    },
    prelavage: { box: "", buckets: 0, secondBox: "", secondBuckets: 0 },
    granulation: {
      box: "",
      acidTitre: 1,
      acidConsumption: 1,
      baskets: 0,
      basketAdvance: "",
      basketsWashed: "",
    },
    drying: {
      basketsDry: 0,
      sechoirs: [1, 2, 3].map((number) => ({
        number,
        cycle: 0,
        bruleur1: 0,
        bruleur2: 0,
        counter: "",
        gas1: "",
        gas2: "",
        stops: [],
      })),
    },
    production: {
      paniers: 0,
      tonnageKg: 0,
      balesStart: 0,
      balesquart: 0,
      balesProcessed: 0,
      balesEnd: 0,
    },
    generators: { "GE 2500 KVA": [], "GE 2000 KVA": [] },
    stops: [],
  };
}
// lireHeureEnMinutes : convertit une saisie comme « 07H30 » en minutes après minuit.
function lireHeureEnMinutes(value) {
  const m = String(value ?? "")
    .trim()
    .match(/^(\d{1,2})\s*[:hH.]\s*(\d{0,2})$/);
  if (!m) return null;
  const h = Number(m[1]),
    minute = Number(m[2] || 0);
  return h <= 23 && minute <= 59 ? h * 60 + minute : null;
}
function formaterHeure(value) {
  const n = lireHeureEnMinutes(value);
  if (n === null) return "";
  return `${String(Math.floor(n / 60)).padStart(2, "0")}H${String(n % 60).padStart(2, "0")}`;
}
// intervalleArretValide : autorise le passage à minuit uniquement au quart de nuit.
function intervalleArretValide(startValue, endValue, quart) {
  const start = lireHeureEnMinutes(startValue),
    end = lireHeureEnMinutes(endValue);
  if (start === null || end === null || start === end) return false;
  if (end < start && quart !== QUARTS[2]) return false;
  return (end - start + 1440) % 1440 <= MINUTES_PAR_QUART;
}
// dureeArret : calcule la durée et prend en charge le passage à minuit du quart de nuit.
function dureeArret(stop, quart) {
  const start = lireHeureEnMinutes(stop.start),
    end = lireHeureEnMinutes(stop.end);
  if (!intervalleArretValide(stop.start, stop.end, quart)) return 0;
  return (end - start + 1440) % 1440;
}
function estPanneEquipementSeule(stop) {
  return stop?.impact === "equipment";
}
function formaterDuree(minutes) {
  const n = Math.max(0, Math.trunc(Number(minutes) || 0));
  return `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, "0")} min`;
}
function effectifPresent(r) {
  const s = r.staff || {};
  return (
    Number(s.total || 0) -
    ["absent", "malade", "permission", "conge"].reduce(
      (n, k) => n + Number(s[k] || 0),
      0,
    )
  );
}
function calculerIndicateurs(r) {
  const paniers = Number(r.production?.paniers || 0),
    dry = Number(r.drying?.basketsDry || 0);
  const stops = r.stops || [];
  const stopTotals = {};
  const equipmentStopTotals = {};
  const ajouterArret = (stop, zone) => {
    const minutes = dureeArret(stop, r.quart);
    if (estPanneEquipementSeule(stop)) {
      const equipment = String(stop.equipment || "Équipement non précisé").trim();
      const key = `${zone} — ${equipment}`;
      equipmentStopTotals[key] = (equipmentStopTotals[key] || 0) + minutes;
    } else {
      stopTotals[zone] = (stopTotals[zone] || 0) + minutes;
    }
  };
  const generatorRunTotals = {};
  Object.entries(r.generators || {}).forEach(([name, periods]) => {
    generatorRunTotals[name] = (periods || []).reduce(
      (n, x) => n + dureeArret(x, r.quart),
      0,
    );
  });
  stops.forEach((s) => {
    const zone = s.zone || "Autre";
    ajouterArret(s, zone);
  });
  (r.drying?.sechoirs || []).forEach((d) => {
    (d.stops || []).forEach((stop) => ajouterArret(stop, `Séchoir ${d.number}`));
  });
  const kg = paniers * KG_PAR_COLIS;
  return {
    present: effectifPresent(r),
    kg,
    prelavageTotal:
      (Number(r.prelavage?.buckets || 0) +
        Number(r.prelavage?.secondBuckets || 0)) *
      KG_PAR_GODET,
    averageBasket: dry ? ((paniers * 36) / dry) * 35 : null,
    averageBasketDiv28: dry ? (((paniers * 36) / dry) * 35) / 28 : null,
    stopTotals,
    equipmentStopTotals,
    totalEquipmentStops: Object.values(equipmentStopTotals).reduce((a, b) => a + b, 0),
    generatorRunTotals,
    totalStops: Object.values(stopTotals).reduce((a, b) => a + b, 0),
    sechoirs: (r.drying?.sechoirs || []).map((d) => {
      const total = (d.stops || [])
        .filter((s) => !estPanneEquipementSeule(s))
        .reduce((a, s) => a + dureeArret(s, r.quart), 0);
      return {
        ...d,
        stopMinutes: total,
        runMinutes: Math.max(MINUTES_PAR_QUART - total, 0),
      };
    }),
  };
}
// validerRapport : contrôle les champs et l’ordre des heures avant l’enregistrement.
function validerRapport(r) {
  const errors = [];
  if (!r.date) errors.push("La date est obligatoire.");
  if (!QUARTS.includes(r.quart)) errors.push("Sélectionnez un quart valide.");
  if (!EQUIPES[r.equipe]) errors.push("Sélectionnez une équipe valide.");
  if (effectifPresent(r) < 0)
    errors.push("Les absences dépassent l’effectif total.");
  if (Number(r.production?.paniers || 0) < 0)
    errors.push("La production ne peut pas être négative.");
  for (const sechoir of r.drying?.sechoirs || []) {
    for (const [label, value] of [["Brûleur 1", sechoir.bruleur1], ["Brûleur 2", sechoir.bruleur2]]) {
      if (Number(value) < 0 || Number(value) > 130)
        errors.push(`${label} du séchoir ${sechoir.number} doit être compris entre 0 et 130.`);
    }
  }
  const checkTimeRange = (startValue, endValue, label) => {
    if (!startValue && !endValue) return;
    const start = lireHeureEnMinutes(startValue),
      end = lireHeureEnMinutes(endValue);
    if (start === null || end === null) {
      errors.push(`Heure invalide pour ${label}. Saisissez une heure comme 07H30.`);
    } else if (start === end || (end < start && r.quart !== QUARTS[2])) {
      errors.push(`La fin de ${label} doit suivre le début. Seul le quart 23h-07h peut passer minuit.`);
    } else if (!intervalleArretValide(startValue, endValue, r.quart)) {
      errors.push(`La durée de ${label} ne peut pas dépasser 8 heures.`);
    }
  };
  for (const stop of [
    ...(r.stops || []),
    ...(r.drying?.sechoirs || []).flatMap((d) => d.stops || []),
  ]) {
    if (estPanneEquipementSeule(stop) && !String(stop.equipment || "").trim())
      errors.push(`Précisez l’équipement en panne dans ${stop.zone || "la zone concernée"}.`);
    if (estPanneEquipementSeule(stop) && (!stop.start || !stop.end))
      errors.push(`Saisissez le début et la fin de la panne de l’équipement dans ${stop.zone || "la zone concernée"}.`);
    checkTimeRange(stop.start, stop.end, `l’arrêt ${stop.zone || ""}`);
  }
  Object.entries(r.generators || {}).forEach(([name, periods]) =>
    (periods || []).forEach((period) =>
      checkTimeRange(period.start, period.end, `la période du ${name}`),
    ),
  );
  return errors;
}
function lignesSynthese(r) {
  const d = calculerIndicateurs(r),
    sechoirs = d.sechoirs;
  const asClock = (minutes) => {
    const total = Math.max(0, Math.trunc(Number(minutes) || 0));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
  };
  const decimal2 = (value) =>
    value == null
      ? "-"
      : Number(value).toLocaleString("fr-FR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  const decimal1 = (value) =>
    Number(value || 0).toLocaleString("fr-FR", {
      maximumFractionDigits: 1,
    });

  return [
    { label: "Nbre de Paniers", value: Number(r.drying?.basketsDry || 0) },
    { label: "Nbre de Colis", value: Number(r.production?.paniers || 0) },
    ...sechoirs.map((sechoir) => ({
      label: `Cycle du séchoir n°${sechoir.number} (secondes)`,
      value: sechoir.cycle || 0,
    })),
    { label: "Production du quart (kg)", value: decimal2(d.kg), highlight: true },
    {
      label: "Poids moyen Paniers (kg)",
      value: decimal2(d.averageBasket),
      highlight: true,
    },
    {
      label: "Poids moyen Pains (kg)",
      value: decimal2(d.averageBasketDiv28),
      highlight: true,
    },
    ...sechoirs.map((sechoir) => ({
      label: `Tps d'arrêt séchoir n°${sechoir.number} (h:mn:s)`,
      value: asClock(sechoir.stopMinutes),
      tone: sechoir.stopMinutes > 0 ? "danger" : "success",
    })),
    {
      label: "Tps d'arrêt Granulation Ligne n°1 (h:mn:s)",
      value: asClock(d.stopTotals["Ligne 1"] || 0),
      tone: d.stopTotals["Ligne 1"] > 0 ? "danger" : "success",
    },
    {
      label: "Tps d'arrêt Granulation Ligne n°2 (h:mn:s)",
      value: asClock(d.stopTotals["Ligne 2"] || 0),
      tone: d.stopTotals["Ligne 2"] > 0 ? "danger" : "success",
    },
    ...Object.entries(d.equipmentStopTotals).map(([name, minutes]) => ({
      label: `Panne ${name} (zone en marche)`,
      value: asClock(minutes),
      tone: minutes > 0 ? "danger" : "success",
    })),
    { label: "Avances Paniers", value: r.granulation?.basketAdvance || "" },
    {
      label: "Balles détectées durant le quart",
      value: r.production?.balesquart || 0,
    },
    {
      label: "Balles détectées traitées",
      value: r.production?.balesProcessed || 0,
    },
    { label: "Paniers lavés", value: r.granulation?.basketsWashed || "" },
    {
      label: "Consommation Acide (Kg)",
      value: decimal1(r.granulation?.acidConsumption),
    },
    { label: "Effectif présent", value: d.present, tone: "success" },
  ];
}
function texteRapport(r) {
  const d = calculerIndicateurs(r);
  const display = (value) => (String(value ?? "").trim() ? value : "-");
  const hms = (minutes) => formaterDuree(minutes);
  const lines = [
    `RAPPORT CHEF DE QUART ||${r.date} || Quart ${r.quart} || }`,
    `${EQUIPES[r.equipe]} || Équipe ${r.equipe}`,
    "====================",
    `EFFECTIF : ${r.staff?.total || 0} | Présent ${d.present} | Absent ${r.staff?.absent || 0} | Malade ${r.staff?.malade || 0} | Permission ${r.staff?.permission || 0} | congé : ${r.staff?.conge || 0}`,
    `ACCIDENT DE TRAVAIL : ${r.staff?.accidents || 0}`,
    "====================",
    `Paniers séchés : ${r.drying?.basketsDry || 0} | Production ${r.production?.paniers || 0} colis, soit ${d.kg.toLocaleString("fr-FR")} kg`,
    `Poids moyen d'un panier : ${d.averageBasket == null ? "-" : d.averageBasket.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Poids moyen d'un pain : ${d.averageBasketDiv28 == null ? "-" : d.averageBasketDiv28.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `Box en cours d'usinage : ${display(r.granulation?.box)}`,
    `Paniers granulés : ${r.granulation?.baskets || 0} | Titre d'acide : ${r.granulation?.acidTitre ?? 0} g/l | Conso acide : ${r.granulation?.acidConsumption || 0} kg`,
    `Box prélavé : (${display(r.prelavage?.box)}) | ${r.prelavage?.buckets || 0} godets | total prélavé ${((Number(r.prelavage?.buckets) || 0) * KG_PAR_GODET).toLocaleString("fr-FR")} kg`,
  ];
  if (Number(r.prelavage?.secondBuckets) > 0 || String(r.prelavage?.secondBox || "").trim())
    lines.push(`Deuxième box prélavé : (${display(r.prelavage?.secondBox)}) | ${r.prelavage?.secondBuckets || 0} godets | total prélavé ${((Number(r.prelavage?.secondBuckets) || 0) * KG_PAR_GODET).toLocaleString("fr-FR")} kg`);

  for (const zone of ["Ligne 1", "Ligne 2"]) {
    const minutes = d.stopTotals[zone] || 0;
    lines.push(`${zone} : arrêts ${hms(minutes)} | fonctionnement ${hms(Math.max(MINUTES_PAR_QUART - minutes, 0))}`);
  }
  lines.push(`Avance panier fin : ${display(r.granulation?.basketAdvance)}`);
  lines.push("====================",);

  for (const sechoir of d.sechoirs) {
    lines.push(`Séchoir ${sechoir.number} : cycle ${sechoir.cycle || 0} sec | brûleurs ${sechoir.bruleur1 || 0}/${sechoir.bruleur2 || 0} | arrêt ${hms(sechoir.stopMinutes)} | marche ${hms(sechoir.runMinutes)}`);
  }

  lines.push("====================",);
  lines.push(`Balles détectées : début ${r.production?.balesStart || 0} | Pendant le quart ${r.production?.balesquart || 0} | Balles traitées ${r.production?.balesProcessed || 0} | Fin de quart ${r.production?.balesEnd || 0}`);
  lines.push(`Paniers lavés : ${display(r.granulation?.basketsWashed)}`);
  lines.push("====================",);
  lines.push("LES ARRÊTS DU QUART");

  const stops = [
    ...(r.stops || []),
    ...(r.drying?.sechoirs || []).flatMap((sechoir) =>
      (sechoir.stops || []).map((stop) => ({ ...stop, zone: `Séchoir ${sechoir.number}` })),
    ),
  ];
  const equipmentFailures = stops.filter(estPanneEquipementSeule);
  const zoneStops = stops.filter((stop) => !estPanneEquipementSeule(stop));
  lines.push("PANNES D’ÉQUIPEMENT (zone en fonctionnement)");
  if (equipmentFailures.length) {
    for (const stop of equipmentFailures) {
      const cause = stop.cause || "cause non précisée";
      lines.push(`- ${stop.zone} — ${stop.equipment} | ${stop.start} - ${stop.end} : ${cause} | ${hms(dureeArret(stop, r.quart))}`);
    }
  } else {
    lines.push("Aucune");
  }
  lines.push("ARRÊTS DE ZONE");
  if (zoneStops.length) {
    for (const stop of zoneStops) {
      const cause = stop.cause || "cause non précisée";
      const zone = stop.equipment ? `${stop.zone} (${stop.equipment})` : stop.zone;
      lines.push(`- ${zone} | ${stop.start} - ${stop.end} : ${cause} | ${hms(dureeArret(stop, r.quart))}`);
    }
  } else {
    lines.push("Aucun");
  }

  lines.push("====================",);
  lines.push("GÉNÉRATEURS (Fonctionnement)");
  for (const [name, periods] of Object.entries(r.generators || {})) {
    const total = d.generatorRunTotals[name] || 0;
    const detail = periods?.length
      ? ` (démarrage-arrêt : ${periods.map((period) => `${period.start}-${period.end}`).join(", ")})`
      : "";
    lines.push(`${name} : ${hms(total)}${detail}`);
  }
  return lines.join("\n");
}
function identifiantRapport(r) {
  return `${r.date}_${r.quart}_${r.equipe}`;
}
window.ReglesMetier = Object.freeze({
  EQUIPES,
  QUARTS,
  ZONES_ARRET,
  KG_PAR_COLIS,
  KG_PAR_GODET,
  MINUTES_PAR_QUART,
  creerRapportVide,
  lireHeureEnMinutes,
  formaterHeure,
  intervalleArretValide,
  dureeArret,
  formaterDuree,
  effectifPresent,
  calculerIndicateurs,
  validerRapport,
  lignesSynthese,
  texteRapport,
  identifiantRapport,
});
