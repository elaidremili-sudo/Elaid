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
