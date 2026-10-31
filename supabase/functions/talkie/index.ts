// MotoRoute – fonction serveur « talkie » (29/10/2026) : talkie-walkie de groupe.
//
// Rôle : l'application ne connaît JAMAIS la clé secrète Cloudflare. Elle appelle cette fonction, qui
//   1) vérifie le jeton de l'utilisateur ;
//   2) vérifie qu'il a le droit d'entrer dans le canal (membre actif du groupe, ou participant / créateur de la sortie)
//      en appelant la règle SQL public.mr_talkie_can (la même que pour les messages vocaux) ;
//   3) fait les appels à Cloudflare Realtime (SFU) avec les secrets, et renvoie à l'app ce dont elle a besoin.
// Elle sert aussi à effacer PHYSIQUEMENT les messages vocaux de plus de 24 h (action « purge », sans Cloudflare).
//
// Secrets Supabase (Edge Functions > Secrets) :
//   CF_REALTIME_APP_ID      identifiant de l'application Cloudflare Realtime (SFU)        – obligatoire pour le direct
//   CF_REALTIME_APP_SECRET  « App Secret » de cette application                           – obligatoire pour le direct
//   CF_TURN_KEY_ID          identifiant de la clé TURN Cloudflare (réseaux qui bloquent l'UDP) – facultatif, conseillé
//   CF_TURN_API_TOKEN       jeton API de cette clé TURN                                   – facultatif, conseillé
// Sans CF_REALTIME_*, la fonction répond « configured:false » et l'app reste en messages vocaux (mode B), sans erreur.
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
//
// API Cloudflare utilisée (voir DECISION dans docs, et les sources citées dans le rapport) :
//   POST {CF}/apps/{appId}/sessions/new                          -> { sessionId }
//   POST {CF}/apps/{appId}/sessions/{sid}/tracks/new             -> { sessionDescription, tracks[], requiresImmediateRenegotiation }
//   PUT  {CF}/apps/{appId}/sessions/{sid}/renegotiate            -> { }  (corps : { sessionDescription: { type:"answer", sdp } })
//   PUT  {CF}/apps/{appId}/sessions/{sid}/tracks/close           -> { sessionDescription }
//   POST {CF}/turn/keys/{turnKeyId}/credentials/generate-ice-servers  -> { iceServers: [...] }
//   avec  Authorization: Bearer <secret>,  CF = https://rtc.live.cloudflare.com/v1
import { createClient } from "jsr:@supabase/supabase-js@2";

const CF = "https://rtc.live.cloudflare.com/v1";
const BUCKET = "talkie-audio";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const CHANNEL_RE = new RegExp("^([gr]):(" + UUID + ")$");
const SID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const TRACK_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MID_RE = /^[A-Za-z0-9_-]{1,16}$/;
const MAX_SESSIONS_PER_HOUR = 30; // anti-abus : sessions Cloudflare créées par un même membre
// COUPE-CIRCUIT (supabase/talkie-quota.sql) : minutes de CONNEXION au direct (surestime la vraie consommation,
// le son ne part que quand quelqu'un parle). 1 000 Go gratuits/mois ≈ 1,2 million de minutes d'écoute : on s'arrête bien avant.
// Au-delà, le direct est refusé et l'app repasse toute seule en messages vocaux (rien n'est facturé par Cloudflare).
const MONTH_MINUTES = Number(Deno.env.get("TALKIE_MONTH_MINUTES") || 300000); // tout le club, par mois
const DAY_MINUTES = Number(Deno.env.get("TALKIE_DAY_MINUTES") || 240);        // par membre et par jour (4 h)
// A5 (31/10) : le téléphone ne compte plus chaque minute mais toutes les 5 minutes (moins d'appels serveur).
// Chaque « tick » ajoute donc 5 minutes, comptées D'AVANCE (premier tick dès la connexion) : on surestime, jamais l'inverse.
// La valeur est fixée ICI, côté serveur : le téléphone ne choisit pas combien de minutes il déclare.
const TICK_MINUTES = 5;
const STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] }];

type Obj = Record<string, unknown>;
type Sdp = { type: "offer" | "answer"; sdp: string };

