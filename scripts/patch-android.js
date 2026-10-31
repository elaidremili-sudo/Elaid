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
  // 29/10 : READ_MEDIA_IMAGES / READ_MEDIA_VIDEO retirées (refusées par Google Play pour ce cas) :
  // les photos passent par le sélecteur système (plugin Camera / champ « fichier » de la page), sans autorisation.
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
const admobId = process.env.ADMOB_APP_ID || 'ca-app-pub-9115324413258436~7133412146'; // test-61 : application MotoRoute dans AdMob
let man = fs.readFileSync(path, 'utf8');
if (!man.includes('com.google.android.gms.ads.APPLICATION_ID')) {
  man = man.replace(/<application([^>]*)>/, `<application$1>\n        <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${admobId}"/>`);
  fs.writeFileSync(path, man);
}
console.log('AdMob : identifiant MotoRoute ' + admobId);

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
        @Permission(alias = "call", strings = { Manifest.permission.CALL_PHONE })
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

    // Carte SIM à utiliser : celle choisie pour les SMS dans les réglages du téléphone.
    // 29/10 : plus besoin de READ_PHONE_STATE (refusée par Google Play pour cet usage). Sans SIM SMS par défaut
    // (« toujours demander »), on renvoie INVALID et Android utilise sa SIM SMS par défaut (SmsManager standard).
    private int pickSub() {
        try { return SubscriptionManager.getDefaultSmsSubscriptionId(); } catch (Throwable e) {}
        return SubscriptionManager.INVALID_SUBSCRIPTION_ID;
    }

    // test-41 / 29/10 : nom de la SIM utilisée (emplacement + opérateur) pour l'afficher au motard,
    // lu uniquement avec des fonctions Android qui ne demandent aucune autorisation. Sinon "" (jamais d'erreur).
    private String simLabel(int sub) {
        try {
            if (sub == SubscriptionManager.INVALID_SUBSCRIPTION_ID) return "";
            int slot = -1;
            if (Build.VERSION.SDK_INT >= 29) { try { slot = SubscriptionManager.getSlotIndex(sub); } catch (Throwable e) {} }
            String op = "";
            if (Build.VERSION.SDK_INT >= 24) {
                try {
                    android.telephony.TelephonyManager tm = (android.telephony.TelephonyManager) getContext().getSystemService(Context.TELEPHONY_SERVICE);
                    if (tm != null) { String s = tm.createForSubscriptionId(sub).getSimOperatorName(); if (s != null) op = s.trim(); }
                } catch (Throwable e) {}
            }
            if (slot < 0 && op.isEmpty()) return "";
            if (slot < 0) return op;
            return "SIM " + (slot + 1) + (op.isEmpty() ? "" : " (" + op + ")");
        } catch (Throwable e) { return ""; }
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
for (const p of ['android.permission.SEND_SMS', 'android.permission.CALL_PHONE']) {
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

// ---------------------------------------------------------------------------------------------
// test-47 (22/10) : sirène ange gardien même application fermée.
// Avant : le serveur envoyait une notification « classique » ; app fermée, c'est Android qui l'affichait,
// avec le canal « sos_alarm » tel qu'il avait été créé la première fois (un canal Android ne change plus
// jamais de son ensuite) → simple notification, pas de sirène. Désormais le serveur envoie un message
// « données seules » prioritaire : notre propre service le reçoit même app fermée, affiche l'alerte et
// joue lui-même la sirène sur le canal ALARME (sonne même en mode silencieux / vibreur), puis lit le
// message à voix haute. Toucher l'alerte ouvre MotoRoute sur la position ; bouton « Arrêter la sirène ».
// ---------------------------------------------------------------------------------------------
fs.writeFileSync(javaDir + '/MrSosService.java', `package com.motoroute.app;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

// Remplace le service de Capacitor : transmet tout à l'app (comme avant), et déclenche la sirène pour un SOS
public class MrSosService extends com.capacitorjs.plugins.pushnotifications.MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage m) {
        super.onMessageReceived(m);
        Map<String, String> d = m.getData();
        if (d != null && "sos".equals(d.get("type"))) MrSirenService.start(getApplicationContext(), d);
        // test-51 : notification simple (vitrines partenaires : publication à valider, acceptée, refusée)
        else if (d != null && "info".equals(d.get("type"))) MrSirenService.info(getApplicationContext(), d);
    }
}
`);

fs.writeFileSync(javaDir + '/MrSirenService.java', `package com.motoroute.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.Locale;
import java.util.Map;
import org.json.JSONObject;

public class MrSirenService extends Service {
    public static final String CH = "mr_sos_siren_v2";      // alerte, sans son (la sirène est jouée par le service)
    public static final String CH_SOUND = "mr_sos_sound_v2"; // secours : alerte avec le son de sirène du canal
    public static volatile String pending = null;            // alerte touchée, en attente d'être affichée par l'app
    private static MrSirenService current = null;
    // test-49 : après « Arrêter » (ou alerte ouverte), plus aucune sirène pendant 3 min ; une seule sirène par motard
    public static volatile long mutedUntil = 0;
    private static String playingUid = null;

    private MediaPlayer mp;
    private TextToSpeech tts;
    private final Handler h = new Handler(Looper.getMainLooper());
    private AudioManager am;
    private int savedVol = -1;
    private int nid = 7000;
    private boolean done = false;

    private static AudioAttributes alarmAttr(int content) {
        return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(content).build();
    }

    public static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CH) == null) {
            NotificationChannel ch = new NotificationChannel(CH, "Alertes SOS (sirène)", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Alerte quand un proche ou un membre de ton groupe chute. La sirène est jouée par MotoRoute.");
            ch.setSound(null, null);
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[] { 0, 900, 400, 900, 400, 900, 400, 900 });
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ch.setBypassDnd(true);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_SOUND) == null) {
            NotificationChannel ch = new NotificationChannel(CH_SOUND, "Alertes SOS (secours)", NotificationManager.IMPORTANCE_HIGH);
            ch.setSound(Uri.parse("android.resource://" + c.getPackageName() + "/" + R.raw.sos_alarm), alarmAttr(AudioAttributes.CONTENT_TYPE_SONIFICATION));
            ch.enableVibration(true);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ch.setBypassDnd(true);
            nm.createNotificationChannel(ch);
        }
    }

    public static void start(Context c, Map<String, String> d) {
        String data = new JSONObject(d).toString();
        Intent i = new Intent(c, MrSirenService.class).putExtra("data", data);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception e) {
            fallback(c, data);
        }
    }

    // Si Android refuse de lancer le service : notification avec le son de sirène du canal
    static void fallback(Context c, String data) {
        try {
            channels(c);
            JSONObject j = new JSONObject(data);
            NotificationManagerCompat.from(c).notify(idOf(j), build(c, j, CH_SOUND, false));
        } catch (Exception e) {}
    }

    public static final String CH_INFO = "mr_info_v1";
    static void info(Context c, Map<String, String> d) {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null && nm.getNotificationChannel(CH_INFO) == null)
                    nm.createNotificationChannel(new NotificationChannel(CH_INFO, "MotoRoute (infos)", NotificationManager.IMPORTANCE_DEFAULT));
            }
            String title = d.get("title") == null ? "MotoRoute" : d.get("title");
            String body = d.get("body") == null ? "" : d.get("body");
            String tag = d.get("tag") == null ? "mr-info" : d.get("tag");
            Intent o = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, tag.hashCode(), o, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification n = new NotificationCompat.Builder(c, CH_INFO)
                .setSmallIcon(android.R.drawable.stat_notify_more)
                .setContentTitle(title).setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true).setContentIntent(pi).build();
            NotificationManagerCompat.from(c).notify(tag, 1, n);
        } catch (Exception e) {}
    }

    static int idOf(JSONObject j) { return 7000 + (j.optString("uid", "x").hashCode() & 0xfff); }

    static PendingIntent openIntent(Context c, String data, int code) {
        Intent o = new Intent(c, MainActivity.class).putExtra("mr_sos", data)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, code, o, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static Notification build(Context c, JSONObject j, String channel, boolean stopBtn) {
        String title = j.optString("title", "🚨 MotoRoute : alerte SOS");
        String body = j.optString("body", "");
        if (body.isEmpty()) body = j.optString("msg", "");
        if (body.isEmpty()) body = "Touche pour voir sa position.";
        int id = idOf(j);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channel)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setColor(0xFFFF3B30)
            .setAutoCancel(true)
            .setContentIntent(openIntent(c, j.toString(), id))
            .addAction(0, "Voir la position", openIntent(c, j.toString(), id + 1));
        if (stopBtn) {
            PendingIntent stop = PendingIntent.getService(c, id + 2, new Intent(c, MrSirenService.class).setAction("stop"),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.addAction(0, "Arrêter la sirène", stop);
        }
        return b.build();
    }

    public static void stopAll() {
        final MrSirenService s = current;
        if (s != null) new Handler(Looper.getMainLooper()).post(new Runnable() { public void run() { s.finish(); } });
    }

    @Override
    public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent i, int flags, int startId) {
        if (i != null && "stop".equals(i.getAction())) {
            mutedUntil = System.currentTimeMillis() + 180000;
            if (current != null) current.finish(); else stopSelf();
            return START_NOT_STICKY;
        }
        String data = i == null ? null : i.getStringExtra("data");
        JSONObject j;
        try { j = new JSONObject(data == null ? "{}" : data); } catch (Exception e) { j = new JSONObject(); }
        channels(this);
        long now = System.currentTimeMillis();
        boolean test = "1".equals(j.optString("test"));
        long at = 0;
        try { at = Long.parseLong(j.optString("at", "0")); } catch (Exception e) {}
        long age = at > 0 ? now - at : 0;
        String uid = j.optString("uid", "");
        // alerte arrivée en retard (téléphone injoignable un moment), ou sirène coupée il y a moins de 3 min : sans son
        boolean quiet = now < mutedUntil || age > (test ? 120000L : 1800000L);
        // même motard déjà en train de sonner : on met juste l'alerte à jour, sans relancer la sirène
        boolean same = current != null && !current.done && uid.equals(playingUid);
        int id = idOf(j);
        Notification n = build(this, j, CH, !quiet);
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(same ? nid : id, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
            else startForeground(same ? nid : id, n);
        } catch (Exception e) {
            if (!quiet) fallback(this, j.toString());
            else try { NotificationManagerCompat.from(this).notify(id, n); } catch (Exception x) {}
            stopSelf();
            return START_NOT_STICKY;
        }
        if (same) return START_NOT_STICKY;
        if (quiet) {
            if (current == null || current.done) {
                try { if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_DETACH); else stopForeground(false); } catch (Exception e) {}
                stopSelf();
            }
            return START_NOT_STICKY;
        }
        // (un service Android n'existe qu'en un seul exemplaire : on coupe le son en cours sans arrêter le service)
        if (current != null && !current.done) current.mute();
        nid = id;
        current = this;
        playingUid = uid;
        done = false;
        siren(j, test);
        return START_NOT_STICKY;
    }

    // Android 15 : un service court doit s'arrêter au bout de 3 minutes
    public void onTimeout(int startId) { finish(); }
    public void onTimeout(int startId, int type) { finish(); }

    private void siren(final JSONObject j, final boolean test) {
        am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        try {
            if (am != null) {
                if (savedVol < 0) savedVol = am.getStreamVolume(AudioManager.STREAM_ALARM);
                int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                am.setStreamVolume(AudioManager.STREAM_ALARM, Math.max(savedVol, (int) Math.ceil(max * 0.9)), 0);
            }
        } catch (Exception e) {}
        try {
            mp = new MediaPlayer();
            mp.setAudioAttributes(alarmAttr(AudioAttributes.CONTENT_TYPE_SONIFICATION));
            AssetFileDescriptor afd = getResources().openRawResourceFd(R.raw.sos_alarm);
            mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            afd.close();
            mp.setLooping(true);
            mp.prepare();
            mp.start();
        } catch (Exception e) {
            // pas de lecteur : on montre au moins l'alerte avec le son du canal de secours
            fallback(this, j.toString());
        }
        // 24 s de sirène (8 s pour un test), puis le message lu à voix haute (2 fois, 1 fois pour un test)
        h.postDelayed(new Runnable() { public void run() { stopPlayer(); speak(j, test); } }, test ? 8000 : 24000);
        h.postDelayed(new Runnable() { public void run() { finish(); } }, 90000);
    }

    private void speak(JSONObject j, final boolean test) {
        final String say = j.optString("say", "");
        if (say.isEmpty() || done) { finish(); return; }
        String lg = j.optString("lang", "fr");
        final String lang = "ar".equals(lg) ? "ar" : "en".equals(lg) ? "en" : "fr";
        tts = new TextToSpeech(getApplicationContext(), new TextToSpeech.OnInitListener() {
            public void onInit(int st) {
                if (st != TextToSpeech.SUCCESS || tts == null || done) { finish(); return; }
                try {
                    int r = tts.setLanguage(Locale.forLanguageTag(lang));
                    if (r < 0) tts.setLanguage(Locale.FRENCH);
                    tts.setSpeechRate(0.9f);
                    tts.setAudioAttributes(alarmAttr(AudioAttributes.CONTENT_TYPE_SPEECH));
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        public void onStart(String id) {}
                        public void onDone(String id) { if ("mr-fin".equals(id)) h.post(new Runnable() { public void run() { finish(); } }); }
                        public void onError(String id) { h.post(new Runnable() { public void run() { finish(); } }); }
                    });
                    if (test) tts.speak(say, TextToSpeech.QUEUE_FLUSH, null, "mr-fin");
                    else {
                        tts.speak(say, TextToSpeech.QUEUE_FLUSH, null, "mr-1");
                        tts.playSilentUtterance(1500, TextToSpeech.QUEUE_ADD, "mr-pause");
                        tts.speak(say, TextToSpeech.QUEUE_ADD, null, "mr-fin");
                    }
                } catch (Exception e) { finish(); }
            }
        });
    }

    private void mute() {
        h.removeCallbacksAndMessages(null);
        stopPlayer();
        try { if (tts != null) { tts.stop(); tts.shutdown(); } } catch (Exception e) {}
        tts = null;
    }

    private void stopPlayer() {
        try { if (mp != null) { mp.stop(); mp.release(); } } catch (Exception e) {}
        mp = null;
    }

    void finish() {
        if (done) return;
        done = true;
        h.removeCallbacksAndMessages(null);
        stopPlayer();
        try { if (tts != null) { tts.stop(); tts.shutdown(); } } catch (Exception e) {}
        tts = null;
        try { if (am != null && savedVol >= 0) am.setStreamVolume(AudioManager.STREAM_ALARM, savedVol, 0); } catch (Exception e) {}
        savedVol = -1;
        // l'alerte reste affichée (on enlève seulement le bouton « Arrêter la sirène » en la reposant)
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_DETACH); else stopForeground(false);
        } catch (Exception e) {}
        if (current == this) { current = null; playingUid = null; }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (!done) finish();
        super.onDestroy();
    }
}
`);

// MainActivity : garde l'alerte touchée pour l'app, et coupe la sirène quand on ouvre l'alerte
fs.writeFileSync(mainPath, `package com.motoroute.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MrSmsPlugin.class);
        super.onCreate(savedInstanceState);
        keepSos(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        keepSos(intent);
    }

    private void keepSos(Intent i) {
        if (i == null) return;
        String d = i.getStringExtra("mr_sos");
        if (d != null) {
            MrSirenService.pending = d;
            MrSirenService.mutedUntil = System.currentTimeMillis() + 180000;
            MrSirenService.stopAll();
            i.removeExtra("mr_sos");
        }
    }
}
`);

// Module MrSms : l'app récupère l'alerte touchée (takeSos) et peut couper la sirène (stopSiren)
{
  const pp = javaDir + '/MrSmsPlugin.java';
  let src = fs.readFileSync(pp, 'utf8');
  const anchor = '    @PluginMethod\n    public void stopSpeak(PluginCall call) { stopVoice(); call.resolve(); }';
  if (!src.includes(anchor)) throw new Error('patch-android : ancre stopSpeak introuvable');
  src = src.replace(anchor, `    @PluginMethod
    public void stopSpeak(PluginCall call) { stopVoice(); MrSirenService.stopAll(); call.resolve(); }

    @PluginMethod
    public void stopSiren(PluginCall call) { MrSirenService.mutedUntil = System.currentTimeMillis() + 180000; MrSirenService.stopAll(); call.resolve(); }

    @PluginMethod
    public void takeSos(PluginCall call) {
        String d = MrSirenService.pending;
        MrSirenService.pending = null;
        JSObject r = new JSObject();
        r.put("data", d);
        call.resolve(r);
    }

    // État des alertes sur ce téléphone (notifications autorisées, canal sirène actif, économie de batterie)
    @PluginMethod
    public void alertState(PluginCall call) {
        Context c = getContext();
        MrSirenService.channels(c);
        JSObject r = new JSObject();
        r.put("notif", androidx.core.app.NotificationManagerCompat.from(c).areNotificationsEnabled());
        boolean chOk = true;
        if (Build.VERSION.SDK_INT >= 26) {
            android.app.NotificationManager nm = (android.app.NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            android.app.NotificationChannel ch = nm == null ? null : nm.getNotificationChannel(MrSirenService.CH);
            chOk = ch != null && ch.getImportance() != android.app.NotificationManager.IMPORTANCE_NONE;
        }
        r.put("channel", chOk);
        boolean batt = true;
        try {
            android.os.PowerManager pm = (android.os.PowerManager) c.getSystemService(Context.POWER_SERVICE);
            if (pm != null && Build.VERSION.SDK_INT >= 23) batt = pm.isIgnoringBatteryOptimizations(c.getPackageName());
        } catch (Exception e) {}
        r.put("battery", batt);
        call.resolve(r);
    }

    @PluginMethod
    public void openBattery(PluginCall call) {
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            try {
                Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } catch (Exception x) {}
        }
        call.resolve();
    }`);
  fs.writeFileSync(pp, src);
}

// Manifeste : notre service remplace celui de Capacitor ; service de sirène ; pas de sauvegarde Android
{
  let m = fs.readFileSync(path, 'utf8');
  if (!m.includes('xmlns:tools=')) m = m.replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ');
  for (const p of ['android.permission.FOREGROUND_SERVICE', 'android.permission.WAKE_LOCK']) {
    if (!m.includes(`"${p}"`)) m = m.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
  }
  if (!m.includes('MrSosService')) m = m.replace('</application>', `        <service android:name="com.capacitorjs.plugins.pushnotifications.MessagingService" tools:node="remove" />
        <service android:name=".MrSosService" android:exported="false">
            <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
        </service>
        <service android:name=".MrSirenService" android:exported="false" android:foregroundServiceType="shortService" />
    </application>`);
  // test-47 : la sauvegarde Android restaurait d'anciens réglages (dont « présentation déjà vue ») à la réinstallation
  m = m.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
  if (!m.includes('android:allowBackup')) m = m.replace(/<application /, '<application android:allowBackup="false" ');
  m = m.replace('android:value="sos_alarm" />', 'android:value="mr_sos_sound_v2" />');
  fs.writeFileSync(path, m);
  console.log('Sirène : service natif MrSosService + MrSirenService (alarme même app fermée)');
}

// MrSosService a besoin de Firebase Messaging à la compilation (le module Capacitor ne l'expose pas à l'app)
{
  let gr = fs.readFileSync(gradlePath, 'utf8');
  if (!gr.includes('firebase-messaging')) {
    gr = gr.replace(/dependencies\s*\{/, 'dependencies {\n    implementation "com.google.firebase:firebase-messaging:24.1.0"');
    fs.writeFileSync(gradlePath, gr);
  }
}

// test-66 (25/10) : musique en arrière-plan. Android endort une appli qui n'est plus à l'écran, même si sa page joue du son :
// la radio et les morceaux s'arrêtaient écran éteint. Service « lecture multimédia » (notification avec ⏮ ⏯ ⏭ ✕)
// + session média : les boutons du casque Bluetooth / de l'intercom pilotent le lecteur de MotoRoute.
fs.writeFileSync(javaDir + '/MrMusicPlugin.java', `package com.motoroute.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MrMusic")
public class MrMusicPlugin extends Plugin {
    private static MrMusicPlugin inst = null;

    @Override
    public void load() { inst = this; }

    // appelé par le service : bouton de la notification ou du casque → l'app agit sur son lecteur
    static void emit(String action) {
        MrMusicPlugin p = inst;
        if (p == null) return;
        JSObject d = new JSObject();
        d.put("action", action);
        p.notifyListeners("action", d, true);
    }

    @PluginMethod
    public void update(PluginCall call) {
        Context c = getContext();
        String title = call.getString("title", "MotoRoute"), artist = call.getString("artist", "");
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", false)), live = Boolean.TRUE.equals(call.getBoolean("live", false));
        // service déjà lancé : mise à jour directe (Android interdit de relancer un service depuis l'arrière-plan,
        // par ex. quand un morceau enchaîne sur le suivant écran éteint)
        final MrMusicService s = MrMusicService.inst;
        if (s != null) { new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> s.set(title, artist, playing, live)); call.resolve(); return; }
        Intent i = new Intent(c, MrMusicService.class).setAction(MrMusicService.UPDATE)
            .putExtra("title", title).putExtra("artist", artist).putExtra("playing", playing).putExtra("live", live);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context c = getContext();
        try { c.stopService(new Intent(c, MrMusicService.class)); } catch (Exception e) {}
        call.resolve();
    }
}
`);

fs.writeFileSync(javaDir + '/MrMusicService.java', `package com.motoroute.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;

public class MrMusicService extends Service {
    static volatile MrMusicService inst = null;
    static final String UPDATE = "com.motoroute.app.MUSIC_UPDATE";
    static final String CH = "mr_music_v1";
    private static final int NID = 7600;
    private MediaSessionCompat session;
    private PowerManager.WakeLock cpu;
    private WifiManager.WifiLock wifi;
    private final Handler h = new Handler(Looper.getMainLooper());
    private String title = "MotoRoute", artist = "";
    private boolean playing = false, live = false;
    // en pause depuis 10 min : on libère le téléphone (la musique reprend depuis l'app)
    private final Runnable idle = () -> { MrMusicPlugin.emit("stop"); stopSelf(); };

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        inst = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CH) == null) {
                NotificationChannel ch = new NotificationChannel(CH, "Musique MotoRoute", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Commandes de la musique (radio, morceaux) pendant que tu roules.");
                ch.setShowBadge(false);
                ch.setSound(null, null);
                nm.createNotificationChannel(ch);
            }
        }
        session = new MediaSessionCompat(this, "MotoRoute");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { MrMusicPlugin.emit("play"); }
            @Override public void onPause() { MrMusicPlugin.emit("pause"); }
            @Override public void onSkipToNext() { MrMusicPlugin.emit("next"); }
            @Override public void onSkipToPrevious() { MrMusicPlugin.emit("prev"); }
            @Override public void onStop() { MrMusicPlugin.emit("stop"); }
        });
        session.setActive(true);
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MotoRoute:musique");
            cpu.setReferenceCounted(false);
        } catch (Exception e) {}
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            wifi = wm.createWifiLock(Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF, "MotoRoute:musique");
            wifi.setReferenceCounted(false);
        } catch (Exception e) {}
    }

    private PendingIntent act(String a, int code) {
        Intent i = new Intent(this, MrMusicService.class).setAction(a);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification build() {
        Intent o = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(this, NID, o, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CH)
            .setSmallIcon(playing ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(open)
            .setDeleteIntent(act("mr.stop", 4))
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(playing)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .addAction(android.R.drawable.ic_media_previous, "Précédent", act("mr.prev", 1))
            .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "Pause" : "Lecture", act("mr.toggle", 2))
            .addAction(android.R.drawable.ic_media_next, "Suivant", act("mr.next", 3))
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Fermer", act("mr.stop", 4))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    private void apply() {
        long acts = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_STOP;
        session.setPlaybackState(new PlaybackStateCompat.Builder().setActions(acts)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, playing ? 1f : 0f).build());
        session.setMetadata(new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, live ? "Radio en direct" : "MotoRoute").build());
        Notification n = build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NID, n);
        h.removeCallbacks(idle);
        if (playing) {
            try { if (cpu != null && !cpu.isHeld()) cpu.acquire(4 * 60 * 60 * 1000L); } catch (Exception e) {}
            try { if (wifi != null && !wifi.isHeld()) wifi.acquire(); } catch (Exception e) {}
        } else {
            release();
            h.postDelayed(idle, 10 * 60 * 1000L);
        }
        // talkie-walkie actif : il garde les boutons du casque (la session média qui vient de changer d'état les a repris)
        MrTalkieService.reclaimButtons();
    }

    void set(String t, String a, boolean p, boolean l) {
        title = t == null || t.isEmpty() ? "MotoRoute" : t; artist = a == null ? "" : a; playing = p; live = l;
        apply();
    }

    private void release() {
        try { if (cpu != null && cpu.isHeld()) cpu.release(); } catch (Exception e) {}
        try { if (wifi != null && wifi.isHeld()) wifi.release(); } catch (Exception e) {}
    }

    @Override
    public int onStartCommand(Intent i, int flags, int startId) {
        String a = i == null ? null : i.getAction();
        if (UPDATE.equals(a)) {
            title = i.getStringExtra("title"); if (title == null || title.isEmpty()) title = "MotoRoute";
            artist = i.getStringExtra("artist"); if (artist == null) artist = "";
            playing = i.getBooleanExtra("playing", false);
            live = i.getBooleanExtra("live", false);
            apply();
        } else {
            // le service doit être au premier plan quelques secondes après son lancement, même pour un simple bouton
            apply();
            if ("mr.prev".equals(a)) MrMusicPlugin.emit("prev");
            else if ("mr.next".equals(a)) MrMusicPlugin.emit("next");
            else if ("mr.toggle".equals(a)) MrMusicPlugin.emit(playing ? "pause" : "play");
            else if ("mr.stop".equals(a)) { MrMusicPlugin.emit("stop"); stopSelf(); }
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // l'appli est balayée de l'écran des applis récentes : on arrête la musique avec elle
        MrMusicPlugin.emit("stop");
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        inst = null;
        h.removeCallbacks(idle);
        release();
        try { session.setActive(false); session.release(); } catch (Exception e) {}
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        super.onDestroy();
    }
}
`);

{
  const mp = javaDir + '/MainActivity.java';
  let ma = fs.readFileSync(mp, 'utf8');
  if (!ma.includes('MrMusicPlugin')) ma = ma.replace('registerPlugin(MrSmsPlugin.class);', 'registerPlugin(MrSmsPlugin.class);\n        registerPlugin(MrMusicPlugin.class);');
  if (!ma.includes('MrMusicPlugin')) throw new Error('patch-android : MainActivity sans MrMusicPlugin');
  fs.writeFileSync(mp, ma);

  let m = fs.readFileSync(path, 'utf8');
  for (const p of ['android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'android.permission.WAKE_LOCK', 'android.permission.ACCESS_WIFI_STATE']) {
    if (!m.includes(`"${p}"`)) m = m.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
  }
  if (!m.includes('MrMusicService')) m = m.replace('</application>', '        <service android:name=".MrMusicService" android:exported="false" android:foregroundServiceType="mediaPlayback" />\n    </application>');
  fs.writeFileSync(path, m);

  let gr = fs.readFileSync(gradlePath, 'utf8');
  if (!gr.includes('androidx.media:media')) {
    gr = gr.replace(/dependencies\s*\{/, 'dependencies {\n    implementation "androidx.media:media:1.6.0"');
    fs.writeFileSync(gradlePath, gr);
  }
  console.log('Musique : service MrMusicService (lecture écran éteint, notification, boutons du casque)');
}

// ---------------------------------------------------------------------------------------------
// test-68 (29/10) : TALKIE-WALKIE de groupe (push-to-talk) — partie Android.
// La page web (www/js/talkie.js, window.MrTalkie) fait la voix (micro, réseau, lecture) ; le natif sert à :
//  1. tenir un service au premier plan de type « microphone » : sans lui, Android coupe le micro (silence, sans erreur)
//     dès que l'écran s'éteint ou que l'appli passe en arrière-plan ;
//  2. donner au bouton du casque Bluetooth le rôle de bouton « parler » (session média dédiée) ;
//  3. gérer le son : focus audio « baisser les autres applis » (MAY_DUCK) et routage vers le micro/écouteur du casque (SCO) ;
//  4. afficher la notification « 📻 Talkie-walkie — canal X » avec les boutons Parler / Arrêter.
//
// Règles Android respectées (à re-vérifier sur la doc officielle, voir play-store/declaration-micro-talkie.md) :
//  - Android 14+ (cible 34+) : type de service obligatoire dans le manifeste (foregroundServiceType="microphone"),
//    permissions FOREGROUND_SERVICE + FOREGROUND_SERVICE_MICROPHONE, et RECORD_AUDIO DÉJÀ accordée avant startForeground
//    (sinon SecurityException).
//  - Un service « microphone » ne peut être lancé que quand l'appli est visible (ou exceptions prévues par Android :
//    appui sur un bouton de notification, etc.). start() est donc à appeler depuis la page ouverte, par un geste du
//    motard. Si Android refuse, start() est REJETÉ avec un code clair (jamais de plantage) :
//      no-permission-micro | micro-refuse | demarrage-interdit-arriere-plan | service-refuse | service-sans-reponse.
//    Une fois lancé appli visible, le service garde l'accès au micro écran éteint.
//  - Le service ne se lance jamais tout seul (ni au démarrage du téléphone, ni depuis un message push) : toujours un geste.
//
// Écran éteint / WebView en arrière-plan :
//  - Capacitor garde la WebView active par défaut (préférence KeepRunning = true, jamais changée ici) : ni
//    WebView.onPause() ni pauseTimers() ne sont appelés. Le plugin refait en plus onResume()/resumeTimers() quand
//    l'activité passe en pause/arrêt avec le talkie actif (ceinture et bretelles).
//  - Le service est un service au premier plan (processus protégé) + verrou CPU partiel : le réseau et le JavaScript
//    continuent écran éteint. Chromium ralentit seulement les minuteries (setTimeout) d'une page cachée ; la capture
//    micro et la lecture audio d'une page ne sont pas gelées. La page doit éviter de dépendre de minuteries précises.
//  - Conseil pour talkie.js : ouvrir le micro (getUserMedia) pendant que l'appli est visible, au moment de start(),
//    puis couper/rouvrir la piste (track.enabled) à chaque prise de parole, au lieu de rouvrir getUserMedia en arrière-plan.
//
// Bouton du casque → page web : méthode choisie = bridge.eval() (JavaScript évalué directement dans la WebView).
//  Raison : notifyListeners() passe par la file de messages de Capacitor et exige que la page ait déjà fait
//  addListener() ; eval ne dépend de rien, arrive tout de suite, et marche écran éteint tant que la WebView existe.
//  Le service tient son propre état « je parle » (un appui = on/off), indépendamment de la page.
//  Pour chaque appui : window.dispatchEvent(new CustomEvent('mr-talkie-native', {detail:{type:'button', source, talking, channel}}))
//  puis window.MrTalkie.toggle(). Autres événements (detail.type) : 'timeout' (30 s max de parole : pttUp() ou toggle()),
//  'focus' (un appel téléphonique ou une autre appli a pris le son : fin de parole), 'stop' (service arrêté ;
//  detail.source = notification | plugin | task-removed | activity-destroyed | system).
//
// Boutons du casque : MrTalkieService crée sa propre MediaSession. Tant qu'il tourne, elle est « en lecture » et Android lui
// envoie les boutons (dernière session passée en lecture) ; MrMusicService reprend la main dès que le talkie s'arrête.
// Si la musique change d'état pendant le talkie, MrMusicService appelle MrTalkieService.reclaimButtons() pour les reprendre.
// Suivant/Précédent du casque restent envoyés au lecteur de musique (s'il tourne).
//
// Son : focus AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK demandé tant que le motard parle ou reçoit (la page l'indique avec
//  MrTalkie.state({receiving:true/false}) ; talking est connu du natif par le bouton, ou via state({talking})).
//  Les autres applis baissent leur volume. La musique de MotoRoute elle-même (WebView) n'est pas concernée par le focus
//  Android : c'est à la page de baisser son lecteur.
//  Casque Bluetooth : mode MODE_IN_COMMUNICATION + setCommunicationDevice (Android 12+) ou startBluetoothSco (avant),
//  pendant TOUTE la durée du talkie, uniquement si un casque Bluetooth est connecté. Limite connue : le profil
//  téléphone (SCO/HFP) est en qualité « voix » : la musique du casque devient étroite/mono tant que le talkie est actif,
//  et le volume suit le volume « appel ». Sans casque, rien n'est modifié (haut-parleur/écouteur filaire habituel).
// ---------------------------------------------------------------------------------------------
fs.writeFileSync(javaDir + '/MrTalkiePlugin.java', `package com.motoroute.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import org.json.JSONObject;

// Plugin « MrTalkie » : start({channel, lang?, bluetooth?}) · stop() · isRunning() · state({talking?, receiving?})
@CapacitorPlugin(
    name = "MrTalkie",
    permissions = {
        @Permission(alias = "micro", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class MrTalkiePlugin extends Plugin {
    static volatile MrTalkiePlugin inst = null;
    private final Handler h = new Handler(Looper.getMainLooper());
    private PluginCall pendingStart = null;
    private final Runnable startTimeout = new Runnable() {
        public void run() { finishStart(false, "service-sans-reponse", "", "none"); }
    };

    @Override
    public void load() { inst = this; }

    // Écran qui s'éteint / appli en arrière-plan : on s'assure que la WebView ne dort pas tant que le talkie tourne
    @Override
    protected void handleOnPause() { keepWebViewAwake(); }

    @Override
    protected void handleOnStop() { keepWebViewAwake(); }

    private void keepWebViewAwake() {
        if (MrTalkieService.inst == null || getBridge() == null) return;
        getBridge().executeOnMainThread(new Runnable() {
            public void run() {
                try {
                    android.webkit.WebView w = getBridge().getWebView();
                    if (w != null) { w.onResume(); w.resumeTimers(); }
                } catch (Throwable e) {}
            }
        });
    }

    // La page (qui fait la voix) disparaît : micro ouvert sans page = inutile et gênant (voyant micro). On arrête le service.
    @Override
    protected void handleOnDestroy() {
        MrTalkieService s = MrTalkieService.inst;
        if (s != null) {
            s.stopReason = "activity-destroyed";
            try { getContext().stopService(new Intent(getContext(), MrTalkieService.class)); } catch (Exception e) {}
        }
        if (inst == this) inst = null;
    }

    // JavaScript évalué dans la WebView (voir le commentaire de patch-android.js : choisi plutôt que notifyListeners)
    static void js(final String code) {
        final MrTalkiePlugin p = inst;
        if (p == null) return;
        try { if (p.getBridge() != null) p.getBridge().eval(code, null); } catch (Throwable e) {}
    }

    // Construit le JavaScript : événement 'mr-talkie-native' puis, si demandé, appel de window.MrTalkie.<fn>()
    static String eventJs(String type, String source, boolean talking, String channel, String fn) {
        StringBuilder b = new StringBuilder();
        b.append("(function(){var d={type:'").append(type).append("',source:'").append(source)
         .append("',talking:").append(talking).append(",channel:").append(JSONObject.quote(channel == null ? "" : channel)).append("};");
        b.append("try{window.dispatchEvent(new CustomEvent('mr-talkie-native',{detail:d}));}catch(e){}");
        if (fn != null) {
            b.append("try{var T=window.MrTalkie;");
            if ("pttUp".equals(fn)) b.append("if(T&&typeof T.pttUp==='function')T.pttUp();else if(T&&typeof T.toggle==='function')T.toggle();");
            else b.append("if(T&&typeof T.").append(fn).append("==='function')T.").append(fn).append("();");
            b.append("}catch(e){}");
        }
        b.append("})();");
        return b.toString();
    }

    @PluginMethod
    public void start(final PluginCall call) {
        if (pendingStart != null) { call.reject("deja-en-cours"); return; }
        boolean wantBt = !Boolean.FALSE.equals(call.getBoolean("bluetooth", true));
        ArrayList<String> need = new ArrayList<>();
        if (getPermissionState("micro") != PermissionState.GRANTED) need.add("micro");
        if (wantBt && Build.VERSION.SDK_INT >= 31) {
            PermissionState b = getPermissionState("bluetooth");
            if (b == PermissionState.PROMPT || b == PermissionState.PROMPT_WITH_RATIONALE) need.add("bluetooth");
        }
        if (!need.isEmpty()) { requestPermissionForAliases(need.toArray(new String[0]), call, "permDone"); return; }
        launch(call);
    }

    // Le micro est obligatoire (Android 14 : sans lui startForeground lève une SecurityException) ; le Bluetooth est facultatif
    @PermissionCallback
    private void permDone(PluginCall call) {
        if (getPermissionState("micro") != PermissionState.GRANTED) { call.reject("no-permission-micro"); return; }
        launch(call);
    }

    private void launch(PluginCall call) {
        Context c = getContext();
        Intent i = new Intent(c, MrTalkieService.class).setAction(MrTalkieService.START)
            .putExtra("channel", call.getString("channel", ""))
            .putExtra("lang", call.getString("lang", ""))
            .putExtra("bluetooth", !Boolean.FALSE.equals(call.getBoolean("bluetooth", true)));
        synchronized (this) { pendingStart = call; }
        h.postDelayed(startTimeout, 6000);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception e) {
            // Android 12+ : ForegroundServiceStartNotAllowedException quand l'appli n'est pas visible
            String n = e.getClass().getSimpleName();
            finishStart(false, n.contains("NotAllowed") ? "demarrage-interdit-arriere-plan" : "service-refuse", "", "none");
        }
    }

    private synchronized PluginCall takePending() {
        PluginCall c = pendingStart;
        pendingStart = null;
        return c;
    }

    private void finishStart(boolean ok, String code, String channel, String route) {
        h.removeCallbacks(startTimeout);
        PluginCall call = takePending();
        if (call == null) return;
        if (!ok) { call.reject(code); return; }
        JSObject r = new JSObject();
        r.put("running", true);
        r.put("channel", channel);
        r.put("audioRoute", route);
        call.resolve(r);
    }

    // Réponse du service : lancé (ok) ou refusé par Android (code)
    static void startResult(final boolean ok, final String code, final String channel, final String route) {
        final MrTalkiePlugin p = inst;
        if (p == null) return;
        p.h.post(new Runnable() { public void run() { p.finishStart(ok, code, channel, route); } });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        MrTalkieService s = MrTalkieService.inst;
        if (s != null) s.stopReason = "plugin";
        try { getContext().stopService(new Intent(getContext(), MrTalkieService.class)); } catch (Exception e) {}
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        MrTalkieService s = MrTalkieService.inst;
        JSObject r = new JSObject();
        boolean on = s != null && s.active;
        r.put("running", on);
        r.put("talking", on && s.talking);
        r.put("channel", on ? s.channel : "");
        r.put("audioRoute", on ? s.audioRoute : "none");
        call.resolve(r);
    }

    // Facultatif : la page dit au natif où elle en est (sert au focus audio, à la notification et au délai de 30 s)
    @PluginMethod
    public void state(PluginCall call) {
        final MrTalkieService s = MrTalkieService.inst;
        JSObject r = new JSObject();
        r.put("running", s != null && s.active);
        if (s != null) {
            final Boolean t = call.getBoolean("talking");
            final Boolean rc = call.getBoolean("receiving");
            h.post(new Runnable() { public void run() { s.applyState(t, rc); } });
        }
        call.resolve(r);
    }
}
`);

fs.writeFileSync(javaDir + '/MrTalkieService.java', `package com.motoroute.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.view.KeyEvent;
import androidx.core.app.NotificationCompat;
import java.util.Locale;

// Service au premier plan de type « microphone » du talkie-walkie (voir le long commentaire de patch-android.js)
public class MrTalkieService extends Service {
    static volatile MrTalkieService inst = null;
    static final String START = "com.motoroute.app.TALKIE_START";
    static final String CH = "mr_talkie_v1";
    private static final int NID = 12001;
    static final long TALK_MAX_MS = 30000L;       // sécurité : une prise de parole ne dépasse jamais 30 s
    private static final long RECEIVE_MAX_MS = 45000L; // « réception » non renouvelée par la page : on rend le son

    volatile boolean active = false;
    volatile boolean talking = false;
    volatile String channel = "";
    volatile String audioRoute = "none";           // none | off | bt-sco | bt-refuse | bt-erreur
    volatile String stopReason = "system";
    private boolean receiving = false, useBt = true, hasFocus = false, routed = false, modeSaved = false;
    private int savedMode = AudioManager.MODE_NORMAL;
    private String lang = "fr", lastWhy = "service-refuse";
    private long lastPress = 0;
    private MediaSessionCompat session;
    private PowerManager.WakeLock cpu;
    private AudioManager am;
    private AudioFocusRequest focusReq;
    private AudioDeviceCallback devCb;
    private final Handler h = new Handler(Looper.getMainLooper());

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        inst = this;
        am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
    }

    // ---------- textes (langue du téléphone, ou lang={fr|ar|en} donné par la page) ----------
    private String L(String fr, String ar, String en) { return "ar".equals(lang) ? ar : "en".equals(lang) ? en : fr; }

    private static String pickLang(String wanted) {
        String l = wanted == null ? "" : wanted.trim().toLowerCase(Locale.ROOT);
        if (l.length() < 2) l = Locale.getDefault().getLanguage();
        if (l.startsWith("ar")) return "ar";
        if (l.startsWith("en")) return "en";
        return "fr";
    }

    private static String clean(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder();
        for (int k = 0; k < s.length() && b.length() < 40; k++) {
            char c = s.charAt(k);
            b.append(Character.isISOControl(c) ? ' ' : c);
        }
        return b.toString().trim();
    }

    private String title() {
        if (channel.isEmpty()) return L("📻 Talkie-walkie", "📻 جهاز اللاسلكي", "📻 Walkie-talkie");
        return L("📻 Talkie-walkie — canal ", "📻 جهاز اللاسلكي — القناة ", "📻 Walkie-talkie — channel ") + channel;
    }

    private PendingIntent act(String a, int code) {
        Intent i = new Intent(this, MrTalkieService.class).setAction(a);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void makeChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CH) != null) return;
        NotificationChannel ch = new NotificationChannel(CH, L("Talkie-walkie MotoRoute", "جهاز اللاسلكي - موتوروت", "MotoRoute walkie-talkie"), NotificationManager.IMPORTANCE_LOW);
        ch.setDescription(L("Affichée tant que le talkie-walkie est actif (micro ouvert).", "تظهر طالما كان جهاز اللاسلكي يعمل (الميكروفون مفتوح).", "Shown while the walkie-talkie is on (microphone open)."));
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    private Notification build() {
        Intent o = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(this, NID, o, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = talking ? L("🎙 Tu parles…", "🎙 أنت تتحدّث…", "🎙 You are talking…")
            : receiving ? L("🔊 Réception…", "🔊 استقبال…", "🔊 Receiving…")
            : L("Prêt — appuie sur le bouton du casque pour parler", "جاهز — اضغط زر الخوذة للتحدّث", "Ready — press your headset button to talk");
        return new NotificationCompat.Builder(this, CH)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(title())
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(android.R.drawable.ic_btn_speak_now, talking ? L("Fin de parole", "انتهيت", "Done") : L("Parler", "تحدّث", "Talk"), act("mr.talkie.ptt", 1))
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, L("Arrêter", "إيقاف", "Stop"), act("mr.talkie.stop", 2))
            .build();
    }

    private void refresh() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NID, build());
        } catch (Exception e) {}
    }

    // Code d'erreur donné à la page quand Android refuse le service
    private static String why(Exception e) {
        if (e.getClass().getSimpleName().contains("NotAllowed")) return "demarrage-interdit-arriere-plan";
        if (e instanceof SecurityException) return "micro-refuse"; // autorisation micro absente, ou appli pas visible (Android 14+)
        return "service-refuse";
    }

    private boolean goForeground() {
        try {
            Notification n = build();
            if (Build.VERSION.SDK_INT >= 30) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(NID, n);
            return true;
        } catch (Exception e) {
            lastWhy = why(e);
            return false;
        }
    }

    // ---------- démarrage / arrêt ----------
    @Override
    public int onStartCommand(Intent i, int flags, int startId) {
        String a = i == null ? null : i.getAction();
        if (START.equals(a)) { begin(i); return START_NOT_STICKY; }
        // bouton de notification arrivé alors que le talkie n'est plus actif : on ne reste pas là pour rien
        if (!active) { stopSelf(); return START_NOT_STICKY; }
        if ("mr.talkie.ptt".equals(a)) toggleTalking("notification");
        else if ("mr.talkie.stop".equals(a)) { stopReason = "notification"; stopSelf(); }
        return START_NOT_STICKY;
    }

    private void begin(Intent i) {
        channel = clean(i.getStringExtra("channel"));
        lang = pickLang(i.getStringExtra("lang"));
        useBt = i.getBooleanExtra("bluetooth", true);
        makeChannel();
        if (active) { refresh(); route(); MrTalkiePlugin.startResult(true, null, channel, audioRoute); return; }
        if (!goForeground()) {
            // Android refuse (micro non accordé, appli pas visible…) : on le dit à la page, sans planter
            MrTalkiePlugin.startResult(false, lastWhy, channel, "none");
            stopSelf();
            return;
        }
        active = true;
        stopReason = "system";
        talking = false;
        receiving = false;
        startSession();
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MotoRoute:talkie");
            cpu.setReferenceCounted(false);
            cpu.acquire(4 * 60 * 60 * 1000L);
        } catch (Exception e) {}
        watchDevices();
        route();
        MrTalkiePlugin.startResult(true, null, channel, audioRoute);
    }

    // ---------- boutons du casque (session média dédiée) ----------
    private PlaybackStateCompat pb(int st) {
        return new PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
            .setState(st, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, st == PlaybackStateCompat.STATE_PLAYING ? 1f : 0f).build();
    }

    private void startSession() {
        session = new MediaSessionCompat(this, "MotoRoute-Talkie");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override
            @SuppressWarnings("deprecation")
            public boolean onMediaButtonEvent(Intent e) {
                KeyEvent ke = e == null ? null : (KeyEvent) e.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                if (ke == null) return false;
                int k = ke.getKeyCode();
                boolean down = ke.getAction() == KeyEvent.ACTION_DOWN && ke.getRepeatCount() == 0;
                if (k == KeyEvent.KEYCODE_HEADSETHOOK || k == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                    || k == KeyEvent.KEYCODE_MEDIA_PLAY || k == KeyEvent.KEYCODE_MEDIA_PAUSE) {
                    if (down) toggleTalking("headset");
                    return true;
                }
                if (k == KeyEvent.KEYCODE_MEDIA_NEXT) { if (down) toMusic("next"); return true; }
                if (k == KeyEvent.KEYCODE_MEDIA_PREVIOUS) { if (down) toMusic("prev"); return true; }
                return super.onMediaButtonEvent(e);
            }
            // certains casques envoient play/pause par commande de transport et non par touche : même effet (anti-doublon dans toggleTalking)
            @Override public void onPlay() { toggleTalking("headset"); }
            @Override public void onPause() { toggleTalking("headset"); }
            @Override public void onSkipToNext() { toMusic("next"); }
            @Override public void onSkipToPrevious() { toMusic("prev"); }
        });
        session.setMetadata(new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title())
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "MotoRoute").build());
        session.setPlaybackState(pb(PlaybackStateCompat.STATE_PLAYING));
        session.setActive(true);
    }

    // Les pistes suivant/précédent restent à la musique si elle tourne
    private void toMusic(String action) { if (MrMusicService.inst != null) MrMusicPlugin.emit(action); }

    // Appelé par MrMusicService quand sa session change d'état : repasser PAUSED puis PLAYING redonne la priorité aux boutons
    static void reclaimButtons() {
        final MrTalkieService s = inst;
        if (s == null || !s.active) return;
        s.h.post(new Runnable() { public void run() {
            if (!s.active || s.session == null) return;
            try {
                s.session.setPlaybackState(s.pb(PlaybackStateCompat.STATE_PAUSED));
                s.session.setPlaybackState(s.pb(PlaybackStateCompat.STATE_PLAYING));
            } catch (Exception e) {}
        }});
    }

    // ---------- prise de parole ----------
    private void toggleTalking(String source) {
        if (!active) return;
        long now = SystemClock.uptimeMillis();
        if (now - lastPress < 400) return; // un appui = un seul basculement (touche + commande de transport, rebonds)
        lastPress = now;
        setTalking(!talking);
        MrTalkiePlugin.js(MrTalkiePlugin.eventJs("button", source, talking, channel, "toggle"));
    }

    private final Runnable talkTimeout = new Runnable() {
        public void run() {
            if (!talking) return;
            setTalking(false);
            MrTalkiePlugin.js(MrTalkiePlugin.eventJs("timeout", "timer", false, channel, "pttUp"));
        }
    };

    private final Runnable recvTimeout = new Runnable() {
        public void run() { receiving = false; updateFocus(); refresh(); }
    };

    private void setTalking(boolean t) {
        talking = t;
        h.removeCallbacks(talkTimeout);
        if (t) h.postDelayed(talkTimeout, TALK_MAX_MS);
        updateFocus();
        refresh();
    }

    // état annoncé par la page (facultatif)
    void applyState(Boolean t, Boolean r) {
        if (!active) return;
        if (t != null && t.booleanValue() != talking) setTalking(t.booleanValue());
        if (r != null) {
            receiving = r.booleanValue();
            h.removeCallbacks(recvTimeout);
            if (receiving) h.postDelayed(recvTimeout, RECEIVE_MAX_MS);
            updateFocus();
            refresh();
        }
    }

    // ---------- focus audio : baisser les autres applis pendant qu'on parle ou qu'on reçoit ----------
    private final AudioManager.OnAudioFocusChangeListener focusListener = new AudioManager.OnAudioFocusChangeListener() {
        public void onAudioFocusChange(int change) {
            if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                // appel téléphonique ou autre appli qui prend tout le son : on arrête la prise de parole
                hasFocus = false;
                if (talking) {
                    setTalking(false);
                    MrTalkiePlugin.js(MrTalkiePlugin.eventJs("focus", "system", false, channel, "pttUp"));
                }
            }
        }
    };

    private final Runnable abandonFocus = new Runnable() {
        public void run() { if (!(talking || receiving)) dropFocus(); }
    };

    private void updateFocus() {
        h.removeCallbacks(abandonFocus);
        if (talking || receiving) { if (!hasFocus) takeFocus(); }
        else if (hasFocus) h.postDelayed(abandonFocus, 800); // petit délai : pas de « pompage » entre deux messages rapprochés
    }

    private void takeFocus() {
        if (am == null) return;
        try {
            int r;
            if (Build.VERSION.SDK_INT >= 26) {
                focusReq = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setOnAudioFocusChangeListener(focusListener, h)
                    .build();
                r = am.requestAudioFocus(focusReq);
            } else {
                r = am.requestAudioFocus(focusListener, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
            hasFocus = r == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } catch (Exception e) { hasFocus = false; }
    }

    private void dropFocus() {
        if (am == null) return;
        try {
            if (Build.VERSION.SDK_INT >= 26) { if (focusReq != null) am.abandonAudioFocusRequest(focusReq); }
            else am.abandonAudioFocus(focusListener);
        } catch (Exception e) {}
        hasFocus = false;
    }

    // ---------- casque Bluetooth : micro et son par la voie « téléphone » (SCO) ----------
    private final Runnable reroute = new Runnable() { public void run() { if (active) route(); } };

    private void watchDevices() {
        if (am == null) return;
        try {
            devCb = new AudioDeviceCallback() {
                @Override public void onAudioDevicesAdded(AudioDeviceInfo[] d) { h.removeCallbacks(reroute); h.postDelayed(reroute, 400); }
                @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] d) { h.removeCallbacks(reroute); h.postDelayed(reroute, 400); }
            };
            am.registerAudioDeviceCallback(devCb, h);
        } catch (Exception e) { devCb = null; }
    }

    private void saveMode() {
        if (!modeSaved) { savedMode = am.getMode(); modeSaved = true; }
    }

    private void route() {
        if (am == null) return;
        try {
            if (!useBt) { releaseRoute(); audioRoute = "off"; return; }
            if (Build.VERSION.SDK_INT >= 31) {
                AudioDeviceInfo bt = null;
                for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                    int t = d.getType();
                    if (t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || t == AudioDeviceInfo.TYPE_BLE_HEADSET) { bt = d; break; }
                }
                if (bt == null) { releaseRoute(); audioRoute = "none"; return; }
                AudioDeviceInfo cur = am.getCommunicationDevice();
                if (routed && cur != null && cur.getId() == bt.getId()) { audioRoute = "bt-sco"; return; }
                saveMode();
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                if (am.setCommunicationDevice(bt)) { routed = true; audioRoute = "bt-sco"; }
                else { releaseRoute(); audioRoute = "bt-refuse"; }
            } else {
                boolean bt = false;
                for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                    int t = d.getType();
                    if (t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) bt = true;
                }
                if (!bt) { releaseRoute(); audioRoute = "none"; return; }
                if (routed) { audioRoute = "bt-sco"; return; }
                saveMode();
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.startBluetoothSco();
                am.setBluetoothScoOn(true);
                routed = true;
                audioRoute = "bt-sco";
            }
        } catch (Throwable e) {
            releaseRoute();
            audioRoute = "bt-erreur"; // ex. autorisation Bluetooth refusée : le talkie marche quand même avec le micro du téléphone
        }
    }

    private void releaseRoute() {
        if (am == null || !(routed || modeSaved)) return;
        try {
            if (routed) {
                if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
                else { am.stopBluetoothSco(); am.setBluetoothScoOn(false); }
            }
        } catch (Throwable e) {}
        // on ne remet pas le mode si un appel téléphonique l'a changé entre-temps
        try { if (modeSaved && am.getMode() == AudioManager.MODE_IN_COMMUNICATION) am.setMode(savedMode); } catch (Throwable e) {}
        routed = false;
        modeSaved = false;
    }

    // ---------- fin ----------
    // Android 15+ : si un type de service reçoit une limite de durée, on s'arrête proprement au lieu de provoquer une erreur
    public void onTimeout(int startId) { stopReason = "timeout"; stopSelf(); }
    public void onTimeout(int startId, int type) { stopReason = "timeout"; stopSelf(); }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // l'appli est balayée de l'écran des applis récentes : la page n'existe plus, le micro doit se fermer
        stopReason = "task-removed";
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        boolean was = active;
        active = false;
        talking = false;
        receiving = false;
        if (inst == this) inst = null;
        h.removeCallbacksAndMessages(null);
        dropFocus();
        releaseRoute();
        try { if (devCb != null && am != null) am.unregisterAudioDeviceCallback(devCb); } catch (Exception e) {}
        devCb = null;
        try { if (session != null) { session.setActive(false); session.release(); } } catch (Exception e) {}
        try { if (cpu != null && cpu.isHeld()) cpu.release(); } catch (Exception e) {}
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        } catch (Exception e) {}
        if (was) MrTalkiePlugin.js(MrTalkiePlugin.eventJs("stop", stopReason, false, channel, null));
        super.onDestroy();
    }
}
`);

{
  // MainActivity : enregistrement du plugin MrTalkie (à côté de MrSms et MrMusic)
  const mp = javaDir + '/MainActivity.java';
  let ma = fs.readFileSync(mp, 'utf8');
  if (!ma.includes('MrTalkiePlugin')) ma = ma.replace('registerPlugin(MrMusicPlugin.class);', 'registerPlugin(MrMusicPlugin.class);\n        registerPlugin(MrTalkiePlugin.class);');
  if (!ma.includes('MrTalkiePlugin')) throw new Error('patch-android : MainActivity sans MrTalkiePlugin');
  fs.writeFileSync(mp, ma);

  // Manifeste : service « microphone » + autorisations (RECORD_AUDIO et MODIFY_AUDIO_SETTINGS existent déjà plus haut)
  const talkiePerms = ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MICROPHONE', 'android.permission.RECORD_AUDIO',
    'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.WAKE_LOCK', 'android.permission.BLUETOOTH_CONNECT'];
  let m = fs.readFileSync(path, 'utf8');
  for (const p of talkiePerms) {
    if (!m.includes(`"${p}"`)) m = m.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
  }
  // sans ces lignes, RECORD_AUDIO rend le micro « obligatoire » et Google Play cacherait l'appli aux tablettes sans micro
  for (const f of ['android.hardware.microphone', 'android.hardware.bluetooth']) {
    if (!m.includes(`"${f}"`)) m = m.replace('</manifest>', `    <uses-feature android:name="${f}" android:required="false" />\n</manifest>`);
  }
  if (!m.includes('MrTalkieService')) m = m.replace('</application>', '        <service android:name=".MrTalkieService" android:exported="false" android:foregroundServiceType="microphone" />\n    </application>');
  fs.writeFileSync(path, m);

  // contrôle : si le manifeste n'est pas conforme Android 14+, la fabrication s'arrête ici
  const svc = m.match(/<service[^>]*\.MrTalkieService[^>]*>/);
  if (!svc || !svc[0].includes('android:foregroundServiceType="microphone"')) throw new Error('patch-android : MrTalkieService sans foregroundServiceType="microphone"');
  for (const p of talkiePerms) if (!m.includes(`"${p}"`)) throw new Error('patch-android : autorisation talkie manquante : ' + p);
  console.log('Talkie-walkie : plugin MrTalkie + service MrTalkieService (micro au premier plan, bouton du casque, focus audio, Bluetooth)');
}

// ---------------------------------------------------------------------------------------------
// 29/10 : Google Play exige targetSdk 36 (Android 16). Capacitor 7 génère 35 : on monte compileSdk et
// targetSdk à 36, et l'outil de fabrication Android (AGP) au moins à 8.10.1 (API 36 demande AGP ≥ 8.9.1,
// AGP 8.10 accepte jusqu'à l'API 36 et fonctionne avec Gradle 8.11.1, celui de Capacitor 7).
// Chaque remplacement est vérifié : si Capacitor change ses fichiers, la fabrication s'arrête au lieu de
// produire une appli refusée par Google Play.
// ---------------------------------------------------------------------------------------------
{
  const SDK = 36;
  const vg = 'android/variables.gradle';
  let v = fs.readFileSync(vg, 'utf8');
  v = v.replace(/compileSdkVersion\s*=\s*\d+/, `compileSdkVersion = ${SDK}`)
       .replace(/targetSdkVersion\s*=\s*\d+/, `targetSdkVersion = ${SDK}`);
  if (!new RegExp(`compileSdkVersion = ${SDK}\\b`).test(v) || !new RegExp(`targetSdkVersion = ${SDK}\\b`).test(v))
    throw new Error('patch-android : compileSdkVersion/targetSdkVersion introuvables dans variables.gradle');
  fs.writeFileSync(vg, v);

  const ver = s => s.split('.').map(n => parseInt(n, 10) || 0);
  const lower = (a, b) => { const x = ver(a), y = ver(b); for (let k = 0; k < 3; k++) { if ((x[k] || 0) !== (y[k] || 0)) return (x[k] || 0) < (y[k] || 0); } return false; };

  const rg = 'android/build.gradle';
  let r = fs.readFileSync(rg, 'utf8');
  const agp = r.match(/com\.android\.tools\.build:gradle:([\d.]+)/);
  if (!agp) throw new Error('patch-android : version AGP introuvable dans android/build.gradle');
  const AGP_MIN = '8.10.1';
  if (lower(agp[1], AGP_MIN)) {
    r = r.replace(agp[0], `com.android.tools.build:gradle:${AGP_MIN}`);
    fs.writeFileSync(rg, r);
  }

  const wp = 'android/gradle/wrapper/gradle-wrapper.properties';
  let w = fs.readFileSync(wp, 'utf8');
  const gv = w.match(/gradle-([\d.]+)-(all|bin)\.zip/);
  if (!gv) throw new Error('patch-android : version Gradle introuvable dans gradle-wrapper.properties');
  if (lower(gv[1], '8.11.1')) { w = w.replace(gv[0], `gradle-8.11.1-${gv[2]}.zip`); fs.writeFileSync(wp, w); }

  console.log(`Android : compileSdk ${SDK}, targetSdk ${SDK}, AGP ${lower(agp[1], AGP_MIN) ? AGP_MIN : agp[1]}, Gradle ${lower(gv[1], '8.11.1') ? '8.11.1' : gv[1]}`);
}

// 29/10 : autorisations refusées par Google Play pour MotoRoute. On les retire du manifeste, et on demande
// à Android de les supprimer même si une bibliothèque les ajoutait (tools:node="remove").
{
  const banned = ['android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO', 'android.permission.READ_PHONE_STATE'];
  let m = fs.readFileSync(path, 'utf8');
  if (!m.includes('xmlns:tools=')) m = m.replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ');
  for (const p of banned) {
    m = m.replace(new RegExp(`[ \\t]*<uses-permission[^>]*android:name="${p.replace(/\./g, '\\.')}"[^>]*/>\\r?\\n?`, 'g'), '');
    m = m.replace('</manifest>', `    <uses-permission android:name="${p}" tools:node="remove" />\n</manifest>`);
  }
  // contrôle : chaque autorisation interdite n'apparaît plus qu'une fois, avec tools:node="remove"
  for (const p of banned) {
    const hits = m.match(new RegExp(`<uses-permission[^>]*"${p.replace(/\./g, '\\.')}"[^>]*>`, 'g')) || [];
    if (hits.length !== 1 || !hits[0].includes('tools:node="remove"')) throw new Error('patch-android : ' + p + ' encore demandée');
  }
  fs.writeFileSync(path, m);
  console.log('Autorisations retirées (Google Play) : ' + banned.map(p => p.split('.').pop()).join(', '));
}
