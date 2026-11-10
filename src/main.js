const {
  app,
  BrowserWindow,
  Menu,
  screen,
  ipcMain,
  safeStorage,
  dialog,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
// Une seule instance par session Windows ; un second lancement réactive la première.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else
  app.on("second-instance", () => {
    if (win && !win.isDestroyed()) focusMainWindow();
  });
// Processus principal Electron : fenêtre, accès aux données et règles serveur.
let win;
let activeUser = null;
let sqliteApi = null;
let sqliteModule = null;
let sqliteDatabase = null;
let sqlCipherKey = null;
const REPORT_EDIT_WINDOW_HOURS = 8;
const file = () => path.join(app.getPath("userData"), "rapport-cq.db");
const oldDataFile = () => path.join(app.getPath("userData"), "rapport-cq.dat");
const sqliteVirtualPath = "/rapport-cq.db";
const sqlCipherEntropy = Buffer.from("RapportQuart.Cle.v1", "utf8");
const legacyDatabase = () =>
  path.join(
    process.env.RAPPORT_QUART_DONNEES ||
      path.join(process.env.ProgramData || "C:\\ProgramData", "RapportQuart"),
    "rapports_quart.db",
  );
function log(level, message) {
  try {
    const dir = app.getPath("userData"),
      p = path.join(dir, "journal.log");
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(p) && fs.statSync(p).size > 1_000_000)
      fs.renameSync(p, p + ".old");
    fs.appendFileSync(
      p,
      `${new Date().toISOString()} [${process.env.USERNAME || "Windows"}@${process.env.COMPUTERNAME || "PC"}] ${level} ${message}\n`,
    );
  } catch {}
}
let data = { users: {}, reports: [] };
function readOldDataFile() {
  try {
    const raw = fs.readFileSync(oldDataFile());
    const text = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString("utf8");
    const oldData = JSON.parse(text);
    if (oldData && oldData.users && Array.isArray(oldData.reports))
      return oldData;
  } catch {
    // Aucun fichier .dat ou ancienne version illisible : on démarrera vide.
  }
  return null;
}
function readOrCreateDatabaseKey(oldData) {
  const locations = [
    process.env.RAPPORT_QUART_DONNEES &&
      path.join(process.env.RAPPORT_QUART_DONNEES, "cle.dat"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "RapportQuart", "cle.dat"),
    path.join(app.getPath("userData"), "rapport-cq-sqlcipher-key.dat"),
  ].filter(Boolean);
  const { Dpapi, isPlatformSupported } = require("@primno/dpapi");
  if (!isPlatformSupported)
    throw new Error("Le chiffrement SQLCipher de l’application requiert Windows.");
  for (const location of locations) {
    if (!fs.existsSync(location)) continue;
    try {
      const key = Dpapi.unprotectData(
        fs.readFileSync(location),
        sqlCipherEntropy,
        "LocalMachine",
      ).toString("utf8").trim();
      if (/^[0-9A-F]{40}$/i.test(key)) return key;
    } catch {
      // Un fichier cle.dat peut appartenir à un autre poste Windows ; on essaie
      // alors la clé locale de l’application, ou la clé de récupération connue.
    }
  }
  const localKeyFile = locations.at(-1);
  const backupKey = String(oldData?.recoveryKey || "").trim().toUpperCase();
  if (fs.existsSync(file())) {
    if (/^[0-9A-F]{40}$/.test(backupKey)) return backupKey;
    throw new Error(
      "Clé SQLCipher introuvable. Gardez le fichier de clé du poste ayant créé cette base.",
    );
  }
  const key = /^[0-9A-F]{40}$/.test(backupKey)
    ? backupKey
    : crypto.randomBytes(20).toString("hex").toUpperCase();
  fs.mkdirSync(path.dirname(localKeyFile), { recursive: true });
  fs.writeFileSync(
    localKeyFile,
    Dpapi.protectData(Buffer.from(key, "utf8"), sqlCipherEntropy, "LocalMachine"),
  );
  return key;
}
function readDatabaseState() {
  const result = { users: {}, reports: [], loginAttempts: {} };
  for (const row of sqliteDatabase.query("SELECT username, password_json FROM users"))
    result.users[row.username] = JSON.parse(row.password_json);
  for (const row of sqliteDatabase.query("SELECT report_id, report_date, shift, team, staff_total, staff_absent, production_parcels, baskets_dry, tonnage_kg, payload_json FROM reports ORDER BY report_date, shift, team")) {
    const report = JSON.parse(row.payload_json);
    report.id = row.report_id;
    report.date = row.report_date;
    report.shift = row.shift;
    report.team = row.team;
    report.staff ||= {};
    report.staff.total = Number(row.staff_total) || 0;
    report.staff.absent = Number(row.staff_absent) || 0;
    report.production ||= {};
    report.production.parcels = Number(row.production_parcels) || 0;
    report.production.tonnageKg = Number(row.tonnage_kg) || 0;
    report.drying ||= {};
    report.drying.basketsDry = Number(row.baskets_dry) || 0;
    result.reports.push(report);
  }
  for (const row of sqliteDatabase.query("SELECT username, attempts, locked_until FROM login_attempts"))
    result.loginAttempts[row.username] = {
      count: Number(row.attempts) || 0,
      until: Number(row.locked_until) || 0,
    };
  for (const row of sqliteDatabase.query("SELECT setting, value_json FROM app_settings"))
    result[row.setting] = JSON.parse(row.value_json);
  return result;
}
function writeDatabaseState() {
  if (!sqliteDatabase) throw new Error("La base SQLCipher n’est pas ouverte.");
  sqliteDatabase.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    sqliteDatabase.exec("DELETE FROM users; DELETE FROM reports; DELETE FROM login_attempts; DELETE FROM app_settings");
    for (const [username, password] of Object.entries(data.users || {}))
      sqliteDatabase.query("INSERT INTO users (username, password_json) VALUES (?, ?)", [username, JSON.stringify(password)]);
    for (const report of data.reports || [])
      sqliteDatabase.query(
        "INSERT INTO reports (report_id, report_date, shift, team, staff_total, staff_absent, production_parcels, baskets_dry, tonnage_kg, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          report.id,
          report.date,
          report.shift,
          report.team,
          Number(report.staff?.total) || 0,
          Number(report.staff?.absent) || 0,
          Number(report.production?.parcels) || 0,
          Number(report.drying?.basketsDry) || 0,
          Number(report.production?.tonnageKg) || 0,
          JSON.stringify(report),
        ],
      );
    for (const [username, attempt] of Object.entries(data.loginAttempts || {}))
      sqliteDatabase.query("INSERT INTO login_attempts (username, attempts, locked_until) VALUES (?, ?, ?)", [username, Number(attempt.count) || 0, Number(attempt.until) || 0]);
    for (const setting of ["recoveryKey", "recoveryAcknowledged", "legacyConnected"])
      if (data[setting] !== undefined)
        sqliteDatabase.query("INSERT INTO app_settings (setting, value_json) VALUES (?, ?)", [setting, JSON.stringify(data[setting])]);
    sqliteDatabase.exec("COMMIT");
  } catch (error) {
    try { sqliteDatabase.exec("ROLLBACK"); } catch {}
    throw error;
  }
  sqliteDatabase.close();
  sqliteDatabase = null;
  const bytes = Buffer.from(sqliteModule.FS.readFile(sqliteVirtualPath));
  const target = file();
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, target);
  sqliteDatabase = sqliteApi.open(sqliteVirtualPath, sqlCipherKey);
  sqliteDatabase.exec("PRAGMA cipher_compatibility = 4");
}
async function load() {
  const oldData = readOldDataFile();
  sqlCipherKey = readOrCreateDatabaseKey(oldData);
  const { initSQLite } = require("@7mind.io/sqlcipher-wasm");
  sqliteApi = await initSQLite();
  sqliteModule = sqliteApi.getModule();
  const databaseExisted = fs.existsSync(file());
  if (databaseExisted)
    sqliteModule.FS.writeFile(sqliteVirtualPath, fs.readFileSync(file()));
  sqliteDatabase = sqliteApi.open(sqliteVirtualPath, sqlCipherKey);
  sqliteDatabase.exec("PRAGMA cipher_compatibility = 4");
  sqliteDatabase.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      report_id TEXT PRIMARY KEY,
      report_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      team TEXT NOT NULL,
      staff_total INTEGER,
      staff_absent INTEGER,
      production_parcels REAL,
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
  data = databaseExisted
    ? readDatabaseState()
    : oldData || {
        users: {},
        reports: [],
        loginAttempts: {},
        // Une base neuve reste vide au premier lancement ; l'import ancien
        // pourra toujours être lancé explicitement par l'administrateur.
        legacyConnected: true,
      };
  data.users ||= {};
  data.reports ||= [];
  data.loginAttempts ||= {};
  if (!data.recoveryKey) {
    data.recoveryKey = crypto.randomBytes(20).toString("hex").toUpperCase();
    data.recoveryAcknowledged = false;
  }
  if (!databaseExisted || !sqliteDatabase.query("SELECT 1 FROM app_settings WHERE setting = 'recoveryKey'").length)
    writeDatabaseState();
}
function save() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  writeDatabaseState();
}
// Recharge le fichier partagé sans perdre la dernière copie valide en mémoire.
function refreshSharedData() {
  const previousBytes = sqliteModule &&
    Buffer.from(sqliteModule.FS.readFile(sqliteVirtualPath));
  try {
    if (!fs.existsSync(file())) return false;
    if (sqliteDatabase) sqliteDatabase.close();
    sqliteModule.FS.writeFile(sqliteVirtualPath, fs.readFileSync(file()));
    sqliteDatabase = sqliteApi.open(sqliteVirtualPath, sqlCipherKey);
    sqliteDatabase.exec("PRAGMA cipher_compatibility = 4");
    const latest = readDatabaseState();
    if (!latest || !latest.users || !Array.isArray(latest.reports)) return false;
    data = latest;
    return true;
  } catch {
    // Si une édition externe est incomplète, on rouvre la dernière image valide.
    try {
      if (previousBytes) {
        sqliteModule.FS.writeFile(sqliteVirtualPath, previousBytes);
        sqliteDatabase = sqliteApi.open(sqliteVirtualPath, sqlCipherKey);
        sqliteDatabase.exec("PRAGMA cipher_compatibility = 4");
      }
    } catch {
      sqliteDatabase = null;
    }
    return false;
  }
}
function clockMinutes(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d{1,2})\s*[:hH.]\s*(\d{0,2})$/);
  if (!match) return null;
  const hour = Number(match[1]),
    minute = Number(match[2] || 0);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}
