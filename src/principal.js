const {
  app: applicationElectron,
  BrowserWindow,
  Menu,
  screen,
  ipcMain,
  safeStorage,
  dialog,
  shell,
} = require("electron");
const fichiers = require("node:fs");
const chemins = require("node:path");
const cryptographie = require("node:crypto");
// Une seule instance par session Windows ; un second lancement réactive la première.
const verrouInstanceUnique = applicationElectron.requestSingleInstanceLock();
if (!verrouInstanceUnique) applicationElectron.quit();
else
  applicationElectron.on("second-instance", () => {
    if (fenetrePrincipale && !fenetrePrincipale.isDestroyed()) activerFenetrePrincipale();
  });
// Processus principal Electron : fenêtre, accès aux données et règles serveur.
let fenetrePrincipale;
let utilisateurActif = null;
let apiSqlite = null;
let moduleSqlite = null;
let baseSqlite = null;
let cleSqlCipher = null;
const DELAI_MODIFICATION_RAPPORT_HEURES = 8;
const cheminBaseDonnees = () => chemins.join(applicationElectron.getPath("userData"), "rapport-cq.db");
const cheminAncienFichierDonnees = () => chemins.join(applicationElectron.getPath("userData"), "rapport-cq.dat");
const cheminIdentifiantsPortail = () => chemins.join(applicationElectron.getPath("userData"), "identifiants-portail.dat");
const cheminVirtuelSqlite = "/rapport-cq.db";
const entropieSqlCipher = Buffer.from("RapportQuart.Cle.v1", "utf8");
const ancienneBaseDeDonnees = () =>
  chemins.join(
    process.env.RAPPORT_QUART_DONNEES ||
      chemins.join(process.env.ProgramData || "C:\\ProgramData", "RapportQuart"),
    "rapports_quart.db",
  );