// Valide une description SDP venue du téléphone (type fixé, taille bornée)
function sdp(v: unknown, type: "offer" | "answer"): Sdp | null {
  const o = v as Obj | null;
  if (!o || typeof o.sdp !== "string" || o.sdp.length < 20 || o.sdp.length > 60000) return null;
  return { type, sdp: o.sdp };
}

// Appel Cloudflare Realtime SFU (jamais exposé à l'app)
async function cf(method: string, path: string, body?: unknown): Promise<Obj> {
  const appId = Deno.env.get("CF_REALTIME_APP_ID")!;
  const secret = Deno.env.get("CF_REALTIME_APP_SECRET")!;
  const r = await fetch(`${CF}/apps/${appId}${path}`, {
    method,
    headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(9000),
  });
  const t = await r.text();
  let j: Obj = {};
  try { j = t ? JSON.parse(t) : {}; } catch { j = { errorCode: "bad_json", errorDescription: t.slice(0, 120) }; }
  if (!r.ok && !j.errorCode) j.errorCode = "http_" + r.status;
  return j;
}
// Erreur Cloudflare -> réponse douce (l'app retombe en messages vocaux sans rien afficher d'effrayant)
const cfFail = (j: Obj) => json({ ok: false, why: "cf", code: String(j.errorCode || ""), msg: String(j.errorDescription || "").slice(0, 160) });

