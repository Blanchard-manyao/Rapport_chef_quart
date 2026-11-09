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
let win;
let activeUser = null;
const REPORT_EDIT_WINDOW_HOURS = 8;
const file = () => path.join(app.getPath("userData"), "rapport-cq.dat");
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
let data = { users: {}, reports: [], audit: [] };
function load() {
  try {
    const raw = fs.readFileSync(file());
    const text = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString("utf8");
    data = JSON.parse(text);
  } catch {
    data = { users: {}, reports: [], audit: [] };
  }
  data.users ||= {};
  data.reports ||= [];
  data.audit ||= [];
  data.loginAttempts ||= {};
  if (!data.recoveryKey) {
    data.recoveryKey = crypto.randomBytes(20).toString("hex").toUpperCase();
    data.recoveryAcknowledged = false;
    save();
  }
}
function save() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  const text = JSON.stringify(data);
  const bytes = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(text)
    : Buffer.from(text);
  fs.writeFileSync(file(), bytes);
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
function audit(action, id = "", previous = null) {
  data.audit.unshift({
    at: new Date().toISOString(),
    user: activeUser || "Inconnu",
    action,
    id,
    detail: previous ? JSON.stringify(previous) : "",
  });
}
function backupDaily() {
  if (!fs.existsSync(file())) return;
  const dir = path.join(app.getPath("userData"), "Sauvegardes");
  fs.mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const target = path.join(dir, `rapport-cq-${today}.dat`);
  if (!fs.existsSync(target)) fs.copyFileSync(file(), target);
  const files = fs
    .readdirSync(dir)
    .map((n) => path.join(dir, n))
    .filter((n) => fs.statSync(n).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  files.slice(30).forEach((n) => fs.unlinkSync(n));
}
ipcMain.handle("bootstrap", () => {
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
    audit: admin ? data.audit : [],
    secure: safeStorage.isEncryptionAvailable(),
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
    audit("REINITIALISATION_MOT_DE_PASSE", user);
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
      win.focus();
      win.webContents.focus();
      return true;
    };

    if (!focus()) return resolve(false);
    // Windows can deliver the logout IPC response while the prior page is
    // still relinquishing keyboard focus. Refocus after that transition.
    setTimeout(() => resolve(focus()), 150);
  });
}
ipcMain.handle("logout", async () => {
  log("INFO", `Session fermée (${activeUser || "inconnue"})`);
  activeUser = null;
  return focusMainWindow();
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
  audit("CHANGEMENT_MOT_DE_PASSE");
  save();
  return true;
});
ipcMain.handle("export-backup", async () => {
  if (activeUser !== "Administrateur")
    throw new Error("Action réservée à l’administrateur.");
  save();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `rapport-cq-${new Date().toISOString().slice(0, 10)}.dat`,
    filters: [{ name: "Sauvegarde Rapport CQ", extensions: ["dat"] }],
  });
  if (canceled) return false;
  fs.copyFileSync(file(), filePath);
  return true;
});
ipcMain.handle("capture-synthesis", async (_, rect) => {
  if (!activeUser) throw new Error("Connectez-vous pour capturer la synthèse.");
  const report = data.reports.find((item) => item.id === rect?.reportId);
  if (
    activeUser !== "Administrateur" &&
    (!report || report.team !== activeUser)
  )
    throw new Error("Vous pouvez capturer uniquement le rapport de votre équipe.");
  const root = path.join(app.getPath("documents"), "RapportQuart", "Captures");
  const dir =
    activeUser === "Administrateur"
      ? root
      : path.join(root, `Equipe-${activeUser}`);
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
  for (const a of table("journal_audit")) {
    const at = a.horodatage;
    if (!at) continue;
    let stamp;
    try {
      stamp = new Date(at).toISOString();
    } catch {
      stamp = new Date().toISOString();
    }
    const entry = {
      at: stamp,
      user: a.machine
        ? `${a.utilisateur || "Ancien journal"}@${a.machine}`
        : a.utilisateur || "Ancien journal",
      action: a.action || "MODIFICATION",
      id: a.rapport_id || "",
      detail: a.ancien_contenu || "",
    };
    const key = JSON.stringify([entry.at, entry.user, entry.action, entry.id]);
    if (
      !data.audit.some(
        (v) => JSON.stringify([v.at, v.user, v.action, v.id]) === key,
      )
    )
      data.audit.push(entry);
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
  data.audit.unshift({
    at: new Date().toISOString(),
    user: activeUser,
    action: "IMPORT_BASE_C#",
    id: picked.filePaths[0].split(/[\\/]/).pop(),
    detail: `${imported} rapport(s) importé(s)`,
  });
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
  if (!report.date || !report.shift || !report.team)
    throw new Error("Date, quart et équipe obligatoires.");
  if ((report.drying?.dryers || []).some((dryer) => [dryer.burner1, dryer.burner2].some((value) => Number(value) < 0 || Number(value) > 130)))
    throw new Error("Les valeurs des brûleurs doivent être comprises entre 0 et 130.");
  if (activeUser !== "Administrateur" && activeUser !== report.team)
    throw new Error(
      "Vous ne pouvez enregistrer que les rapports de votre équipe.",
    );
  report.id = `${report.date}_${report.shift}_${report.team}`;
  const oldIndex = data.reports.findIndex((r) => r.id === report.id);
  const old = oldIndex >= 0 ? data.reports[oldIndex] : null;
  if (old && activeUser !== "Administrateur") {
    const created = Date.parse(old.createdAt || 0);
    if (
      created &&
      Date.now() - created > REPORT_EDIT_WINDOW_HOURS * 60 * 60 * 1000
    )
      throw new Error(
        `Modification impossible : le délai de ${REPORT_EDIT_WINDOW_HOURS} heures après la création de ce rapport est dépassé. Contactez l’administrateur si une correction est nécessaire.`,
      );
  }
  report.createdAt = old?.createdAt || new Date().toISOString();
  report.updatedAt = new Date().toISOString();
  if (old) {
    audit("MODIFICATION", report.id, old);
    data.reports.splice(oldIndex, 1);
  } else audit("CREATION", report.id);
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
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  load();
  backupDaily();
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