function consignerEvenement(level, message) {
  try {
    const dir = applicationElectron.getPath("userData"),
      p = chemins.join(dir, "journal.log");
    fichiers.mkdirSync(dir, { recursive: true });
    if (fichiers.existsSync(p) && fichiers.statSync(p).size > 1_000_000)
      fichiers.renameSync(p, p + ".old");
    fichiers.appendFileSync(
      p,
      `${new Date().toISOString()} [${process.env.USERNAME || "Windows"}@${process.env.COMPUTERNAME || "PC"}] ${level} ${message}\n`,
    );
  } catch {}
}
function lireIdentifiantsPortail() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const identifiants = JSON.parse(safeStorage.decryptString(fichiers.readFileSync(cheminIdentifiantsPortail())));
    return identifiants?.username && identifiants?.password ? identifiants : null;
  } catch {
    return null;
  }
}
function enregistrerIdentifiantsPortail(identifiants) {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("Le chiffrement Windows n’est pas disponible sur ce poste.");
  const repertoire = applicationElectron.getPath("userData");
  fichiers.mkdirSync(repertoire, { recursive: true });
  const chemin = cheminIdentifiantsPortail();
  const temporaire = `${chemin}.${process.pid}.tmp`;
  fichiers.writeFileSync(temporaire, safeStorage.encryptString(JSON.stringify(identifiants)));
  fichiers.renameSync(temporaire, chemin);
}
let donnees = { users: {}, reports: [] };
function lireAncienFichierDonnees() {
  try {
    const raw = fichiers.readFileSync(cheminAncienFichierDonnees());
    const text = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString("utf8");
    const anciennesDonnees = JSON.parse(text);
    if (anciennesDonnees && anciennesDonnees.users && Array.isArray(anciennesDonnees.reports))
      return anciennesDonnees;
  } catch {
    // Aucun fichier .dat ou ancienne version illisible : on démarrera vide.
  }
  return null;
}
function lireOuCreerCleBase(anciennesDonnees) {
  const locations = [
    process.env.RAPPORT_QUART_DONNEES &&
      chemins.join(process.env.RAPPORT_QUART_DONNEES, "cle.dat"),
    chemins.join(process.env.ProgramData || "C:\\ProgramData", "RapportQuart", "cle.dat"),
    chemins.join(applicationElectron.getPath("userData"), "rapport-cq-sqlcipher-key.dat"),
  ].filter(Boolean);
  const { Dpapi, isPlatformSupported } = require("@primno/dpapi");
  if (!isPlatformSupported)
    throw new Error("Le chiffrement SQLCipher de l’application requiert Windows.");
  for (const location of locations) {
    if (!fichiers.existsSync(location)) continue;
    try {
      const key = Dpapi.unprotectData(
        fichiers.readFileSync(location),
        entropieSqlCipher,
        "LocalMachine",
      ).toString("utf8").trim();
      if (/^[0-9A-F]{40}$/i.test(key)) return key;
    } catch {
      // Un fichier cle.dat peut appartenir à un autre poste Windows ; on essaie
      // alors la clé locale de l’application, ou la clé de récupération connue.
    }
  }
  const localKeyFile = locations.at(-1);
  const backupKey = String(anciennesDonnees?.recoveryKey || "").trim().toUpperCase();
  if (fichiers.existsSync(cheminBaseDonnees())) {
    if (/^[0-9A-F]{40}$/.test(backupKey)) return backupKey;
    throw new Error(
      "Clé SQLCipher introuvable. Gardez le fichier de clé du poste ayant créé cette base.",
    );
  }
  const key = /^[0-9A-F]{40}$/.test(backupKey)
    ? backupKey
    : cryptographie.randomBytes(20).toString("hex").toUpperCase();
  fichiers.mkdirSync(chemins.dirname(localKeyFile), { recursive: true });
  fichiers.writeFileSync(
    localKeyFile,
    Dpapi.protectData(Buffer.from(key, "utf8"), entropieSqlCipher, "LocalMachine"),
  );
  return key;
}
function lireEtatBase() {
  const result = { users: {}, reports: [], loginAttempts: {} };
  for (const row of baseSqlite.query("SELECT username, password_json FROM users"))
    result.users[row.username] = JSON.parse(row.password_json);
  for (const row of baseSqlite.query("SELECT report_id, report_date, quart, equipe, staff_total, staff_absent, production_paniers, baskets_dry, tonnage_kg, payload_json FROM reports ORDER BY report_date, quart, equipe")) {
    const report = normaliserRapport(JSON.parse(row.payload_json));
    report.id = row.report_id;
    report.date = row.report_date;
    report.quart = row.quart;
    report.equipe = row.equipe;
    report.staff ||= {};
    report.staff.total = Number(row.staff_total) || 0;
    report.staff.absent = Number(row.staff_absent) || 0;
    report.production ||= {};
    report.production.paniers = Number(row.production_paniers) || 0;
    report.production.tonnageKg = Number(row.tonnage_kg) || 0;
    report.drying ||= {};
    report.drying.basketsDry = Number(row.baskets_dry) || 0;
    result.reports.push(report);
  }
  for (const row of baseSqlite.query("SELECT username, attempts, locked_until FROM login_attempts"))
    result.loginAttempts[row.username] = {
      count: Number(row.attempts) || 0,
      until: Number(row.locked_until) || 0,
    };
  for (const row of baseSqlite.query("SELECT setting, value_json FROM app_settings"))
    result[row.setting] = JSON.parse(row.value_json);
  return result;
}
function normaliserRapport(report) {
  if (report.quart === undefined && report.shift !== undefined) report.quart = report.shift;
  if (report.equipe === undefined && report.team !== undefined) report.equipe = report.team;
  delete report.shift;
  delete report.team;

  report.production ||= {};
  if (report.production.paniers === undefined && report.production.parcels !== undefined)
    report.production.paniers = report.production.parcels;
  if (report.production.balesquart === undefined && report.production.balesShift !== undefined)
    report.production.balesquart = report.production.balesShift;
  delete report.production.parcels;
  delete report.production.balesShift;

  report.drying ||= {};
  if (report.drying.sechoirs === undefined && report.drying.dryers !== undefined)
    report.drying.sechoirs = report.drying.dryers;
  delete report.drying.dryers;
  for (const sechoir of report.drying.sechoirs || []) {
    if (sechoir.bruleur1 === undefined && sechoir.burner1 !== undefined)
      sechoir.bruleur1 = sechoir.burner1;
    if (sechoir.bruleur2 === undefined && sechoir.burner2 !== undefined)
      sechoir.bruleur2 = sechoir.burner2;
    delete sechoir.burner1;
    delete sechoir.burner2;
  }
  return report;
}
function migrerColonnesRapports() {
  const colonnes = new Set(baseSqlite.query("PRAGMA table_info(reports)").map((colonne) => colonne.name));
  let schemaModifie = false;
  const renommages = [
    ["shift", "quart"],
    ["team", "equipe"],
    ["production_parcels", "production_paniers"],
  ];
  baseSqlite.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    for (const [ancienNom, nouveauNom] of renommages) {
      if (colonnes.has(ancienNom) && !colonnes.has(nouveauNom)) {
        baseSqlite.exec(`ALTER TABLE reports RENAME COLUMN ${ancienNom} TO ${nouveauNom}`);
        colonnes.delete(ancienNom);
        colonnes.add(nouveauNom);
        schemaModifie = true;
      }
    }
    baseSqlite.exec("COMMIT");
  } catch (erreur) {
    try { baseSqlite.exec("ROLLBACK"); } catch {}
    throw erreur;
  }
  return schemaModifie;
}
function ecrireEtatBase() {
  if (!baseSqlite) throw new Error("La base SQLCipher n’est pas ouverte.");
  baseSqlite.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    baseSqlite.exec("DELETE FROM users; DELETE FROM reports; DELETE FROM login_attempts; DELETE FROM app_settings");
    for (const [username, password] of Object.entries(donnees.users || {}))
      baseSqlite.query("INSERT INTO users (username, password_json) VALUES (?, ?)", [username, JSON.stringify(password)]);
    for (const report of donnees.reports || [])
      baseSqlite.query(
        "INSERT INTO reports (report_id, report_date, quart, equipe, staff_total, staff_absent, production_paniers, baskets_dry, tonnage_kg, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          report.id,
          report.date,
          report.quart,
          report.equipe,
          Number(report.staff?.total) || 0,
          Number(report.staff?.absent) || 0,
          Number(report.production?.paniers) || 0,
          Number(report.drying?.basketsDry) || 0,
          Number(report.production?.tonnageKg) || 0,
          JSON.stringify(report),
        ],
      );
    for (const [username, attempt] of Object.entries(donnees.loginAttempts || {}))
      baseSqlite.query("INSERT INTO login_attempts (username, attempts, locked_until) VALUES (?, ?, ?)", [username, Number(attempt.count) || 0, Number(attempt.until) || 0]);
    for (const setting of ["recoveryKey", "recoveryAcknowledged", "legacyConnected", "syncPendingScopes"])
      if (donnees[setting] !== undefined)
        baseSqlite.query("INSERT INTO app_settings (setting, value_json) VALUES (?, ?)", [setting, JSON.stringify(donnees[setting])]);
    baseSqlite.exec("COMMIT");
  } catch (error) {
    try { baseSqlite.exec("ROLLBACK"); } catch {}
    throw error;
  }
  baseSqlite.close();
  baseSqlite = null;
  const bytes = Buffer.from(moduleSqlite.FS.readFile(cheminVirtuelSqlite));
  const target = cheminBaseDonnees();
  const temporary = `${target}.${process.pid}.tmp`;
  fichiers.writeFileSync(temporary, bytes);
  fichiers.renameSync(temporary, target);
  baseSqlite = apiSqlite.open(cheminVirtuelSqlite, cleSqlCipher);
  baseSqlite.exec("PRAGMA cipher_compatibility = 4");
}
async function chargerBase() {
  const anciennesDonnees = lireAncienFichierDonnees();
  cleSqlCipher = lireOuCreerCleBase(anciennesDonnees);
  const { initSQLite } = require("@7mind.io/sqlcipher-wasm");
  apiSqlite = await initSQLite();
  moduleSqlite = apiSqlite.getModule();
  const databaseExisted = fichiers.existsSync(cheminBaseDonnees());
  if (databaseExisted)
    moduleSqlite.FS.writeFile(cheminVirtuelSqlite, fichiers.readFileSync(cheminBaseDonnees()));
  baseSqlite = apiSqlite.open(cheminVirtuelSqlite, cleSqlCipher);
  baseSqlite.exec("PRAGMA cipher_compatibility = 4");
  baseSqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      report_id TEXT PRIMARY KEY,
      report_date TEXT NOT NULL,
      quart TEXT NOT NULL,
      equipe TEXT NOT NULL,
      staff_total INTEGER,
      staff_absent INTEGER,
      production_paniers REAL,
      baskets_dry REAL,
      tonnage_kg REAL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      username TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      setting TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
  `);
  const schemaModifie = migrerColonnesRapports();
  donnees = databaseExisted
    ? lireEtatBase()
    : anciennesDonnees || {
        users: {},
        reports: [],
        loginAttempts: {},
        // Une base neuve reste vide au premier lancement ; l'import ancien
        // pourra toujours être lancé explicitement par l'administrateur.
        legacyConnected: true,
      };
  donnees.users ||= {};
  donnees.reports = (donnees.reports || []).map(normaliserRapport);
  donnees.loginAttempts ||= {};
  donnees.syncPendingScopes = Array.isArray(donnees.syncPendingScopes) ? donnees.syncPendingScopes : [];
  if (!donnees.recoveryKey) {
    donnees.recoveryKey = cryptographie.randomBytes(20).toString("hex").toUpperCase();
    donnees.recoveryAcknowledged = false;
  }
  if (
    schemaModifie ||
    !databaseExisted ||
    !baseSqlite.query("SELECT 1 FROM app_settings WHERE setting = 'recoveryKey'").length
  )
    ecrireEtatBase();
}
function sauvegarderBase() {
  fichiers.mkdirSync(applicationElectron.getPath("userData"), { recursive: true });
  ecrireEtatBase();
}
function ajouterSynchronisationEnAttente(scope) {
  donnees.syncPendingScopes ||= [];
  if (!donnees.syncPendingScopes.includes(scope)) donnees.syncPendingScopes.push(scope);
  sauvegarderBase();
}
function retirerSynchronisationEnAttente(scope) {
  donnees.syncPendingScopes ||= [];
  donnees.syncPendingScopes = scope === "*"
    ? []
    : donnees.syncPendingScopes.filter((value) => value !== scope);
  sauvegarderBase();
}
// Recharge le fichier partagé sans perdre la dernière copie valide en mémoire.
function actualiserDonneesPartagees() {
  const previousBytes = moduleSqlite &&
    Buffer.from(moduleSqlite.FS.readFile(cheminVirtuelSqlite));
  try {
    if (!fichiers.existsSync(cheminBaseDonnees())) return false;
    if (baseSqlite) baseSqlite.close();
    moduleSqlite.FS.writeFile(cheminVirtuelSqlite, fichiers.readFileSync(cheminBaseDonnees()));
    baseSqlite = apiSqlite.open(cheminVirtuelSqlite, cleSqlCipher);
    baseSqlite.exec("PRAGMA cipher_compatibility = 4");
    const latest = lireEtatBase();
    if (!latest || !latest.users || !Array.isArray(latest.reports)) return false;
    donnees = latest;
    return true;
  } catch {
    // Si une édition externe est incomplète, on rouvre la dernière image valide.
    try {
      if (previousBytes) {
        moduleSqlite.FS.writeFile(cheminVirtuelSqlite, previousBytes);
        baseSqlite = apiSqlite.open(cheminVirtuelSqlite, cleSqlCipher);
        baseSqlite.exec("PRAGMA cipher_compatibility = 4");
      }
    } catch {
      baseSqlite = null;
    }
    return false;
  }
}
function heureEnMinutes(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d{1,2})\s*[:hH.]\s*(\d{0,2})$/);
  if (!match) return null;
  const hour = Number(match[1]),
    minute = Number(match[2] || 0);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}
// Vérifie les heures côté serveur, y compris les arrêts de nuit après minuit.
function validerPlagesHorairesRapport(report) {
  const intervals = [
    ...(report.stops || []).map((stop) => ({
      ...stop,
      label: `l’arrêt ${stop.zone || ""}`,
    })),
    ...(report.drying?.sechoirs || []).flatMap((sechoir) =>
      (sechoir.stops || []).map((stop) => ({
        ...stop,
        label: `l’arrêt du séchoir ${sechoir.number}`,
      })),
    ),
    ...Object.entries(report.generators || {}).flatMap(([name, periodes]) =>
      (periodes || []).map((periode) => ({
        ...periode,
        label: `la période du ${name}`,
      })),
    ),
  ];
  for (const interval of intervals) {
    if (!interval.start && !interval.end) continue;
    const start = heureEnMinutes(interval.start),
      end = heureEnMinutes(interval.end);
    if (start === null || end === null)
      throw new Error(
        `Heure invalide pour ${interval.label}. Saisissez une heure comme 07H30.`,
      );
    if (end === start || (end < start && report.quart !== "23h-07h"))
      throw new Error(
        `La fin doit suivre le début pour ${interval.label}. Seul le quart 23h-07h peut passer minuit.`,
      );
    const duration = (end - start + 1440) % 1440;
    if (duration > 480)
      throw new Error(`La durée ne peut pas dépasser 8 heures pour ${interval.label}.`);
  }
}
function hachageAncienMotDePasse(p) {
  return cryptographie.scryptSync(p, "rapport-cq-js-v1", 64).toString("hex");
}
function creerMotDePasse(p) {
  const salt = cryptographie.randomBytes(16);
  return {
    salt: salt.toString("hex"),
    hash: cryptographie.pbkdf2Sync(p, salt, 200000, 32, "sha256").toString("hex"),
    iterations: 200000,
    failures: 0,
    lockedUntil: 0,
  };
}
function verifierMotDePasse(stored, p) {
  if (typeof stored === "string")
    return { ok: stored === hachageAncienMotDePasse(p), upgrade: stored === hachageAncienMotDePasse(p) };
  if (!stored?.salt || !stored?.hash) return { ok: false };
  const iterations = Math.max(
      100000,
      Math.min(1000000, Number(stored.iterations) || 200000),
    ),
    expected = Buffer.from(stored.hash, "hex"),
    actual = cryptographie.pbkdf2Sync(
      p,
      Buffer.from(stored.salt, "hex"),
      iterations,
      expected.length,
      "sha256",
    );
  return {
    ok:
      expected.length === actual.length &&
      cryptographie.timingSafeEqual(expected, actual),
  };
}
function sauvegarderChaqueJour() {
  if (!fichiers.existsSync(cheminBaseDonnees())) return;
  const dir = chemins.join(applicationElectron.getPath("userData"), "Sauvegardes");
  fichiers.mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const target = chemins.join(dir, `rapport-cq-${today}.db`);
  if (!fichiers.existsSync(target)) fichiers.copyFileSync(cheminBaseDonnees(), target);
  const files = fichiers
    .readdirSync(dir)
    .map((n) => chemins.join(dir, n))
    .filter((n) => fichiers.statSync(n).isFile())
    .sort((a, b) => fichiers.statSync(b).mtimeMs - fichiers.statSync(a).mtimeMs);
  files.slice(30).forEach((n) => fichiers.unlinkSync(n));
}
ipcMain.handle("bootstrap", () => {
  // Chaque actualisation relit les changements enregistrés par les autres fenêtres.
  actualiserDonneesPartagees();
  const admin = utilisateurActif === "Administrateur",
    logged = !!utilisateurActif;
  return {
    users: Object.keys(donnees.users),
    equipes: {
      A: "KONAN LUC",
      B: "EYO NESTOR",
      C: "DAMEY JEAN-BAPTISTE",
      D: "TIA LOU EDWIGE",
    },
    reports: logged ? donnees.reports : [],
    adminSet: !!donnees.users.Administrateur,
    recoveryKey: donnees.recoveryAcknowledged ? null : donnees.recoveryKey,
    recoveryKeyForSetup: donnees.users.Administrateur ? null : donnees.recoveryKey,
    legacyAvailable: admin && fichiers.existsSync(ancienneBaseDeDonnees()),
    legacyConnected: !!donnees.legacyConnected,
  };
});
ipcMain.handle("ack-recovery", () => {
  donnees.recoveryAcknowledged = true;
  sauvegarderBase();
  return true;
});
ipcMain.handle("auth", (_, { user, password, confirmation, recoveryKey }) => {
  if (!user || !password)
    return { ok: false, message: "Saisissez le mot de passe." };
  const rapportExistant = donnees.users[user];
  if (!rapportExistant) {
    if (user === "Administrateur") {
      if (
        String(recoveryKey || "")
          .trim()
          .toUpperCase() !== donnees.recoveryKey
      )
        return { ok: false, message: "Clé de récupération incorrecte." };
      if (password !== confirmation)
        return {
          ok: false,
          message: "Les deux mots de passe sont différents.",
        };
      if (
        password.length < 8 ||
        password.length > 64 ||
        /[\x00-\x1f\x7f]/.test(password)
      )
        return {
          ok: false,
          message:
            "Le mot de passe administrateur doit contenir de 8 à 64 caractères.",
        };
    } else {
      if (!["A", "B", "C", "D"].includes(user))
        return { ok: false, message: "Profil inconnu." };
      if (password !== confirmation)
        return {
          ok: false,
          message: "Les deux mots de passe sont différents.",
        };
      if (
        password.length < 6 ||
        password.length > 64 ||
        /[\x00-\x1f\x7f]/.test(password)
      )
        return {
          ok: false,
          message: "Le mot de passe doit contenir de 6 à 64 caractères.",
        };
    }
    donnees.users[user] = creerMotDePasse(password);
    sauvegarderBase();
    utilisateurActif = user;
    consignerEvenement("INFO", `Initialisation et connexion autorisées (${user})`);
    return { ok: true, first: true, user };
  }
  const attempt = donnees.loginAttempts[user] || { count: 0, until: 0 };
  if (attempt.until > Date.now())
    return {
      ok: false,
      message: `Trop de tentatives. Réessayez après ${new Date(attempt.until).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`,
    };
  if (rapportExistant.lockedUntil > Date.now())
    return {
      ok: false,
      message: `Trop de tentatives. Réessayez après ${new Date(rapportExistant.lockedUntil).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`,
    };
  const checked = verifierMotDePasse(rapportExistant, password);
  if (!checked.ok) {
    attempt.count++;
    if (typeof rapportExistant === "object") {
      rapportExistant.failures = (rapportExistant.failures || 0) + 1;
      if (rapportExistant.failures >= 5) {
        rapportExistant.lockedUntil = Date.now() + 15 * 60 * 1000;
        rapportExistant.failures = 0;
      }
    }
    if (attempt.count >= 5) {
      attempt.count = 0;
      attempt.until = Date.now() + 15 * 60 * 1000;
    }
    donnees.loginAttempts[user] = attempt;
    sauvegarderBase();
    consignerEvenement("INFO", `Échec de connexion (${user})`);
    return {
      ok: false,
      message:
        attempt.until || rapportExistant.lockedUntil
          ? "Trop de tentatives. Réessayez dans 15 minutes."
          : "Mot de passe incorrect.",
    };
  }
  if (checked.upgrade) donnees.users[user] = creerMotDePasse(password);
  if (typeof donnees.users[user] === "object") {
    donnees.users[user].failures = 0;
    donnees.users[user].lockedUntil = 0;
  }
  donnees.loginAttempts[user] = { count: 0, until: 0 };
  utilisateurActif = user;
  consignerEvenement("INFO", `Connexion autorisée (${user})`);
  return { ok: true, user };
});
ipcMain.handle(
  "reset-equipe-password",
  (_, { user, recoveryKey, next, confirmation }) => {
    if (!["A", "B", "C", "D"].includes(user))
      throw new Error(
        "Seul le mot de passe d’une équipe peut être réinitialisé ici.",
      );
    if (
      String(recoveryKey || "")
        .trim()
        .toUpperCase() !== donnees.recoveryKey
    )
      throw new Error("Clé de récupération incorrecte.");
    if (next !== confirmation)
      throw new Error("Les deux mots de passe sont différents.");
    if (
      String(next || "").length < 6 ||
      String(next || "").length > 64 ||
      /[\x00-\x1f\x7f]/.test(next)
    )
      throw new Error("Le mot de passe doit contenir de 6 à 64 caractères.");
    donnees.users[user] = creerMotDePasse(next);
    donnees.loginAttempts[user] = { count: 0, until: 0 };
    sauvegarderBase();
    return true;
  },
);
function activerFenetrePrincipale() {
  return new Promise((resolve) => {
    const focus = () => {
      if (!fenetrePrincipale || fenetrePrincipale.isDestroyed()) return false;
      if (fenetrePrincipale.isMinimized()) fenetrePrincipale.restore();
      if (!fenetrePrincipale.isVisible()) fenetrePrincipale.show();
      try {
        applicationElectron.focus({ steal: true });
      } catch {}
      fenetrePrincipale.focus();
      fenetrePrincipale.webContents.focus();
      return true;
    };

    if (!focus()) return resolve(false);
    // Windows peut répondre avant que l’ancien champ ait libéré le clavier ;
    // on reprend le focus après cette transition.
    setTimeout(() => resolve(focus()), 220);
  });
}
ipcMain.handle("logout", async () => {
  consignerEvenement("INFO", `Session fermée (${utilisateurActif || "inconnue"})`);
  utilisateurActif = null;
  // L’interface affiche d’abord le formulaire de connexion, puis le renderer
  // demande le focus. Re-focaliser ici ciblait parfois le document précédent.
  return true;
});
ipcMain.handle("focus-applicationElectron", () => activerFenetrePrincipale());
ipcMain.handle("change-password", (_, { current, next }) => {
  if (!utilisateurActif) throw new Error("Aucun profil connecté.");
  if (!verifierMotDePasse(donnees.users[utilisateurActif], current || "").ok)
    throw new Error("Le mot de passe actuel est incorrect.");
  const minimum = utilisateurActif === "Administrateur" ? 8 : 6;
  if (
    String(next || "").length < minimum ||
    String(next || "").length > 64 ||
    /[\x00-\x1f\x7f]/.test(next)
  )
    throw new Error(
      `Le nouveau mot de passe doit contenir de ${minimum} à 64 caractères.`,
    );
  donnees.users[utilisateurActif] = creerMotDePasse(next);
  sauvegarderBase();
  return true;
});
ipcMain.handle("capture-synthesis", async (_, rect) => {
  if (!utilisateurActif) throw new Error("Connectez-vous pour capturer la synthèse.");
  const report = donnees.reports.find((item) => item.id === rect?.reportId);
  if (!report) throw new Error("Le rapport à capturer est introuvable.");
  if (
    utilisateurActif !== "Administrateur" &&
    report.equipe !== utilisateurActif
  )
    throw new Error("Vous pouvez capturer uniquement le rapport de votre équipe.");
  const root = chemins.join(applicationElectron.getPath("documents"), "RapportQuart", "Captures");
  // Chaque image va dans le dossier de l’équipe du rapport, même si
  // l’administrateur a déclenché la capture depuis l’historique.
  const dir = chemins.join(root, `Equipe-${report.equipe}`);
  for (const equipe of ["A", "B", "C", "D"])
    fichiers.mkdirSync(chemins.join(root, `Equipe-${equipe}`), { recursive: true });
  fichiers.mkdirSync(dir, { recursive: true });
  const safe = Object.fromEntries(
    ["x", "y", "width", "height"].map((k) => [
      k,
      Math.max(0, Math.floor(Number(rect?.[k]) || 0)),
    ]),
  );
  if (!safe.width || !safe.height)
    throw new Error("La synthèse n’est pas visible.");
  const image = await fenetrePrincipale.webContents.capturePage(safe);
  const requestedName = chemins.basename(String(rect?.name || ""));
  const name = /^[\w .-]+\.png$/i.test(requestedName)
    ? requestedName
    : `Synthese_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  const target = chemins.join(dir, name);
  fichiers.writeFileSync(target, image.toPNG());
  return target;
});
ipcMain.handle("open-captures", async () => {
  if (!utilisateurActif) throw new Error("Connectez-vous pour ouvrir le dossier.");
  if (utilisateurActif !== "Administrateur" && !["A", "B", "C", "D"].includes(utilisateurActif))
    throw new Error("Profil non autorisé à ouvrir un dossier de capture.");
  const root = chemins.join(applicationElectron.getPath("documents"), "RapportQuart", "Captures");
  const dir =
    utilisateurActif === "Administrateur"
      ? root
      : chemins.join(root, `Equipe-${utilisateurActif}`);
  fichiers.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
ipcMain.handle("import-legacy-db", async (_, options = {}) => {
  if (utilisateurActif !== "Administrateur")
    throw new Error("Import réservé à l’administrateur.");
  const automatic = options?.automatic === true;
  if (automatic && donnees.legacyConnected && !options?.force)
    return { imported: 0, alreadyConnected: true };
  const fixedPath = ancienneBaseDeDonnees();
  if (automatic && !fichiers.existsSync(fixedPath))
    throw new Error(`Ancienne base introuvable : ${fixedPath}`);
  const picked = automatic
    ? { canceled: false, filePaths: [fixedPath] }
    : await dialog.showOpenDialog(fenetrePrincipale, {
        defaultPath: fichiers.existsSync(fixedPath) ? fixedPath : undefined,
        properties: ["openFile"],
        filters: [
          { name: "Base SQLite", extensions: ["db", "sqlite", "sqlite3"] },
        ],
      });
  if (picked.canceled || !picked.filePaths[0]) return false;
  const bytes = fichiers.readFileSync(picked.filePaths[0]);
  let legacy, table, hasTable, sqlRows;
  const sqliteHeader = Buffer.from("SQLite format 3\0");
  if (bytes.subarray(0, sqliteHeader.length).equals(sqliteHeader)) {
    try {
      const SQL = await require("sql.js")({
        locateFile: (n) =>
          chemins.join(chemins.dirname(require.resolve("sql.js")), n),
      });
      legacy = new SQL.Database(bytes);
      sqlRows = (sql) => {
        const q = legacy.exec(sql)[0];
        return q
          ? q.values.map((values) =>
              Object.fromEntries(q.columns.map((c, i) => [c, values[i]])),
            )
          : [];
      };
      table = (name) => {
        try {
          return sqlRows(`SELECT * FROM "${name}"`);
        } catch {
          return [];
        }
      };
      hasTable = (name) =>
        sqlRows(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`,
        ).length > 0;
    } catch {
      throw new Error("La sauvegarde SQLite est illisible ou endommagée.");
    }
  } else {
    let keyFile = [
      process.env.RAPPORT_QUART_DONNEES &&
        chemins.join(process.env.RAPPORT_QUART_DONNEES, "cle.dat"),
      chemins.join(
        process.env.ProgramData || "C:\\ProgramData",
        "RapportQuart",
        "cle.dat",
      ),
      chemins.join(chemins.dirname(picked.filePaths[0]), "cle.dat"),
    ].find((p) => p && fichiers.existsSync(p));
    if (!keyFile) {
      const keyPick = await dialog.showOpenDialog(fenetrePrincipale, {
        properties: ["openFile"],
        filters: [
          { name: "Clé de chiffrement C# (cle.dat)", extensions: ["dat"] },
        ],
      });
      if (keyPick.canceled || !keyPick.filePaths[0])
        throw new Error(
          "La base est chiffrée. Sélectionnez le fichier cle.dat de l’installation C# pour la déverrouiller.",
        );
      keyFile = keyPick.filePaths[0];
    }
    let key;
    try {
      const { Dpapi, isPlatformSupported } = require("@primno/dpapi");
      if (!isPlatformSupported) throw new Error("DPAPI Windows indisponible");
      key = Buffer.from(
        Dpapi.unprotectData(
          fichiers.readFileSync(keyFile),
          Buffer.from("RapportQuart.Cle.v1", "utf8"),
          "LocalMachine",
        ),
      ).toString("utf8");
    } catch {
      throw new Error(
        "Impossible de lire la clé DPAPI. Utilisez le fichier cle.dat de cette installation Windows.",
      );
    }
    try {
      const { initSQLite } = require("@7mind.io/sqlcipher-wasm");
      const sqlite = await initSQLite(),
        module = sqlite.getModule(),
        virtualPath = "/rapport-cq-legacy.db";
      module.FS.writeFile(virtualPath, bytes);
      legacy = sqlite.open(virtualPath, key);
      legacy.query("SELECT count(*) AS n FROM sqlite_master");
      sqlRows = (sql, params = []) => legacy.query(sql, params);
      table = (name) => {
        try {
          if (!hasTable(name)) return [];
          return sqlRows(`SELECT * FROM "${name}"`);
        } catch {
          return [];
        }
      };
      hasTable = (name) =>
        sqlRows(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          [name],
        ).length > 0;
    } catch {
      throw new Error(
        "Déverrouillage SQLCipher impossible : clé incorrecte, paramètres de chiffrement incompatibles ou fichier endommagé. La base originale n’a pas été modifiée.",
      );
    } finally {
      key = "";
    }
  }
  const reports = table("rapport"),
    sechoirs = table("sechoir_releve"),
    stops = table("arret"),
    gens = table("generateur_marche");
  if (!hasTable("rapport")) {
    legacy.close();
    throw new Error("Aucune table de rapports trouvée dans cette sauvegarde.");
  }
  const num = (v, d = 0) =>
      v == null || v === "" ? d : Number.isFinite(Number(v)) ? Number(v) : d,
    time = (v) => {
      const m = String(v || "").match(/^(\d{1,2})[:hH.](\d{2})/);
      return m ? `${m[1].padStart(2, "0")}H${m[2]}` : String(v || "");
    };
  let imported = 0;
  const sechoirById = new Map();
  sechoirs.forEach((x) => {
    const a = sechoirById.get(x.rapport_id) || [];
    a.push({
      number: num(x.sechoir),
      cycle: num(x.cycle_sec),
      bruleur1: num(x.bruleur1),
      bruleur2: num(x.bruleur2),
      counter: x.compteur || "",
      gas1: x.gaz || "",
      gas2: x.gaz2 || "",
      stops: [],
    });
    sechoirById.set(x.rapport_id, a);
  });
  const stopById = new Map();
  stops.forEach((x) => {
    const a = stopById.get(x.rapport_id) || [];
    a.push({
      zone: x.zone || "Autre",
      start: time(x.heure_debut),
      end: time(x.heure_fin),
      cause: x.cause || "",
    });
    stopById.set(x.rapport_id, a);
  });
  const genById = new Map();
  gens.forEach((x) => {
    const a = genById.get(x.rapport_id) || {};
    (a[x.generateur] ||= []).push({
      start: time(x.heure_demarrage),
      end: time(x.heure_arret),
    });
    genById.set(x.rapport_id, a);
  });
  for (const x of reports) {
    const id = x.id || `${x.date}_${x.quart}_${x.equipe}`;
    if (donnees.reports.some((r) => r.id === id)) continue;
    const ds = sechoirById.get(id) || [];
    for (const n of [1, 2, 3])
      if (!ds.some((d) => d.number === n))
        ds.push({
          number: n,
          cycle: 0,
          bruleur1: 0,
          bruleur2: 0,
          counter: "",
          gas1: "",
          gas2: "",
          stops: [],
        });
    const all = stopById.get(id) || [],
      mainStops = [];
    for (const s of all) {
      const m = s.zone.match(/^Séchoir\s*([123])$/i),
        d = m && ds.find((y) => y.number === Number(m[1]));
      if (d) d.stops.push(s);
      else mainStops.push(s);
    }
    const paniers = num(x.production),
      r = {
        id,
        date: String(x.date || ""),
        quart: x.quart || "",
        equipe: x.equipe || "",
        staff: {
          total: num(x.effectif_total),
          absent: num(x.absent),
          malade: num(x.malade),
          permission: num(x.permission),
          conge: num(x.conge),
          accidents: num(x.accident),
        },
        prelavage: {
          box: x.box_prelave || "",
          buckets: num(x.godets),
          secondBox: x.box_prelave2 || "",
          secondBuckets: num(x.godets2),
        },
        granulation: {
          box: x.box_usinage || "",
          acidTitre: num(x.titre_acide),
          acidConsumption: num(x.conso_acide),
          baskets: num(x.paniers_granules ?? x.paniers),
          basketAdvance: x.avance_panier || "",
          basketsWashed: x.panier_lave || "",
        },
        drying: { basketsDry: num(x.paniers_seches), sechoirs: ds },
        production: {
          paniers,
          tonnageKg: num(x.kg, paniers * 1260),
          balesStart: num(x.balles_debut),
          balesquart: num(x.balles_quart),
          balesProcessed: num(x.balles_traitees),
          balesEnd: num(x.balles_fin),
        },
        generators: genById.get(id) || { "GE 2500 KVA": [], "GE 2000 KVA": [] },
        stops: mainStops,
        createdAt: x.cree_le
          ? new Date(x.cree_le).toISOString()
          : new Date().toISOString(),
        updatedAt: x.cree_le
          ? new Date(x.cree_le).toISOString()
          : new Date().toISOString(),
      };
    donnees.reports.push(r);
    imported++;
  }
  const safeSql = (sql) => {
    try {
      return sqlRows(sql);
    } catch {
      return [];
    }
  };
  for (const x of safeSql(
    "SELECT code, hex(sel) AS sel_hex, hex(hash) AS hash_hex, iterations, echecs, bloque_jusqua FROM equipe_acces",
  )) {
    if (!donnees.users[x.code] && x.sel_hex && x.hash_hex)
      donnees.users[x.code] = {
        salt: x.sel_hex.toLowerCase(),
        hash: x.hash_hex.toLowerCase(),
        iterations: num(x.iterations, 200000),
        failures: num(x.echecs),
        lockedUntil: x.bloque_jusqua ? Date.parse(x.bloque_jusqua) || 0 : 0,
      };
  }
  const adminAccess = safeSql(
    "SELECT hex(sel) AS sel_hex, hex(hash) AS hash_hex, iterations, echecs, bloque_jusqua FROM administrateur_acces WHERE id=1",
  )[0];
  if (
    !donnees.users.Administrateur &&
    adminAccess?.sel_hex &&
    adminAccess?.hash_hex
  )
    donnees.users.Administrateur = {
      salt: adminAccess.sel_hex.toLowerCase(),
      hash: adminAccess.hash_hex.toLowerCase(),
      iterations: num(adminAccess.iterations, 200000),
      failures: num(adminAccess.echecs),
      lockedUntil: adminAccess.bloque_jusqua
        ? Date.parse(adminAccess.bloque_jusqua) || 0
        : 0,
    };
  legacy.close();
  if (automatic) donnees.legacyConnected = true;
  sauvegarderBase();
  consignerEvenement("INFO", `${imported} rapport(s) importé(s) depuis une sauvegarde C#`);
  return { imported };
});
ipcMain.handle("save-report", (_, report) => {
  if (!utilisateurActif) throw new Error("La session a expiré. Reconnectez-vous.");
  if (utilisateurActif === "Administrateur")
    throw new Error(
      "Seuls les utilisateurs d’équipe peuvent créer des rapports.",
    );
  // Vérifie les doublons contre la dernière version partagée des données.
  actualiserDonneesPartagees();
  if (!report.date || !report.quart || !report.equipe)
    throw new Error("Date, quart et équipe obligatoires.");
  validerPlagesHorairesRapport(report);
  if ((report.drying?.sechoirs || []).some((sechoir) => [sechoir.bruleur1, sechoir.bruleur2].some((value) => Number(value) < 0 || Number(value) > 130)))
    throw new Error("Les valeurs des brûleurs doivent être comprises entre 0 et 130.");
  if (utilisateurActif !== "Administrateur" && utilisateurActif !== report.equipe)
    throw new Error(
      "Vous ne pouvez enregistrer que les rapports de votre équipe.",
    );
  report.id = `${report.date}_${report.quart}_${report.equipe}`;
  const sameSlot = donnees.reports.find(
    (saved) => saved.date === report.date && saved.quart === report.quart && saved.id !== report.id,
  );
  if (sameSlot)
    throw new Error(
      `Un rapport existe déjà pour cette date et ce quart (équipe ${sameSlot.equipe}).`,
    );
  const oldIndex = donnees.reports.findIndex((r) => r.id === report.id);
  const old = oldIndex >= 0 ? donnees.reports[oldIndex] : null;
  if (old && utilisateurActif !== "Administrateur") {
    const created = Date.parse(old.createdAt || "");
    if (
      !Number.isFinite(created) ||
      Date.now() - created > DELAI_MODIFICATION_RAPPORT_HEURES * 60 * 60 * 1000
    )
      throw new Error(
        `Modification impossible : le délai de ${DELAI_MODIFICATION_RAPPORT_HEURES} heures après la création de ce rapport est dépassé ou indisponible. Contactez l’administrateur si une correction est nécessaire.`,
      );
  }
  report.createdAt = old?.createdAt || new Date().toISOString();
  report.updatedAt = new Date().toISOString();
  if (old) donnees.reports.splice(oldIndex, 1);
  donnees.reports.push(report);
  sauvegarderBase();
  return report;
});
ipcMain.handle("configure-sync-credentials", (_, { username, password } = {}) => {
  if (utilisateurActif !== "Administrateur")
    throw new Error("Seul l’administrateur local peut configurer la synchronisation.");
  const nomUtilisateur = String(username || "").trim();
  const motDePasse = String(password || "");
  if (!nomUtilisateur || !motDePasse || nomUtilisateur.length > 100 || motDePasse.length > 128)
    throw new Error("Saisissez un identifiant et un mot de passe valides pour le portail.");
  enregistrerIdentifiantsPortail({ username: nomUtilisateur, password: motDePasse });
  consignerEvenement("INFO", "Identifiants du portail enregistrés dans le stockage sécurisé Windows");
  return true;
});
ipcMain.handle("sync-reports", async (_, { automatic = false, offline = false } = {}) => {
  if (!utilisateurActif)
    throw new Error("Connectez-vous avant de synchroniser les rapports.");

  actualiserDonneesPartagees();
  const scope = utilisateurActif === "Administrateur" ? "*" : utilisateurActif;
  const pendingScopes = donnees.syncPendingScopes || [];
  const pendingForUser = utilisateurActif === "Administrateur"
    ? pendingScopes.length > 0
    : pendingScopes.includes(scope);
  if (automatic && !pendingForUser) return { pending: false, queued: false, synced: 0, total: 0 };
  const reports = (donnees.reports || []).filter(
    (report) => report?.date && report?.quart && report?.equipe &&
      (utilisateurActif === "Administrateur" || report.equipe === utilisateurActif),
  );
  if (!reports.length) {
    if (pendingForUser) retirerSynchronisationEnAttente(scope);
    return { pending: false, queued: false, synced: 0, total: 0 };
  }
  if (!automatic) ajouterSynchronisationEnAttente(scope);
  if (offline) return { pending: true, queued: true, synced: 0, total: reports.length };

  const identifiantsPortail = lireIdentifiantsPortail();
  if (!identifiantsPortail)
    throw new Error("L’administrateur local doit configurer les accès du portail une fois sur ce poste.");
  const identifiant = identifiantsPortail.username;
  let motDePasse = identifiantsPortail.password;

  const origin = "https://rapportchefquart.vercel.app";
  const envoyer = async (url, options) =>
    fetch(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  let cookie = "";
  let synced = 0;
  try {
    const login = await envoyer(`${origin}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: identifiant, password: motDePasse }),
    });
    motDePasse = "";
    if (!login.ok) {
      const details = await login.json().catch(() => ({}));
      if (login.status >= 500) { const error = new Error(details.error || "Portail temporairement indisponible."); error.retryable = true; throw error; }
      throw new Error(details.error || "Connexion au portail refusée.");
    }
    cookie = String(login.headers.get("set-cookie") || "").split(";", 1)[0];
    if (!cookie.startsWith("rapport_cq_admin="))
      throw new Error("Le portail n’a pas fourni de session valide.");

    for (let index = 0; index < reports.length; index += 50) {
      const batch = reports.slice(index, index + 50);
      const response = await envoyer(`${origin}/api/admin/reports`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ reports: batch }),
      });
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        if (response.status >= 500) { const error = new Error(details.error || "Portail temporairement indisponible."); error.retryable = true; throw error; }
        throw new Error(
          synced
            ? `Synchronisation partielle : ${synced} rapport(s) envoyé(s). Relancez-la pour terminer.`
            : details.error || "Le portail n’a pas accepté les rapports.",
        );
      }
      synced += batch.length;
    }
    consignerEvenement("INFO", `${synced} rapport(s) synchronisé(s) vers le portail distant`);
    retirerSynchronisationEnAttente(scope);
    return { pending: false, queued: false, synced, total: reports.length };
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError" || error instanceof TypeError || error.retryable) {
      ajouterSynchronisationEnAttente(scope);
      consignerEvenement("INFO", `Synchronisation hors ligne mise en attente (${scope})`);
      return { pending: true, queued: true, synced, total: reports.length };
    }
    throw error;
  } finally {
    motDePasse = "";
    cookie = "";
  }
});
ipcMain.handle("export-xlsx", async (_, { name, rows }) => {
  if (utilisateurActif !== "Administrateur")
    throw new Error("Action réservée à l’administrateur.");
  const { canceled, filePath } = await dialog.showSaveDialog(fenetrePrincipale, {
    defaultPath: name,
    filters: [{ name: "Classeur Excel", extensions: ["xlsx"] }],
  });
  if (canceled) return false;
  const safeRows = (rows || []).map((row) =>
    (row || []).map((value) =>
      typeof value === "string" && /^[=+\-@\t\r]/.test(value)
        ? `'${value}`
        : value,
    ),
  );
  const XLSX = require("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(safeRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rapports");
  XLSX.writeFile(wb, filePath);
  return true;
});
function creerFenetrePrincipale() {
  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize;
  fenetrePrincipale = new BrowserWindow({
    width: Math.min(1440, screenWidth),
    height: Math.min(920, screenHeight),
    minWidth: Math.min(800, screenWidth),
    minHeight: Math.min(600, screenHeight),
    autoHideMenuBar: true,
    icon: chemins.join(__dirname, "../assets/exat_agri_fb.ico"),
    webPreferences: {
      preload: chemins.join(__dirname, "prechargement.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  fenetrePrincipale.webContents.on("did-fail-load", (_evenement, codeErreur, detailErreur, adresse, cadrePrincipal) => {
    if (cadrePrincipal)
      consignerEvenement("ERREUR_INTERFACE", `Chargement impossible (${codeErreur}) ${detailErreur} — ${adresse}`);
  });
  fenetrePrincipale.webContents.on("console-message", (_evenement, details) => {
    if (details.level >= 2)
      consignerEvenement("ERREUR_INTERFACE", `${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  fenetrePrincipale.webContents.on("render-process-gone", (_evenement, details) => {
    consignerEvenement("ERREUR_INTERFACE", `Processus d’affichage arrêté (${details.reason}, code ${details.exitCode})`);
  });
  fenetrePrincipale.loadFile(chemins.join(__dirname, "index.html"));
}
applicationElectron.whenReady().then(async () => {
  if (!verrouInstanceUnique) return;
  Menu.setApplicationMenu(null);
  try {
    await chargerBase();
    sauvegarderChaqueJour();
    creerFenetrePrincipale();
  } catch (error) {
    dialog.showErrorBox(
      "Base SQLCipher inaccessible",
      `Impossible d’ouvrir la base JavaScript : ${error.message}`,
    );
    applicationElectron.quit();
  }
});
applicationElectron.on("window-all-closed", () => {
  if (process.platform !== "darwin") applicationElectron.quit();
});
