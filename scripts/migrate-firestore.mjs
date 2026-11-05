import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';

const COLLECTION_ORDER = [
  'users',
  'userProvisioning',
  'settings',
  'lotteries',
  'results',
  'tickets',
  'settlements',
];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function readServiceAccount(jsonPath) {
  const absolute = path.resolve(jsonPath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Service account file not found: ${absolute}`);
  }
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function copyCollection({
  sourceDb,
  targetDb,
  collectionName,
  pageSize,
  batchSize,
}) {
  let copied = 0;
  let lastDocId = null;
  let page = 0;

  while (true) {
    let query = sourceDb
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);

    if (lastDocId) {
      query = query.startAfter(lastDocId);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    page += 1;
    const docs = snapshot.docs;
    const chunks = chunkArray(docs, batchSize);

    for (const docChunk of chunks) {
      const batch = targetDb.batch();
      for (const srcDoc of docChunk) {
        const targetRef = targetDb.collection(collectionName).doc(srcDoc.id);
        batch.set(targetRef, srcDoc.data(), { merge: false });
      }
      await batch.commit();
    }

    copied += docs.length;
    lastDocId = docs[docs.length - 1].id;
    console.log(`[${collectionName}] page ${page} copied ${docs.length}, running total ${copied}`);
  }

  return copied;
}

async function main() {
  const sourceCredPath = requiredEnv('SOURCE_SERVICE_ACCOUNT_PATH');
  const targetCredPath = requiredEnv('TARGET_SERVICE_ACCOUNT_PATH');
  const sourceDbId = (
    process.env.SOURCE_FIRESTORE_DATABASE_ID ||
    process.env.SOURCE_FIRESTORE_DB_ID ||
    '(default)'
  ).trim();
  const targetDbId = (
    process.env.TARGET_FIRESTORE_DATABASE_ID ||
    process.env.TARGET_FIRESTORE_DB_ID ||
    '(default)'
  ).trim();
  const pageSize = Number(process.env.MIGRATION_PAGE_SIZE || 400);
  const batchSize = Number(process.env.MIGRATION_BATCH_SIZE || 300);

  if (pageSize <= 0 || batchSize <= 0) {
    throw new Error('MIGRATION_PAGE_SIZE and MIGRATION_BATCH_SIZE must be > 0');
  }
  if (batchSize > 500) {
    throw new Error('MIGRATION_BATCH_SIZE must be <= 500');
  }

  const sourceServiceAccount = readServiceAccount(sourceCredPath);
  const targetServiceAccount = readServiceAccount(targetCredPath);

  const sourceApp = initializeApp(
    {
      credential: cert(sourceServiceAccount),
      projectId: sourceServiceAccount.project_id,
    },
    'source-app'
  );

  const targetApp = initializeApp(
    {
      credential: cert(targetServiceAccount),
      projectId: targetServiceAccount.project_id,
    },
    'target-app'
  );

  const sourceDb = getFirestore(sourceApp, sourceDbId);
  const targetDb = getFirestore(targetApp, targetDbId);

  console.log('Starting Firestore migration');
  console.log(`Source project: ${sourceServiceAccount.project_id} | DB: ${sourceDbId}`);
  console.log(`Target project: ${targetServiceAccount.project_id} | DB: ${targetDbId}`);
  console.log(`Collections order: ${COLLECTION_ORDER.join(', ')}`);
  console.log(`Batch size: ${batchSize} | Page size: ${pageSize}`);

  const counts = {};
  let grandTotal = 0;

  try {
    for (const collectionName of COLLECTION_ORDER) {
      console.log(`\n--- Migrating collection: ${collectionName} ---`);
      const copied = await copyCollection({
        sourceDb,
        targetDb,
        collectionName,
        pageSize,
        batchSize,
      });
      counts[collectionName] = copied;
      grandTotal += copied;
      console.log(`Completed ${collectionName}: ${copied} docs copied`);
    }

    console.log('\n========== MIGRATION SUMMARY ==========');
    for (const collectionName of COLLECTION_ORDER) {
      console.log(`${collectionName}: ${counts[collectionName] || 0}`);
    }
    console.log(`TOTAL DOCS COPIED: ${grandTotal}`);
    console.log('=======================================');
  } finally {
    await deleteApp(sourceApp);
    await deleteApp(targetApp);
  }
}

main().catch((error) => {
  console.error('\nMigration failed.');
  console.error(error);
  process.exit(1);
});
