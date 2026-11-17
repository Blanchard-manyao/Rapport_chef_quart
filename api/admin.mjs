import { createHmac, pbkdf2Sync, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "rapport_cq_admin";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const supabaseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabase(path, options = {}) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey(),
      Authorization: `Bearer ${supabaseKey()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(`Supabase ${response.status} ${detail.code || "unknown"}`);
  }
  return response.status === 204 ? null : response.json();
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

function configurationReady() {
  return Boolean(
    supabaseUrl() &&
      supabaseKey() &&
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
    let cleTentatives;
    try {
      const adresse = request.headers.get("x-real-ip") || "inconnue";
      cleTentatives = `${adresse}:${utilisateur.toLowerCase()}`.slice(0, 250);
      const verrou = await supabase(`admin_login_attempts?select=locked_until&login_key=eq.${encodeURIComponent(cleTentatives)}`);
      if (verrou[0]?.locked_until && new Date(verrou[0].locked_until) > new Date())
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
        await supabase("rpc/record_admin_login_failure", {
          method: "POST",
          body: JSON.stringify({ p_login_key: cleTentatives }),
        });
      } catch {
        return json({ error: "Le service de connexion est indisponible." }, 503);
      }
      return json({ error: "Identifiant ou mot de passe incorrect." }, 401);
    }

    await supabase(`admin_login_attempts?login_key=eq.${encodeURIComponent(cleTentatives)}`, { method: "DELETE" });

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
      const rows = await supabase("reports?select=payload_json&order=report_date.desc,quart.asc,equipe.asc&limit=1000");
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
      await supabase("reports?on_conflict=report_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(reports),
      });
      return json({ ok: true, synced: reports.length }, 200, {
        "Cache-Control": "no-store",
      });
    } catch (error) {
      console.error("Échec Supabase pendant la synchronisation des rapports:", error.message);
      return json({ error: "Impossible d’enregistrer les rapports." }, 503, {
        "Cache-Control": "no-store",
      });
    }
  }

  return json({ error: "Route introuvable." }, 404);
}

export default { fetch: router };
