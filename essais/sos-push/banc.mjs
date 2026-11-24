// Banc d'essai de sos-push (24/11) : base Supabase et Firebase simulées, pannes injectées, 37 cas.
// Usage (Node 22) : node --experimental-strip-types --no-warnings essais/sos-push/banc.mjs supabase/functions/sos-push/index.ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const src = process.argv[2];
const code = fs.readFileSync(src, 'utf8').replace(/^import \{ createClient \} from "jsr:@supabase\/supabase-js@2";\s*$/m, '');
if (/from "jsr:/.test(code)) throw new Error('import non retiré');
const prelude = `const createClient = (..._a) => globalThis.__mk();\n`;
const tmp = path.join(path.dirname(src), '.banc-' + path.basename(src, '.ts') + '-' + process.pid + '.ts');
fs.writeFileSync(tmp, prelude + code);

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
globalThis.__env = {
  SUPABASE_URL: 'https://exemple.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'cle',
  FCM_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'sa@exemple.iam', private_key: pem, project_id: 'motoroute-test' }),
};
globalThis.Deno = { env: { get: (k) => globalThis.__env[k] }, serve: (h) => { globalThis.__h = h; } };

let W; // état du scénario en cours
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.startsWith('https://oauth2.googleapis.com/token')) { W.oauth++; return new Response(JSON.stringify({ access_token: 'jeton' + W.oauth, expires_in: 3600 })); }
  if (url.startsWith('https://fcm.googleapis.com/')) {
    const m = JSON.parse(init.body).message; const t = m.token;
    W.calls[t] = (W.calls[t] || 0) + 1; W.titles.push(m.data.title);
    const plan = W.fcmPlan ? W.fcmPlan(t, W.calls[t], init.headers.Authorization) : 'ok';
    if (plan === 'throw') throw new TypeError('connection reset (simulée)');
    if (plan !== 'ok') return new Response(JSON.stringify(plan.body || {}), { status: plan.status });
    W.fcm.push(t); return new Response('{}');
  }
  throw new Error('fetch inattendu ' + url);
};

const ERR = { message: 'fetch failed (panne simulée)', code: '' };
const MISSING = { code: 'PGRST202', message: 'Could not find the function public.mr_sos_siren_groups(p_user) in the schema cache' };
const TRANSIENT = { code: '57014', message: 'canceling statement due to statement timeout' };

function fail(key) { if ((W.fails[key] || 0) > 0) { W.fails[key]--; W.reads[key] = (W.reads[key] || 0) + 1; return true; } W.reads[key] = (W.reads[key] || 0) + 1; return false; }

