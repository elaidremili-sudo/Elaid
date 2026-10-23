// MotoRoute – sos-push (20/10/2026, sirène app fermée le 22/10 : test-47, sécurité 23/10)
// 23/10 : le texte affiché et lu à voix haute est rédigé ICI par le serveur (avant, le téléphone pouvait
// envoyer n'importe quel texte → risque de fausses alertes). Limite : 5 alertes par heure vers les autres.
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
        tp: "TEST (pas un vrai accident) : ", m: "🚨 {n} a fait une chute à moto et ne répond plus. Position :",
        s: "Alerte MotoRoute. {n} a fait une chute à moto et ne répond plus. Ouvre MotoRoute pour voir sa position." },
  ar: { t: "🚨 موتوروت: سقوط {n}", tt: "🧪 تجربة موتوروت: {n}", b: "المس لرؤية موقعه.",
        tp: "تجربة (ليست حادثًا حقيقيًا): ", m: "🚨 {n} سقط بالدراجة النارية ولا يرد. الموقع:",
        s: "تنبيه موتوروت. {n} سقط بالدراجة النارية ولا يرد. افتح موتوروت لرؤية موقعه." },
  en: { t: "🚨 MotoRoute: {n} has crashed", tt: "🧪 MotoRoute TEST: {n}", b: "Tap to see the location.",
        tp: "TEST (not a real accident): ", m: "🚨 {n} has crashed on a motorcycle and is not answering. Location:",
        s: "MotoRoute alert. {n} has crashed on a motorcycle and is not answering. Open MotoRoute to see the location." },
};

// 23/10 : texte lu à voix haute, rédigé par le serveur dans la langue de celui qui reçoit
// (même contenu que voiceTxt() dans l'app : nom de la fiche d'urgence, moto, coordonnées chiffre par chiffre)
function voice(lg: string, test: boolean, nm: string, mo: string, lat: string, lng: string) {
  const dig = (v: string) => {
    const [a, b] = Math.abs(+v).toFixed(4).split(".");
    return a + (lg === "ar" ? " فاصلة " : lg === "en" ? " point " : " virgule ") + b.split("").join(", ");
  };
  const ll = lat !== "" && lng !== "";
  if (lg === "ar") return (test ? "هذه تجربة، ليست حادثًا حقيقيًا. " : "") + "تنبيه من موتوروت. رسالة آلية. " + nm +
    (mo ? " على دراجة " + mo : "") + " سقط بالدراجة النارية ولا يرد منذ دقيقتين. يحتاج إلى مساعدة. " +
    (ll ? "الإحداثيات: " + dig(lat) + (+lat < 0 ? " جنوبًا، " : " شمالًا، ") + dig(lng) + (+lng < 0 ? " غربًا. " : " شرقًا. ") : "") + "أكرر. ";
  if (lg === "en") return (test ? "This is a test, not a real accident. " : "") + "MotoRoute alert. Automatic message. " + nm +
    (mo ? ", riding a " + mo + "," : "") + " has crashed on a motorcycle and has not answered for two minutes. Help is needed. " +
    (ll ? "GPS coordinates: " + dig(lat) + (+lat < 0 ? " south, " : " north, ") + dig(lng) + (+lng < 0 ? " west. " : " east. ") : "") + "I repeat. ";
  return (test ? "Ceci est un test, ce n’est pas un vrai accident. " : "") + "Alerte MotoRoute. Message automatique. " + nm +
    (mo ? ", sur sa moto " + mo + "," : "") + " a fait une chute à moto et ne répond plus depuis deux minutes. Il a besoin d’aide. " +
    (ll ? "Coordonnées GPS : " + dig(lat) + (+lat < 0 ? " sud, " : " nord, ") + dig(lng) + (+lng < 0 ? " ouest. " : " est. ") : "") + "Je répète. ";
}

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
    // 23/10 : on ignore b.msg et b.say (texte libre). Seules la position (nombres) et les cases test/self comptent.
    const okLat = typeof b.lat === "number" && Number.isFinite(b.lat) && Math.abs(b.lat) <= 90;
    const okLng = typeof b.lng === "number" && Number.isFinite(b.lng) && Math.abs(b.lng) <= 180;
    const lat = okLat && okLng ? (+b.lat).toFixed(5) : "";
    const lng = okLat && okLng ? (+b.lng).toFixed(5) : "";
    const kind = self ? "self" : test ? "test" : "real";

    // Anti-abus : essai sur son propre téléphone = 6 par 10 min ; alertes vers les autres = 5 par heure
    const since = new Date(Date.now() - (self ? 10 : 60) * 60 * 1000).toISOString();
    let q = admin.from("sos_push_log").select("*", { count: "exact", head: true }).eq("user_id", me).gte("at", since);
    q = self ? q.eq("kind", "self") : q.neq("kind", "self");
    const { count } = await q;
    if ((count || 0) >= (self ? 6 : 5)) return json({ ok: false, why: "trop" });

    const { data: prof } = await admin.from("profiles").select("first_name,moto").eq("id", me).maybeSingle();
    const { data: ice } = await admin.from("emergency_cards").select("full_name").eq("user_id", me).maybeSingle();
    const name = String(prof?.first_name || "").trim().slice(0, 40) || "Motard";
    const fullName = String(ice?.full_name || "").trim().slice(0, 60) || name;
    const moto = String(prof?.moto || "").trim().slice(0, 40);

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
      await admin.from("sos_push_log").insert({ user_id: me, sent: 0, kind });
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
      const L = (T as Record<string, { t: string; tt: string; b: string; s: string; tp: string; m: string }>)[lg];
      const title = (test ? L.tt : L.t).replace("{n}", name);
      const map = lat ? "https://maps.google.com/?q=" + lat + "," + lng : "";
      const msg = ((test ? L.tp : "") + L.m.replace("{n}", fullName) + (map ? " " + map : "")).trim();
      const body = test ? L.tp + L.b : L.b;
      const speak = voice(lg, test, fullName, moto, lat, lng);
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
    await admin.from("sos_push_log").insert({ user_id: me, sent, kind });
    return json({ ok: true, recipients: list.length, withApp: (toks || []).length, sent, guardians: nGuard, errors: errs.slice(0, 3), dead: dead.length });
  } catch (e) {
    return json({ ok: false, why: "erreur", detail: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