async function iceServers(): Promise<unknown[]> {
  const id = Deno.env.get("CF_TURN_KEY_ID"), tok = Deno.env.get("CF_TURN_API_TOKEN");
  if (!id || !tok) return STUN;
  try {
    const r = await fetch(`${CF}/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 3600 }),
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    const s = j?.iceServers;
    const arr = Array.isArray(s) ? s : s ? [s] : [];
    return arr.length ? [...STUN, ...arr] : STUN;
  } catch { return STUN; }
}

// Lecture du compteur (sans rien ajouter). true = encore du quota. Compteur illisible = false (prudence : pas de facture surprise).
// deno-lint-ignore no-explicit-any
async function quotaOk(admin: any, me: string): Promise<boolean> {
  const { data: u, error } = await admin.rpc("mr_talkie_usage", { p_user: me });
  const row = Array.isArray(u) ? u[0] : u;
  return !error && !!row && Number(row.month_minutes) < MONTH_MINUTES && Number(row.day_minutes) < DAY_MINUTES;
}
// Ajoute TICK_MINUTES au compteur et renvoie les nouveaux totaux.
// Utilise mr_talkie_add (supabase/talkie-quota-v2.sql) ; si ce script n'est pas encore appliqué (fonction absente),
// repli sur l'ancienne mr_talkie_tick (+1) appelée TICK_MINUTES fois, pour que le comptage reste juste.
// deno-lint-ignore no-explicit-any
async function addMinutes(admin: any, me: string): Promise<{ month_minutes: number; day_minutes: number } | null> {
  const r = await admin.rpc("mr_talkie_add", { p_user: me, p_minutes: TICK_MINUTES });
  let res = r;
  if (r.error && (r.error.code === "PGRST202" || r.error.code === "42883")) {
    for (let i = 0; i < TICK_MINUTES; i++) {
      res = await admin.rpc("mr_talkie_tick", { p_user: me });
      if (res.error) break;
    }
  }
  if (res.error) { console.error("talkie tick", res.error.message); return null; }
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  return row ? { month_minutes: Number(row.month_minutes), day_minutes: Number(row.day_minutes) } : null;
}
// Réponse « quota atteint » (code 200, pour que l'app la lise) : l'app coupe le direct et repasse en messages vocaux.
const quotaStop = () => json({ ok: false, why: "quota", stop: true });

let lastPurge = 0;
// Efface physiquement les messages de plus de 24 h : fichiers (API Storage), puis lignes. Sans Cloudflare.
// deno-lint-ignore no-explicit-any
async function purge(admin: any) {
  if (Date.now() - lastPurge < 5 * 60 * 1000) return { removed: 0, skipped: true };
  lastPurge = Date.now();
  const { data: rows } = await admin.from("talkie_messages").select("id,path")
    .lt("expires_at", new Date().toISOString()).limit(300);
  const list = (rows || []) as { id: string; path: string }[];
  let removed = 0;
  if (list.length) {
    const { error } = await admin.storage.from(BUCKET).remove(list.map((x) => x.path));
    if (error) { console.error("talkie purge storage", error.message); return { removed: 0, error: true }; }
    await admin.from("talkie_messages").delete().in("id", list.map((x) => x.id));
    removed = list.length;
  }
  // sessions Cloudflare anciennes (le registre ne sert qu'à vérifier les droits de lecture)
  await admin.from("talkie_live").delete().lt("created_at", new Date(Date.now() - 12 * 3600 * 1000).toISOString());
  return { removed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, why: "methode" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const raw = await req.text();
    if (raw.length > 80000) return json({ ok: false, why: "gros" }, 413);
    let b: Obj = {};
    try { b = raw ? JSON.parse(raw) : {}; } catch { return json({ ok: false, why: "json" }, 400); }
    const action = String(b.action || "");

    // Tâche planifiée (pg_cron) : appelée avec la clé de service ; n'efface que ce qui a plus de 24 h
    if (action === "purge" && jwt && jwt === service) return json({ ok: true, ...(await purge(admin)) });

    // 1) Qui est-ce ?
    const { data: ud, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !ud?.user) return json({ ok: false, why: "nouser" }, 401);
    const me = ud.user.id;

    // Purge lancée par un téléphone connecté : même effet, limité à 1 fois / 5 min par instance
    if (action === "purge") return json({ ok: true, ...(await purge(admin)) });

    const configured = !!(Deno.env.get("CF_REALTIME_APP_ID") && Deno.env.get("CF_REALTIME_APP_SECRET"));

    // 2) A-t-il le droit d'entrer dans ce canal ? (même règle SQL que les messages vocaux)
    const m = CHANNEL_RE.exec(String(b.channel || ""));
    if (!m) return json({ ok: false, why: "canal" });
    const channel = (m[1] + ":" + m[2]).toLowerCase();
    const asUser = createClient(url, anon, { global: { headers: { Authorization: "Bearer " + jwt } }, auth: { persistSession: false } });
    const { data: can, error: ce } = await asUser.rpc("mr_talkie_can", {
      p_group: m[1] === "g" ? m[2] : null,
      p_ride: m[1] === "r" ? m[2] : null,
    });
    if (ce || can !== true) return json({ ok: false, why: "droit" }, 403);

    // « join » : l'app demande si le direct est disponible. Pas configuré = réponse normale (mode B).
    if (action === "join") {
      if (!configured) return json({ ok: true, configured: false });
      // Quota : si le compteur est illisible (script non appliqué…), on refuse le direct par prudence (pas de facture surprise)
      if (!(await quotaOk(admin, me))) return json({ ok: true, configured: false, quota: true });
      return json({ ok: true, configured: true, tickMs: TICK_MINUTES * 60000, iceServers: await iceServers() }); // test-71 : le téléphone compte au rythme du serveur
    }
    if (!configured) return json({ ok: false, why: "nocf" });

    // Nouvelle session Cloudflare (une par téléphone et par canal)
    if (action === "session") {
      const since = new Date(Date.now() - 3600 * 1000).toISOString();
      const { count } = await admin.from("talkie_live").select("session_id", { count: "exact", head: true })
        .eq("user_id", me).gt("created_at", since);
      if ((count || 0) >= MAX_SESSIONS_PER_HOUR) return json({ ok: false, why: "limite" });
      // A5 : quota revérifié à la création de la session (le « join » a pu être fait longtemps avant)
      if (!(await quotaOk(admin, me))) return quotaStop();
      const j = await cf("POST", "/sessions/new");
      if (j.errorCode || typeof j.sessionId !== "string") return cfFail(j);
      await admin.from("talkie_live").insert({ session_id: j.sessionId, channel, user_id: me });
      return json({ ok: true, sessionId: j.sessionId });
    }

    // Toutes les autres actions travaillent sur LA session de l'utilisateur dans CE canal
    const sid = String(b.sessionId || "");
    if (!SID_RE.test(sid)) return json({ ok: false, why: "session" });
    const { data: own } = await admin.from("talkie_live").select("session_id")
      .eq("session_id", sid).eq("user_id", me).eq("channel", channel).maybeSingle();
    if (!own) return json({ ok: false, why: "session" }, 403);

    // TICK_MINUTES (5) minutes de direct de plus : appelé dès la connexion puis toutes les 5 minutes par le téléphone
    // tant que le direct est connecté. Compteur illisible = stop (prudence).
    if (action === "tick") {
      const row = await addMinutes(admin, me);
      const stop = !row || row.month_minutes >= MONTH_MINUTES || row.day_minutes >= DAY_MINUTES;
      return json({ ok: true, stop, every: TICK_MINUTES });
    }

    if (action === "push") {                 // publier SA piste micro
      const offer = sdp(b.offer, "offer");
      const t = Array.isArray(b.tracks) ? (b.tracks as Obj[]).slice(0, 2) : [];
      if (!offer || !t.length || !t.every((x) => TRACK_RE.test(String(x.trackName)) && MID_RE.test(String(x.mid)))) return json({ ok: false, why: "param" });
      const j = await cf("POST", `/sessions/${sid}/tracks/new`, {
        sessionDescription: offer,
        tracks: t.map((x) => ({ location: "local", mid: String(x.mid), trackName: String(x.trackName) })),
      });
      if (j.errorCode) return cfFail(j);
      return json({ ok: true, sessionDescription: j.sessionDescription, tracks: j.tracks, requiresImmediateRenegotiation: !!j.requiresImmediateRenegotiation });
    }

    if (action === "pull") {                 // écouter la piste d'un autre membre DU MÊME canal
      const r = (b.remote || {}) as Obj;
      const rsid = String(r.sessionId || ""), rtn = String(r.trackName || "");
      if (!SID_RE.test(rsid) || !TRACK_RE.test(rtn) || rsid === sid) return json({ ok: false, why: "param" });
      const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
      const { data: tgt } = await admin.from("talkie_live").select("session_id")
        .eq("session_id", rsid).eq("channel", channel).gt("created_at", since).maybeSingle();
      if (!tgt) return json({ ok: false, why: "cible" });
      // A5 : quota revérifié à chaque écoute d'un autre membre (chaque piste écoutée consomme du trafic Cloudflare)
      if (!(await quotaOk(admin, me))) return quotaStop();
      const j = await cf("POST", `/sessions/${sid}/tracks/new`, { tracks: [{ location: "remote", sessionId: rsid, trackName: rtn }] });
      if (j.errorCode) return cfFail(j);
      return json({ ok: true, sessionDescription: j.sessionDescription, tracks: j.tracks, requiresImmediateRenegotiation: !!j.requiresImmediateRenegotiation });
    }

    if (action === "renegotiate") {          // réponse du téléphone à l'offre de Cloudflare
      const answer = sdp(b.answer, "answer");
      if (!answer) return json({ ok: false, why: "param" });
      const j = await cf("PUT", `/sessions/${sid}/renegotiate`, { sessionDescription: answer });
      if (j.errorCode) return cfFail(j);
      return json({ ok: true });
    }

    if (action === "close") {                // fermer des pistes (membre parti)
      const offer = sdp(b.offer, "offer");
      const mids = Array.isArray(b.mids) ? (b.mids as unknown[]).map(String).filter((x) => MID_RE.test(x)).slice(0, 8) : [];
      if (!offer || !mids.length) return json({ ok: false, why: "param" });
      const j = await cf("PUT", `/sessions/${sid}/tracks/close`, { tracks: mids.map((mid) => ({ mid })), sessionDescription: offer, force: false });
      if (j.errorCode) return cfFail(j);
      return json({ ok: true, sessionDescription: j.sessionDescription });
    }

    return json({ ok: false, why: "action" });
  } catch (e) {
    console.error("talkie", e);
    return json({ ok: false, why: "erreur" });
  }
});
