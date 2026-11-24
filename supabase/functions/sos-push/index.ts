// MotoRoute – sos-push (24/11 : lectures et envoi Firebase vérifiés, voir « 24/11 » plus bas ; 07/11 : plafond recompté après réservation ; 20/10/2026, sirène app fermée le 22/10 : test-47, sécurité 23/10)
// Règle d'or depuis le 24/11 : AVANT la 1re sirène partie, toute panne → 500 (le téléphone garde l'alerte et la renvoie
// avec le même « aid ») ; APRÈS la 1re sirène partie, jamais de 500 (sinon le renvoi refait sonner les mêmes téléphones).
// 29/10 (test-67) : identifiant d'alerte « aid » → pas de doublon quand le téléphone renvoie l'alerte après une coupure réseau.
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

// 24/11 : une lecture de la base qui échoue ne doit plus donner « ok, 0 destinataire » (alerte perdue sans bruit,
// le téléphone la retirait de sa file). On réessaie une fois tout de suite ; si ça échoue encore, erreur 500 :
// le téléphone garde l'alerte dans sa file et la renvoie (5 s, 15 s, 30 s, 60 s… pendant 2 h) avec le même
// identifiant (aid), donc sans doublon ; la ligne réservée du journal est effacée dans le catch.
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => String((e as { message?: string })?.message || e).slice(0, 200);
type Res<D> = { data: D; error: unknown };
// « again » : réessayer pour cette erreur ? (inutile quand une fonction ou une colonne n'existe pas)
async function twice<D>(run: () => PromiseLike<Res<D>>, again: (e: unknown) => boolean = () => true): Promise<Res<D>> {
  let r = await run();
  if (r.error && again(r.error)) { await pause(400); r = await run(); }
  return r;
}
async function must<D>(label: string, run: () => PromiseLike<Res<D>>): Promise<D> {
  const r = await twice(run);
  if (r.error) throw new Error(label + ": " + errMsg(r.error));
  return r.data;
}
// Lecture « de confort » (nom affiché, mode dégradé) : ne bloque jamais la sirène, mais laisse une trace dans les journaux.
async function soft<D>(label: string, run: () => PromiseLike<Res<D>>, miss?: string[]): Promise<D | null> {
  const r = await twice(run);
  if (r.error) { console.error("sos-push lecture", label, errMsg(r.error)); miss?.push(label); return null; }
  return r.data;
}
const code = (e: unknown) => String((e as { code?: string })?.code || "");
// La fonction SQL mr_sos_siren_groups n'existe pas (script securite-31-10.sql pas passé) : seul cas où l'ancien calcul sert.
const fnMissing = (e: unknown) =>
  code(e) === "PGRST202" || code(e) === "42883" || /could not find the function|function .* does not exist/i.test(errMsg(e));
