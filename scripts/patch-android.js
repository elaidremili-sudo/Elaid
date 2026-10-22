// Ajoute à l'application Android les autorisations dont MotoRoute a besoin
// (GPS, caméra, micro pour les vidéos, notifications, vibration).
const fs = require('fs');
const path = 'android/app/src/main/AndroidManifest.xml';
let xml = fs.readFileSync(path, 'utf8');

const permissions = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.VIBRATE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
];
const features = [
  'android.hardware.location.gps',
  'android.hardware.camera',
  'android.hardware.sensor.accelerometer',
  'android.hardware.sensor.gyroscope',
];

let add = '';
for (const p of permissions) {
  if (!xml.includes(`"${p}"`)) add += `    <uses-permission android:name="${p}" />\n`;
}
for (const f of features) {
  if (!xml.includes(`"${f}"`)) add += `    <uses-feature android:name="${f}" android:required="false" />\n`;
}
xml = xml.replace('</manifest>', add + '</manifest>');
fs.writeFileSync(path, xml);
console.log('Autorisations ajoutées :\n' + (add || '(déjà présentes)'));

// Numéro de version : augmente à chaque fabrication (obligatoire pour Google Play)
const gradlePath = 'android/app/build.gradle';
const run = parseInt(process.env.GITHUB_RUN_NUMBER || '1', 10);
let gradle = fs.readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${100 + run}`)
               .replace(/versionName\s+"[^"]*"/, `versionName "1.0.${run}"`);
fs.writeFileSync(gradlePath, gradle);
console.log(`Version : 1.0.${run} (code ${100 + run})`);

// AdMob : identifiant de l'application (test Google tant que ADMOB_APP_ID n'est pas fourni)
const admobId = process.env.ADMOB_APP_ID || 'ca-app-pub-3940256099942544~3347511713';
let man = fs.readFileSync(path, 'utf8');
if (!man.includes('com.google.android.gms.ads.APPLICATION_ID')) {
  man = man.replace(/<application([^>]*)>/, `<application$1>\n        <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${admobId}"/>`);
  fs.writeFileSync(path, man);
}
console.log('AdMob : ' + (process.env.ADMOB_APP_ID ? 'identifiant MotoRoute' : 'identifiant de test Google'));

// Écran complet en paysage : l'app s'affiche aussi à côté de la caméra (plus de bande noire) — test-24
const stylesPath = 'android/app/src/main/res/values/styles.xml';
if (fs.existsSync(stylesPath)) {
  let st = fs.readFileSync(stylesPath, 'utf8');
  if (!st.includes('windowLayoutInDisplayCutoutMode')) {
    st = st.replace(/(<style name="AppTheme\.NoActionBar(?:Launch)?"[^>]*>)/g,
      '$1\n        <item name="android:windowLayoutInDisplayCutoutMode" tools:targetApi="28">shortEdges</item>');
    if (!st.includes('xmlns:tools')) st = st.replace('<resources>', '<resources xmlns:tools="http://schemas.android.com/tools">');
    fs.writeFileSync(stylesPath, st);
  }
  console.log('Écran complet (encoche/caméra) : activé');
}

// AdMob : bannière MotoRoute réelle si la variable GitHub ADMOB_BANNER_ID est fournie (sinon bannière de test Google)
// La copie de www/ vers Android se fait après ce script (npx cap sync), donc on modifie www/index.html ici.
const banner = process.env.ADMOB_BANNER_ID;
if (banner && /^ca-app-pub-\d+\/\d+$/.test(banner) && process.env.ADMOB_APP_ID) {
  const ip = 'www/index.html';
  let h = fs.readFileSync(ip, 'utf8');
  h = h.replace("const BANNER_ID='ca-app-pub-3940256099942544/6300978111',TESTING=true;",
                `const BANNER_ID='${banner}',TESTING=false;`);
  fs.writeFileSync(ip, h);
  console.log('AdMob bannière : identifiant MotoRoute (publicités réelles)');
} else {
  console.log('AdMob bannière : identifiant de test Google (ADMOB_APP_ID + ADMOB_BANNER_ID à ajouter dans les variables GitHub)');
}

