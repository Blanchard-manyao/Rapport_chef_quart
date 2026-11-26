"use strict";

// Formulaire de rapport sur une page.
(() => {
  const reglesMetier = window.ReglesMetier;

  function echapperTexteHtml(valeur) {
    return String(valeur ?? "").replace(/[&<>"']/g, (caractere) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[caractere],
    );
  }

  function creerChamp(intitule, chemin, valeur, type = "text", attributs = "") {
    return `<label class="champ">${intitule}<input data-chemin="${chemin}" type="${type}" value="${echapperTexteHtml(valeur)}" ${attributs}></label>`;
  }

  function creerChampNombre(intitule, chemin, valeur = 0, minimum = 0, maximum = 99999) {
    return creerChamp(intitule, chemin, valeur, "number", `min="${minimum}" max="${maximum}" step="1"`);
  }

  function identifiantSuggestion(zone) {
    return `suggestion-${String(zone || "Autre").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  function ligneArret(arret = {}, zoneFixe = arret.zone || "Autre") {
    const zone = zoneFixe;
    return `<div class="arret ligne-arret">
      <input data-arret="zone" aria-label="Zone de l’arrêt" value="${echapperTexteHtml(zone)}" readonly title="La zone est imposée par cette section">
      <input data-arret="equipment" aria-label="Équipement concerné" placeholder="Équipement concerné" value="${echapperTexteHtml(arret.equipment || "")}">
      <select data-arret="impact" aria-label="Impact de la panne">
        <option value="zone" ${arret.impact === "equipment" ? "" : "selected"}>Arrêt de zone</option>
        <option value="equipment" ${arret.impact === "equipment" ? "selected" : ""}>Panne équipement, zone en marche</option>
      </select>
      <input data-arret="debut" aria-label="Heure de début de l’arrêt" placeholder="Début · 07H30" maxlength="5" value="${echapperTexteHtml(reglesMetier.formaterHeure(arret.start) || arret.start || "")}">
      <input data-arret="fin" aria-label="Heure de fin de l’arrêt" placeholder="Fin · 08H15" maxlength="5" value="${echapperTexteHtml(reglesMetier.formaterHeure(arret.end) || arret.end || "")}">
      <input data-arret="cause" aria-label="Cause de l’arrêt" placeholder="Cause de l’arrêt" value="${echapperTexteHtml(arret.cause || "")}" list="${identifiantSuggestion(zone)}">
      <output class="duree-arret" data-duree-arret>Durée : —</output>
      <button type="button" class="alerte supprimer-arret" aria-label="Supprimer cet arrêt">×</button>
    </div>`;
  }

  function groupeArrets(title, zone, items = []) {
    return `<section class="panneau section-formulaire groupe-arrets" data-zone-groupe-arrets="${echapperTexteHtml(zone)}">
      <h3>${title}</h3>
      <div class="liste-arrets">${items.map((item) => ligneArret(item, zone)).join("")}</div>
      <button class="secondaire ajouter-arret" type="button">Ajouter un arrêt</button>
      <div class="resume-arrets" aria-live="polite">Temps d’arrêt de la zone : <output data-total-arrets>0 h 00 min</output><span>Temps de fonctionnement de la zone : <output data-fonctionnement-arrets>8 h 00 min</output></span></div>
    </section>`;
  }

  function sectionGenerateur(label, key, periodes = []) {
    return `<section class="panneau section-formulaire">
      <h3>${label}</h3>
      <div class="liste-generateur" data-generateur="${echapperTexteHtml(key)}">
        ${periodes.map((periode) => ligneGenerateur(periode)).join("")}
      </div>
      <button type="button" class="secondaire ajouter-generateur">Ajouter une période</button>
    </section>`;
  }

  function ligneGenerateur(periode = {}) {
    return `<div class="ligne-generateur">
      <input data-heure-generateur="debut" aria-label="Heure de démarrage du générateur" placeholder="Démarrage · 07H30" maxlength="5" value="${echapperTexteHtml(reglesMetier.formaterHeure(periode.start) || periode.start || "")}">
      <input data-heure-generateur="fin" aria-label="Heure d’arrêt du générateur" placeholder="Arrêt · 15H00" maxlength="5" value="${echapperTexteHtml(reglesMetier.formaterHeure(periode.end) || periode.end || "")}">
      <output class="duree-generateur" data-duree-generateur>Fonctionnement : —</output>
      <button type="button" class="alerte supprimer-generateur" aria-label="Supprimer cette période">×</button>
    </div>`;
  }

  function afficherFormulaire(rapportExistant, enregistrer) {
    const rapport = rapportExistant ? structuredClone(rapportExistant) : reglesMetier.creerRapportVide();
    rapport.prelavage ||= { box: "", buckets: 0, secondBox: "", secondBuckets: 0 };
    rapport.prelavage.tourBennes ||= 0;
    rapport.stops ||= [];
    if (!rapportExistant && window.utilisateurActif && window.utilisateurActif !== "Administrateur") {
      rapport.equipe = window.utilisateurActif;
    }

    const hasSecondBox = Boolean(
      rapport.prelavage.secondBox || Number(rapport.prelavage.secondBuckets),
    );
    const sechoirs = rapport.drying?.sechoirs || reglesMetier.creerRapportVide().drying.sechoirs;
    const equipeOptions = Object.keys(reglesMetier.EQUIPES)
      .map(
        (equipe) =>
          `<option value="${equipe}" ${rapport.equipe === equipe ? "selected" : ""}>Équipe ${equipe} — ${reglesMetier.EQUIPES[equipe]}</option>`,
      )
      .join("");

    const panels = [
      {
        id: "effectif",
        title: "Effectif",
        content: `<section class="panneau section-formulaire"><h3>Effectif</h3><div class="grille-formulaire">
          ${creerChampNombre("Effectif total", "staff.total", rapport.staff.total)}
          ${creerChampNombre("Absents", "staff.absent", rapport.staff.absent)}
          ${creerChampNombre("Malades", "staff.malade", rapport.staff.malade)}
          ${creerChampNombre("Permissions", "staff.permission", rapport.staff.permission)}
          ${creerChampNombre("Congés", "staff.conge", rapport.staff.conge)}
          ${creerChampNombre("Accidents", "staff.accidents", rapport.staff.accidents)}
        </div><p class="valeur-calculee">Effectif présent : <b data-effectif-present>${reglesMetier.effectifPresent(rapport)}</b></p></section>`,
      },
      {
        id: "prelavage",
        title: "Prélavage",
        content: `<section class="panneau section-formulaire">
          <h3>Prélavage</h3>
          <div class="grille-formulaire">
            ${creerChamp("Box prélavé", "prelavage.box", rapport.prelavage.box)}
            ${creerChampNombre("Nombre de godets", "prelavage.buckets", rapport.prelavage.buckets)}
            ${creerChampNombre("Tour de bennes", "prelavage.tourBennes", rapport.prelavage.tourBennes || 0)}
          </div>
          <div class="champs-deuxieme-box ${hasSecondBox ? "" : "masque"}">
            <div class="grille-formulaire">
              ${creerChamp("Deuxième box prélavé", "prelavage.secondBox", rapport.prelavage.secondBox)}
              ${creerChampNombre("Nombre de godets du deuxième box", "prelavage.secondBuckets", rapport.prelavage.secondBuckets)}
            </div>
            <button type="button" class="secondaire supprimer-deuxieme-box">Retirer le deuxième box</button>
          </div>
          <button type="button" class="secondaire afficher-deuxieme-box">Ajouter un deuxième box prélavé</button>
          <p class="valeur-calculee">Total prélavé : <b data-prelavage>${reglesMetier.calculerIndicateurs(rapport).prelavageTotal.toLocaleString("fr-FR")} kg</b></p>
          ${groupeArrets("Arrêt prélavage", "Prélavage", rapport.stops.filter((stop) => stop.zone === "Prélavage"))}
        </section>`,
      },
      {
        id: "granulation",
        title: "Granulation",
        content: `<section class="panneau section-formulaire"><h3>Granulation</h3><div class="grille-formulaire">
          ${creerChamp("Box en cours d’usinage", "granulation.box", rapport.granulation.box)}
          ${creerChamp("Titre acide (g/l)", "granulation.acidTitre", rapport.granulation.acidTitre, "number", 'min="0" step="0.1"')}
          ${creerChamp("Consommation acide (kg)", "granulation.acidConsumption", rapport.granulation.acidConsumption, "number", 'min="0" step="0.1"')}
          ${creerChampNombre("Paniers granulés", "granulation.baskets", rapport.granulation.baskets, 0, 999)}
          ${creerChamp("Avance panier fin", "granulation.basketAdvance", rapport.granulation.basketAdvance)}
          ${creerChamp("Paniers lavés", "granulation.basketsWashed", rapport.granulation.basketsWashed)}
        </div>
          ${groupeArrets("Arrêts granulation – Ligne 1", "Ligne 1", rapport.stops.filter((stop) => stop.zone === "Ligne 1"))}
          ${groupeArrets("Arrêts granulation – Ligne 2", "Ligne 2", rapport.stops.filter((stop) => stop.zone === "Ligne 2"))}
        </section>`,
      },
      {
        id: "sechage",
        title: "Séchage et production",
        content: `<section class="panneau section-formulaire"><h3>Séchage et production</h3><div class="grille-formulaire">
          ${creerChampNombre("Colis produits", "production.paniers", rapport.production.paniers)}
          ${creerChampNombre("Paniers séchés", "drying.basketsDry", rapport.drying.basketsDry, 0, 999)}
        </div>
        <p class="valeur-calculee">Tonnage réalisé : <b data-kg>${reglesMetier.calculerIndicateurs(rapport).kg.toLocaleString("fr-FR")} kg</b></p>
        <p class="valeur-calculee">Poids moyen d'un panier : <b data-poids-moyen-panier>${reglesMetier.calculerIndicateurs(rapport).averageBasket?.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "—"} kg</b></p>
        <p class="valeur-calculee">Poids moyen d’un pain : <b data-poids-moyen-pain>${reglesMetier.calculerIndicateurs(rapport).averageBasketDiv28?.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "—"} kg</b></p></section>`,
      },
      ...sechoirs.map((sechoir, index) => ({
        id: `sechoir-${index + 1}`,
        title: `Séchoir ${index + 1}`,
        content: `<section class="panneau section-formulaire sechoir" data-sechoir="${index}"><h3>Séchoir ${index + 1}</h3><div class="grille-formulaire">
          ${creerChampNombre("Cycle (en secondes)", "sechoir.cycle", sechoir.cycle, 0, 600)}
          ${creerChampNombre("Brûleur 1", "sechoir.bruleur1", sechoir.bruleur1, 0, 130)}
          ${creerChampNombre("Brûleur 2", "sechoir.bruleur2", sechoir.bruleur2, 0, 130)}
          ${creerChamp("Compteur du séchoir", "sechoir.counter", sechoir.counter)}
          ${creerChamp("Compteur gaz E1", "sechoir.gas1", sechoir.gas1)}
          ${creerChamp("Compteur gaz E2", "sechoir.gas2", sechoir.gas2)}
        </div>${groupeArrets(`Arrêt séchoir ${index + 1}`, "Séchage", (sechoir.stops || []).map((stop) => ({ ...stop, equipment: stop.equipment || `Séchoir ${index + 1}` })))}</section>`,
      })),
      {
        id: "conditionnement",
        title: "Conditionnement",
        content: `<section class="panneau section-formulaire"><h3>Conditionnement</h3><div class="grille-formulaire">
          ${creerChampNombre("Balles détectées en début de quart", "production.balesStart", rapport.production.balesStart)}
          ${creerChampNombre("Balles détectées", "production.balesquart", rapport.production.balesquart)}
          ${creerChampNombre("Balles détectées traitées", "production.balesProcessed", rapport.production.balesProcessed)}
          ${creerChampNombre("Balles détectées en fin de quart", "production.balesEnd", rapport.production.balesEnd)}
        </div>${groupeArrets("Arrêt conditionnement", "Conditionnement", rapport.stops.filter((stop) => stop.zone === "Conditionnement"))}</section>`,
      },
      {
        id: "generateurs",
        title: "Générateurs",
        content: `${sectionGenerateur("Groupe électrogène 2 500 kVA", "GE 2500 KVA", rapport.generators?.["GE 2500 KVA"] || [])}
          ${sectionGenerateur("Groupe électrogène 2 000 kVA", "GE 2000 KVA", rapport.generators?.["GE 2000 KVA"] || [])}`,
      },
      {
        id: "autres-arrets",
        title: "Autres arrêts",
        content: groupeArrets("Autres arrêts machine", "Autre", rapport.stops.filter((stop) => stop.zone === "Autre")),
      },
    ];

    const suggestionLists = reglesMetier.ZONES_ARRET.map((zone) => {
      const defaults = [
        "Panne mécanique",
        "Panne électrique",
        "Manque de matière",
        "Nettoyage",
        "Problème d’énergie",
      ];
      const suggestions = [...(window.suggestionsArret?.[zone] || []), ...defaults].filter(
        (item, index, all) => all.indexOf(item) === index,
      );
      return `<datalist id="${identifiantSuggestion(zone)}">${suggestions.map((item) => `<option>${echapperTexteHtml(item)}</option>`).join("")}</datalist>`;
    }).join("");

    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="fenetre-modale fenetre-rapport"><section class="panneau editeur-rapport">
        <h2>${rapportExistant ? "Modifier le rapport de quart" : "Nouveau rapport de quart"}</h2>
        <form class="formulaire-rapport">
          <div class="contexte-formulaire grille-formulaire">
            ${creerChamp("Date", "date", rapport.date, "date", "required")}
            <label class="champ">Quart<select data-chemin="quart" required><option value="" disabled ${rapport.quart ? "" : "selected"}>Choisir un quart</option>${reglesMetier.QUARTS.map((quart) => `<option ${rapport.quart === quart ? "selected" : ""}>${quart}</option>`).join("")}</select></label>
            <label class="champ">Équipe<select data-chemin="equipe">${equipeOptions}</select></label>
          </div>
          <div class="disposition-rapport">
            <div class="saisie-rapport">
              <div class="sections-rapport">
                ${panels.map((panel) => `<section class="section-rapport" data-section-rapport="${panel.id}">${panel.content}</section>`).join("")}
              </div>
            </div>
            <aside class="panneau-rapport-copier">
              <h3>Rapport à copier</h3>
              <textarea id="texteRapportCopier" readonly spellcheck="false">${echapperTexteHtml(reglesMetier.texteRapport(rapport))}</textarea>
              <button type="button" id="copierRapport">Copier rapport</button>
              <p id="etatCopieRapport" class="discret" aria-live="polite"></p>
            </aside>
          </div>
          ${suggestionLists}
          <div class="actions actions-rapport">
            <button type="button" id="enregistrerRapport">${rapportExistant ? "Enregistrer les modifications" : "Enregistrer le rapport"}</button>
            <button type="button" class="secondaire annuler">Fermer</button>
          </div>
        </form>
      </section></div>`,
    );

    const modal = document.querySelector(".fenetre-rapport:last-child");
    const form = modal.querySelector(".formulaire-rapport");
    const equipeSelect = modal.querySelector('[data-chemin="equipe"]');
    if (window.utilisateurActif && window.utilisateurActif !== "Administrateur") {
      equipeSelect.value = window.utilisateurActif;
      equipeSelect.disabled = true;
    }
    if (!rapportExistant) {
      form.querySelectorAll("[data-chemin]").forEach((field) => {
        if (field.dataset.chemin !== "equipe") field.value = "";
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

    const secondBoxFields = modal.querySelector(".champs-deuxieme-box");
    const toggleSecondBox = modal.querySelector(".afficher-deuxieme-box");
    toggleSecondBox.onclick = () => {
      const isVisible = !secondBoxFields.classList.contains("masque");
      if (!isVisible) {
        secondBoxFields.classList.remove("masque");
        toggleSecondBox.classList.add("masque");
        secondBoxFields.querySelector('[data-chemin="prelavage.secondBox"]').focus();
      }
    };
    modal.querySelector(".supprimer-deuxieme-box").onclick = () => {
      secondBoxFields.querySelector('[data-chemin="prelavage.secondBox"]').value = "";
      secondBoxFields.querySelector('[data-chemin="prelavage.secondBuckets"]').value = "0";
      secondBoxFields.classList.add("masque");
      toggleSecondBox.classList.remove("masque");
      actualiserApercu();
    };

    modal.querySelectorAll(".ajouter-arret").forEach((button) => {
      button.onclick = () => {
        const list = button.closest(".groupe-arrets").querySelector(".liste-arrets");
        list.insertAdjacentHTML(
          "beforeend",
          ligneArret({ zone: button.closest(".groupe-arrets").dataset.zoneGroupeArrets }),
        );
        list.querySelector(".ligne-arret:last-child [data-arret='debut']")?.focus();
        actualiserApercu();
      };
    });

    modal.querySelectorAll(".ajouter-generateur").forEach((button) => {
      button.onclick = () => {
        button.previousElementSibling.insertAdjacentHTML("beforeend", ligneGenerateur());
        actualiserApercu();
      };
    });

    modal.addEventListener("click", (event) => {
      if (event.target.matches(".supprimer-generateur")) {
        event.target.closest(".ligne-generateur").remove();
        actualiserApercu();
      }
      if (event.target.matches(".supprimer-arret")) {
        event.target.closest(".ligne-arret").remove();
        actualiserApercu();
      }
      if (event.target.matches(".annuler")) confirmerFermetureRapport();
    });

    // Demande confirmation avant de perdre une saisie non enregistrée.
    function confirmerFermetureRapport() {
      if (document.querySelector(".confirmation-fermeture-rapport")) return;
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="fenetre-modale confirmation-fermeture-rapport" role="alertdialog" aria-modal="true" aria-labelledby="titreFermetureRapport">
          <section class="panneau">
            <h2 id="titreFermetureRapport">Fermer le rapport ?</h2>
            <p>Les modifications non enregistrées seront perdues. Veux-tu vraiment fermer la saisie ?</p>
            <div class="actions">
              <button type="button" class="secondaire continuer-rapport">Continuer la saisie</button>
              <button type="button" class="abandonner-rapport">Fermer sans enregistrer</button>
            </div>
          </section>
        </div>`,
      );
      const confirmation = document.querySelector(".confirmation-fermeture-rapport");
      confirmation.querySelector(".continuer-rapport").onclick = () => confirmation.remove();
      confirmation.querySelector(".abandonner-rapport").onclick = () => {
        confirmation.remove();
        modal.remove();
      };
      confirmation.querySelector(".continuer-rapport").focus();
    }
    // Met à jour les durées et le texte du rapport à partir des champs visibles.
    function actualiserApercu() {
      const current = recueillirDonneesFormulaire(form, rapport);
      const derived = reglesMetier.calculerIndicateurs(current);
      modal.querySelectorAll(".groupe-arrets").forEach((group) => {
        let total = 0;
        group.querySelectorAll(".ligne-arret").forEach((row) => {
          const debut = row.querySelector('[data-arret="debut"]').value;
          const fin = row.querySelector('[data-arret="fin"]').value;
          const startMinute = reglesMetier.lireHeureEnMinutes(debut),
            endMinute = reglesMetier.lireHeureEnMinutes(fin),
            complete = startMinute !== null && endMinute !== null,
            valid = complete && reglesMetier.intervalleArretValide(debut, fin, current.quart),
            impact = row.querySelector('[data-arret="impact"]').value,
            equipment = row.querySelector('[data-arret="equipment"]').value.trim();
          const duration = valid ? reglesMetier.dureeArret({ start: debut, end: fin }, current.quart) : 0;
          if (impact !== "equipment") total += duration;
          const durationLabel = row.querySelector("[data-duree-arret]");
          durationLabel.textContent = valid
            ? `${impact === "equipment" ? `Panne ${equipment || "équipement"}` : "Arrêt de zone"} : ${reglesMetier.formaterDuree(duration)}`
            : complete
              ? (!reglesMetier.intervalleDansQuart(debut, fin, current.quart)
                  ? `Heure hors du quart ${current.quart}`
                  : endMinute < startMinute && current.quart !== "23h-07h"
                  ? "Seul le quart 23h-07h peut passer minuit"
                  : "Durée invalide (maximum 8 h)")
              : "Durée : —";
          durationLabel.classList.toggle("heure-invalide", complete && !valid);
        });
        group.querySelector("[data-total-arrets]").textContent = reglesMetier.formaterDuree(total);
        group.querySelector("[data-fonctionnement-arrets]").textContent = reglesMetier.formaterDuree(Math.max(480 - total, 0));
      });
      modal.querySelectorAll(".ligne-generateur").forEach((row) => {
        const debut = row.querySelector('[data-heure-generateur="debut"]').value;
        const fin = row.querySelector('[data-heure-generateur="fin"]').value;
        const startMinute = reglesMetier.lireHeureEnMinutes(debut),
          endMinute = reglesMetier.lireHeureEnMinutes(fin),
          complete = startMinute !== null && endMinute !== null,
          valid = complete && reglesMetier.intervalleArretValide(debut, fin, current.quart),
          duration = row.querySelector("[data-duree-generateur]");
        duration.textContent = valid
          ? `Fonctionnement : ${reglesMetier.formaterDuree(reglesMetier.dureeArret({ start: debut, end: fin }, current.quart))}`
          : complete
            ? (!reglesMetier.intervalleDansQuart(debut, fin, current.quart)
                ? `Heure hors du quart ${current.quart}`
                : endMinute < startMinute && current.quart !== "23h-07h"
                ? "Seul le quart 23h-07h peut passer minuit"
                : "Durée invalide (maximum 8 h)")
            : "Fonctionnement : —";
        duration.classList.toggle("heure-invalide", complete && !valid);
      });
      modal.querySelector("[data-effectif-present]").textContent = derived.present;
      modal.querySelector("[data-prelavage]").textContent = `${derived.prelavageTotal.toLocaleString("fr-FR")} kg`;
      modal.querySelector("[data-kg]").textContent = `${derived.kg.toLocaleString("fr-FR")} kg`;
      modal.querySelector("[data-poids-moyen-panier]").textContent = `${derived.averageBasket?.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "—"} kg`;
      modal.querySelector("[data-poids-moyen-pain]").textContent = `${derived.averageBasketDiv28?.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "—"} kg`;
      modal.querySelector("#texteRapportCopier").value = reglesMetier.texteRapport(current);
    }

    form.addEventListener("keydown", (event) => {
      const field = event.target;
      if (field.matches('input[type="number"]') && (/^[eE+-]$/.test(event.key) || (field.step === "1" && /^[.,]$/.test(event.key))))
        event.preventDefault();
    });
    form.addEventListener("input", (event) => {
      const field = event.target;
      if (field.matches('input[type="number"]') && field.value) {
        const normalized = field.value.replace(",", ".").replace(/[^0-9.]/g, "");
        const [whole, ...fraction] = normalized.split(".");
        const clean = whole + (fraction.length ? `.${fraction.join("")}` : "");
        if (clean !== field.value) field.value = clean;
      }
      if (field.matches('[data-arret="debut"], [data-arret="fin"], [data-heure-generateur]'))
        field.value = field.value.slice(0, 5);
      actualiserApercu();
    });
    form.addEventListener("change", actualiserApercu);
    actualiserApercu();
    modal.querySelector("#copierRapport").onclick = async () => {
      const text = modal.querySelector("#texteRapportCopier").value;
      const status = modal.querySelector("#etatCopieRapport");
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = "Rapport copié dans le presse-papiers.";
      } catch {
        const preview = modal.querySelector("#texteRapportCopier");
        preview.focus();
        preview.select();
        const copied = document.execCommand("copy");
        status.textContent = copied
          ? "Rapport copié dans le presse-papiers."
          : "Copie impossible. Sélectionnez le texte pour le copier.";
      }
    };

    // La validation métier s’exécute avant l’appel de sauvegarde principal.
    const sauvegarder = async () => {
      const result = recueillirDonneesFormulaire(form, rapport);
      const errors = reglesMetier.validerRapport(result);
      if (errors.length) {
        alert(errors.join("\n"));
        return;
      }
      const saved = await enregistrer(result);
      if (saved !== false) modal.remove();
    };
    form.onsubmit = (event) => event.preventDefault();
    modal.querySelector("#enregistrerRapport").onclick = sauvegarder;
  }

  function recueillirDonneesFormulaire(form, base) {
    const rapport = structuredClone(base);

    form.querySelectorAll("[data-chemin]").forEach((element) => {
      const path = element.dataset.chemin;
      if (path.startsWith("sechoir.")) return;

      let value = element.value;
      if (element.type === "number") value = Number(value || 0);
      if (["date", "equipe", "quart"].includes(path)) {
        rapport[path] = value;
        return;
      }

      const keys = path.split(".");
      let target = rapport;
      for (const key of keys.slice(0, -1)) target = target[key] ?? (target[key] = {});
      target[keys.at(-1)] = value;
    });

    rapport.stops = [];
    form.querySelectorAll(".groupe-arrets").forEach((group) => {
      if (group.closest(".sechoir")) return;
      group.querySelectorAll(".ligne-arret").forEach((row) => {
        const stop = { zone: group.dataset.zoneGroupeArrets };
        row.querySelectorAll("[data-arret]").forEach((element) => {
          if (element.dataset.arret !== "zone") {
            const cle = { debut: "start", fin: "end", cause: "cause", equipment: "equipment", impact: "impact" }[element.dataset.arret];
            stop[cle] = element.value.trim();
          }
        });
        if (stop.start || stop.end || stop.cause || stop.equipment) rapport.stops.push(stop);
      });
    });

    rapport.drying.sechoirs = [...form.querySelectorAll(".sechoir")].map((box, index) => {
      const previous = (base.drying?.sechoirs || [])[index] || {};
      const sechoir = {
        number: index + 1,
        cycle: 0,
        bruleur1: 0,
        bruleur2: 0,
        counter: "",
        gas1: "",
        gas2: "",
        stops: [],
      };

      box
        .querySelectorAll(
          '[data-chemin="sechoir.cycle"], [data-chemin="sechoir.bruleur1"], [data-chemin="sechoir.bruleur2"], [data-chemin="sechoir.counter"], [data-chemin="sechoir.gas1"], [data-chemin="sechoir.gas2"]',
        )
        .forEach((element) => {
          const key = element.dataset.chemin.split(".")[1];
          sechoir[key] = element.type === "number" ? Number(element.value || 0) : element.value.trim();
        });

      box.querySelectorAll(".ligne-arret").forEach((row) => {
        const stop = { zone: `Séchoir ${index + 1}` };
        row.querySelectorAll("[data-arret]").forEach((element) => {
          if (element.dataset.arret !== "zone") {
            const cle = { debut: "start", fin: "end", cause: "cause", equipment: "equipment", impact: "impact" }[element.dataset.arret];
            stop[cle] = element.value.trim();
          }
        });
        if (stop.start || stop.end || stop.cause || stop.equipment) sechoir.stops.push(stop);
      });

      return { ...previous, ...sechoir };
    });

    rapport.generators = {};
    form.querySelectorAll("[data-generateur]").forEach((list) => {
      rapport.generators[list.dataset.generateur] = [...list.querySelectorAll(".ligne-generateur")]
        .map((row) => ({
          start: row.querySelector('[data-heure-generateur="debut"]').value.trim(),
          end: row.querySelector('[data-heure-generateur="fin"]').value.trim(),
        }))
        .filter((periode) => periode.start || periode.end);
    });

    rapport.id = reglesMetier.identifiantRapport(rapport);
    return rapport;
  }

  window.FormulaireRapport = { afficherFormulaire };
})();