// Colonne client_id / done / recipients absente (script test-67.sql pas passé) : seul cas où l'on renonce à l'anti-doublon.
const colMissing = (e: unknown) =>
  code(e) === "42703" || code(e) === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(errMsg(e));

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
    signal: AbortSignal.timeout(5000), // 24/11 : jamais d'attente sans fin
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
  // test-67 : ligne de journal réservée pour cette alerte ; effacée si l'envoi plante, pour qu'un renvoi soit possible
  let reserved: number | null = null;
  let adminRef: ReturnType<typeof createClient> | null = null;
  let sentAny = false; // 24/11 : au moins une sirène est partie → plus jamais de 500 pour cette alerte
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    adminRef = admin;
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: ud, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !ud?.user) return json({ ok: false, why: "nouser" }, 401);
    const me = ud.user.id;

    const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    // 24/11 : 503 et trace dans les journaux (avant : 200 muet) ; à partir de test-111 le téléphone garde l'alerte en file
    if (!raw) { console.error("sos-push : secret FCM_SERVICE_ACCOUNT absent"); return json({ ok: false, why: "nofcm" }, 503); }
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
    // 24/11 : « try » = nombre de pannes du SERVEUR (5xx) déjà vues par le téléphone pour cette alerte (test-111 et suivantes ;
    // les coupures réseau ne comptent pas). À partir de 2, mode dégradé : si une source reste en panne, la sirène part
    // vers ceux qu'on a pu lire (avant : tout ou rien pendant 2 h).
    // Ce nombre ne peut que RÉDUIRE la liste des destinataires (jamais l'ancien calcul des groupes) : aucun risque d'abus.
    const tries = typeof b.try === "number" && Number.isFinite(b.try) ? Math.floor(b.try) : 0;
    const degrade = !self && tries >= 2;
    const miss: string[] = [];

    // test-67 : identifiant unique de l'alerte (aid), créé par le téléphone et gardé dans sa file d'attente.
    // Si le téléphone renvoie la même alerte (réseau coupé pendant la réponse), on ne la renvoie pas une 2e fois.
    // L'expéditeur est TOUJOURS celui du jeton de connexion (me) : aucun identifiant du corps n'est utilisé.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let aid: string | null = !self && typeof b.aid === "string" && UUID.test(b.aid) ? b.aid.toLowerCase() : null;
    if (aid) {
      const pv = await twice(() => admin.from("sos_push_log")
        .select("id,sent,recipients,done,at").eq("user_id", me).eq("client_id", aid).maybeSingle(), (e) => !colMissing(e));
      // 24/11 : on ne renonce à l'anti-doublon que si la colonne manque (avant : sur n'importe quelle erreur → 2e sonnerie possible)
      if (pv.error) { if (colMissing(pv.error)) aid = null; else throw new Error("sos_push_log (aid): " + errMsg(pv.error)); }
      else if (pv.data) {
        const prev = pv.data as { id: number; sent: number; recipients: number | null; done: boolean; at: string };
        if (prev.done) return json({ ok: true, dup: true, recipients: prev.recipients ?? prev.sent, sent: prev.sent });
        // envoi encore en cours (autre essai parallèle) : le téléphone réessaiera un peu plus tard
        if (Date.now() - new Date(prev.at).getTime() < 90_000) return json({ ok: false, why: "encours" });
        await must("sos_push_log (ancien essai)", () => admin.from("sos_push_log").delete().eq("id", prev.id)); // essai précédent planté : on le refait
      }
    }

    // Anti-abus : essai sur son propre téléphone = 6 par 10 min ; vraies alertes = 5 par heure ; essais chez les autres = 3 par heure.
    // 24/11 : chaque sorte a son propre compteur (avant : 5 « Tester la sirène chez eux » bloquaient une vraie chute pendant 1 h) ;
    // essais limités à 3 pour qu'un membre ne reçoive pas plus de 8 sirènes par heure d'un même motard (avant : 5).
    // Si le décompte échoue, on laisse passer (un SOS ne doit pas être bloqué par une panne), mais on le note.
    const since = new Date(Date.now() - (self ? 10 : 60) * 60 * 1000).toISOString();
    const cap = self ? 6 : test ? 3 : 5;
    const countKind = async () => {
      const r = await admin.from("sos_push_log").select("*", { count: "exact", head: true }).eq("user_id", me).eq("kind", kind).gte("at", since);
      if (r.error) console.error("sos-push décompte", errMsg(r.error));
      return r.count || 0;
    };
    if ((await countKind()) >= cap) return json({ ok: false, why: "trop", max: cap });

    // test-67 : on réserve la ligne du journal AVANT d'envoyer (compte dans la limite, bloque les doublons)
    let logId: number | null = null;
    if (aid) {
      const { data: rv, error: re } = await admin.from("sos_push_log")
        .insert({ user_id: me, sent: 0, kind, client_id: aid, done: false }).select("id").single();
      if (re) {
        if (code(re) === "23505") return json({ ok: false, why: "encours" });
        if (colMissing(re)) aid = null;
        else throw new Error("sos_push_log (réservation): " + errMsg(re)); // rien n'est parti : le téléphone renverra
      } else logId = rv.id;
    }
    reserved = logId;
    // 07/11 : plafond sûr même avec des envois simultanés. Chaque alerte est d'abord réservée dans le journal,
    // puis on recompte : si la réservation dépasse le plafond, on l'annule (avant, le compte était fait avant la réservation).
    if (logId != null && (await countKind()) > cap) {
      await admin.from("sos_push_log").delete().eq("id", logId);
      reserved = null;
      return json({ ok: false, why: "trop", max: cap });
    }
    const writeLog = async (sent: number, recipients: number) => {
      // 24/11 : vérifié et réessayé une fois (avant : une ligne restée « en cours » laissait un renvoi refaire sonner après 90 s)
      const r = logId != null
        ? await twice(() => admin.from("sos_push_log").update({ sent, recipients, done: true, at: new Date().toISOString() }).eq("id", logId))
        : await twice(() => admin.from("sos_push_log").insert({ user_id: me, sent, kind }));
      if (r.error) console.error("sos-push journal", errMsg(r.error));
      reserved = null;
    };

    // Nom affiché et lu : une panne ici ne bloque jamais la sirène (« Motard » par défaut), mais elle est notée.
    const prof = await soft("profiles", () => admin.from("profiles").select("first_name,moto").eq("id", me).maybeSingle());
    const ice = await soft("emergency_cards", () => admin.from("emergency_cards").select("full_name").eq("user_id", me).maybeSingle());
    const name = String((prof as { first_name?: string } | null)?.first_name || "").trim().slice(0, 40) || "Motard";
    const fullName = String((ice as { full_name?: string } | null)?.full_name || "").trim().slice(0, 60) || name;
    const moto = String((prof as { moto?: string } | null)?.moto || "").trim().slice(0, 40);

    // Destinataires : anges gardiens + membres actifs de mes groupes actifs
    // 24/11 : en mode dégradé (3e essai et plus), une source en panne est sautée au lieu de tout bloquer.
    const read = <D>(label: string, run: () => PromiseLike<Res<D>>) => (degrade ? soft(label, run, miss) : must(label, run));
    const ids = new Set<string>();
    let nGuard = 0;
    if (self) ids.add(me); // 24/11 : l'essai sur son propre téléphone ne lit plus les groupes (une panne sans rapport le cassait)
    else {
      const gs = await read("guardians", () => admin.from("guardians").select("guardian_id").eq("rider_id", me));
      for (const g of (gs as { guardian_id: string }[] | null) || []) ids.add(g.guardian_id);
      nGuard = ids.size;
      // test-71 (B3) : groupes que ce membre a le droit de faire sonner (anti-spam des groupes publics, securite-31-10.sql).
      // Si la fonction n'existe pas encore sur la base, on garde l'ancien calcul.
      // 24/11 : une autre erreur (panne passagère) n'utilise plus l'ancien calcul, qui contournait le blocage 24 h des groupes publics.
      let groups: string[] = [];
      const sg = await twice(() => admin.rpc("mr_sos_siren_groups", { p_user: me }), (e) => !fnMissing(e));
      if (!sg.error && Array.isArray(sg.data)) {
        groups = sg.data.map((x: unknown) => (typeof x === "string" ? x : (x as Record<string, string>)?.mr_sos_siren_groups)).filter(Boolean);
      } else if (sg.error && !fnMissing(sg.error)) {
        if (!degrade) throw new Error("mr_sos_siren_groups: " + errMsg(sg.error));
        console.error("sos-push lecture mr_sos_siren_groups", errMsg(sg.error)); miss.push("mr_sos_siren_groups"); // anges gardiens seuls
      } else {
        const mine = await read("group_members (mes groupes)", () => admin.from("group_members").select("group_id,status").eq("user_id", me));
        groups = ((mine as { group_id: string; status: string | null }[] | null) || []).filter((m) => (m.status || "active") === "active").map((m) => m.group_id);
      }
      if (groups.length) {
        const mem = await read("group_members", () => admin.from("group_members").select("user_id,status").in("group_id", groups));
        for (const m of (mem as { user_id: string; status: string | null }[] | null) || []) if ((m.status || "active") === "active") ids.add(m.user_id);
      }
      ids.delete(me);
    }
    const list = [...ids].slice(0, 300);
    if (!list.length) {
      // Personne à prévenir. Si c'est à cause d'une source en panne (mode dégradé), on renvoie une erreur pour réessayer.
      if (miss.length) throw new Error("aucun destinataire lisible (" + miss.join(", ") + ")");
      await writeLog(0, 0);
      return json({ ok: true, recipients: 0, sent: 0, guardians: nGuard });
    }
    const toks = (await must("push_tokens", () => admin.from("push_tokens").select("user_id,token,lang").in("user_id", list))) as
      { user_id: string; token: string; lang: string }[] | null;

    let access = await googleToken(sa);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
    let sent = 0;
    const dead: string[] = [];
    const errs: string[] = [];
    type Tok = { user_id: string; token: string; lang: string };
    // 24/11 : un envoi = « ok », « dead » (jeton effacé chez Google), « retry » (panne passagère : 5xx, 429, 401, réseau)
    // ou « fail » (message refusé, inutile de réessayer). Chaque jeton a son propre try/catch : une coupure vers Firebase
    // ne fait plus échouer tout l'envoi (avant : 500 après des sirènes parties → le renvoi les refaisait sonner, en boucle).
    const sendOne = async (t: Tok, tok: string): Promise<"ok" | "dead" | "retry" | "fail"> => {
      const lg = ["fr", "ar", "en"].includes(t.lang) ? t.lang : "fr";
      const L = (T as Record<string, { t: string; tt: string; b: string; s: string; tp: string; m: string }>)[lg];
      const title = (test ? L.tt : L.t).replace("{n}", name);
      const map = lat ? "https://maps.google.com/?q=" + lat + "," + lng : "";
      const msg = ((test ? L.tp : "") + L.m.replace("{n}", fullName) + (map ? " " + map : "")).trim();
      const body = test ? L.tp + L.b : L.b;
      const speak = voice(lg, test, fullName, moto, lat, lng);
      try {
        const r = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(3500), // 24/11 : une connexion qui pend ne bloque plus l'alerte (3 passages < 15 s du téléphone)
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
        if (r.ok) return "ok";
        // 22/10 (test-45) : on n'efface le jeton que si Google dit clairement qu'il n'existe plus (UNREGISTERED).
        const e = await r.json().catch(() => ({}));
        const raw = JSON.stringify(e);
        const ec = (e?.error?.details || []).map((d: { errorCode?: string }) => d?.errorCode).filter(Boolean).join(",");
        errs.push(`${r.status} ${ec || e?.error?.status || ""} ${String(e?.error?.message || "").slice(0, 120)}`);
        console.error("FCM", r.status, raw.slice(0, 500));
        if (/UNREGISTERED/.test(ec) || /not a valid FCM registration token/i.test(raw)) return "dead";
        if (r.status === 401) { cached = null; return "retry"; } // 24/11 : jeton Google refusé → on en refait un (avant : gardé 1 h)
        if (r.status === 429 || r.status >= 500) return "retry";
        return "fail";
      } catch (x) {
        errs.push("réseau " + errMsg(x));
        console.error("FCM réseau", errMsg(x));
        return "retry";
      }
    };
    // 3 passages au plus : le 2e et le 3e ne renvoient qu'aux téléphones en échec passager (jamais 2 fois au même).
    let pending: Tok[] = toks || [];
    for (let round = 0; round < 3 && pending.length; round++) {
      if (round) {
        await pause(round === 1 ? 500 : 1000);
        if (!cached) { try { access = await googleToken(sa); } catch (x) { console.error("sos-push jeton Google", errMsg(x)); } }
      }
      const res = await Promise.all(pending.map(async (t) => [t, await sendOne(t, access)] as const));
      pending = [];
      for (const [t, st] of res) {
        if (st === "ok") { sent++; sentAny = true; }
        else if (st === "dead") dead.push(t.user_id);
        else if (st === "retry") pending.push(t);
      }
    }
    // Rien n'est parti à cause d'une panne passagère de Firebase : 500, le téléphone renverra l'alerte (sans doublon possible).
    if (!sentAny && pending.length) throw new Error("fcm : aucune sirène partie (" + errs.slice(0, 2).join(" | ") + ")");
    // À partir d'ici, des sirènes sont parties : plus aucune exception ne doit remonter.
    if (dead.length) {
      try { const r = await admin.from("push_tokens").delete().in("user_id", dead); if (r.error) console.error("sos-push jetons morts", errMsg(r.error)); }
      catch (x) { console.error("sos-push jetons morts", errMsg(x)); }
    }
    try { await writeLog(sent, list.length); } catch (x) { console.error("sos-push journal", errMsg(x)); }
    const partial = [...miss, ...(pending.length ? [`fcm:${pending.length}`] : [])];
    return json({ ok: true, recipients: list.length, withApp: (toks || []).length, sent, guardians: nGuard, errors: errs.slice(0, 3), dead: dead.length, ...(partial.length ? { partial } : {}) });
  } catch (e) {
    console.error("sos-push", String((e as Error)?.message || e).slice(0, 300));
    if (sentAny) {
      // Ne devrait pas arriver (tout est protégé après l'envoi) ; par sécurité, jamais de 500 une fois une sirène partie.
      if (reserved != null && adminRef) { try { await adminRef.from("sos_push_log").update({ done: true }).eq("id", reserved); } catch { /* rien */ } }
      return json({ ok: true, partial: ["erreur-apres-envoi"] });
    }
    if (reserved != null && adminRef) {
      const del = () => adminRef!.from("sos_push_log").delete().eq("id", reserved!);
      try { const r = await del(); if (r.error) { await pause(400); await del(); } } catch { /* rien : le renvoi attendra 90 s */ }
    }
    return json({ ok: false, why: "erreur" }, 500); // 07/11 : le détail reste dans les journaux du serveur
  }
});
