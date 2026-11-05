// Siembra datos de prueba SOLO en los emuladores locales (nunca en producción).
import admin from 'firebase-admin';

const PROJECT_ID = 'demo-chances-local';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';

if (!process.env.FIRESTORE_EMULATOR_HOST.startsWith('127.0.0.1') || !PROJECT_ID.startsWith('demo-')) {
  throw new Error('Este script solo puede apuntar a los emuladores locales.');
}

admin.initializeApp({ projectId: PROJECT_ID });
const auth = admin.auth();
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const PASSWORD = 'local1234';
const DOMAIN = 'local.test';
const DAYS_BACK = 3;

const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rnd(0, arr.length - 1)];
const pad = (n, len) => String(n).padStart(len, '0');
const fmtDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;

const FIRST_NAMES = ['Carlos', 'María', 'José', 'Ana', 'Luis', 'Carmen', 'Pedro', 'Rosa', 'Miguel', 'Laura', 'Jorge', 'Elena', 'Andrés', 'Sofía', 'Diego', 'Paola', 'Ramón', 'Lucía', 'Héctor', 'Julia'];
const LAST_NAMES = ['Pérez', 'Gómez', 'Rodríguez', 'López', 'Martínez', 'Díaz', 'Torres', 'Ramírez', 'Castro', 'Vega'];
const CUSTOMERS = ['', 'Don Tito', 'Doña Mery', 'Juan', 'Tienda La Esquina', 'Cliente 1', 'Cliente 2', 'Pablo', ''];

const people = [];
for (let i = 1; i <= 2; i++) people.push({ username: `ceo${pad(i + 1, 2)}`, role: 'ceo', commissionRate: 15, canLiquidate: true });
for (let i = 1; i <= 3; i++) people.push({ username: `admin${pad(i, 2)}`, role: 'admin', commissionRate: 15, canLiquidate: i === 1 });
for (let i = 1; i <= 15; i++) people.push({ username: `vendedor${pad(i, 2)}`, role: 'seller', commissionRate: 15, canLiquidate: false });

const LOTTERIES = [
  { id: 'nacional', name: 'Nacional', drawTime: '12:00', isFourDigits: true },
  { id: 'tica', name: 'Tica', drawTime: '13:30', isFourDigits: false },
  { id: 'panama', name: 'Panamá', drawTime: '16:00', isFourDigits: true },
  { id: 'nica', name: 'Nica', drawTime: '18:00', isFourDigits: false },
  { id: 'caracas', name: 'Caracas', drawTime: '20:00', isFourDigits: false },
  { id: 'noche', name: 'La Noche', drawTime: '22:00', isFourDigits: true }
];

async function ensureUser({ username, role, commissionRate, canLiquidate }, index) {
  const email = `${username}@${DOMAIN}`;
  const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  let record;
  try {
    record = await auth.getUserByEmail(email);
  } catch {
    record = await auth.createUser({ email, password: PASSWORD, displayName: name });
  }
  await auth.setCustomUserClaims(record.uid, { role, isPrimaryCeo: false });
  const sellerId = `${role === 'seller' ? 'V' : role === 'admin' ? 'A' : 'C'}${pad(index + 1, 3)}`;
  await db.doc(`users/${email}`).set({
    email, name, role, commissionRate, status: 'active', canLiquidate, sellerId, currentDebt: 0
  }, { merge: true });
  return { uid: record.uid, email, name, role, commissionRate, sellerId };
}

function randomBets(selected) {
  const count = rnd(1, 6);
  const bets = [];
  for (let i = 0; i < count; i++) {
    const lot = pick(selected);
    const type = lot.isFourDigits ? pick(['CH', 'CH', 'BL', 'PL']) : pick(['CH', 'CH', 'CH', 'PL']);
    const quantity = rnd(1, 10);
    const unit = pick([1, 1, 2, 5]);
    const number = type === 'CH' ? pad(rnd(0, 99), 2) : type === 'BL' ? pad(rnd(0, 9999), 4) : `${pad(rnd(0, 99), 2)}${pad(rnd(0, 99), 2)}`;
    bets.push({ number, lottery: lot.name, amount: quantity * unit, type, quantity });
  }
  return bets;
}

