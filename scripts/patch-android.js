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
