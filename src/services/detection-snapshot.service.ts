import { drizzle } from 'drizzle-orm/better-sqlite3';
import { deploymentSnapshots } from '../db/schema';

export async function saveDetectionSnapshot(db: ReturnType<typeof drizzle>, deploymentId: string, stepName: string, stepOrder: number, detection: any) {
  const snapshot = JSON.stringify(detection);
  await db.insert(deploymentSnapshots).values({
    id: require('crypto').randomUUID(),
    deploymentId,
    stepName,
    stepOrder,
    snapshotData: snapshot,
    reversible: false,
    reversed: false,
    createdAt: new Date(),
  });
}

export default saveDetectionSnapshot;
