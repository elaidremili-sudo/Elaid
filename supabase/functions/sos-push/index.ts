// MotoRoute – sos-push (20/10/2026, sirène app fermée le 22/10 : test-47)
// Envoie une notification d'urgence (sirène + lecture vocale à l'ouverture) aux anges gardiens
// du motard et aux membres actifs de ses groupes, via Firebase Cloud Messaging (gratuit).
// Secret requis : FCM_SERVICE_ACCOUNT = contenu complet du fichier JSON « clé de compte de service » Firebase.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const T = {
  fr: { t: "🚨 MotoRoute : chute de {n}", tt: "🧪 TEST MotoRoute : {n}", b: "Touche pour voir sa position.",
        s: "Alerte MotoRoute. {n} a fait une chute à moto et ne répond plus. Ouvre MotoRoute pour voir sa position." },
  ar: { t: "🚨 موتوروت: سقوط {n}", tt: "🧪 تجربة موتوروت: {n}", b: "المس لرؤية موقعه.",
        s: "تنبيه موتوروت. {n} سقط بالدراجة النارية ولا يرد. افتح موتوروت لرؤية موقعه." },
  en: { t: "🚨 MotoRoute: {n} has crashed", tt: "🧪 MotoRoute TEST: {n}", b: "Tap to see the location.",
        s: "MotoRoute alert. {n} has crashed on a motorcycle and is not answering. Open MotoRoute to see the location." },
};

// ---- Jeton d'accès Google à partir de la clé de compte de service ----
let cached: { tok: string; exp: number } | null = null;
const b64u = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function googleToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp > now + 60) return cached.tok;
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\\n/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claim));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + head + "." + claim + "." + b64u(sig),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("google-token: " + (j.error_description || j.error || r.status));
  cached = { tok: j.access_token, exp: now + (j.expires_in || 3600) };
  return cached.tok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, why: "methode" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: ud, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !ud?.user) return json({ ok: false, why: "nouser" }, 401);
    const me = ud.user.id;

    const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!raw) return json({ ok: false, why: "nofcm" });
    // Collé depuis un Google Doc : guillemets « intelligents » et \_ possibles
    let sa;
    try { sa = JSON.parse(raw); } catch {
      sa = JSON.parse(raw.replace(/[“”]/g, '"').replace(/\\_/g, "_").replace(/\\\\n/g, "\\n"));
    }

    const b = await req.json().catch(() => ({}));
    const test = b.test === true;
    // 22/10 (test-48) : test de réception sur son propre téléphone (diagnostic, n'alerte personne d'autre)
    const self = b.self === true;
    const msg = String(b.msg || "").slice(0, 400);
    const lat = Number.isFinite(+b.lat) ? String(+b.lat) : "";
    const lng = Number.isFinite(+b.lng) ? String(+b.lng) : "";
    const say = String(b.say || "").slice(0, 900);

    // Anti-abus : 6 alertes maximum par tranche de 10 minutes
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin.from("sos_push_log").select("*", { count: "exact", head: true }).eq("user_id", me).gte("at", since);
    if ((count || 0) >= 6) return json({ ok: false, why: "trop" });

    const { data: prof } = await admin.from("profiles").select("first_name").eq("id", me).maybeSingle();
    const name = String(prof?.first_name || "Motard").slice(0, 40);

    // Destinataires : anges gardiens + membres actifs de mes groupes actifs
    const ids = new Set<string>();
    const { data: gs } = await admin.from("guardians").select("guardian_id").eq("rider_id", me);
    for (const g of gs || []) ids.add(g.guardian_id);
    const nGuard = ids.size;
    const { data: mine } = await admin.from("group_members").select("group_id,status").eq("user_id", me);
    const groups = (mine || []).filter((m) => (m.status || "active") === "active").map((m) => m.group_id);
    if (groups.length) {
      const { data: mem } = await admin.from("group_members").select("user_id,status").in("group_id", groups);
      for (const m of mem || []) if ((m.status || "active") === "active") ids.add(m.user_id);
    }
    ids.delete(me);
    if (self) { ids.clear(); ids.add(me); }
    const list = [...ids].slice(0, 300);
    if (!list.length) {
      await admin.from("sos_push_log").insert({ user_id: me, sent: 0 });
      return json({ ok: true, recipients: 0, sent: 0, guardians: nGuard });
    }
    const { data: toks } = await admin.from("push_tokens").select("user_id,token,lang").in("user_id", list);

    const access = await googleToken(sa);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
    let sent = 0;
    const dead: string[] = [];
    const errs: string[] = [];
    await Promise.all((toks || []).map(async (t) => {
      const lg = ["fr", "ar", "en"].includes(t.lang) ? t.lang : "fr";
      const L = (T as Record<string, { t: string; tt: string; b: string; s: string }>)[lg];
      const title = (test ? L.tt : L.t).replace("{n}", name);
      const body = msg || L.b;
      const speak = say || L.s.replace("{n}", name);
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token: t.token,
            // 22/10 (test-47) : message « données seules » prioritaire. Avant, la partie « notification » était affichée
            // par Android lui-même quand l'app était fermée → simple notification, sans sirène. Maintenant le service
            // MrSosService de l'app le reçoit même app fermée et joue la sirène sur le canal alarme.
            // "from" est un mot réservé par Firebase (refus « Invalid data payload key: from ») → "who"
            data: { type: "sos", uid: me, self: self ? "1" : "0", who: name, msg, lat, lng, test: test ? "1" : "0", say: speak, title, body, lang: lg, at: String(Date.now()) },
            android: { priority: "HIGH", ttl: "3600s" },
          },
        }),
      });
      if (r.ok) sent++;
      else {
        // 22/10 (test-45) : avant, toute erreur INVALID_ARGUMENT/NOT_FOUND effaçait le jeton du téléphone,
        // même quand le problème venait du message → les 2 jetons ont été effacés. Maintenant on n'efface
        // que si Google dit clairement que le jeton n'existe plus (UNREGISTERED), et on garde l'erreur exacte.
        const e = await r.json().catch(() => ({}));
        const code = JSON.stringify(e);
        const ec = (e?.error?.details || []).map((d: { errorCode?: string }) => d?.errorCode).filter(Boolean).join(",");
        errs.push(`${r.status} ${ec || e?.error?.status || ""} ${String(e?.error?.message || "").slice(0, 120)}`);
        console.error("FCM", r.status, code.slice(0, 500));
        if (/UNREGISTERED/.test(ec) || /not a valid FCM registration token/i.test(code)) dead.push(t.user_id);
      }
    }));
    if (dead.length) await admin.from("push_tokens").delete().in("user_id", dead);
    await admin.from("sos_push_log").insert({ user_id: me, sent });
    return json({ ok: true, recipients: list.length, withApp: (toks || []).length, sent, guardians: nGuard, errors: errs.slice(0, 3), dead: dead.length });
  } catch (e) {
    return json({ ok: false, why: "erreur", detail: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
