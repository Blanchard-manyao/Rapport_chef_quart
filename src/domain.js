// Modèle métier JavaScript porté de Donnees.cs / FormPrincipal.cs.
"use strict";

const TEAMS = Object.freeze({
  A: "KONAN LUC",
  B: "EYO NESTOR",
  C: "DAMEY JEAN-BAPTISTE",
  D: "TIA LOU EDWIGE",
});
const SHIFTS = Object.freeze(["07h-15h", "15h-23h", "23h-07h"]);
const ZONES = Object.freeze([
  "Prélavage",
  "Conditionnement",
  "Ligne 1",
  "Ligne 2",
  "Séchoir 1",
  "Séchoir 2",
  "Séchoir 3",
  "Autre",
]);
const KG_PER_UNIT = 1260;
const PRELAVE_PER_BUCKET = 1500;
const SHIFT_MINUTES = 480;

function emptyReport() {
  return {
    date: new Date().toISOString().slice(0, 10),
    shift: SHIFTS[2],
    team: "A",
    staff: {
      total: 0,
      absent: 0,
      sick: 0,
      permission: 0,
      leave: 0,
      accidents: 0,
    },
    prewash: { box: "", buckets: 0, secondBox: "", secondBuckets: 0 },
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
      dryers: [1, 2, 3].map((number) => ({
        number,
        cycle: 0,
        burner1: 0,
        burner2: 0,
        counter: "",
        gas1: "",
        gas2: "",
        stops: [],
      })),
    },
    production: {
      parcels: 0,
      tonnageKg: 0,
      balesStart: 0,
      balesShift: 0,
      balesProcessed: 0,
      balesEnd: 0,
    },
    generators: { "GE 2500 KVA": [], "GE 2000 KVA": [] },
    stops: [],
  };
}
function parseTime(value) {
  const m = String(value ?? "")
    .trim()
    .match(/^(\d{1,2})\s*[:hH.]\s*(\d{0,2})$/);
  if (!m) return null;
  const h = Number(m[1]),
    minute = Number(m[2] || 0);
  return h <= 23 && minute <= 59 ? h * 60 + minute : null;
}
function normalizeTime(value) {
  const n = parseTime(value);
  if (n === null) return "";
  return `${String(Math.floor(n / 60)).padStart(2, "0")}H${String(n % 60).padStart(2, "0")}`;
}
function stopDuration(stop) {
  const start = parseTime(stop.start),
    end = parseTime(stop.end);
  if (start === null || end === null) return 0;
  return (end - start + 1440) % 1440;
}
function durationText(minutes) {
  const n = Math.max(0, Math.trunc(Number(minutes) || 0));
  return `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, "0")} min`;
}
function staffPresent(r) {
  const s = r.staff || {};
  return (
    Number(s.total || 0) -
    ["absent", "sick", "permission", "leave"].reduce(
      (n, k) => n + Number(s[k] || 0),
      0,
    )
  );
}
function derive(r) {
  const parcels = Number(r.production?.parcels || 0),
    dry = Number(r.drying?.basketsDry || 0);
  const stops = r.stops || [];
  const stopTotals = {};
  const generatorRunTotals = {};
  Object.entries(r.generators || {}).forEach(([name, periods]) => {
    generatorRunTotals[name] = (periods || []).reduce(
      (n, x) => n + stopDuration(x),
      0,
    );
  });
  stops.forEach((s) => {
    const zone = s.zone || "Autre";
    stopTotals[zone] = (stopTotals[zone] || 0) + stopDuration(s);
  });
  (r.drying?.dryers || []).forEach((d) => {
    stopTotals[`Séchoir ${d.number}`] =
      (stopTotals[`Séchoir ${d.number}`] || 0) +
      (d.stops || []).reduce((a, s) => a + stopDuration(s), 0);
  });
  const kg = parcels * KG_PER_UNIT;
  return {
    present: staffPresent(r),
    kg,
    prewashTotal:
      (Number(r.prewash?.buckets || 0) +
        Number(r.prewash?.secondBuckets || 0)) *
      PRELAVE_PER_BUCKET,
    averageBasket: dry ? ((parcels * 36) / dry) * 35 : null,
    averageBasketDiv28: dry ? (((parcels * 36) / dry) * 35) / 28 : null,
    stopTotals,
    generatorRunTotals,
    totalStops: Object.values(stopTotals).reduce((a, b) => a + b, 0),
    dryers: (r.drying?.dryers || []).map((d) => {
      const total = (d.stops || []).reduce((a, s) => a + stopDuration(s), 0);
      return {
        ...d,
        stopMinutes: total,
        runMinutes: Math.max(SHIFT_MINUTES - total, 0),
      };
    }),
  };
}
function validateReport(r) {
  const errors = [];
  if (!r.date) errors.push("La date est obligatoire.");
  if (!SHIFTS.includes(r.shift)) errors.push("Sélectionnez un quart valide.");
  if (!TEAMS[r.team]) errors.push("Sélectionnez une équipe valide.");
  if (staffPresent(r) < 0)
    errors.push("Les absences dépassent l’effectif total.");
  if (Number(r.production?.parcels || 0) < 0)
    errors.push("La production ne peut pas être négative.");
  for (const dryer of r.drying?.dryers || []) {
    for (const [label, value] of [["Brûleur 1", dryer.burner1], ["Brûleur 2", dryer.burner2]]) {
      if (Number(value) < 0 || Number(value) > 130)
        errors.push(`${label} du séchoir ${dryer.number} doit être compris entre 0 et 130.`);
    }
  }
  for (const stop of [
    ...(r.stops || []),
    ...(r.drying?.dryers || []).flatMap((d) => d.stops || []),
  ]) {
    if (!stop.start && !stop.end) continue;
    if (parseTime(stop.start) === null || parseTime(stop.end) === null)
      errors.push(
        `Heure invalide pour l’arrêt ${stop.zone || ""}. Saisissez une heure comme 07H30.`,
      );
  }
  return errors;
}
function synthesisRows(r) {
  const d = derive(r),
    dryers = d.dryers;
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
    { label: "Nbre de Colis", value: Number(r.production?.parcels || 0) },
    ...dryers.map((dryer) => ({
      label: `Cycle du séchoir n°${dryer.number} (secondes)`,
      value: dryer.cycle || 0,
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
    ...dryers.map((dryer) => ({
      label: `Tps d'arrêt séchoir n°${dryer.number} (h:mn:s)`,
      value: asClock(dryer.stopMinutes),
      tone: dryer.stopMinutes > 0 ? "danger" : "success",
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
    { label: "Avances Paniers", value: r.granulation?.basketAdvance || "" },
    {
      label: "Balles détectées durant le quart",
      value: r.production?.balesShift || 0,
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
function reportText(r) {
  const d = derive(r);
  const display = (value) => (String(value ?? "").trim() ? value : "-");
  const hms = (minutes) => durationText(minutes);
  const lines = [
    "RAPPORT CHEF DE QUART",
    `${r.date} - Quart ${r.shift} - Équipe ${r.team}`,
    `Chef de quart : ${TEAMS[r.team] || ""}`,
    "=================================================================================",
    `EFFECTIF : ${r.staff?.total || 0} | Présent ${d.present} | Absent ${r.staff?.absent || 0} | Malade ${r.staff?.sick || 0} | Permission ${r.staff?.permission || 0} | congé : ${r.staff?.leave || 0}`,
    `ACCIDENT DE TRAVAIL : ${r.staff?.accidents || 0}`,
    "=================================================================================",
    `Paniers séchés : ${r.drying?.basketsDry || 0} | Production ${r.production?.parcels || 0} colis, soit ${d.kg.toLocaleString("fr-FR")} kg`,
    `Poids moyen d'un panier : ${d.averageBasket == null ? "-" : d.averageBasket.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Poids moyen d'un pain : ${d.averageBasketDiv28 == null ? "-" : d.averageBasketDiv28.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `Box en cours d'usinage : ${display(r.granulation?.box)}`,
    `Paniers granulés : ${r.granulation?.baskets || 0} | Titre d'acide : ${r.granulation?.acidTitre ?? 0} g/l | Conso acide : ${r.granulation?.acidConsumption || 0} kg`,
    `Box prélavé : (${display(r.prewash?.box)}) | ${r.prewash?.buckets || 0} godets | total prélavé ${((Number(r.prewash?.buckets) || 0) * PRELAVE_PER_BUCKET).toLocaleString("fr-FR")} kg`,
  ];
  if (Number(r.prewash?.secondBuckets) > 0 || String(r.prewash?.secondBox || "").trim())
    lines.push(`Deuxième box prélavé : (${display(r.prewash?.secondBox)}) | ${r.prewash?.secondBuckets || 0} godets | total prélavé ${((Number(r.prewash?.secondBuckets) || 0) * PRELAVE_PER_BUCKET).toLocaleString("fr-FR")} kg`);

  for (const zone of ["Ligne 1", "Ligne 2"]) {
    const minutes = d.stopTotals[zone] || 0;
    lines.push(`${zone} : arrêts ${hms(minutes)} | fonctionnement ${hms(Math.max(SHIFT_MINUTES - minutes, 0))}`);
  }
  lines.push(`Avance panier fin : ${display(r.granulation?.basketAdvance)}`);
  lines.push("=================================================================================");

  for (const dryer of d.dryers) {
    lines.push(`Séchoir ${dryer.number} : cycle ${dryer.cycle || 0} sec | brûleurs ${dryer.burner1 || 0}/${dryer.burner2 || 0} | arrêt ${hms(dryer.stopMinutes)} | marche ${hms(dryer.runMinutes)}`);
  }

  lines.push("=================================================================================");
  lines.push(`Balles détectées : début ${r.production?.balesStart || 0} | Pendant le quart ${r.production?.balesShift || 0} | Balles traitées ${r.production?.balesProcessed || 0} | Fin de quart ${r.production?.balesEnd || 0}`);
  lines.push(`Paniers lavés : ${display(r.granulation?.basketsWashed)}`);
  lines.push("=================================================================================");
  lines.push("LES ARRÊTS DU QUART");

  const stops = [
    ...(r.stops || []),
    ...(r.drying?.dryers || []).flatMap((dryer) =>
      (dryer.stops || []).map((stop) => ({ ...stop, zone: `Séchoir ${dryer.number}` })),
    ),
  ];
  if (stops.length) {
    for (const stop of stops) {
      const cause = stop.cause || "cause non précisée";
      const zone = stop.equipment ? `${stop.zone} (${stop.equipment})` : stop.zone;
      lines.push(`- ${zone} | ${stop.start} - ${stop.end} : ${cause} | ${hms(stopDuration(stop))}`);
    }
  } else {
    lines.push("Aucun");
  }

  lines.push("=================================================================================");
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
function reportId(r) {
  return `${r.date}_${r.shift}_${r.team}`;
}
function groupStopsByZone(reports) {
  const out = {};
  for (const r of reports)
    for (const s of [
      ...(r.stops || []),
      ...(r.drying?.dryers || []).flatMap((d) =>
        (d.stops || []).map((x) => ({ ...x, zone: `Séchoir ${d.number}` })),
      ),
    ])
      out[s.zone || "Autre"] = (out[s.zone || "Autre"] || 0) + stopDuration(s);
  return out;
}
window.CQDomain = Object.freeze({
  TEAMS,
  SHIFTS,
  ZONES,
  KG_PER_UNIT,
  PRELAVE_PER_BUCKET,
  SHIFT_MINUTES,
  emptyReport,
  parseTime,
  normalizeTime,
  stopDuration,
  durationText,
  staffPresent,
  derive,
  validateReport,
  synthesisRows,
  reportText,
  reportId,
  groupStopsByZone,
});
