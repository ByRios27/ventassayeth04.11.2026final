// Lee los registros de lecturas (colección read_meter) de un día y genera un resumen.
// Uso: node scripts/read-meter-report.mjs [AAAA-MM-DD]
// Cuesta una lectura por dispositivo registrado ese día.
import fs from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const date = process.argv[2] || new Date().toLocaleDateString('sv-SE');
const sa = JSON.parse(fs.readFileSync('credentials/chances-v5-target-sa.json', 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const snap = await db.collection('read_meter')
  .where('date', '==', date)
  .get();

const devices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(`reports/read-meter-${date}.json`, JSON.stringify(devices, null, 2));

const total = (o) => Object.values(o || {}).reduce((s, b) => s + (b.docs || 0), 0);
const agg = {};
const aggTab = {};
const byRole = {};
const byHour = {};
for (const d of devices) {
  byRole[d.role] ??= { devices: 0, docs: 0 };
  byRole[d.role].devices += 1;
  byRole[d.role].docs += d.totalDocsFromServer || 0;
  for (const [k, b] of Object.entries(d.byKey || {})) {
    const a = (agg[k] ??= { docs: 0, cacheDocs: 0, calls: 0, opens: 0 });
    a.docs += b.docs; a.cacheDocs += b.cacheDocs; a.calls += b.calls; a.opens += b.opens;
  }
  for (const [k, b] of Object.entries(d.byTab || {})) {
    const a = (aggTab[k] ??= { docs: 0, opens: 0 });
    a.docs += b.docs; a.opens += b.opens;
  }
  for (const [h, n] of Object.entries(d.byHour || {})) byHour[h] = (byHour[h] || 0) + n;
}

console.log(`Fecha ${date}: ${devices.length} dispositivos, ${devices.reduce((s, d) => s + (d.totalDocsFromServer || 0), 0)} documentos leídos del servidor`);
console.log('\nPor rol:'); console.table(byRole);
console.log('\nPor consulta (top 15):');
console.table(Object.fromEntries(Object.entries(agg).sort((a, b) => b[1].docs - a[1].docs).slice(0, 15)));
console.log('\nPor pestaña|consulta (top 15):');
console.table(Object.fromEntries(Object.entries(aggTab).sort((a, b) => b[1].docs - a[1].docs).slice(0, 15)));
console.log('\nPor hora:'); console.table(byHour);
console.log(`\nDetalle completo en reports/read-meter-${date}.json`);
