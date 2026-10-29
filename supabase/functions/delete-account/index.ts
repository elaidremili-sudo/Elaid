// MotoRoute – delete-account (test-67, 29/10/2026)
// « Supprimer mon compte » complet :
//   1) appelle delete_my_account() AVEC le jeton de l'utilisateur (c'est lui, et lui seul, qui est effacé) ;
//      cette fonction SQL efface les lignes et met ses photos dans la file public.mr_storage_purge ;
//   2) efface ces photos du stockage Supabase par l'API Storage (Supabase interdit de les effacer en SQL).
// Si l'étape 2 échoue (réseau…), les photos restent dans la file : le prochain appel (de n'importe quel
// compte qui se supprime, ou un appel manuel du propriétaire avec la clé service_role) les efface.
// Aucun secret supplémentaire : SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Vide la file des photos à effacer (par paquets, buckets connus seulement)
async function purgeStorage(admin: ReturnType<typeof createClient>) {
  const BUCKETS = ["place-photos", "annonce-photos", "partner-photos"];
  let removed = 0;
  for (let round = 0; round < 10; round++) {
    const { data: rows, error } = await admin.from("mr_storage_purge")
      .select("id,bucket_id,name,tries").lt("tries", 20).order("id").limit(100);
    if (error || !rows || !rows.length) break;
    const byBucket = new Map<string, { id: number; name: string; tries: number }[]>();
    for (const r of rows) {
      if (!BUCKETS.includes(r.bucket_id)) { await admin.from("mr_storage_purge").delete().eq("id", r.id); continue; }
      const l = byBucket.get(r.bucket_id) || [];
      l.push(r); byBucket.set(r.bucket_id, l);
    }
    for (const [bucket, list] of byBucket) {
      const { error: re } = await admin.storage.from(bucket).remove(list.map((x) => x.name));
      if (re) {
        console.error("delete-account storage", bucket, re.message);
        for (const x of list) await admin.from("mr_storage_purge").update({ tries: x.tries + 1, last_error: String(re.message).slice(0, 200) }).eq("id", x.id);
      } else {
        // remove() ne signale pas un fichier déjà absent : dans les deux cas, c'est fini pour lui
        await admin.from("mr_storage_purge").delete().in("id", list.map((x) => x.id));
        removed += list.length;
      }
    }
    if (rows.length < 100) break;
  }
  const { count } = await admin.from("mr_storage_purge").select("*", { count: "exact", head: true });
  return { removed, left: count || 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, why: "methode" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "");

    // Appel de maintenance par le propriétaire (clé service_role) : seulement vider la file
    if (jwt && jwt === service) return json({ ok: true, purge: await purgeStorage(admin) });

    // L'identité vient uniquement du jeton de connexion (jamais du corps de la requête)
    const { data: ud, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !ud?.user) return json({ ok: false, why: "nouser" }, 401);

    // Client « au nom de l'utilisateur » : auth.uid() dans delete_my_account() = cet utilisateur
    const asUser = createClient(url, anonKey, { global: { headers: { Authorization: "Bearer " + jwt } }, auth: { persistSession: false } });
    const { error: de } = await asUser.rpc("delete_my_account");
    if (de) {
      console.error("delete-account rpc", de.message);
      return json({ ok: false, why: "sql", detail: String(de.message).slice(0, 200) }, 500);
    }
    let purge = { removed: 0, left: -1 };
    try { purge = await purgeStorage(admin); } catch (e) { console.error("delete-account purge", String(e)); }
    return json({ ok: true, purge });
  } catch (e) {
    console.error("delete-account", String((e as Error)?.message || e).slice(0, 300));
    return json({ ok: false, why: "erreur" }, 500);
  }
});