// Vérifie l’ordre des heures côté serveur, même si l’interface est contournée.
function validateReportTimeRanges(report) {
  const intervals = [
    ...(report.stops || []).map((stop) => ({
      ...stop,
      label: `l’arrêt ${stop.zone || ""}`,
    })),
    ...(report.drying?.dryers || []).flatMap((dryer) =>
      (dryer.stops || []).map((stop) => ({
        ...stop,
        label: `l’arrêt du séchoir ${dryer.number}`,
      })),
    ),
    ...Object.entries(report.generators || {}).flatMap(([name, periods]) =>
      (periods || []).map((period) => ({
        ...period,
        label: `la période du ${name}`,
      })),
    ),
  ];
  for (const interval of intervals) {
    if (!interval.start && !interval.end) continue;
    const start = clockMinutes(interval.start),
      end = clockMinutes(interval.end);
    if (start === null || end === null)
      throw new Error(
        `Heure invalide pour ${interval.label}. Saisissez une heure comme 07H30.`,
      );
    if (end <= start)
      throw new Error(
        `L’heure de fin doit être supérieure à l’heure de début pour ${interval.label}.`,
      );
  }
}
function legacyHash(p) {
  return crypto.scryptSync(p, "rapport-cq-js-v1", 64).toString("hex");
}
function makePassword(p) {
  const salt = crypto.randomBytes(16);
  return {
    salt: salt.toString("hex"),
    hash: crypto.pbkdf2Sync(p, salt, 200000, 32, "sha256").toString("hex"),
    iterations: 200000,
    failures: 0,
    lockedUntil: 0,
  };
}
function verifyPassword(stored, p) {
  if (typeof stored === "string")
    return { ok: stored === legacyHash(p), upgrade: stored === legacyHash(p) };
  if (!stored?.salt || !stored?.hash) return { ok: false };
  const iterations = Math.max(
      100000,
      Math.min(1000000, Number(stored.iterations) || 200000),
    ),
    expected = Buffer.from(stored.hash, "hex"),
    actual = crypto.pbkdf2Sync(
      p,
      Buffer.from(stored.salt, "hex"),
      iterations,
      expected.length,
      "sha256",
    );
  return {
    ok:
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual),
  };
}
function backupDaily() {
  if (!fs.existsSync(file())) return;
  const dir = path.join(app.getPath("userData"), "Sauvegardes");
  fs.mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const target = path.join(dir, `rapport-cq-${today}.db`);
  if (!fs.existsSync(target)) fs.copyFileSync(file(), target);
  const files = fs
    .readdirSync(dir)
    .map((n) => path.join(dir, n))
    .filter((n) => fs.statSync(n).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  files.slice(30).forEach((n) => fs.unlinkSync(n));
}
ipcMain.handle("bootstrap", () => {
  // Chaque actualisation relit les changements enregistrés par les autres fenêtres.
  refreshSharedData();
  const admin = activeUser === "Administrateur",
    logged = !!activeUser;
  return {
    users: Object.keys(data.users),
    teams: {
      A: "KONAN LUC",
      B: "EYO NESTOR",
      C: "DAMEY JEAN-BAPTISTE",
      D: "TIA LOU EDWIGE",
    },
    reports: logged ? data.reports : [],
    adminSet: !!data.users.Administrateur,
    recoveryKey: data.recoveryAcknowledged ? null : data.recoveryKey,
    recoveryKeyForSetup: data.users.Administrateur ? null : data.recoveryKey,
    legacyAvailable: admin && fs.existsSync(legacyDatabase()),
    legacyConnected: !!data.legacyConnected,
  };
});
ipcMain.handle("ack-recovery", () => {
  data.recoveryAcknowledged = true;
  save();
  return true;
});
ipcMain.handle("auth", (_, { user, password, confirmation, recoveryKey }) => {
  if (!user || !password)
    return { ok: false, message: "Saisissez le mot de passe." };
  const existing = data.users[user];
  if (!existing) {
    if (user === "Administrateur") {
      if (
        String(recoveryKey || "")
          .trim()
          .toUpperCase() !== data.recoveryKey
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
    data.users[user] = makePassword(password);
    save();
    activeUser = user;
    log("INFO", `Initialisation et connexion autorisées (${user})`);
    return { ok: true, first: true, user };
  }
  const attempt = data.loginAttempts[user] || { count: 0, until: 0 };
  if (attempt.until > Date.now())
    return {
      ok: false,
      message: `Trop de tentatives. Réessayez après ${new Date(attempt.until).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`,
    };
  if (existing.lockedUntil > Date.now())
    return {
      ok: false,
      message: `Trop de tentatives. Réessayez après ${new Date(existing.lockedUntil).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`,
    };
  const checked = verifyPassword(existing, password);
  if (!checked.ok) {
    attempt.count++;
    if (typeof existing === "object") {
      existing.failures = (existing.failures || 0) + 1;
      if (existing.failures >= 5) {
        existing.lockedUntil = Date.now() + 15 * 60 * 1000;
        existing.failures = 0;
      }
    }
    if (attempt.count >= 5) {
      attempt.count = 0;
      attempt.until = Date.now() + 15 * 60 * 1000;
    }
    data.loginAttempts[user] = attempt;
    save();
    log("INFO", `Échec de connexion (${user})`);
    return {
      ok: false,
      message:
        attempt.until || existing.lockedUntil
          ? "Trop de tentatives. Réessayez dans 15 minutes."
          : "Mot de passe incorrect.",
    };
  }
  if (checked.upgrade) data.users[user] = makePassword(password);
  if (typeof data.users[user] === "object") {
    data.users[user].failures = 0;
    data.users[user].lockedUntil = 0;
  }
  data.loginAttempts[user] = { count: 0, until: 0 };
  activeUser = user;
  log("INFO", `Connexion autorisée (${user})`);
  return { ok: true, user };
});
ipcMain.handle(
  "reset-team-password",
  (_, { user, recoveryKey, next, confirmation }) => {
    if (!["A", "B", "C", "D"].includes(user))
      throw new Error(
        "Seul le mot de passe d’une équipe peut être réinitialisé ici.",
      );
    if (
      String(recoveryKey || "")
        .trim()
        .toUpperCase() !== data.recoveryKey
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
    data.users[user] = makePassword(next);
    data.loginAttempts[user] = { count: 0, until: 0 };
    save();
    return true;
  },
);
function focusMainWindow() {
  return new Promise((resolve) => {
    const focus = () => {
      if (!win || win.isDestroyed()) return false;
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      try {
        app.focus({ steal: true });
      } catch {}
      win.focus();
      win.webContents.focus();
      return true;
    };

    if (!focus()) return resolve(false);
    // Windows peut répondre avant que l’ancien champ ait libéré le clavier ;
    // on reprend le focus après cette transition.
    setTimeout(() => resolve(focus()), 220);
  });
}
ipcMain.handle("logout", async () => {
  log("INFO", `Session fermée (${activeUser || "inconnue"})`);
  activeUser = null;
  // L’interface affiche d’abord le formulaire de connexion, puis le renderer
  // demande le focus. Re-focaliser ici ciblait parfois le document précédent.
  return true;
});
ipcMain.handle("focus-app", () => focusMainWindow());
ipcMain.handle("change-password", (_, { current, next }) => {
  if (!activeUser) throw new Error("Aucun profil connecté.");
  if (!verifyPassword(data.users[activeUser], current || "").ok)
    throw new Error("Le mot de passe actuel est incorrect.");
  const minimum = activeUser === "Administrateur" ? 8 : 6;
  if (
    String(next || "").length < minimum ||
    String(next || "").length > 64 ||
    /[\x00-\x1f\x7f]/.test(next)
  )
    throw new Error(
      `Le nouveau mot de passe doit contenir de ${minimum} à 64 caractères.`,
    );
  data.users[activeUser] = makePassword(next);
  save();
  return true;
});
ipcMain.handle("capture-synthesis", async (_, rect) => {
  if (!activeUser) throw new Error("Connectez-vous pour capturer la synthèse.");
  const report = data.reports.find((item) => item.id === rect?.reportId);
  if (!report) throw new Error("Le rapport à capturer est introuvable.");
  if (
    activeUser !== "Administrateur" &&
    report.team !== activeUser
  )
    throw new Error("Vous pouvez capturer uniquement le rapport de votre équipe.");
  const root = path.join(app.getPath("documents"), "RapportQuart", "Captures");
  // Chaque image va dans le dossier de l’équipe du rapport, même si
  // l’administrateur a déclenché la capture depuis l’historique.
  const dir = path.join(root, `Equipe-${report.team}`);
  for (const team of ["A", "B", "C", "D"])
    fs.mkdirSync(path.join(root, `Equipe-${team}`), { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  const safe = Object.fromEntries(
    ["x", "y", "width", "height"].map((k) => [
      k,
      Math.max(0, Math.floor(Number(rect?.[k]) || 0)),
    ]),
  );
  if (!safe.width || !safe.height)
    throw new Error("La synthèse n’est pas visible.");
  const image = await win.webContents.capturePage(safe);
  const requestedName = path.basename(String(rect?.name || ""));
  const name = /^[\w .-]+\.png$/i.test(requestedName)
    ? requestedName
    : `Synthese_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  const target = path.join(dir, name);
  fs.writeFileSync(target, image.toPNG());
  return target;
});
ipcMain.handle("open-captures", async () => {
  if (!activeUser) throw new Error("Connectez-vous pour ouvrir le dossier.");
  if (activeUser !== "Administrateur" && !["A", "B", "C", "D"].includes(activeUser))
    throw new Error("Profil non autorisé à ouvrir un dossier de capture.");
  const root = path.join(app.getPath("documents"), "RapportQuart", "Captures");
  const dir =
    activeUser === "Administrateur"
      ? root
      : path.join(root, `Equipe-${activeUser}`);
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
ipcMain.handle("import-legacy-db", async (_, options = {}) => {
  if (activeUser !== "Administrateur")
    throw new Error("Import réservé à l’administrateur.");
  const automatic = options?.automatic === true;
  if (automatic && data.legacyConnected && !options?.force)
    return { imported: 0, alreadyConnected: true };
  const fixedPath = legacyDatabase();
  if (automatic && !fs.existsSync(fixedPath))
    throw new Error(`Ancienne base introuvable : ${fixedPath}`);
  const picked = automatic
    ? { canceled: false, filePaths: [fixedPath] }
    : await dialog.showOpenDialog(win, {
        defaultPath: fs.existsSync(fixedPath) ? fixedPath : undefined,
        properties: ["openFile"],
        filters: [
          { name: "Base SQLite", extensions: ["db", "sqlite", "sqlite3"] },
        ],
      });
  if (picked.canceled || !picked.filePaths[0]) return false;
  const bytes = fs.readFileSync(picked.filePaths[0]);
  let legacy, table, hasTable, sqlRows;
  const sqliteHeader = Buffer.from("SQLite format 3\0");
  if (bytes.subarray(0, sqliteHeader.length).equals(sqliteHeader)) {
    try {
      const SQL = await require("sql.js")({
        locateFile: (n) =>
          path.join(path.dirname(require.resolve("sql.js")), n),
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
        path.join(process.env.RAPPORT_QUART_DONNEES, "cle.dat"),
      path.join(
        process.env.ProgramData || "C:\\ProgramData",
        "RapportQuart",
        "cle.dat",
      ),
      path.join(path.dirname(picked.filePaths[0]), "cle.dat"),
    ].find((p) => p && fs.existsSync(p));
    if (!keyFile) {
      const keyPick = await dialog.showOpenDialog(win, {
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
          fs.readFileSync(keyFile),
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
    dryers = table("sechoir_releve"),
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
  const dryerById = new Map();
  dryers.forEach((x) => {
    const a = dryerById.get(x.rapport_id) || [];
    a.push({
      number: num(x.sechoir),
      cycle: num(x.cycle_sec),
      burner1: num(x.bruleur1),
      burner2: num(x.bruleur2),
      counter: x.compteur || "",
      gas1: x.gaz || "",
      gas2: x.gaz2 || "",
      stops: [],
    });
    dryerById.set(x.rapport_id, a);
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
    if (data.reports.some((r) => r.id === id)) continue;
    const ds = dryerById.get(id) || [];
    for (const n of [1, 2, 3])
      if (!ds.some((d) => d.number === n))
        ds.push({
          number: n,
          cycle: 0,
          burner1: 0,
          burner2: 0,
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
    const parcels = num(x.production),
      r = {
        id,
        date: String(x.date || ""),
        shift: x.quart || "",
        team: x.equipe || "",
        staff: {
          total: num(x.effectif_total),
          absent: num(x.absent),
          sick: num(x.malade),
          permission: num(x.permission),
          leave: num(x.conge),
          accidents: num(x.accident),
        },
        prewash: {
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
        drying: { basketsDry: num(x.paniers_seches), dryers: ds },
        production: {
          parcels,
          tonnageKg: num(x.kg, parcels * 1260),
          balesStart: num(x.balles_debut),
          balesShift: num(x.balles_quart),
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
    data.reports.push(r);
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
    if (!data.users[x.code] && x.sel_hex && x.hash_hex)
      data.users[x.code] = {
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
    !data.users.Administrateur &&
    adminAccess?.sel_hex &&
    adminAccess?.hash_hex
  )
    data.users.Administrateur = {
      salt: adminAccess.sel_hex.toLowerCase(),
      hash: adminAccess.hash_hex.toLowerCase(),
      iterations: num(adminAccess.iterations, 200000),
      failures: num(adminAccess.echecs),
      lockedUntil: adminAccess.bloque_jusqua
        ? Date.parse(adminAccess.bloque_jusqua) || 0
        : 0,
    };
  legacy.close();
  if (automatic) data.legacyConnected = true;
  save();
  log("INFO", `${imported} rapport(s) importé(s) depuis une sauvegarde C#`);
  return { imported };
});
ipcMain.handle("save-report", (_, report) => {
  if (!activeUser) throw new Error("La session a expiré. Reconnectez-vous.");
  if (activeUser === "Administrateur")
    throw new Error(
      "Seuls les utilisateurs d’équipe peuvent créer des rapports.",
    );
  // Vérifie les doublons contre la dernière version partagée des données.
  refreshSharedData();
  if (!report.date || !report.shift || !report.team)
    throw new Error("Date, quart et équipe obligatoires.");
  validateReportTimeRanges(report);
  if ((report.drying?.dryers || []).some((dryer) => [dryer.burner1, dryer.burner2].some((value) => Number(value) < 0 || Number(value) > 130)))
    throw new Error("Les valeurs des brûleurs doivent être comprises entre 0 et 130.");
  if (activeUser !== "Administrateur" && activeUser !== report.team)
    throw new Error(
      "Vous ne pouvez enregistrer que les rapports de votre équipe.",
    );
  report.id = `${report.date}_${report.shift}_${report.team}`;
  const sameSlot = data.reports.find(
    (saved) => saved.date === report.date && saved.shift === report.shift && saved.id !== report.id,
  );
  if (sameSlot)
    throw new Error(
      `Un rapport existe déjà pour cette date et ce quart (équipe ${sameSlot.team}).`,
    );
  const oldIndex = data.reports.findIndex((r) => r.id === report.id);
  const old = oldIndex >= 0 ? data.reports[oldIndex] : null;
  if (old && activeUser !== "Administrateur") {
    const created = Date.parse(old.createdAt || "");
    if (
      !Number.isFinite(created) ||
      Date.now() - created > REPORT_EDIT_WINDOW_HOURS * 60 * 60 * 1000
    )
      throw new Error(
        `Modification impossible : le délai de ${REPORT_EDIT_WINDOW_HOURS} heures après la création de ce rapport est dépassé ou indisponible. Contactez l’administrateur si une correction est nécessaire.`,
      );
  }
  report.createdAt = old?.createdAt || new Date().toISOString();
  report.updatedAt = new Date().toISOString();
  if (old) data.reports.splice(oldIndex, 1);
  data.reports.push(report);
  save();
  return report;
});
ipcMain.handle("export-xlsx", async (_, { name, rows }) => {
  if (activeUser !== "Administrateur")
    throw new Error("Action réservée à l’administrateur.");
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
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
function createWindow() {
  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1440, screenWidth),
    height: Math.min(920, screenHeight),
    minWidth: Math.min(800, screenWidth),
    minHeight: Math.min(600, screenHeight),
    autoHideMenuBar: true,
    icon: path.join(__dirname, "../assets/exat_agri_fb.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "index.html"));
}
app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  Menu.setApplicationMenu(null);
  try {
    await load();
    backupDaily();
    createWindow();
  } catch (error) {
    dialog.showErrorBox(
      "Base SQLCipher inaccessible",
      `Impossible d’ouvrir la base JavaScript : ${error.message}`,
    );
    app.quit();
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