async function main() {
  console.log('Creando loterías y ajustes...');
  for (const l of LOTTERIES) {
    await db.doc(`lotteries/${l.id}`).set({ ...l, active: true }, { merge: true });
  }
  await db.doc('settings/global').set({
    id: 'global',
    chancePrices: [
      { price: 5, ch1: 300, ch2: 50, ch3: 10 },
      { price: 10, ch1: 600, ch2: 100, ch3: 20 },
      { price: 20, ch1: 1200, ch2: 200, ch3: 40 }
    ],
    palesEnabled: true,
    billetesEnabled: true,
    pl12Multiplier: 1000,
    pl13Multiplier: 1000,
    pl23Multiplier: 200,
    nextSellerNumber: 100
  }, { merge: true });

  console.log('Creando usuarios...');
  const users = [];
  for (let i = 0; i < people.length; i++) users.push(await ensureUser(people[i], i));
  const sellers = users.filter(u => u.role === 'seller');

  const today = new Date();
  const days = [];
  for (let d = DAYS_BACK; d >= 0; d--) {
    const day = new Date(today);
    day.setDate(day.getDate() - d);
    days.push(day);
  }

  console.log('Creando resultados y ventas...');
  let ticketCount = 0;
  for (const day of days) {
    const dayKey = fmtDay(day);
    const isToday = dayKey === fmtDay(today);

    for (const l of LOTTERIES) {
      const [h] = l.drawTime.split(':').map(Number);
      if (isToday && h > today.getHours()) continue;
      await db.doc(`results/${l.id}_${dayKey}`).set({
        lotteryId: l.id,
        lotteryName: l.name,
        date: dayKey,
        firstPrize: pad(rnd(0, 9999), 4),
        secondPrize: pad(rnd(0, 99), 2),
        thirdPrize: pad(rnd(0, 99), 2),
        timestamp: Timestamp.fromDate(new Date(`${dayKey}T${pad(h, 2)}:30:00`))
      });
    }

    let batch = db.batch();
    let pending = 0;
    let seq = 0;
    for (const seller of sellers) {
      const n = rnd(8, 25);
      for (let i = 0; i < n; i++) {
        const selected = [...LOTTERIES].sort(() => Math.random() - 0.5).slice(0, rnd(1, 3));
        const bets = randomBets(selected);
        const totalAmount = bets.reduce((s, b) => s + b.amount, 0);
        const ts = new Date(`${dayKey}T${pad(rnd(8, 21), 2)}:${pad(rnd(0, 59), 2)}:${pad(rnd(0, 59), 2)}`);
        if (isToday && ts > today) ts.setTime(today.getTime() - rnd(1, 3600) * 1000);
        const status = Math.random() < 0.05 ? 'cancelled' : 'active';
        batch.set(db.collection('tickets').doc(), {
          bets,
          totalAmount,
          chancePrice: pick([5, 10, 20]),
          timestamp: Timestamp.fromDate(ts),
          date: dayKey,
          sellerId: seller.uid,
          sellerCode: seller.sellerId,
          sellerEmail: seller.email,
          sellerName: seller.name,
          commissionRate: seller.commissionRate,
          status,
          customerName: pick(CUSTOMERS),
          sequenceNumber: pad(++seq, 4),
          liquidated: false
        });
        ticketCount++;
        if (++pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0; }
      }
    }
    if (pending) await batch.commit();
  }

  console.log(`Listo: ${users.length} usuarios (+ceo@local.test), ${LOTTERIES.length} loterías, ${ticketCount} tickets en ${days.length} días.`);
  console.log(`Contraseña de todos: ${PASSWORD}`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
