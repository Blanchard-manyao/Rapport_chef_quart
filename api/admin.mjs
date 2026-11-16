import { neon } from "@neondatabase/serverless";
import { createHmac, pbkdf2Sync, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "rapport_cq_admin";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const databaseUrl = () =>
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED;

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

function configurationReady() {
  return Boolean(
    databaseUrl() &&
      process.env.ADMIN_USERNAME &&
      process.env.ADMIN_PASSWORD_HASH &&
      process.env.SESSION_SECRET,
  );
}

function sign(payload) {
  return createHmac("sha256", process.env.SESSION_SECRET)
    .update(payload)
    .digest("base64url");
}

function lireSession(request) {
  const cookie = request.headers.get("cookie") || "";
  const valeur = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!valeur) return false;

  const [payload, signature] = valeur.split(".");
  if (!payload || !signature) return false;
  const signatureAttendue = sign(payload);
  const recu = Buffer.from(signature);
  const attendu = Buffer.from(signatureAttendue);
  if (recu.length !== attendu.length || !timingSafeEqual(recu, attendu))
    return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    return session.user === process.env.ADMIN_USERNAME && session.exp > Date.now();
  } catch {
    return false;
  }
}

function verifierMotDePasse(motDePasse) {
  const [algorithme, iterationsTexte, sel, empreinte] = String(
    process.env.ADMIN_PASSWORD_HASH || "",
  ).split("$");
  const iterations = Number(iterationsTexte);
  if (
    algorithme !== "pbkdf2-sha256" ||
    !Number.isInteger(iterations) ||
    iterations < 310000 ||
    !sel ||
    !empreinte
  )
    return false;

  const attendu = Buffer.from(empreinte, "hex");
  const calcule = pbkdf2Sync(motDePasse, sel, iterations, attendu.length, "sha256");
  return attendu.length === calcule.length && timingSafeEqual(attendu, calcule);
}

function optionsCookie(maxAge) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function lireJson(request, tailleMaximale = 2048) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > tailleMaximale) throw new Error("Requête trop volumineuse.");
  const body = await request.text();
  if (Buffer.byteLength(body) > tailleMaximale) throw new Error("Requête trop volumineuse.");
  return JSON.parse(body);
}