function builder(table) {
  const st = { table, op: 'select', f: {}, opts: null, single: false, row: null, sel: false };
  const b = {
    select(cols, opts) { if (st.op === 'insert') st.sel = true; else { st.op = 'select'; st.opts = opts || null; } return b; },
    eq(k, v) { st.f[k] = v; return b; }, neq(k, v) { st.f['!' + k] = v; return b; },
    in(k, v) { st.f[k] = v; return b; }, gte(k, v) { st.f['>=' + k] = v; return b; },
    maybeSingle() { st.single = true; return b; }, single() { st.single = true; return b; },
    insert(row) { st.op = 'insert'; st.row = row; return b; },
    update(row) { st.op = 'update'; st.row = row; return b; },
    delete() { st.op = 'delete'; return b; },
    then(ok, ko) { return Promise.resolve().then(() => resolve(st)).then(ok, ko); },
  };
  return b;
}
function resolve(st) {
  const { table, op, f } = st;
  if (table === 'sos_push_log') {
    if (op === 'select' && st.opts && st.opts.head) { W.countKinds.push(f.kind); return W.countErr ? { count: null, error: ERR } : { count: (W.counts[f.kind] ?? W.logCount), error: null }; }
    if (op === 'select') { if (W.lookupErr.length) return { data: null, error: W.lookupErr.shift() }; return { data: null, error: null }; }
    if (op === 'insert') { if (st.sel && W.insErr) return { data: null, error: W.insErr }; W.log.push({ insert: st.row }); return st.sel ? { data: { id: 101 }, error: null } : { data: null, error: null }; }
    if (op === 'update') { if (W.updErr > 0) { W.updErr--; return { data: null, error: ERR }; } W.log.push({ update: st.row, id: f.id }); return { data: null, error: null }; }
    if (op === 'delete') { W.log.push({ delete: f.id }); return { data: null, error: null }; }
  }
  if (table === 'profiles') return W.profErr ? { data: null, error: ERR } : { data: { first_name: 'Rider', moto: 'Z H2' }, error: null };
  if (table === 'emergency_cards') return { data: { full_name: 'Rider Essai' }, error: null };
  if (table === 'guardians') return fail('guardians') ? { data: null, error: ERR } : { data: W.guardians.map((g) => ({ guardian_id: g })), error: null };
  if (table === 'group_members' && f.user_id) return fail('gm_mine') ? { data: null, error: ERR } : { data: W.mine, error: null };
  if (table === 'group_members') return fail('gm_members') ? { data: null, error: ERR } : { data: W.members.filter((m) => f.group_id.includes(m.g)).map((m) => ({ user_id: m.u, status: m.s })), error: null };
  if (table === 'push_tokens') {
    if (op === 'delete') { if (W.tokDelErr) throw new Error('panne suppression jetons'); W.tokDel.push(...f.user_id); return { data: null, error: null }; }
    return fail('push_tokens') ? { data: null, error: ERR } : { data: W.tokens.filter((t) => f.user_id.includes(t.user_id)), error: null };
  }
  throw new Error('table inattendue ' + table + ' ' + op);
}
globalThis.__mk = () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) },
  from: (t) => builder(t),
  rpc: async (name) => {
    W.reads.rpc = (W.reads.rpc || 0) + 1;
    if (W.rpcAlways) return { data: null, error: W.rpcAlways };
    if (W.rpcErr.length) return { data: null, error: W.rpcErr.shift() };
    return { data: W.sirenGroups, error: null };
  },
});

await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);
const handler = globalThis.__h;

function world(o = {}) {
  return Object.assign({
    fails: {}, reads: {}, rpcErr: [], fcm: [], log: [], logCount: 1, counts: {}, countKinds: [], lookupErr: [], insErr: null, updErr: 0,
    oauth: 0, calls: {}, titles: [], tokDel: [], tokDelErr: false, profErr: false, fcmPlan: null, env: {},
    guardians: ['g1'], sirenGroups: ['grp1'],
    mine: [{ group_id: 'grp1', status: 'active' }, { group_id: 'grpPublicNouveau', status: 'active' }],
    members: [{ g: 'grp1', u: 'm1', s: 'active' }, { g: 'grp1', u: 'me', s: 'active' }, { g: 'grpPublicNouveau', u: 'p9', s: 'active' }],
    tokens: [{ user_id: 'g1', token: 'tok-g1', lang: 'fr' }, { user_id: 'm1', token: 'tok-m1', lang: 'en' }, { user_id: 'p9', token: 'tok-p9', lang: 'ar' }],
  }, o);
}
async function call(body) {
  const save = { ...globalThis.__env }; Object.assign(globalThis.__env, W.env);
  for (const k of Object.keys(W.env)) if (W.env[k] === undefined) delete globalThis.__env[k];
  try { return await call0(body); } finally { globalThis.__env = save; }
}
async function call0(body) {
  const req = new Request('http://local/sos-push', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify(body) });
  const r = await handler(req);
  return { status: r.status, j: await r.json() };
}
const AID = '6f1c2b0e-3a4d-4c5e-8f90-1a2b3c4d5e6f';
const reservedDeleted = () => W.log.some((x) => x.delete === 101);

