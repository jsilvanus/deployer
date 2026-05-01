import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { appEnvVars } from '../db/schema.js';
import type { Db } from '../db/client.js';

const ALGORITHM = 'aes-256-gcm';

export class AppEnvService {
  private keyBuffer: Buffer;

  constructor(private db: Db, encryptionKeyHex: string) {
    this.keyBuffer = Buffer.from(encryptionKeyHex, 'hex');
  }

  private encrypt(plaintext: string): { encrypted: string; iv: string } {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.keyBuffer, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      encrypted: Buffer.concat([encrypted, authTag]).toString('base64'),
      iv: iv.toString('base64'),
    };
  }

  private decrypt(encryptedBase64: string, ivBase64: string): string {
    const combined = Buffer.from(encryptedBase64, 'base64');
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = combined.subarray(combined.length - 16);
    const ciphertext = combined.subarray(0, combined.length - 16);
    const decipher = createDecipheriv(ALGORITHM, this.keyBuffer, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  async set(appId: string, key: string, value: string): Promise<void> {
    const { encrypted, iv } = this.encrypt(value);
    const now = new Date();
    await this.db
      .insert(appEnvVars)
      .values({ id: randomUUID(), appId, key, encryptedValue: encrypted, iv, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [appEnvVars.appId, appEnvVars.key],
        set: { encryptedValue: encrypted, iv, updatedAt: now },
      });
  }

  async setMany(appId: string, vars: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(vars)) {
      await this.set(appId, key, value);
    }
  }

  async get(appId: string, key: string): Promise<string | null> {
    const [row] = await this.db
      .select()
      .from(appEnvVars)
      .where(and(eq(appEnvVars.appId, appId), eq(appEnvVars.key, key)))
      .limit(1);
    if (!row) return null;
    return this.decrypt(row.encryptedValue, row.iv);
  }

  async getAll(appId: string): Promise<Record<string, string>> {
    const rows = await this.db
      .select()
      .from(appEnvVars)
      .where(eq(appEnvVars.appId, appId));
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = this.decrypt(row.encryptedValue, row.iv);
    }
    return result;
  }

  async listKeys(appId: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: appEnvVars.key })
      .from(appEnvVars)
      .where(eq(appEnvVars.appId, appId));
    return rows.map(r => r.key);
  }

  async delete(appId: string, key: string): Promise<boolean> {
    const result = await this.db
      .delete(appEnvVars)
      .where(and(eq(appEnvVars.appId, appId), eq(appEnvVars.key, key)));
    return (result.changes ?? 0) > 0;
  }

  async deleteAll(appId: string): Promise<void> {
    await this.db.delete(appEnvVars).where(eq(appEnvVars.appId, appId));
  }
}
