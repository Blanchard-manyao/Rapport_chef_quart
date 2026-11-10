"use strict";
// Interface utilisateur : navigation, filtres, tableaux et graphiques.
const app = document.querySelector("#app"),
  D = window.CQDomain;
const state = {
  reports: [],
  user: null,
  admin: false,
  tab: "home",
  month: new Date().toISOString().slice(0, 7),
  day: "",
  periodStart: "",
  periodEnd: "",
  legacyAvailable: false,
  legacyConnected: false,
  legacyPrompted: false,
  refreshTimer: null,
  sessionVersion: 0,
  selectedStopsReportId: null,
  selectedStopsTarget: null,
};
const $ = (s, root = document) => root.querySelector(s),
  esc = (s) =>
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
const dateFmt = (x) =>
  x ? new Date(x + "T00:00:00").toLocaleDateString("fr-FR") : "";
// dateFilterToken : traduit le filtre de dates en suffixe lisible pour le fichier exporté.
function dateFilterToken(exactDate = "") {
  const compact = (date) => String(date || "").replaceAll("-", "");
  if (exactDate) return compact(exactDate);
  if (state.periodStart || state.periodEnd)
    return `${compact(state.periodStart) || "sans-debut"}_au_${compact(state.periodEnd) || "sans-fin"}`;
  if (state.month && state.day) return compact(`${state.month}-${state.day}`);
  if (state.month) return compact(state.month);
  return "toutes-dates";
}
window.addEventListener("focus", () => {
  const password = $("#loginForm input[name='password']");
  if (password && document.activeElement !== password)
    password.focus({ preventScroll: true });
  if (state.admin && state.tab === "home" && !document.querySelector(".modal"))
    refreshAdminData();
});
const STOP_ZONES = [
  "Séchoir 1",
  "Séchoir 2",
  "Séchoir 3",
  "Ligne 1",
  "Ligne 2",
  "Prélavage",
];
function toast(s) {
  const e = document.createElement("div");
  e.className = "toast";
  e.textContent = s;
  document.body.append(e);
  setTimeout(() => e.remove(), 3200);
}
async function reload(expectedVersion = state.sessionVersion) {
  const x = await cq.bootstrap();
  if (expectedVersion !== state.sessionVersion) return false;
  state.reports = x.reports || [];
  state.users = x.users || [];
  state.adminSet = x.adminSet;
  state.recoveryKey = x.recoveryKey;
  state.adminSetupKey = x.recoveryKeyForSetup;
  state.legacyAvailable = x.legacyAvailable;
  state.legacyConnected = x.legacyConnected;
  return true;
}
let refreshInProgress = false;
// Actualise l’interface admin quand un autre processus a enregistré un rapport.
async function refreshAdminData() {
  if (!state.admin || refreshInProgress || document.querySelector(".modal")) return;
  refreshInProgress = true;
  const previousReports = JSON.stringify(state.reports);
  try {
    await reload();
    if (state.admin && JSON.stringify(state.reports) !== previousReports) render();
  } catch (error) {
    console.error("Actualisation des rapports impossible :", error);
  } finally {
    refreshInProgress = false;
  }
}
function login(refocusAfterSession = false) {
  app.innerHTML = `<main class="login panel">
    <h1>Rapport Chef de Quart</h1>
    <p class="muted">Connexion</p>
    <form id="loginForm">
      <label class="field">Profil
        <select name="user">
          <option value="A">Équipe A — ${esc(D.TEAMS.A)}</option>
          <option value="B">Équipe B — ${esc(D.TEAMS.B)}</option>
          <option value="C">Équipe C — ${esc(D.TEAMS.C)}</option>
          <option value="D">Équipe D — ${esc(D.TEAMS.D)}</option>
          <option value="Administrateur">Administrateur</option>
        </select>
      </label>
      <label class="field">Mot de passe
        <input name="password" type="password" required maxlength="64" autocomplete="current-password">
      </label>
      <label class="field" id="confirmWrap">Confirmer le mot de passe
        <input name="confirmation" type="password" maxlength="64" autocomplete="new-password">
      </label>
      <p class="muted" id="loginMessage"></p>
      <div class="actions login-actions">
        <button type="submit">Se connecter</button>
        <button type="button" id="forgot" class="secondary">Mot de passe oublié ?</button>
      </div>
    </form>
  </main>`;
  const form = $("#loginForm"),
    user = form.elements.user;
  const mode = () => {
    const admin = user.value === "Administrateur",
      exists = state.users.includes(user.value);
    $("#confirmWrap").classList.toggle("hidden", exists);
    const confirmation = $("#confirmWrap").querySelector("input");
    confirmation.required = !exists;
    confirmation.disabled = exists;
    if (exists) confirmation.value = "";
    $("#loginMessage").textContent = admin
      ? state.adminSet
        ? "Connectez-vous pour ouvrir le tableau de bord administrateur."
        : "Première connexion : le compte administrateur doit être initialisé avec la clé de récupération."
      : exists
        ? ""
        : "Première utilisation : choisissez et confirmez un mot de passe (6 caractères minimum).";
  };
  user.onchange = mode;
  mode();
  const focusPassword = () => {
    const password = form.elements.password;
    cq.focusApp()
      .catch(() => false)
      .then(() => {
        if (!password.isConnected) return;
        window.focus();
        password.focus({ preventScroll: true });
      });
  };
  requestAnimationFrame(focusPassword);
  if (refocusAfterSession) {
    setTimeout(focusPassword, 180);
    setTimeout(focusPassword, 420);
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const sessionVersion = ++state.sessionVersion;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const f = new FormData(form);
    let res;
    try {
      res = await cq.auth({
        user: f.get("user"),
        password: f.get("password"),
        confirmation: f.get("confirmation"),
        recoveryKey: state.adminSet ? "" : state.adminSetupKey,
      });
    } catch (error) {
      $("#loginMessage").textContent = `Connexion impossible : ${error.message}`;
      submitButton.disabled = false;
      return;
    }
    if (!res.ok) {
      $("#loginMessage").textContent = res.message;
      submitButton.disabled = false;
      return;
    }
    state.user = res.user;
    state.admin = res.user === "Administrateur";
    state.tab = state.admin ? "home" : "create";
    window.CQUser = state.user;
    try {
      if (!(await reload(sessionVersion))) return;
    } catch (error) {
      state.user = null;
      state.admin = false;
      window.CQUser = null;
      await cq.logout();
      $("#loginMessage").textContent = `Connexion interrompue : ${error.message}`;
      submitButton.disabled = false;
      return;
    }
    if (state.admin && !state.refreshTimer)
      state.refreshTimer = setInterval(refreshAdminData, 5000);
    render();
    toast(res.first ? "Mot de passe initialisé." : "Connexion établie.");
    if (
      state.admin &&
      state.legacyAvailable &&
      !state.legacyConnected &&
      !state.legacyPrompted
    ) {
      state.legacyPrompted = true;
      try {
        const result = await cq.importLegacyDb({ automatic: true });
        if (result) {
          await reload();
          render();
          toast(
            `${result.imported} rapport(s) importé(s) depuis l’ancienne base.`,
          );
        }
      } catch (error) {
        alert(`Import de l’ancienne base impossible : ${error.message}`);
      }
    }
  };
  $("#forgot").onclick = () => resetPasswordDialog(user.value);
}
function resetPasswordDialog(user) {
  if (user === "Administrateur") {
    toast(
      "Pour réinitialiser l’administrateur, utilisez la clé de récupération au premier paramétrage.",
    );
    return;
  }
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal"><section class="panel"><h2>Réinitialiser le mot de passe</h2><form id="resetForm"><label class="field">Équipe<select name="user">${Object.keys(
      D.TEAMS,
    )
      .map(
        (t) =>
          `<option value="${t}" ${t === user ? "selected" : ""}>Équipe ${t}</option>`,
      )
      .join(
        "",
      )}</select></label><label class="field">Clé de récupération<input name="recoveryKey" required></label><label class="field">Nouveau mot de passe<input name="next" type="password" minlength="6" maxlength="64" required></label><label class="field">Confirmer le mot de passe<input name="confirmation" type="password" required></label><p id="resetError" class="muted"></p><div class="actions"><button>Réinitialiser</button><button type="button" class="secondary" onclick="this.closest('.modal').remove()">Annuler</button></div></form></section></div>`,
  );
  $("#resetForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await cq.resetTeamPassword(Object.fromEntries(f));
      document.querySelector(".modal").remove();
      await reload();
      login();
      toast("Mot de passe réinitialisé.");
    } catch (x) {
      $("#resetError").textContent = x.message;
    }
  };
}
function shell() {
  const rangeActive = Boolean(state.periodStart || state.periodEnd);
  const tabs = state.admin
    ? [
        ["home", "Tableau de bord"],
        ["reports", "Rapports enregistrés"],
        ["stops", "Temps d’arrêt par zone"],
      ]
    : [
        ["create", "Créer un rapport"],
        ["history", "Historique"],
      ];
  const [year, month] = state.month.split("-").map(Number),
    count = Number.isFinite(year) && month ? new Date(year, month, 0).getDate() : 31,
    showFilters = state.admin;
  const titles = {
    home: "Tableau de bord",
    create: "Créer un rapport",
    reports: "Rapports enregistrés",
    history: "Historique",
    stops: "Temps d’arrêt par zone",
  };
  const teamActions = state.admin
    ? ""
    : '<button id="changeTeam" class="secondary">Changer d’équipe</button>';
  return `<div class="shell"><aside class="side"><div class="brand">USINE MISSEHI<br><small>Rapport de quart</small></div>${tabs.map(([k, t]) => `<button data-tab="${k}" class="${state.tab === k ? "active" : ""}">${t}</button>`).join("")}${teamActions}<button id="password" class="secondary">Changer le mot de passe</button><button id="logout" class="logout">Déconnexion</button></aside><section class="main"><header class="top"><h1>${titles[state.tab]}</h1>${
    showFilters
      ? `<div class="filters"><label>Mois <input id="month" type="month" value="${state.month}" ${rangeActive ? "disabled" : ""}></label><label>Jour <select id="day" ${rangeActive ? "disabled" : ""}><option value="">Tous les jours</option>${Array.from(
          { length: count },
          (_, i) => String(i + 1).padStart(2, "0"),
        )
          .map(
            (d) =>
              `<option value="${d}" ${state.day === d ? "selected" : ""}>${d}</option>`,
          )
          .join(
            "",
          )}</select></label>${state.admin ? `<fieldset class="period-filter"><legend>Période</legend><label>Du <input id="periodStart" type="date" value="${state.periodStart}"></label><label>Au <input id="periodEnd" type="date" value="${state.periodEnd}"></label>${rangeActive ? '<button type="button" id="clearPeriod" class="secondary">Effacer</button>' : ""}</fieldset>` : ""}<button id="refresh" class="secondary">Actualiser</button></div>`
      : ""
  }</header><main class="content" id="view"></main></section></div>`;
}
function render() {
  app.innerHTML = shell();
  document.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        state.tab = b.dataset.tab;
        render();
      }),
  );
  $("#logout").onclick = async () => {
    if (!window.confirm("Voulez-vous vraiment vous déconnecter ?")) return;
    await closeSession();
  };
  $("#password").onclick = passwordDialog;
  if (!state.admin)
    $("#changeTeam").onclick = async () => {
      if (!window.confirm("Voulez-vous vous déconnecter pour changer d’équipe ?"))
        return;
      await closeSession();
    };
  if ($("#refresh"))
    $("#refresh").onclick = async () => {
      await reload();
      render();
    };
  if ($("#month"))
    $("#month").onchange = (e) => {
      state.month = e.target.value;
      state.day = "";
      render();
    };
  if ($("#day"))
    $("#day").onchange = (e) => {
      state.day = e.target.value;
      render();
    };
  if ($("#periodStart"))
    $("#periodStart").onchange = (e) => {
      state.periodStart = e.target.value;
      if (state.periodEnd && state.periodStart > state.periodEnd)
        state.periodEnd = state.periodStart;
      render();
    };
  if ($("#periodEnd"))
    $("#periodEnd").onchange = (e) => {
      state.periodEnd = e.target.value;
      if (state.periodStart && state.periodEnd < state.periodStart)
        state.periodStart = state.periodEnd;
      render();
    };
  if ($("#clearPeriod"))
    $("#clearPeriod").onclick = () => {
      state.periodStart = "";
      state.periodEnd = "";
      render();
    };
  const view = $("#view");
  (
    ({
      home,
      create: createView,
      reports: reportsView,
      history: historyView,
      stops: stopsView,
    })[state.tab] || createView
  )(view);
  if (state.selectedStopsReportId && state.selectedStopsTarget) {
    const target = $(`#${state.selectedStopsTarget}`);
    if (target) displayStops(state.selectedStopsReportId, state.selectedStopsTarget);
  }
}
async function closeSession() {
  const sessionVersion = ++state.sessionVersion;
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = null;
  state.user = null;
  state.admin = false;
  state.tab = "home";
  state.reports = [];
  state.periodStart = "";
  state.periodEnd = "";
  window.CQUser = null;
  document.querySelectorAll(".modal, .synthesis-drawer, .row-menu").forEach((el) => el.remove());
  try {
    await cq.logout();
  } catch (error) {
    console.error("Fermeture de session interrompue :", error);
  } finally {
    if (sessionVersion === state.sessionVersion) login(true);
  }
}
function passwordDialog() {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal"><section class="panel"><h2>Changer le mot de passe</h2><form id="passwordForm"><label class="field">Mot de passe actuel<input name="current" type="password" required maxlength="64"></label><label class="field">Nouveau mot de passe<input name="next" type="password" required maxlength="64"></label><label class="field">Confirmer le nouveau mot de passe<input name="confirmation" type="password" required maxlength="64"></label><div class="actions"><button>Enregistrer</button><button type="button" class="secondary" onclick="this.closest('.modal').remove()">Annuler</button></div><p class="muted" id="passwordError"></p></form></section></div>`,
  );
  $("#passwordForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get("next") !== f.get("confirmation")) {
      $("#passwordError").textContent =
        "Les deux mots de passe sont différents.";
      return;
    }
    try {
      await cq.changePassword({
        current: f.get("current"),
        next: f.get("next"),
      });
      document.querySelector(".modal").remove();
      await reload();
      toast("Mot de passe modifié.");
    } catch (x) {
      $("#passwordError").textContent = x.message;
    }
  };
}
// period : applique les filtres de date et respecte l’historique complet des équipes.
function period() {
  if (!state.admin && state.tab === "history") return state.reports;
  const ranged = Boolean(state.periodStart || state.periodEnd);
  return state.reports.filter((r) => {
    const date = String(r.date || "");
    if (ranged)
      return (!state.periodStart || date >= state.periodStart) &&
        (!state.periodEnd || date <= state.periodEnd);
    return date.startsWith(state.month) &&
      (!state.day || date.slice(8, 10) === state.day);
  });
}
// stopsOf : rassemble les arrêts du rapport et ceux de ses trois séchoirs.
function stopsOf(r) {
  return [
    ...(r.stops || []),
    ...(r.drying?.dryers || []).flatMap((x) =>
      (x.stops || []).map((s) => ({ ...s, zone: `Séchoir ${x.number}` })),
    ),
  ].map((s) => ({
    ...s,
    minutes: D.stopDuration(s),
    date: r.date,
    shift: r.shift,
    team: r.team,
    id: r.id,
  }));
}
function allStops(rs = period()) {
  return rs.flatMap(stopsOf);
}
function sum(a) {
  return a.reduce((n, x) => n + (Number(x) || 0), 0);
}
function productionCurve(reports, mode = "day") {
  const year = state.month.slice(0, 4),
    chartReports =
      mode === "month"
        ? state.reports.filter((r) => String(r.date || "").startsWith(year))
        : reports,
    dates =
      mode === "month"
        ? [...new Set(chartReports.map((r) => String(r.date).slice(0, 7)))].sort()
        : [...new Set(chartReports.map((r) => r.date))].sort();
  if (!dates.length)
    return '<p class="muted">Aucune production enregistrée pour cette période.</p>';

  const teams = Object.keys(D.TEAMS);
  const colors = ["#2563eb", "#16a34a", "#f59e0b", "#9333ea"];
  const values = teams.map((team) =>
    dates.map((date) =>
      sum(
        chartReports
          .filter((r) => String(r.date || "").startsWith(date) && r.team === team)
          .map((r) => r.production?.parcels),
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
    return `<g class="chart-grid"><line x1="${left}" y1="${y}" x2="${right}" y2="${y}"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${compact(value)}</text></g>`;
  }).join("");

  const series = values
    .map((points, teamIndex) => {
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
          `<circle cx="${x}" cy="${y}" r="4" fill="${colors[teamIndex]}"><title>Équipe ${teams[teamIndex]} · ${dates[index]} : ${compact(points[index])} colis</title></circle>`,
        )
        .join("");
      return `<g class="chart-series"><path d="${path}" stroke="${colors[teamIndex]}"/>${markers}</g>`;
    })
    .join("");

  const labels = dates
    .map(
      (date, index) =>
        `<text class="chart-date" x="${xAt(index)}" y="244" text-anchor="middle">${mode === "month" ? new Date(`${date}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) : date.slice(8, 10)}</text>`,
    )
    .join("");
  const legend = teams
    .map(
      (team, index) =>
        `<span><i style="background:${colors[index]}"></i>Équipe ${team}</span>`,
    )
    .join("");

  return `<div class="line-chart-with-legend"><div class="line-chart-wrap"><svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Évolution de la production par équipe ${mode === "month" ? "par mois" : "par jour"}">${grid}${series}${labels}</svg></div><div class="legend">${legend}</div></div>`;
}
function reportTable(rs, withActions = false) {
  return `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Quart</th><th>Équipe</th><th>Effectif présent</th><th>Production</th><th>Tonnage (kg)</th>${withActions ? "<th>Action</th>" : ""}</tr></thead><tbody>${rs
    .map((r) => {
      const d = D.derive(r);
      return `<tr class="report-row" data-id="${esc(r.id)}"><td>${dateFmt(r.date)}</td><td>${esc(r.shift)}</td><td>${esc(r.team)}</td><td>${d.present}</td><td>${Number(r.production?.parcels || 0)}</td><td>${d.kg.toLocaleString("fr-FR")}</td>${withActions ? `<td><button class="secondary" data-open="${esc(r.id)}">Voir</button> <button data-synthesis="${esc(r.id)}">Synthèse</button></td>` : ""}</tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function bindReportButtons() {
  document
    .querySelectorAll("[data-open]")
    .forEach((b) => (b.onclick = () => openReport(b.dataset.open)));
  document
    .querySelectorAll("[data-synthesis]")
    .forEach((b) => (b.onclick = () => synthesis(b.dataset.synthesis)));
}
// home : construit les indicateurs, les six zones, le camembert et la courbe.
function home(el) {
  const rs = period(),
    st = allStops(rs),
    prod = sum(rs.map((r) => r.production?.parcels)),
    zones = STOP_ZONES.map((zone) => ({
      name: zone,
      minutes: sum(st.filter((stop) => stop.zone === zone).map((stop) => stop.minutes)),
    })),
    colors = ["#2563eb", "#16a34a", "#f59e0b", "#9333ea"],
    teams = Object.keys(D.TEAMS),
    totals = teams.map((team) =>
      sum(rs.filter((r) => r.team === team).map((r) => r.production?.parcels)),
    );
  const productionTotal = sum(totals);
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
    ? teams
        .map((team, index) => {
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

          return `<span class="pie-label" style="left:${x}%;top:${y}%">${team}<br>${percent} %</span>`;
        })
        .join("")
    : "";

  const chartMonths = new Set(rs.map((r) => String(r.date || "").slice(0, 7)).filter(Boolean)),
    chartMode = chartMonths.size > 1 ? "month" : "day",
    chartTitle = chartMode === "month" ? "par mois" : "par jour";

  el.innerHTML = `<div class="cards">
    <div class="card">Rapports enregistrés<b>${rs.length}</b></div>
    <div class="card">Production de la période<b>${prod.toLocaleString("fr-FR")} colis</b></div>
  </div>
  <div class="grid2 home-summary">
    <section class="panel home-zones">
      <h2>Temps d’arrêt par zone</h2>
      <div class="zone-grid">${zones.map(({ name, minutes }) =>
        `<article class="zone-card"><span>${esc(name)}</span><b>${D.durationText(minutes)}</b></article>`,
      ).join("")}</div>
    </section>
    <section class="panel home-pie">
      <h2>Répartition de la production par équipe</h2>
      <div class="pie-layout">
        <div class="pie" style="background:conic-gradient(${slices || "#dbe5ef 0deg 360deg"})">${pieLabels}</div>
        <div>${teams.map((team, index) => {
          const percent = productionTotal
            ? ((totals[index] / productionTotal) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })
            : "0";
          return `<div class="zone-row"><span><i class="dot" style="background:${colors[index]}"></i>Équipe ${team} · ${percent} %</span><b>${totals[index].toLocaleString("fr-FR")} colis</b></div>`;
        }).join("")}</div>
      </div>
    </section>
  </div>
  <section class="panel home-trend">
    <h2>Évolution de la production par équipe — ${chartTitle}</h2>
    ${productionCurve(rs, chartMode)}
  </section>`;
}
function createView(el) {
  el.innerHTML = `<section class="panel"><h2>Nouveau rapport de quart</h2><p class="muted">Créez ou complétez le rapport de votre équipe. Les rapports enregistrés restent consultables dans l’historique.</p><button id="startReport">Créer un rapport</button></section>`;
  $("#startReport").onclick = () => newReport();
}
function reportsView(el) {
  const rs = period();
  el.innerHTML = `<section class="panel"><h2>Rapports enregistrés</h2>${reportTable(rs, true)}<div class="actions"><button id="exportReports" class="secondary">Exporter Excel</button></div><h3>Arrêts du rapport sélectionné</h3><div id="reportStops" class="muted">Sélectionnez un rapport dans le tableau.</div></section>`;
  bindReportButtons();
  document.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
    tr.onclick = () => displayStops(tr.dataset.id);
    tr.ondblclick = () => displayStops(tr.dataset.id);
    tr.oncontextmenu = (e) => {
      e.preventDefault();
      contextActions(tr.dataset.id, e.clientX, e.clientY);
    };
  });
  if (state.admin) $("#exportReports").onclick = () => exportReports(rs);
}
function historyView(el) {
  el.innerHTML = `<section class="panel"><h2>Historique</h2><div class="actions"><label>Date <input type="date" id="filterDate"></label><label>Quart <select id="filterShift"><option value="">Tous</option>${D.SHIFTS.map((x) => `<option>${x}</option>`).join("")}</select></label><label>Équipe <select id="filterTeam"><option value="">Toutes</option>${Object.keys(
    D.TEAMS,
  )
    .map((x) => `<option value="${x}">${x}</option>`)
    .join(
      "",
    )}</select></label><button id="clearFilter" class="secondary">Effacer les filtres</button>${state.admin ? '<button id="exportHistory">Exporter Excel</button>' : ""}</div><div id="historyTable">${reportTable(period())}</div><h3>Arrêts du rapport sélectionné</h3><div id="historyStops" class="muted">Sélectionnez un rapport.</div></section>`;
  const apply = () => {
    let list = period();
    const date = $("#filterDate").value,
      shift = $("#filterShift").value,
      team = $("#filterTeam").value;
    list = list.filter(
      (r) =>
        (!date || r.date === date) &&
        (!shift || r.shift === shift) &&
        (!team || r.team === team),
    );
    $("#historyTable").innerHTML = reportTable(list);
    document
      .querySelectorAll("#historyTable tbody tr[data-id]")
      .forEach((tr) => {
        tr.onclick = () => displayStops(tr.dataset.id, "historyStops");
        tr.ondblclick = () => synthesis(tr.dataset.id);
      });
    if (state.admin)
      $("#exportHistory").onclick = () =>
        exportReports(list, $("#filterDate").value);
  };
  ["filterDate", "filterShift", "filterTeam"].forEach(
    (id) => ($("#" + id).onchange = apply),
  );
  $("#clearFilter").onclick = () => {
    $("#filterDate").value = "";
    $("#filterShift").value = "";
    $("#filterTeam").value = "";
    apply();
  };
  apply();
}
function contextActions(id, x, y) {
  document.querySelector(".row-menu")?.remove();
  const m = document.createElement("div");
  m.className = "row-menu";
  m.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:8;background:white;border:1px solid #cbd5e1;border-radius:8px;padding:6px;box-shadow:0 5px 20px #0003`;
  m.innerHTML =
    '<button class="secondary" data-action="open">Voir le rapport de quart</button><button data-action="synth">Voir la synthèse de quart</button>';
  document.body.append(m);
  m.onclick = (e) => {
    const a = e.target.dataset.action;
    m.remove();
    if (a === "open") openReport(id);
    if (a === "synth") synthesis(id);
  };
  setTimeout(
    () => document.addEventListener("click", () => m.remove(), { once: true }),
    0,
  );
}
function displayStops(id, target = "reportStops") {
  const r = state.reports.find((x) => x.id === id);
  if (!r) return;
  const stops = stopsOf(r);
  state.selectedStopsReportId = id;
  state.selectedStopsTarget = target;
  const box = $(`#${target}`);
  if (!stops.length) {
    box.innerHTML = "<p>Aucun arrêt enregistré pour ce rapport.</p>";
    return;
  }
  box.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Zone</th><th>Début</th><th>Fin</th><th>Cause</th><th>Durée</th></tr></thead><tbody>${stops.map((s) => `<tr><td>${esc(s.zone)}</td><td>${esc(D.normalizeTime(s.start))}</td><td>${esc(D.normalizeTime(s.end))}</td><td>${esc(s.cause)}</td><td>${D.durationText(s.minutes)}</td></tr>`).join("")}</tbody></table></div>`;
}
function stopsView(el) {
  const st = allStops().sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      D.SHIFTS.indexOf(a.shift) - D.SHIFTS.indexOf(b.shift) ||
      a.team.localeCompare(b.team) ||
      (D.parseTime(a.start) ?? 0) - (D.parseTime(b.start) ?? 0),
  );
  const zoneTotals = STOP_ZONES.map((zone) => ({
    name: zone,
    minutes: sum(st.filter((stop) => stop.zone === zone).map((stop) => stop.minutes)),
  }));
  const zoneCards = zoneTotals
    .map(
      ({ name, minutes }) =>
        `<article class="zone-card"><span>${esc(name)}</span><b>${D.durationText(minutes)}</b></article>`,
    )
    .join("");
  const rows = st
    .map((s, i) => {
      const prev = st[i - 1],
        startGroup =
          !prev ||
          `${prev.date}|${prev.shift}|${prev.team}` !==
            `${s.date}|${s.shift}|${s.team}`;
      return `<tr class="${startGroup ? "stop-group-start" : ""}"><td>${dateFmt(s.date)}</td><td>${esc(s.shift)}</td><td>${esc(s.team)}</td><td>${esc(s.zone)}</td><td>${esc(D.normalizeTime(s.start))}–${esc(D.normalizeTime(s.end))}</td><td>${esc(s.cause)}</td><td>${D.durationText(s.minutes)}</td></tr>`;
    })
    .join("");
  el.innerHTML = `<div class="actions"><button id="exportStops">Exporter les arrêts XLSX</button></div><section class="panel stop-summary"><h2>Temps d’arrêt par zone</h2><div class="zone-grid">${zoneCards}</div></section><section class="panel stop-details"><h2>Détail par jour et quart — un arrêt distinct par ligne</h2><div class="tablewrap"><table><thead><tr><th>Jour</th><th>Quart</th><th>Équipe</th><th>Zone</th><th>Heures</th><th>Cause</th><th>Durée</th></tr></thead><tbody>${rows || '<tr><td colspan="7">Aucun arrêt enregistré pour cette période.</td></tr>'}</tbody></table></div></section>`;
  $("#exportStops").onclick = async () => {
    const rows = [
      ["Jour", "Quart", "Équipe", "Zone", "Début", "Fin", "Cause", "Durée"],
      ...st.map((s) => [
        dateFmt(s.date),
        s.shift,
        s.team,
        s.zone,
        D.normalizeTime(s.start),
        D.normalizeTime(s.end),
        s.cause,
        D.durationText(s.minutes),
      ]),
    ];
    if (
      await cq.exportXlsx({
        name: `temps-arret_${dateFilterToken()}.xlsx`,
        rows,
      })
    )
      toast("Export XLSX terminé");
  };
}
function newReport(existing = null) {
  const hits = {};
  state.reports.forEach((r) =>
    stopsOf(r).forEach((s) => {
      if (!s.cause) return;
      const k = s.zone || "Autre";
      hits[k] ||= {};
      hits[k][s.cause] = (hits[k][s.cause] || 0) + 1;
    }),
  );
  window.CQSuggestions = Object.fromEntries(
    Object.entries(hits).map(([z, m]) => [
      z,
      Object.entries(m)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([cause]) => cause),
    ]),
  );
  CQReportForm.show(existing, async (r) => {
    try {
      const errors = D.validateReport(r);
      if (errors.length) throw new Error(errors.join("\n"));
      // Le même créneau ne peut appartenir qu’à une seule équipe.
      const reportId = `${r.date}_${r.shift}_${r.team}`;
      const duplicate = state.reports.find(
        (saved) => saved.date === r.date && saved.shift === r.shift && saved.id !== reportId,
      );
      if (duplicate)
        throw new Error(
          `Un rapport existe déjà pour cette date et ce quart (équipe ${duplicate.team}).`,
        );
      await cq.saveReport(r);
      await reload();
      render();
      toast("Rapport enregistré.");
      // Ouvre immédiatement la synthèse du rapport tout juste sauvegardé.
      const saved = state.reports.find(
        (item) => item.date === r.date && item.shift === r.shift && item.team === r.team,
      );
      if (saved) synthesis(saved.id);
      return true;
    } catch (e) {
      alert(e.message);
      return false;
    }
  });
}
function openReport(id) {
  const r = state.reports.find((x) => x.id === id);
  if (!r) return;
  const d = D.derive(r),
    fmt = (k, v) =>
      `<div class="zone-row"><span>${esc(k)}</span><b>${v == null || v === "" ? "—" : esc(v)}</b></div>`,
    stops = stopsOf(r);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal"><section class="panel report-readonly"><h2 class="report-title"><span>Rapport de quart</span><button type="button" class="secondary" onclick="this.closest('.modal').remove()">Fermer</button></h2><p>${dateFmt(r.date)} · ${esc(r.shift)} · Équipe ${esc(r.team)} — ${esc(D.TEAMS[r.team])}</p><h3>Effectif</h3>${fmt("Total", r.staff?.total)}${fmt("Présents", d.present)}${fmt("Absents", r.staff?.absent)}${fmt("Malades", r.staff?.sick)}${fmt("Permissions", r.staff?.permission)}${fmt("Congés", r.staff?.leave)}${fmt("Accidents", r.staff?.accidents)}<h3>Prélavage</h3>${fmt("Box 1", r.prewash?.box)}${fmt("Godets", r.prewash?.buckets)}${fmt("Total prélavé", `${D.derive(r).prewashTotal.toLocaleString("fr-FR")} kg`)}${fmt("Box 2", r.prewash?.secondBox)}${fmt("Godets box 2", r.prewash?.secondBuckets)}<h3>Granulation</h3>${fmt("Box usinage", r.granulation?.box)}${fmt("Titre acide (g/l)", r.granulation?.acidTitre)}${fmt("Consommation acide (kg)", r.granulation?.acidConsumption)}${fmt("Paniers granulés", r.granulation?.baskets)}${fmt("Avance paniers", r.granulation?.basketAdvance)}${fmt("Paniers lavés", r.granulation?.basketsWashed)}<h3>Séchage et production</h3>${fmt("Paniers séchés", r.drying?.basketsDry)}${fmt("Production (colis)", r.production?.parcels)}${fmt("Tonnage (kg)", d.kg)}${fmt("Balles début / quart / traitées / fin", [r.production?.balesStart, r.production?.balesShift, r.production?.balesProcessed, r.production?.balesEnd].join(" / "))}${(r.drying?.dryers || []).map((x) => `<h4>Séchoir ${x.number}</h4>${fmt("Cycle / brûleurs 1–2", `${x.cycle} sec / ${x.burner1} / ${x.burner2}`)}${fmt("Compteur / gaz", `${x.counter || "—"} / ${x.gas1 || "—"} / ${x.gas2 || "—"}`)}`).join("")}<h3>Arrêts du quart</h3>${stops.length ? `<div class="tablewrap"><table><thead><tr><th>Zone</th><th>Début</th><th>Fin</th><th>Cause</th><th>Durée</th></tr></thead><tbody>${stops.map((s) => `<tr><td>${esc(s.zone)}</td><td>${D.normalizeTime(s.start)}</td><td>${D.normalizeTime(s.end)}</td><td>${esc(s.cause)}</td><td>${D.durationText(s.minutes)}</td></tr>`).join("")}</tbody></table></div>` : "<p>Aucun arrêt.</p>"}<h3>Groupes électrogènes</h3>${Object.entries(
      r.generators || {},
    )
      .map(([name, items]) =>
        fmt(
          name,
          (items || [])
            .map((x) => `${D.normalizeTime(x.start)}–${D.normalizeTime(x.end)}`)
            .join(", ") || "Aucune période",
        ),
      )
      .join(
        "",
      )}<div class="actions"><button class="secondary" onclick="this.closest('.modal').remove()">Fermer</button></div></section></div>`,
  );
}
// synthesis : affiche les lignes calculées par le modèle métier dans le tableau de quart.
function synthesis(id) {
  const r = state.reports.find((x) => x.id === id);
  if (!r) return;
  const current = document.querySelector(".synthesis-drawer");
  if (current?.dataset.report === id) {
    current.closest(".synthesis-modal")?.remove();
    return;
  }
  const rows = D.synthesisRows(r);
  current?.closest(".synthesis-modal")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal synthesis-modal"><section class="synthesis-drawer panel" data-report="${esc(id)}">
      <div class="synthesis-capture" id="synthesisCapture">
        <div class="synthesis-title"><h2>Synthèse de la production du quart</h2></div>
        <p class="synthesis-info">${dateFmt(r.date)} · ${esc(r.shift)} · Équipe ${esc(r.team)} — ${esc(D.TEAMS[r.team])}</p>
        <div class="synthesis-table-wrap"><table class="synthesis-table">
          <thead><tr><th>Information</th><th>Valeur</th></tr></thead>
          <tbody>${rows.map((row) => {
            const value = row.value == null || row.value === ""
              ? "—"
              : typeof row.value === "number"
                ? row.value.toLocaleString("fr-FR")
                : row.value;
            const tone = row.tone ? `tone-${esc(row.tone)}` : "";
            return `<tr class="${tone}"><td>${esc(row.label)}</td><td class="${row.highlight ? "highlight" : ""}">${esc(value)}</td></tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>
      <div class="synthesis-actions">
        ${state.admin ? '<button id="captureSynthesis" class="secondary">Capturer le tableau</button><button id="openCaptures" class="secondary">Ouvrir le dossier de capture</button>' : ""}
        <button type="button" class="secondary close-synthesis">Fermer</button>
      </div>
    </section></div>`,
  );
  $(".close-synthesis").onclick = () =>
    document.querySelector(".synthesis-modal")?.remove();
  if (state.admin) {
    $("#captureSynthesis").onclick = async () => {
      const node = document.querySelector("#synthesisCapture"),
        b = node.getBoundingClientRect();
      try {
        const file = await cq.captureSynthesis({
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          reportId: id,
          name: `Synthese_${r.date}_${r.shift.replaceAll("/", "-")}_Equipe-${r.team}.png`,
        });
        toast(`Capture enregistrée : ${file}`);
      } catch (e) {
        alert(e.message);
      }
    };
    $("#openCaptures").onclick = async () => {
      const error = await cq.openCaptures();
      if (error) alert(error);
    };
  }
}
// exportReports : exporte les rapports visibles en reprenant la date du filtre.
async function exportReports(rs, exactDate = "") {
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
      const d = D.derive(r);
      return [
        dateFmt(r.date),
        r.shift,
        r.team,
        d.present,
        r.production?.parcels,
        d.kg,
      ];
    }),
  ];
  if (
    await cq.exportXlsx({
      name: `rapports-quart_${dateFilterToken(exactDate)}.xlsx`,
      rows,
    })
  )
    toast("Export Excel terminé");
}
async function init() {
  await reload();
  if (state.recoveryKey) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="modal recovery-modal"><section class="panel"><h2>Notez la clé de récupération</h2><p>Elle permet d'initialiser l'administrateur, de réinitialiser un mot de passe d'équipe et de déplacer une sauvegarde. Conservez-la en lieu sûr.</p><p class="recovery-code">${esc(state.recoveryKey)}</p><button id="copyRecovery" class="secondary">Copier la clé</button><label class="field recovery-check"><input type="checkbox" id="recoverySaved"> J'ai noté cette clé et je la range en lieu sûr</label><button id="confirmRecovery" disabled>Continuer</button></section></div>`,
    );
    $("#copyRecovery").onclick = async () => {
      try {
        await navigator.clipboard.writeText(state.recoveryKey);
        toast("Clé copiée.");
      } catch {
        toast("Copie indisponible : notez la clé affichée.");
      }
    };
    $("#recoverySaved").onchange = (e) =>
      ($("#confirmRecovery").disabled = !e.target.checked);
    $("#confirmRecovery").onclick = async () => {
      await cq.ackRecovery();
      document.querySelector(".recovery-modal").remove();
      state.recoveryKey = null;
      login();
    };
  }
}
init()
  .then(login)
  .catch((e) => {
    app.textContent = "Erreur de démarrage : " + e.message;
  });