const cas = [
  ['normal : ange gardien + groupe, 2 sirènes', {}, (r) => r.status === 200 && r.j.ok && r.j.recipients === 2 && r.j.sent === 2 && W.fcm.sort().join() === 'tok-g1,tok-m1'],
  ['groupe public récent jamais sonné (fonction SQL OK)', {}, () => !W.fcm.includes('tok-p9') && !W.reads.gm_mine],
  ['anges gardiens : 1 panne passagère → réessai, alerte complète', { fails: { guardians: 1 } }, (r) => r.status === 200 && r.j.ok && r.j.recipients === 2 && W.fcm.includes('tok-g1')],
  ['anges gardiens : panne → 500, ligne réservée effacée, rien envoyé', { fails: { guardians: 2 } }, (r) => r.status === 500 && r.j.why === 'erreur' && reservedDeleted() && W.fcm.length === 0],
  ['jetons : panne → 500 (pas « ok, 0 envoyé »)', { fails: { push_tokens: 2 } }, (r) => r.status === 500 && reservedDeleted() && W.fcm.length === 0],
  ['membres des groupes : panne → 500', { fails: { gm_members: 2 } }, (r) => r.status === 500 && reservedDeleted() && W.fcm.length === 0],
  ['fonction SQL : panne passagère → 500, sans ancien calcul (blocage 24 h gardé)', { rpcErr: [TRANSIENT, TRANSIENT] }, (r) => r.status === 500 && !W.reads.gm_mine && !W.fcm.includes('tok-p9')],
  ['fonction SQL : 1 panne → réessai OK', { rpcErr: [TRANSIENT] }, (r) => r.status === 200 && r.j.recipients === 2 && !W.reads.gm_mine],
  ['fonction SQL absente → ancien calcul (comme avant)', { rpcErr: [MISSING] }, (r) => r.status === 200 && r.j.ok && W.reads.gm_mine === 1 && W.fcm.includes('tok-p9')],
  ['fonction SQL absente + panne de « mes groupes » → 500', { rpcErr: [MISSING, MISSING], fails: { gm_mine: 2 } }, (r) => r.status === 500 && W.fcm.length === 0],
  ['personne à prévenir (vraiment) → ok, 0 destinataire', { guardians: [], sirenGroups: [] }, (r) => r.status === 200 && r.j.ok && r.j.recipients === 0 && W.log.some((x) => x.update && x.update.done)],
  ['essai sur son propre téléphone', { tokens: [{ user_id: 'me', token: 'tok-me', lang: 'fr' }] }, (r) => r.status === 200 && r.j.sent === 1 && W.fcm.join() === 'tok-me', { self: true }],
  // ---- v21 : envoi Firebase ----
  ['Firebase 503 une fois → 2e passage, 2 sirènes', { fcmPlan: (t, n) => n === 1 ? { status: 503 } : 'ok' }, (r) => r.status === 200 && r.j.sent === 2 && !r.j.partial],
  ['Firebase 503 toujours → 500, ligne effacée (le téléphone renverra)', { fcmPlan: () => ({ status: 503 }) }, (r) => r.status === 500 && reservedDeleted() && W.fcm.length === 0],
  ['Firebase 401 → nouveau jeton Google, 2 sirènes', { fcmPlan: (t, n, auth) => auth === 'Bearer jeton1' ? { status: 401 } : 'ok' }, (r) => r.status === 200 && r.j.sent === 2 && W.oauth === 2],
  ['coupure réseau vers 1 téléphone (toujours) → ok partiel, jamais 500 après une sirène', { fcmPlan: (t) => t === 'tok-g1' ? 'throw' : 'ok' }, (r) => r.status === 200 && r.j.ok && r.j.sent === 1 && String(r.j.partial) === 'fcm:1' && !reservedDeleted() && W.log.some((x) => x.update && x.update.done) && W.calls['tok-m1'] === 1],
  ['coupure réseau une fois pour tous → réessai, 2 sirènes', { fcmPlan: (t, n) => n === 1 ? 'throw' : 'ok' }, (r) => r.status === 200 && r.j.sent === 2],
  ['message refusé (400) → pas de réessai', { fcmPlan: (t) => t === 'tok-g1' ? { status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'bad' } } } : 'ok' }, (r) => r.status === 200 && r.j.sent === 1 && W.calls['tok-g1'] === 1 && !r.j.partial],
  ['jeton mort effacé ; panne de l\'effacement → toujours 200', { tokDelErr: true, fcmPlan: (t) => t === 'tok-g1' ? { status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } } : 'ok' }, (r) => r.status === 200 && r.j.dead === 1 && r.j.sent === 1],
  ['secret Firebase absent → 503 (plus de 200 muet)', { env: { FCM_SERVICE_ACCOUNT: undefined } }, (r) => r.status === 503 && r.j.why === 'nofcm'],
  // ---- plafonds ----
  ['5 essais de sirène dans l\'heure ne bloquent pas une vraie chute', { counts: { test: 5, real: 0 } }, (r) => r.status === 200 && r.j.sent === 2 && W.countKinds.every((k) => k === 'real')],
  ['6e essai de sirène dans l\'heure → « trop »', { counts: { test: 5, real: 0 } }, (r) => r.j.why === 'trop', { test: true }],
  ['3 essais de sirène déjà faits → « trop » (max 3)', { counts: { test: 3 } }, (r) => r.j.why === 'trop' && r.j.max === 3, { test: true }],
  ['2 essais de sirène déjà faits → 3e accepté', { counts: { test: 2 } }, (r) => r.status === 200 && r.j.sent === 2, { test: true }],
  ['5 vraies alertes dans l\'heure → « trop » (max 5)', { counts: { real: 5 } }, (r) => r.j.why === 'trop' && r.j.max === 5],
  ['décompte en panne → la sirène part quand même', { countErr: true }, (r) => r.status === 200 && r.j.sent === 2],
  // ---- essai sur son téléphone, mode dégradé ----
  ['essai sur son téléphone malgré une panne des anges gardiens', { fails: { guardians: 9 }, tokens: [{ user_id: 'me', token: 'tok-me', lang: 'fr' }] }, (r) => r.status === 200 && r.j.sent === 1 && !W.reads.guardians, { self: true }],
  ['2e essai (try=1), anges gardiens en panne → 500', { fails: { guardians: 9 } }, (r) => r.status === 500, { try: 1 }],
  ['3e essai (try=2), anges gardiens en panne → le groupe sonne, partiel', { fails: { guardians: 9 } }, (r) => r.status === 200 && W.fcm.join() === 'tok-m1' && String(r.j.partial) === 'guardians', { try: 2 }],
  ['3e essai, fonction SQL en panne → anges gardiens seuls, jamais l\'ancien calcul', { rpcAlways: TRANSIENT }, (r) => r.status === 200 && W.fcm.join() === 'tok-g1' && !W.reads.gm_mine && !W.fcm.includes('tok-p9') && String(r.j.partial) === 'mr_sos_siren_groups', { try: 2 }],
  ['3e essai, tout en panne → 500 (pas « ok, 0 »)', { fails: { guardians: 9 }, rpcAlways: TRANSIENT }, (r) => r.status === 500, { try: 2 }],
  ['« try » farfelu (texte) → ignoré', { fails: { guardians: 9 } }, (r) => r.status === 500, { try: '9' }],
  // ---- journal, anti-doublon, nom ----
  ['recherche de l\'aid en panne → 500 (anti-doublon gardé)', { lookupErr: [TRANSIENT, TRANSIENT] }, (r) => r.status === 500 && W.fcm.length === 0],
  ['colonne client_id absente → ancien fonctionnement', { lookupErr: [{ code: '42703', message: 'column sos_push_log.client_id does not exist' }] }, (r) => r.status === 200 && r.j.sent === 2 && W.log.some((x) => x.insert && !('client_id' in x.insert))],
  ['réservation en panne → 500, rien envoyé', { insErr: TRANSIENT }, (r) => r.status === 500 && W.fcm.length === 0],
  ['journal final en panne (2 fois) → 200 quand même', { updErr: 2 }, (r) => r.status === 200 && r.j.sent === 2],
  ['profil illisible → sirène « Motard », pas bloquée', { profErr: true }, (r) => r.status === 200 && r.j.sent === 2 && W.titles.every((x) => /Motard/.test(x))],
];


let okN = 0;
for (const [nom, o, chk, extra] of cas) {
  W = world(o);
  const body = Object.assign({ lat: 36.12345, lng: 0.54321, aid: AID }, extra || {});
  let r, good;
  try { r = await call(body); good = !!chk(r); } catch (e) { r = { err: String(e) }; good = false; }
  if (good) okN++;
  console.log((good ? 'OK    ' : 'ÉCHEC ') + nom + (good ? '' : '  → ' + JSON.stringify(r).slice(0, 160) + ' fcm=' + W.fcm.join('/')));
}
console.log(`${okN}/${cas.length} réussis`);