async function router(request) {
  if (!configurationReady())
    return json({ error: "Le service administrateur n’est pas configuré." }, 503);

  const url = new URL(request.url);
  const pathname = url.searchParams.has("route")
    ? `/api/admin/${url.searchParams.get("route")}`
    : url.pathname;
  if (pathname === "/api/admin/login" && request.method === "POST") {
    let body;
    try {
      body = await lireJson(request);
    } catch {
      return json({ error: "Requête invalide." }, 400);
    }

    const utilisateur = String(body?.username || "");
    const motDePasse = String(body?.password || "");
    if (!utilisateur || utilisateur.length > 100 || motDePasse.length > 128)
      return json({ error: "Identifiant ou mot de passe incorrect." }, 401);
    let sql;
    let cleTentatives;
    try {
      sql = neon(databaseUrl());
      const adresse = request.headers.get("x-real-ip") || "inconnue";
      cleTentatives = `${adresse}:${utilisateur.toLowerCase()}`.slice(0, 250);
      const verrou = await sql`
        SELECT locked_until > now() AS locked
        FROM admin_login_attempts
        WHERE login_key = ${cleTentatives}
      `;
      if (verrou[0]?.locked)
        return json({ error: "Trop de tentatives. Réessayez dans 15 minutes." }, 429, {
          "Cache-Control": "no-store",
        });
    } catch {
      return json({ error: "Le service de connexion est indisponible." }, 503);
    }

    const identifiantValide = utilisateur === process.env.ADMIN_USERNAME;
    const motDePasseValide = verifierMotDePasse(motDePasse);
    if (!identifiantValide || !motDePasseValide) {
      try {
        await sql`
          INSERT INTO admin_login_attempts (login_key, failed_count, locked_until)
          VALUES (${cleTentatives}, 1, NULL)
          ON CONFLICT (login_key) DO UPDATE SET
            failed_count = CASE
              WHEN admin_login_attempts.locked_until > now() THEN admin_login_attempts.failed_count
              ELSE admin_login_attempts.failed_count + 1
            END,
            locked_until = CASE
              WHEN admin_login_attempts.failed_count + 1 >= 5 THEN now() + interval '15 minutes'
              ELSE admin_login_attempts.locked_until
            END
        `;
      } catch {
        return json({ error: "Le service de connexion est indisponible." }, 503);
      }
      return json({ error: "Identifiant ou mot de passe incorrect." }, 401);
    }

    await sql`DELETE FROM admin_login_attempts WHERE login_key = ${cleTentatives}`;

    const session = Buffer.from(
      JSON.stringify({ user: utilisateur, exp: Date.now() + SESSION_DURATION_SECONDS * 1000 }),
    ).toString("base64url");
    const jeton = `${session}.${sign(session)}`;
    return json(
      { ok: true, user: utilisateur },
      200,
      {
        "Set-Cookie": `${COOKIE_NAME}=${jeton}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION_SECONDS}`,
        "Cache-Control": "no-store",
      },
    );
  }

  if (pathname === "/api/admin/logout" && request.method === "POST")
    return json({ ok: true }, 200, {
      "Set-Cookie": optionsCookie(0),
      "Cache-Control": "no-store",
    });

  if (pathname === "/api/admin/reports" && request.method === "GET") {
    if (!lireSession(request))
      return json({ error: "Session administrateur requise." }, 401, {
        "Cache-Control": "no-store",
      });

    try {
      const sql = neon(databaseUrl());
      const rows = await sql`
        SELECT report_id, report_date, quart, equipe, payload_json
        FROM reports
        ORDER BY report_date DESC, quart, equipe
        LIMIT 1000
      `;
      return json(
        { reports: rows.map((row) => row.payload_json) },
        200,
        { "Cache-Control": "no-store" },
      );
    } catch {
      return json({ error: "Impossible de charger les rapports." }, 503, {
        "Cache-Control": "no-store",
      });
    }
  }

  if (pathname === "/api/admin/reports" && request.method === "POST") {
    if (!lireSession(request))
      return json({ error: "Session administrateur requise." }, 401, {
        "Cache-Control": "no-store",
      });

    let reports;
    try {
      const body = await lireJson(request, 2 * 1024 * 1024);
      if (!Array.isArray(body?.reports) || body.reports.length < 1 || body.reports.length > 50)
        return json({ error: "Le lot doit contenir de 1 à 50 rapports." }, 400);

      reports = body.reports.map((report) => {
        const date = String(report?.date || "");
        const quart = String(report?.quart || "").trim();
        const equipe = String(report?.equipe || "").trim();
        const id = String(report?.id || `${date}_${quart}_${equipe}`).trim();
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !quart || quart.length > 40 ||
          !equipe || equipe.length > 40 ||
          !id || id.length > 250 ||
          !report || typeof report !== "object" || Array.isArray(report)
        )
          throw new Error("Un rapport du lot est invalide.");
        return { report_id: id, report_date: date, quart, equipe, payload_json: report };
      });
    } catch (error) {
      return json({ error: error.message || "Requête invalide." }, 400, {
        "Cache-Control": "no-store",
      });
    }

    try {
      const sql = neon(databaseUrl());
      await sql`
        INSERT INTO reports (report_id, report_date, quart, equipe, payload_json)
        SELECT report_id, report_date::date, quart, equipe, payload_json
        FROM jsonb_to_recordset(${JSON.stringify(reports)}::jsonb) AS item(
          report_id text,
          report_date text,
          quart text,
          equipe text,
          payload_json jsonb
        )
        ON CONFLICT (report_id) DO UPDATE SET
          report_date = EXCLUDED.report_date,
          quart = EXCLUDED.quart,
          equipe = EXCLUDED.equipe,
          payload_json = EXCLUDED.payload_json,
          updated_at = now()
      `;
      return json({ ok: true, synced: reports.length }, 200, {
        "Cache-Control": "no-store",
      });
    } catch {
      return json({ error: "Impossible d’enregistrer les rapports." }, 503, {
        "Cache-Control": "no-store",
      });
    }
  }

  return json({ error: "Route introuvable." }, 404);
}

export default { fetch: router };
