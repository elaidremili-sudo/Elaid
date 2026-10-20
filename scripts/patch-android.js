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
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.telephony.SmsManager;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;

@CapacitorPlugin(
    name = "MrSms",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS }),
        @Permission(alias = "call", strings = { Manifest.permission.CALL_PHONE })
    }
)
public class MrSmsPlugin extends Plugin {
    @PluginMethod
    public void send(PluginCall call) {
        String to = call.getString("to");
        String msg = call.getString("msg");
        if (to == null || to.isEmpty() || msg == null) { call.reject("numero-manquant"); return; }
        if (getPermissionState("sms") != PermissionState.GRANTED) { call.reject("no-permission"); return; }
        try {
            SmsManager sm = Build.VERSION.SDK_INT >= 31
                ? getContext().getSystemService(SmsManager.class)
                : SmsManager.getDefault();
            ArrayList<String> parts = sm.divideMessage(msg);
            sm.sendMultipartTextMessage(to, null, parts, null, null);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "erreur" : e.getMessage());
        }
    }

    @PluginMethod
    public void dial(PluginCall call) {
        String to = call.getString("to");
        if (to == null || to.isEmpty()) { call.reject("numero-manquant"); return; }
        boolean direct = getPermissionState("call") == PermissionState.GRANTED;
        try {
            Intent i = new Intent(direct ? Intent.ACTION_CALL : Intent.ACTION_DIAL, Uri.parse("tel:" + to));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
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
