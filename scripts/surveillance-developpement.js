"use strict";

// Lance Electron depuis VS Code et redémarre l’application après chaque sauvegarde.
const { spawn: lancerProcessus } = require("node:child_process");
const fichiers = require("node:fs");
const chemins = require("node:path");

const dossierProjet = chemins.resolve(__dirname, "..");
const programmeElectron = require("electron");
const dossiersSurveilles = ["src", "assets"]
  .map((dossier) => chemins.join(dossierProjet, dossier))
  .filter((dossier) => fichiers.existsSync(dossier));

let processusApplication = null;
let minuteurRedemarrage = null;
let redemarrageDemande = false;
let arretDemande = false;

function lancerApplication() {
  console.log("Démarrage de Rapport Chef de Quart…");
  processusApplication = lancerProcessus(programmeElectron, [dossierProjet], {
    cwd: dossierProjet,
    stdio: "inherit",
  });

  processusApplication.on("error", (error) => {
    console.error("Impossible de démarrer Electron :", error.message);
  });

  processusApplication.on("exit", (code) => {
    processusApplication = null;
    if (redemarrageDemande && !arretDemande) {
      redemarrageDemande = false;
      lancerApplication();
    } else if (!arretDemande) {
      console.log(`Application fermée (code ${code ?? "inconnu"}).`);
    }
  });
}

function programmerRedemarrage(dossier, nomFichier) {
  if (arretDemande) return;
  clearTimeout(minuteurRedemarrage);
  minuteurRedemarrage = setTimeout(() => {
    console.log(`Modification détectée dans ${chemins.basename(dossier)}${nomFichier ? `/${nomFichier}` : ""}.`);
    if (!processusApplication) {
      lancerApplication();
      return;
    }
    redemarrageDemande = true;
    processusApplication.kill();
  }, 350);
}

for (const dossier of dossiersSurveilles) {
  try {
    fichiers.watch(dossier, { recursive: true }, (_event, nomFichier) => {
      programmerRedemarrage(dossier, nomFichier?.toString());
    });
  } catch (error) {
    console.error(`Surveillance impossible pour ${dossier} :`, error.message);
  }
}

// Les changements de package.json (par exemple les scripts) redémarrent aussi Electron.
fichiers.watch(dossierProjet, (_event, nomFichier) => {
  if (nomFichier?.toString().toLowerCase() === "package.json")
    programmerRedemarrage(dossierProjet, "package.json");
});

process.on("SIGINT", () => {
  arretDemande = true;
  clearTimeout(minuteurRedemarrage);
  if (processusApplication) processusApplication.kill();
  process.exit(0);
});

lancerApplication();