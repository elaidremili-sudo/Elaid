// MotoRoute – send-email (17/11/2026)
// Pourquoi : Supabase ignore les modèles d'e-mails FR/AR enregistrés dans le tableau de bord
// (projet gratuit créé après le 3 juin 2026 : les e-mails partent toujours avec le texte anglais par défaut,
// vérifié le 16/11 et le 17/11 dans la boîte d'Elaid). Cette fonction est branchée comme « Send Email Hook » :
// Supabase lui confie chaque e-mail d'authentification et c'est elle qui l'envoie par Gmail, avec nos textes.
//
// Secrets à créer par Elaid (Edge Functions → Secrets), jamais dans le dépôt :
//   SEND_EMAIL_HOOK_SECRET : la clé « v1,whsec_… » générée dans Authentication → Hooks → Send Email
//   GMAIL_APP_PASSWORD     : le mot de passe d'application Gmail « Supabase » (rangé dans « Secret »)
// Optionnel : GMAIL_USER (par défaut elaidremilipro@gmail.com).
//
// Gmail par le port 465 (SSL) : les fonctions Supabase n'ont pas le droit d'utiliser les ports 25 et 587.
// Retirer le hook (Authentication → Hooks) suffit pour revenir à l'envoi normal par Supabase.
import { Webhook } from "npm:standardwebhooks@1.0.0";
import nodemailer from "npm:nodemailer@6.9.16";

const PROJECT_URL = "https://ixtqlxltwuktpdznbhnx.supabase.co";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "elaidremilipro@gmail.com";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Textes en français, arabe et anglais dans le même e-mail (on ne connaît pas la langue de l'appli au serveur).
type Txt = { subject: string; fr: [string, string, string]; ar: [string, string]; en: [string, string]; foot: string };
const TXT: Record<string, Txt> = {
  signup: {
    subject: "MotoRoute : confirme ton compte / تأكيد حسابك",
    fr: ["Bienvenue sur MotoRoute 🏍", "Touche le bouton pour confirmer ton compte :", "Confirmer mon compte"],
    ar: ["مرحبًا بك في MotoRoute. اضغط على الزر لتأكيد حسابك:", "تأكيد حسابي"],
    en: ["Welcome to MotoRoute. Tap to confirm your account:", "Confirm my account"],
    foot: "Si tu n'as pas créé de compte, ignore cet e-mail. / إذا لم تنشئ حسابًا، تجاهل هذه الرسالة. / If you didn't sign up, ignore this email.",
  },
  recovery: {
    subject: "MotoRoute : nouveau mot de passe / كلمة مرور جديدة",
    fr: ["MotoRoute : nouveau mot de passe", "Touche le bouton pour choisir un nouveau mot de passe :", "Choisir un nouveau mot de passe"],
    ar: ["اضغط على الزر لاختيار كلمة مرور جديدة:", "اختيار كلمة مرور جديدة"],
    en: ["Tap to choose a new password:", "Choose a new password"],
    foot: "Si tu n'as rien demandé, ignore cet e-mail : ton mot de passe ne change pas. / إذا لم تطلب ذلك، تجاهل هذه الرسالة. / If you didn't ask for this, ignore this email.",
  },
  magiclink: {
    subject: "MotoRoute : lien de connexion / رابط الدخول",
    fr: ["MotoRoute : connexion", "Touche le bouton pour te connecter :", "Me connecter"],
    ar: ["اضغط على الزر لتسجيل الدخول:", "تسجيل الدخول"],
    en: ["Tap to sign in:", "Sign in"],
    foot: "Si tu n'as rien demandé, ignore cet e-mail. / إذا لم تطلب ذلك، تجاهل هذه الرسالة. / If you didn't ask for this, ignore this email.",
  },
  invite: {
    subject: "MotoRoute : invitation / دعوة",
    fr: ["Tu es invité sur MotoRoute 🏍", "Touche le bouton pour accepter l'invitation :", "Accepter l'invitation"],
    ar: ["تمت دعوتك إلى MotoRoute. اضغط على الزر لقبول الدعوة:", "قبول الدعوة"],
    en: ["You're invited to MotoRoute. Tap to accept:", "Accept the invitation"],
    foot: "Si tu ne connais pas MotoRoute, ignore cet e-mail. / إذا كنت لا تعرف MotoRoute، تجاهل هذه الرسالة. / If you don't know MotoRoute, ignore this email.",
  },
};

const BTN = "display:inline-block;background:#c62828;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold";

function build(type: string, url: string, name: string) {
  const t = TXT[type] || TXT.signup;
  const hi = name ? `<p>${esc(name)},</p>` : "";
  const u = esc(url);
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#222">
<h2>${esc(t.fr[0])}</h2>${hi}
<p>${esc(t.fr[1])}</p>
<p><a href="${u}" style="${BTN}">${esc(t.fr[2])}</a></p>
<hr>
<div dir="rtl" style="text-align:right">
<p>${esc(t.ar[0])}</p>
<p><a href="${u}" style="${BTN}">${esc(t.ar[1])}</a></p>
</div>
<hr>
<p>${esc(t.en[0])}</p>
<p><a href="${u}" style="${BTN}">${esc(t.en[1])}</a></p>
<p style="color:#888;font-size:12px">${esc(t.foot)}</p>
</div>`;
  const text = `${t.fr[1]}\n${url}\n\n${t.ar[0]}\n${url}\n\n${t.en[0]}\n${url}\n\n${t.foot}`;
  return { subject: t.subject, html, text };
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
function mailer() {
  const pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!pass) throw new Error("GMAIL_APP_PASSWORD manquant");
  if (!transport) {
    transport = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: pass.replace(/\s+/g, "") },
    });
  }
  return transport;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: { message: "not allowed" } }, 405);
  const raw = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
  if (!raw) return json({ error: { message: "SEND_EMAIL_HOOK_SECRET manquant" } }, 500);

  const payload = await req.text();
  let user: any, email_data: any;
  try {
    ({ user, email_data } = new Webhook(raw.replace("v1,whsec_", "")).verify(payload, Object.fromEntries(req.headers)) as any);
  } catch (_e) {
    return json({ error: { message: "signature invalide" } }, 401);
  }

  try {
    const type = String(email_data?.email_action_type || "signup");
    if (!TXT[type]) {
      // Changement d'e-mail, réauthentification… : l'appli ne s'en sert pas. On refuse clairement plutôt
      // que d'envoyer un lien faux.
      console.error("send-email : type non géré", type);
      return json({ error: { message: `type d'e-mail non géré : ${type}` } }, 400);
    }
    const url = `${PROJECT_URL}/auth/v1/verify?` + new URLSearchParams({
      token: email_data.token_hash,
      type,
      redirect_to: email_data.redirect_to || email_data.site_url || "",
    });
    const name = user?.user_metadata?.first_name || "";
    const m = build(type, url, name);
    await mailer().sendMail({
      from: `"MotoRoute" <${GMAIL_USER}>`,
      to: user.email,
      subject: m.subject,
      html: m.html,
      text: m.text,
    });
    console.log("send-email : envoyé", type);
    return json({});
  } catch (e) {
    console.error("send-email : échec", String((e as Error)?.message || e));
    return json({ error: { message: "envoi de l'e-mail impossible" } }, 500);
  }
});
