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