// Sentry : numéro de version dans l'app pour savoir quelle version a planté (test-33)
fs.writeFileSync('www/js/version.js', `// Fabriqué automatiquement\nwindow.MR_VERSION = 'test-${run}';\n`);
console.log(`Sentry : version test-${run}`);

// test-34 : SOS automatique — petit module Android « MrSms » qui envoie le SMS et lance l'appel
// sans que le motard (peut-être inconscient) ait à toucher l'écran.
const javaDir = 'android/app/src/main/java/com/motoroute/app';
fs.mkdirSync(javaDir, { recursive: true });
fs.writeFileSync(javaDir + '/MrSmsPlugin.java', `package com.motoroute.app;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.telephony.SmsManager;
import android.telephony.SmsMessage;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(
    name = "MrSms",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS }),
        @Permission(alias = "call", strings = { Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE })
    }
)
public class MrSmsPlugin extends Plugin {

    private static String why(int code) {
        switch (code) {
            case Activity.RESULT_OK: return "ok";
            case SmsManager.RESULT_ERROR_NO_SERVICE: return "pas-de-reseau";
            case SmsManager.RESULT_ERROR_RADIO_OFF: return "mode-avion-ou-sim-coupee";
            case SmsManager.RESULT_ERROR_NULL_PDU: return "message-invalide";
            case SmsManager.RESULT_ERROR_GENERIC_FAILURE: return "refus-operateur-ou-credit";
            default: return "erreur-" + code;
        }
    }

    // Carte SIM à utiliser : celle des SMS par défaut, sinon la première SIM active
    private int pickSub() {
        int sub = SubscriptionManager.INVALID_SUBSCRIPTION_ID;
        try { sub = SubscriptionManager.getDefaultSmsSubscriptionId(); } catch (Exception e) {}
        if (sub != SubscriptionManager.INVALID_SUBSCRIPTION_ID) return sub;
        try {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_PHONE_STATE) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                SubscriptionManager sm = (SubscriptionManager) getContext().getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                List<SubscriptionInfo> l = sm == null ? null : sm.getActiveSubscriptionInfoList();
                if (l != null && !l.isEmpty()) return l.get(0).getSubscriptionId();
            }
        } catch (Exception e) {}
        return SubscriptionManager.INVALID_SUBSCRIPTION_ID;
    }

    // test-41 : nom de la SIM utilisée (opérateur + emplacement) pour l'afficher au motard
    private String simLabel(int sub) {
        try {
            if (sub == SubscriptionManager.INVALID_SUBSCRIPTION_ID) return "";
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_PHONE_STATE) != android.content.pm.PackageManager.PERMISSION_GRANTED) return "";
            SubscriptionManager sm = (SubscriptionManager) getContext().getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
            SubscriptionInfo i = sm == null ? null : sm.getActiveSubscriptionInfo(sub);
            if (i == null) return "";
            CharSequence c = i.getCarrierName();
            return "SIM " + (i.getSimSlotIndex() + 1) + (c != null && c.length() > 0 ? " (" + c + ")" : "");
        } catch (Exception e) { return ""; }
    }

    private SmsManager managerFor(int sub) {
        SmsManager base = Build.VERSION.SDK_INT >= 31 ? getContext().getSystemService(SmsManager.class) : SmsManager.getDefault();
        if (sub == SubscriptionManager.INVALID_SUBSCRIPTION_ID) return base;
        return Build.VERSION.SDK_INT >= 31 ? base.createForSubscriptionId(sub) : SmsManager.getSmsManagerForSubscriptionId(sub);
    }

    @PluginMethod
    public void send(final PluginCall call) {
        final String to = call.getString("to");
        String msg = call.getString("msg");
        if (to == null || to.isEmpty() || msg == null) { call.reject("numero-manquant"); return; }
        if (getPermissionState("sms") != PermissionState.GRANTED) { call.reject("no-permission"); return; }
        final Context ctx = getContext();
        final int sub = pickSub();
        final SmsManager sm;
        try { sm = managerFor(sub); } catch (Exception e) { call.reject("sim-introuvable"); return; }
        final ArrayList<String> parts = sm.divideMessage(msg);
        final int n = parts.size();
        final String tag = Long.toString(System.nanoTime());
        final String aSent = ctx.getPackageName() + ".SMS_SENT." + tag;
        final String aDeliv = ctx.getPackageName() + ".SMS_DELIV." + tag;
        final int[] got = {0};
        final int[] firstErr = {Activity.RESULT_OK};
        final boolean[] done = {false};
        final Handler h = new Handler(Looper.getMainLooper());

        final BroadcastReceiver deliv = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                JSObject d = new JSObject();
                d.put("to", to);
                // test-41 : le vrai statut est dans le rapport de l'opérateur (PDU), pas dans getResultCode()
                int st = -1;
                try {
                    byte[] pdu = i.getByteArrayExtra("pdu");
                    String fmt = i.getStringExtra("format");
                    if (pdu != null) {
                        SmsMessage m = Build.VERSION.SDK_INT >= 23 ? SmsMessage.createFromPdu(pdu, fmt) : SmsMessage.createFromPdu(pdu);
                        if (m != null) st = m.getStatus();
                    }
                } catch (Exception e) {}
                boolean gsm = !"3gpp2".equals(i.getStringExtra("format"));
                String state;
                if (st < 0) state = "inconnu";
                else if (gsm) state = st == 0 ? "recu" : (st >= 64 ? "echec" : "en-attente");
                else state = (st >> 16) == 0 ? "recu" : ((st >> 16) == 2 || (st >> 16) == 3 ? "echec" : "en-attente");
                d.put("ok", "recu".equals(state));
                d.put("state", state);
                d.put("status", st);
                notifyListeners("smsDelivered", d);
                if (!"en-attente".equals(state)) { try { ctx.unregisterReceiver(this); } catch (Exception e) {} }
            }
        };
        final BroadcastReceiver sent = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                int code = getResultCode();
                if (code != Activity.RESULT_OK && firstErr[0] == Activity.RESULT_OK) firstErr[0] = code;
                got[0]++;
                if (got[0] >= n && !done[0]) {
                    done[0] = true;
                    try { ctx.unregisterReceiver(this); } catch (Exception e) {}
                    if (firstErr[0] == Activity.RESULT_OK) {
                        JSObject r = new JSObject(); r.put("parts", n); r.put("sim", sub); r.put("simName", simLabel(sub)); call.resolve(r);
                    } else { String sl = simLabel(sub); call.reject(why(firstErr[0]) + (sl.isEmpty() ? "" : " · " + sl)); }
                }
            }
        };
        ContextCompat.registerReceiver(ctx, sent, new IntentFilter(aSent), ContextCompat.RECEIVER_NOT_EXPORTED);
        ContextCompat.registerReceiver(ctx, deliv, new IntentFilter(aDeliv), ContextCompat.RECEIVER_NOT_EXPORTED);
        int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0); // test-41 : MUTABLE obligatoire pour recevoir le rapport de remise (intent explicite vers notre app)
        ArrayList<PendingIntent> sIs = new ArrayList<>(), dIs = new ArrayList<>();
        for (int k = 0; k < n; k++) {
            sIs.add(PendingIntent.getBroadcast(ctx, k, new Intent(aSent).setPackage(ctx.getPackageName()), fl));
            dIs.add(k == n - 1 ? PendingIntent.getBroadcast(ctx, 1000 + k, new Intent(aDeliv).setPackage(ctx.getPackageName()), fl) : null);
        }
        try {
            sm.sendMultipartTextMessage(to, null, parts, sIs, dIs);
        } catch (Exception e) {
            done[0] = true;
            try { ctx.unregisterReceiver(sent); ctx.unregisterReceiver(deliv); } catch (Exception x) {}
            call.reject(e.getMessage() == null ? "erreur" : e.getMessage());
            return;
        }
        h.postDelayed(new Runnable() { public void run() { try { ctx.unregisterReceiver(deliv); } catch (Exception e) {} } }, 600000);
        // Sans réponse du réseau en 60 s : on le dit honnêtement
        h.postDelayed(new Runnable() { public void run() {
            if (!done[0]) { done[0] = true; try { ctx.unregisterReceiver(sent); } catch (Exception e) {} call.reject("pas-de-reponse-du-reseau"); }
        }}, 60000);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "erreur" : e.getMessage());
        }
    }

    // test-38 : appel du contact + message vocal lu en boucle sur le haut-parleur (le micro le transmet)
    private android.speech.tts.TextToSpeech tts;
    private boolean speaking = false;

    private void speakerOn(android.media.AudioManager am) {
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                for (android.media.AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                    if (d.getType() == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) { am.setCommunicationDevice(d); break; }
                }
            } else { am.setSpeakerphoneOn(true); }
            am.setStreamVolume(android.media.AudioManager.STREAM_VOICE_CALL, am.getStreamMaxVolume(android.media.AudioManager.STREAM_VOICE_CALL), 0);
            am.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC), 0);
        } catch (Exception e) {}
    }

    private void startVoice(final String say, final String lang, final int seconds) {
        final Context ctx = getContext();
        final android.media.AudioManager am = (android.media.AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        final Handler h = new Handler(Looper.getMainLooper());
        final long t0 = System.currentTimeMillis();
        final long[] inCallSince = {0};
        tts = new android.speech.tts.TextToSpeech(ctx, new android.speech.tts.TextToSpeech.OnInitListener() {
            public void onInit(int st) {
                if (st != android.speech.tts.TextToSpeech.SUCCESS || tts == null) return;
                try {
                    int r = tts.setLanguage(java.util.Locale.forLanguageTag(lang));
                    if (r < 0) tts.setLanguage(java.util.Locale.FRENCH);
                    tts.setSpeechRate(0.9f);
                    tts.setAudioAttributes(new android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build());
                } catch (Exception e) {}
                // Attend que l'appel soit établi, puis lit le message en boucle jusqu'à la fin de l'appel
                h.post(new Runnable() { public void run() {
                    long now = System.currentTimeMillis();
                    if (now - t0 > (seconds + 40) * 1000L) { stopVoice(); return; }
                    int mode = am == null ? -1 : am.getMode();
                    boolean inCall = mode == android.media.AudioManager.MODE_IN_CALL;
                    if (inCall && inCallSince[0] == 0) inCallSince[0] = now;
                    // Appel terminé après avoir commencé : on arrête
                    if (!inCall && inCallSince[0] != 0 && now - inCallSince[0] > 3000) { stopVoice(); return; }
                    boolean ready = (inCallSince[0] != 0 && now - inCallSince[0] > 3000) || (inCallSince[0] == 0 && now - t0 > 12000);
                    if (ready && !speaking && tts != null) {
                        speaking = true;
                        speakerOn(am);
                        tts.speak(say, android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, "mr-sos");
                        h.postDelayed(new Runnable() { public void run() { speaking = false; } }, 2500 + say.length() * 75L);
                    }
                    h.postDelayed(this, 1000);
                }});
            }
        });
    }

    private void stopVoice() {
        try { if (tts != null) { tts.stop(); tts.shutdown(); } } catch (Exception e) {}
        tts = null; speaking = false;
    }

    // test-40 : lecture à voix haute d'une alerte reçue (téléphone de l'ange gardien), sur le canal « alarme »
    @PluginMethod
    public void speak(final PluginCall call) {
        final String say = call.getString("say");
        final String lang = call.getString("lang", "fr");
        final int repeat = Math.max(1, Math.min(5, call.getInt("repeat", 3)));
        if (say == null || say.isEmpty()) { call.reject("texte-manquant"); return; }
        stopVoice();
        final Context ctx = getContext();
        final android.media.AudioManager am = (android.media.AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        tts = new android.speech.tts.TextToSpeech(ctx, new android.speech.tts.TextToSpeech.OnInitListener() {
            public void onInit(int st) {
                if (st != android.speech.tts.TextToSpeech.SUCCESS || tts == null) return;
                try {
                    int r = tts.setLanguage(java.util.Locale.forLanguageTag(lang));
                    if (r < 0) tts.setLanguage(java.util.Locale.FRENCH);
                    tts.setSpeechRate(0.9f);
                    tts.setAudioAttributes(new android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build());
                    if (am != null) am.setStreamVolume(android.media.AudioManager.STREAM_ALARM, am.getStreamMaxVolume(android.media.AudioManager.STREAM_ALARM), 0);
                    for (int k = 0; k < repeat; k++) {
                        tts.speak(say, k == 0 ? android.speech.tts.TextToSpeech.QUEUE_FLUSH : android.speech.tts.TextToSpeech.QUEUE_ADD, null, "mr-alerte-" + k);
                        tts.playSilentUtterance(1500, android.speech.tts.TextToSpeech.QUEUE_ADD, "mr-pause-" + k);
                    }
                } catch (Exception e) {}
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void stopSpeak(PluginCall call) { stopVoice(); call.resolve(); }

    @PluginMethod
    public void dial(PluginCall call) {
        String to = call.getString("to");
        String say = call.getString("say");
        String lang = call.getString("lang", "fr");
        int seconds = call.getInt("seconds", 90);
        if (to == null || to.isEmpty()) { call.reject("numero-manquant"); return; }
        boolean direct = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CALL_PHONE) == android.content.pm.PackageManager.PERMISSION_GRANTED;
        try {
            Intent i = new Intent(direct ? Intent.ACTION_CALL : Intent.ACTION_DIAL, Uri.parse("tel:" + to));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            stopVoice();
            if (direct && say != null && !say.isEmpty()) startVoice(say, lang, seconds);
            JSObject r = new JSObject(); r.put("direct", direct); r.put("voice", direct && say != null && !say.isEmpty());
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "erreur" : e.getMessage());
        }
    }
}
`);
const mainPath = javaDir + '/MainActivity.java';
fs.writeFileSync(mainPath, `package com.motoroute.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MrSmsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);
let man2 = fs.readFileSync(path, 'utf8');
for (const p of ['android.permission.SEND_SMS', 'android.permission.CALL_PHONE', 'android.permission.READ_PHONE_STATE']) {
  if (!man2.includes(`"${p}"`)) man2 = man2.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
}
if (!man2.includes('"android.hardware.telephony"')) man2 = man2.replace('</manifest>', '    <uses-feature android:name="android.hardware.telephony" android:required="false" />\n</manifest>');
fs.writeFileSync(path, man2);
console.log('SOS : module MrSms (SMS + appel automatiques) ajouté');

// test-40 : alertes sonores (notifications Firebase) — sirène dans res/raw, fichier Firebase si présent
fs.mkdirSync('android/app/src/main/res/raw', { recursive: true });
fs.copyFileSync('android-res/sos_alarm.wav', 'android/app/src/main/res/raw/sos_alarm.wav');
if (fs.existsSync('android-res/google-services.json')) {
  fs.copyFileSync('android-res/google-services.json', 'android/app/google-services.json');
  console.log('Firebase : google-services.json copié (notifications actives)');
  fs.appendFileSync('www/js/version.js', 'window.MR_FCM = true;\n');
} else {
  console.log('::warning::Firebase : google-services.json absent → pas de notifications dans cette version');
}
let man3 = fs.readFileSync(path, 'utf8');
if (!man3.includes('android.permission.POST_NOTIFICATIONS')) man3 = man3.replace('</manifest>', '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n</manifest>');
if (!man3.includes('default_notification_channel_id')) man3 = man3.replace('</application>', '        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="sos_alarm" />\n    </application>');
fs.writeFileSync(path, man3);
