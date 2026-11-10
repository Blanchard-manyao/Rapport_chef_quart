"use strict";

// Formulaire de saisie : onglets, contrôles immédiats et aperçu du rapport.
(() => {
  const D = window.CQDomain;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
    );
  }

  function input(label, path, value, type = "text", attributes = "") {
    return `<label class="field">${label}<input data-path="${path}" type="${type}" value="${escapeHtml(value)}" ${attributes}></label>`;
  }

  function number(label, path, value = 0, min = 0, max = 99999) {
    return input(label, path, value, "number", `min="${min}" max="${max}" step="1"`);
  }

  function suggestionId(zone) {
    return `suggest-${String(zone || "Autre").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  function stopRow(stop = {}, fixedZone = stop.zone || "Autre") {
    const zone = fixedZone;
    return `<div class="stop stop-row">
      <input data-stop="zone" aria-label="Zone de l’arrêt" value="${escapeHtml(zone)}" readonly title="La zone est imposée par cette section">
      <input data-stop="start" aria-label="Heure de début de l’arrêt" placeholder="Début · 07H30" value="${escapeHtml(D.normalizeTime(stop.start) || stop.start || "")}">
      <input data-stop="end" aria-label="Heure de fin de l’arrêt" placeholder="Fin · 08H15" value="${escapeHtml(D.normalizeTime(stop.end) || stop.end || "")}">
      <input data-stop="cause" aria-label="Cause de l’arrêt" placeholder="Cause de l’arrêt" value="${escapeHtml(stop.cause || "")}" list="${suggestionId(zone)}">
      <output class="stop-duration" data-stop-duration>Durée : —</output>
      <button type="button" class="danger remove-stop" aria-label="Supprimer cet arrêt">×</button>
    </div>`;
  }

  function stopGroup(title, zone, items = []) {
    return `<section class="panel form-section stop-group" data-stop-group-zone="${escapeHtml(zone)}">
      <h3>${title}</h3>
      <div class="stops-list">${items.map((item) => stopRow(item, zone)).join("")}</div>
      <button class="secondary add-stop" type="button">Ajouter un arrêt</button>
      <div class="stop-summary" aria-live="polite">Temps d’arrêt : <output data-stop-total>0 h 00 min</output><span>Temps de fonctionnement : <output data-stop-run>8 h 00 min</output></span></div>
    </section>`;
  }

  function generatorSection(label, key, periods = []) {
    return `<section class="panel form-section">
      <h3>${label}</h3>
      <div class="gen-list" data-gen="${escapeHtml(key)}">
        ${periods.map((period) => generatorRow(period)).join("")}
      </div>
      <button type="button" class="secondary add-gen">Ajouter une période</button>
    </section>`;
  }

  function generatorRow(period = {}) {
    return `<div class="gen-row">
      <input data-gen-time="start" aria-label="Heure de démarrage du générateur" placeholder="Démarrage · 07H30" value="${escapeHtml(D.normalizeTime(period.start) || period.start || "")}">
      <input data-gen-time="end" aria-label="Heure d’arrêt du générateur" placeholder="Arrêt · 15H00" value="${escapeHtml(D.normalizeTime(period.end) || period.end || "")}">
      <output class="gen-duration" data-gen-duration>Fonctionnement : —</output>
      <button type="button" class="danger remove-gen" aria-label="Supprimer cette période">×</button>
    </div>`;
  }

  function show(existing, onSave) {
    const report = existing ? structuredClone(existing) : D.emptyReport();
    report.prewash ||= { box: "", buckets: 0, secondBox: "", secondBuckets: 0 };
    report.stops ||= [];
    if (!existing && window.CQUser && window.CQUser !== "Administrateur") {
      report.team = window.CQUser;
    }

    const hasSecondBox = Boolean(
      report.prewash.secondBox || Number(report.prewash.secondBuckets),
    );
    const dryers = report.drying?.dryers || D.emptyReport().drying.dryers;
    const teamOptions = Object.keys(D.TEAMS)
      .map(
        (team) =>
          `<option value="${team}" ${report.team === team ? "selected" : ""}>Équipe ${team} — ${D.TEAMS[team]}</option>`,
      )
      .join("");

    const panels = [
      {
        id: "staff",
        title: "Effectif",
        content: `<section class="panel form-section"><h3>Effectif</h3><div class="formgrid">
          ${number("Effectif total", "staff.total", report.staff.total)}
          ${number("Absents", "staff.absent", report.staff.absent)}
          ${number("Malades", "staff.sick", report.staff.sick)}
          ${number("Permissions", "staff.permission", report.staff.permission)}
          ${number("Congés", "staff.leave", report.staff.leave)}
          ${number("Accidents", "staff.accidents", report.staff.accidents)}
        </div><p class="derived">Effectif présent : <b data-present>${D.staffPresent(report)}</b></p></section>`,
      },
      {
        id: "prewash",
        title: "Prélavage",
        content: `<section class="panel form-section">
          <h3>Prélavage</h3>
          <div class="formgrid">
            ${input("Box prélavé", "prewash.box", report.prewash.box)}
            ${number("Nombre de godets", "prewash.buckets", report.prewash.buckets)}
          </div>
          <div class="second-box-fields ${hasSecondBox ? "" : "hidden"}">
            <div class="formgrid">
              ${input("Deuxième box prélavé", "prewash.secondBox", report.prewash.secondBox)}
              ${number("Nombre de godets du deuxième box", "prewash.secondBuckets", report.prewash.secondBuckets)}
            </div>
            <button type="button" class="secondary remove-second-box">Retirer le deuxième box</button>
          </div>
          <button type="button" class="secondary toggle-second-box">Ajouter un deuxième box prélavé</button>
          <p class="derived">Total prélavé : <b data-prewash>${D.derive(report).prewashTotal.toLocaleString("fr-FR")} kg</b></p>
          ${stopGroup("Arrêt prélavage", "Prélavage", report.stops.filter((stop) => stop.zone === "Prélavage"))}
        </section>`,
      },
      {
        id: "granulation",
        title: "Granulation",
        content: `<section class="panel form-section"><h3>Granulation</h3><div class="formgrid">
          ${input("Box en cours d’usinage", "granulation.box", report.granulation.box)}
          ${input("Titre acide (g/l)", "granulation.acidTitre", report.granulation.acidTitre, "number", 'min="0" step="0.1"')}
          ${input("Consommation acide (kg)", "granulation.acidConsumption", report.granulation.acidConsumption, "number", 'min="0" step="0.1"')}
          ${number("Paniers granulés", "granulation.baskets", report.granulation.baskets, 0, 999)}
          ${input("Avance panier fin", "granulation.basketAdvance", report.granulation.basketAdvance)}
          ${input("Paniers lavés", "granulation.basketsWashed", report.granulation.basketsWashed)}
        </div>
          ${stopGroup("Arrêts granulation – Ligne 1", "Ligne 1", report.stops.filter((stop) => stop.zone === "Ligne 1"))}
          ${stopGroup("Arrêts granulation – Ligne 2", "Ligne 2", report.stops.filter((stop) => stop.zone === "Ligne 2"))}
        </section>`,
      },
      {
        id: "drying",
        title: "Séchage et production",
        content: `<section class="panel form-section"><h3>Séchage et production</h3><div class="formgrid">
          ${number("Colis produits", "production.parcels", report.production.parcels)}
          ${number("Paniers séchés", "drying.basketsDry", report.drying.basketsDry, 0, 999)}
        </div>
        <p class="derived">Tonnage calculé : <b data-kg>${D.derive(report).kg.toLocaleString("fr-FR")} kg</b></p>
        <p class="derived">Poids moyen panier : <b data-average-basket>${D.derive(report).averageBasket?.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "—"} kg</b></p>
        <p class="derived">Poids moyen d’un pain : <b data-average-bread>${D.derive(report).averageBasketDiv28?.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "—"} kg</b></p></section>`,
      },
      ...dryers.map((dryer, index) => ({
        id: `dryer-${index + 1}`,
        title: `Séchoir ${index + 1}`,
        content: `<section class="panel form-section dryer" data-dryer="${index}"><h3>Séchoir ${index + 1}</h3><div class="formgrid">
          ${number("Cycle (en secondes)", "dryer.cycle", dryer.cycle, 0, 600)}
          ${number("Brûleur 1", "dryer.burner1", dryer.burner1, 0, 130)}
          ${number("Brûleur 2", "dryer.burner2", dryer.burner2, 0, 130)}
          ${input("Compteur du séchoir", "dryer.counter", dryer.counter)}
          ${input("Compteur gaz E1", "dryer.gas1", dryer.gas1)}
          ${input("Compteur gaz E2", "dryer.gas2", dryer.gas2)}
        </div>${stopGroup(`Arrêt séchoir ${index + 1}`, `Séchoir ${index + 1}`, dryer.stops || [])}</section>`,
      })),
      {
        id: "conditioning",
        title: "Conditionnement",
        content: `<section class="panel form-section"><h3>Conditionnement</h3><div class="formgrid">
          ${number("Balles détectées en début de quart", "production.balesStart", report.production.balesStart)}
          ${number("Balles détectées", "production.balesShift", report.production.balesShift)}
          ${number("Balles détectées traitées", "production.balesProcessed", report.production.balesProcessed)}
          ${number("Balles détectées en fin de quart", "production.balesEnd", report.production.balesEnd)}
        </div>${stopGroup("Arrêt conditionnement", "Conditionnement", report.stops.filter((stop) => stop.zone === "Conditionnement"))}</section>`,
      },
      {
        id: "generators",
        title: "Générateurs",
        content: `${generatorSection("Groupe électrogène 2 500 kVA", "GE 2500 KVA", report.generators?.["GE 2500 KVA"] || [])}
          ${generatorSection("Groupe électrogène 2 000 kVA", "GE 2000 KVA", report.generators?.["GE 2000 KVA"] || [])}`,
      },
      {
        id: "other-stops",
        title: "Autres arrêts",
        content: stopGroup("Autres arrêts machine", "Autre", report.stops.filter((stop) => stop.zone === "Autre")),
      },
    ];

    const suggestionLists = D.ZONES.map((zone) => {
      const defaults = [
        "Panne mécanique",
        "Panne électrique",
        "Manque de matière",
        "Nettoyage",
        "Problème d’énergie",
      ];
      const suggestions = [...(window.CQSuggestions?.[zone] || []), ...defaults].filter(
        (item, index, all) => all.indexOf(item) === index,
      );
      return `<datalist id="${suggestionId(zone)}">${suggestions.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</datalist>`;
    }).join("");

    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="modal report-modal"><section class="panel report-editor">
        <h2>${existing ? "Rapport de quart" : "Nouveau rapport de quart"}</h2>
        <form class="report-form">
          <div class="form-context formgrid">
            ${input("Date", "date", report.date, "date", "required")}
            <label class="field">Quart<select data-path="shift" required><option value="" disabled ${report.shift ? "" : "selected"}>Choisir un quart</option>${D.SHIFTS.map((shift) => `<option ${report.shift === shift ? "selected" : ""}>${shift}</option>`).join("")}</select></label>
            <label class="field">Équipe<select data-path="team">${teamOptions}</select></label>
          </div>
          <div class="report-layout">
            <div class="report-entry">
              <nav class="form-tab-nav" aria-label="Sections du rapport">
                ${panels.map((panel, index) => `<button type="button" class="form-tab-button ${index === 0 ? "active" : ""}" data-form-tab="${panel.id}">${panel.title}</button>`).join("")}
              </nav>
              <div class="form-tab-content">
                ${panels.map((panel, index) => `<section class="form-tab-panel ${index === 0 ? "active" : "hidden"}" data-form-panel="${panel.id}">${panel.content}</section>`).join("")}
              </div>
            </div>
            <aside class="report-copy-panel">
              <h3>Rapport à copier</h3>
              <textarea id="reportCopyText" readonly spellcheck="false">${escapeHtml(D.reportText(report))}</textarea>
              <button type="button" id="copyReport">Copier rapport</button>
              <p id="copyReportStatus" class="muted" aria-live="polite"></p>
            </aside>
          </div>
          ${suggestionLists}
          <div class="actions report-actions">
            <button type="button" id="saveReport">Enregistrer le rapport</button>
            <button type="button" class="secondary cancel">Annuler</button>
          </div>
        </form>
      </section></div>`,
    );

    const modal = document.querySelector(".report-modal:last-child");
    const form = modal.querySelector(".report-form");
    const teamSelect = modal.querySelector('[data-path="team"]');
    if (window.CQUser && window.CQUser !== "Administrateur") {
      teamSelect.value = window.CQUser;
      teamSelect.disabled = true;
    }
    if (!existing) {
      form.querySelectorAll("[data-path]").forEach((field) => {
        if (field.dataset.path !== "team") field.value = "";
      });
    }

    form.addEventListener("keydown", (event) => {
      if (
        event.key !== "Enter" ||
        event.isComposing ||
        !event.target.matches("input:not([type=button]):not([type=submit])")
      )
        return;

      event.preventDefault();
      const fields = Array.from(
        form.querySelectorAll(
          'input:not([type="hidden"]):not([disabled]), select:not([disabled]), button:not([disabled])',
        ),
      ).filter((field) => field.offsetParent !== null);
      const next = fields[fields.indexOf(event.target) + 1];
      next?.focus();
    });

    modal.querySelectorAll("[data-form-tab]").forEach((button) => {
      button.onclick = () => {
        const selected = button.dataset.formTab;
        modal.querySelectorAll("[data-form-tab]").forEach((item) =>
          item.classList.toggle("active", item === button),
        );
        modal.querySelectorAll("[data-form-panel]").forEach((panel) => {
          const active = panel.dataset.formPanel === selected;
          panel.classList.toggle("active", active);
          panel.classList.toggle("hidden", !active);
        });
      };
    });

    const secondBoxFields = modal.querySelector(".second-box-fields");
    const toggleSecondBox = modal.querySelector(".toggle-second-box");
    toggleSecondBox.onclick = () => {
      const isVisible = !secondBoxFields.classList.contains("hidden");
      if (!isVisible) {
        secondBoxFields.classList.remove("hidden");
        toggleSecondBox.classList.add("hidden");
        secondBoxFields.querySelector('[data-path="prewash.secondBox"]').focus();
      }
    };
    modal.querySelector(".remove-second-box").onclick = () => {
      secondBoxFields.querySelector('[data-path="prewash.secondBox"]').value = "";
      secondBoxFields.querySelector('[data-path="prewash.secondBuckets"]').value = "0";
      secondBoxFields.classList.add("hidden");
      toggleSecondBox.classList.remove("hidden");
      refreshPreview();
    };

    modal.querySelectorAll(".add-stop").forEach((button) => {
      button.onclick = () => {
        const list = button.closest(".stop-group").querySelector(".stops-list");
        list.insertAdjacentHTML(
          "beforeend",
          stopRow({ zone: button.closest(".stop-group").dataset.stopGroupZone }),
        );
        list.querySelector(".stop-row:last-child [data-stop='start']")?.focus();
        refreshPreview();
      };
    });

    modal.querySelectorAll(".add-gen").forEach((button) => {
      button.onclick = () => {
        button.previousElementSibling.insertAdjacentHTML("beforeend", generatorRow());
        refreshPreview();
      };
    });

    modal.addEventListener("click", (event) => {
      if (event.target.matches(".remove-gen")) {
        event.target.closest(".gen-row").remove();
        refreshPreview();
      }
      if (event.target.matches(".remove-stop")) {
        event.target.closest(".stop-row").remove();
        refreshPreview();
      }
      if (event.target.matches(".cancel")) modal.remove();
    });

    // Met à jour les durées et le texte du rapport à partir des champs visibles.
    function refreshPreview() {
      const current = collect(form, report);
      const derived = D.derive(current);
      modal.querySelectorAll(".stop-group").forEach((group) => {
        let total = 0;
        group.querySelectorAll(".stop-row").forEach((row) => {
          const start = row.querySelector('[data-stop="start"]').value;
          const end = row.querySelector('[data-stop="end"]').value;
          const startMinute = D.parseTime(start),
            endMinute = D.parseTime(end),
            complete = startMinute !== null && endMinute !== null,
            valid = complete && endMinute > startMinute;
          const duration = valid ? D.stopDuration({ start, end }) : 0;
          total += duration;
          const durationLabel = row.querySelector("[data-stop-duration]");
          durationLabel.textContent = valid
            ? `Durée : ${D.durationText(duration)}`
            : complete
              ? "Fin après le début requise"
              : "Durée : —";
          durationLabel.classList.toggle("invalid-time", complete && !valid);
        });
        group.querySelector("[data-stop-total]").textContent = D.durationText(total);
        group.querySelector("[data-stop-run]").textContent = D.durationText(Math.max(480 - total, 0));
      });
      modal.querySelectorAll(".gen-row").forEach((row) => {
        const start = row.querySelector('[data-gen-time="start"]').value;
        const end = row.querySelector('[data-gen-time="end"]').value;
        const startMinute = D.parseTime(start),
          endMinute = D.parseTime(end),
          complete = startMinute !== null && endMinute !== null,
          valid = complete && endMinute > startMinute,
          duration = row.querySelector("[data-gen-duration]");
        duration.textContent = valid
          ? `Fonctionnement : ${D.durationText(D.stopDuration({ start, end }))}`
          : complete
            ? "Fin après le début requise"
            : "Fonctionnement : —";
        duration.classList.toggle("invalid-time", complete && !valid);
      });
      modal.querySelector("[data-present]").textContent = derived.present;
      modal.querySelector("[data-prewash]").textContent = `${derived.prewashTotal.toLocaleString("fr-FR")} kg`;
      modal.querySelector("[data-kg]").textContent = `${derived.kg.toLocaleString("fr-FR")} kg`;
      modal.querySelector("[data-average-basket]").textContent = `${derived.averageBasket?.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "—"} kg`;
      modal.querySelector("[data-average-bread]").textContent = `${derived.averageBasketDiv28?.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "—"} kg`;
      modal.querySelector("#reportCopyText").value = D.reportText(current);
    }

    form.addEventListener("input", refreshPreview);
    refreshPreview();
    modal.querySelector("#copyReport").onclick = async () => {
      const text = modal.querySelector("#reportCopyText").value;
      const status = modal.querySelector("#copyReportStatus");
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = "Rapport copié dans le presse-papiers.";
      } catch {
        const preview = modal.querySelector("#reportCopyText");
        preview.focus();
        preview.select();
        const copied = document.execCommand("copy");
        status.textContent = copied
          ? "Rapport copié dans le presse-papiers."
          : "Copie impossible. Sélectionnez le texte pour le copier.";
      }
    };

    // La validation métier s’exécute avant l’appel de sauvegarde principal.
    const saveReport = async () => {
      const result = collect(form, report);
      const errors = D.validateReport(result);
      if (errors.length) {
        alert(errors.join("\n"));
        return;
      }
      const saved = await onSave(result);
      if (saved !== false) modal.remove();
    };
    form.onsubmit = (event) => event.preventDefault();
    modal.querySelector("#saveReport").onclick = saveReport;
  }

  function collect(form, base) {
    const report = structuredClone(base);

    form.querySelectorAll("[data-path]").forEach((element) => {
      const path = element.dataset.path;
      if (path.startsWith("dryer.")) return;

      let value = element.value;
      if (element.type === "number") value = Number(value || 0);
      if (["date", "team", "shift"].includes(path)) {
        report[path] = value;
        return;
      }

      const keys = path.split(".");
      let target = report;
      for (const key of keys.slice(0, -1)) target = target[key] ?? (target[key] = {});
      target[keys.at(-1)] = value;
    });

    report.stops = [];
    form.querySelectorAll(".stop-group").forEach((group) => {
      if (group.closest(".dryer")) return;
      group.querySelectorAll(".stop-row").forEach((row) => {
        const stop = { zone: group.dataset.stopGroupZone };
        row.querySelectorAll("[data-stop]").forEach((element) => {
          if (element.dataset.stop !== "zone") stop[element.dataset.stop] = element.value.trim();
        });
        if (stop.start || stop.end || stop.cause || stop.equipment) report.stops.push(stop);
      });
    });

    report.drying.dryers = [...form.querySelectorAll(".dryer")].map((box, index) => {
      const previous = (base.drying?.dryers || [])[index] || {};
      const dryer = {
        number: index + 1,
        cycle: 0,
        burner1: 0,
        burner2: 0,
        counter: "",
        gas1: "",
        gas2: "",
        stops: [],
      };

      box
        .querySelectorAll(
          '[data-path="dryer.cycle"], [data-path="dryer.burner1"], [data-path="dryer.burner2"], [data-path="dryer.counter"], [data-path="dryer.gas1"], [data-path="dryer.gas2"]',
        )
        .forEach((element) => {
          const key = element.dataset.path.split(".")[1];
          dryer[key] = element.type === "number" ? Number(element.value || 0) : element.value.trim();
        });

      box.querySelectorAll(".stop-row").forEach((row) => {
        const stop = { zone: `Séchoir ${index + 1}` };
        row.querySelectorAll("[data-stop]").forEach((element) => {
          if (element.dataset.stop !== "zone") stop[element.dataset.stop] = element.value.trim();
        });
        if (stop.start || stop.end || stop.cause || stop.equipment) dryer.stops.push(stop);
      });

      return { ...previous, ...dryer };
    });

    report.generators = {};
    form.querySelectorAll("[data-gen]").forEach((list) => {
      report.generators[list.dataset.gen] = [...list.querySelectorAll(".gen-row")]
        .map((row) => ({
          start: row.querySelector('[data-gen-time="start"]').value.trim(),
          end: row.querySelector('[data-gen-time="end"]').value.trim(),
        }))
        .filter((period) => period.start || period.end);
    });

    report.id = D.reportId(report);
    return report;
  }

  window.CQReportForm = { show };
})();
