// MotoRoute – partner-notify (22/10/2026, test-51)
// Prévient par notification :
//  - les administrateurs quand un partenaire envoie une publication ou de nouvelles informations à valider ;
//  - le partenaire quand un administrateur accepte ou refuse.
// Utilise le même secret FCM_SERVICE_ACCOUNT que sos-push. Message « données seules » de type "info"
// (le service Android de l'app l'affiche comme une notification normale, sans sirène).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const M = {
  fr: { pt: "🛡 MotoRoute : à valider", pb: "{p} a envoyé « {t} ». Ouvre Annonces → Publications à valider.",
        ok: "✅ MotoRoute : publication acceptée", okb: "« {t} » est maintenant visible par les membres.",
        ko: "❌ MotoRoute : publication refusée", kob: "« {t} » n'a pas été acceptée. {n}" },
  ar: { pt: "🛡 موتوروت: للمراجعة", pb: "أرسل {p} «{t}». افتح الإعلانات ← منشورات للمراجعة.",
        ok: "✅ موتوروت: تم قبول المنشور", okb: "«{t}» ظاهر الآن للأعضاء.",
        ko: "❌ موتوروت: رُفض المنشور", kob: "لم يُقبل «{t}». {n}" },
  en: { pt: "🛡 MotoRoute: to approve", pb: "{p} sent “{t}”. Open Ads → Posts to approve.",
        ok: "✅ MotoRoute: post approved", okb: "“{t}” is now visible to members.",
        ko: "❌ MotoRoute: post rejected", kob: "“{t}” was not approved. {n}" },
};

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
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: ud, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !ud?.user) return json({ ok: false, why: "nouser" }, 401);
    const me = ud.user.id;

    const b = await req.json().catch(() => ({}));
    const pid = String(b.pid || "").slice(0, 40);
    const event = b.event === "decided" ? "decided" : "pending";
    const title = String(b.title || "").slice(0, 80);
    const note = String(b.note || "").slice(0, 200);
    const { data: p } = await admin.from("partners").select("id,name,owner_id").eq("id", pid).maybeSingle();
    if (!p) return json({ ok: false, why: "partenaire" });
    const { data: adm } = await admin.from("app_admins").select("user_id");
    const admins = (adm || []).map((a) => a.user_id as string);

    // Qui a le droit de prévenir qui
    let to: string[] = [];
    if (event === "pending") {
      if (p.owner_id !== me) return json({ ok: false, why: "interdit" }, 403);
      to = admins.filter((x) => x !== me);
    } else {
      if (!admins.includes(me)) return json({ ok: false, why: "interdit" }, 403);
      if (p.owner_id && p.owner_id !== me) to = [p.owner_id];
    }
    if (!to.length) return json({ ok: true, sent: 0 });

    const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!raw) return json({ ok: false, why: "nofcm" });
    let sa;
    try { sa = JSON.parse(raw); } catch {
      sa = JSON.parse(raw.replace(/[“”]/g, '"').replace(/\\_/g, "_").replace(/\\\\n/g, "\\n"));
    }
    const { data: toks } = await admin.from("push_tokens").select("user_id,token,lang").in("user_id", to);
    const access = await googleToken(sa);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
    let sent = 0;
    await Promise.all((toks || []).map(async (t) => {
      const L = (M as Record<string, typeof M.fr>)[["fr", "ar", "en"].includes(t.lang) ? t.lang : "fr"];
      const ok = b.ok === true;
      const ttl = event === "pending" ? L.pt : ok ? L.ok : L.ko;
      const body = (event === "pending" ? L.pb : ok ? L.okb : L.kob)
        .replace("{p}", p.name).replace("{t}", title).replace("{n}", note).trim();
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { token: t.token,
          data: { type: "info", title: ttl, body, tag: "mr-partner-" + p.id, at: String(Date.now()) },
          android: { priority: "HIGH", ttl: "86400s" } } }),
      });
      if (r.ok) sent++; else console.error("FCM", r.status, (await r.text()).slice(0, 300));
    }));
    return json({ ok: true, sent });
  } catch (e) {
    return json({ ok: false, why: "erreur", detail: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
