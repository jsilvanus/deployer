import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { envFiles } from '../db/schema.js';
import type { Db } from '../db/client.js';
import type { AnyLogger } from '../types/logger.js';

const ALGORITHM = 'aes-256-gcm';

export class EnvService {
  private keyBuffer: Buffer;

  constructor(
    private db: Db,
    private logger: AnyLogger,
    encryptionKeyHex: string,
  ) {
    this.keyBuffer = Buffer.from(encryptionKeyHex, 'hex');
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async read(filePath: string): Promise<string> {
    return readFile(filePath, 'utf8');
  }

  async write(filePath: string, content: string): Promise<void> {
    this.logger.info({ filePath }, 'writing .env file');
    await writeFile(filePath, content, { mode: 0o600 });
  }

  checksum(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  encrypt(plaintext: string): { encrypted: string; iv: string } {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.keyBuffer, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Store authTag appended to ciphertext
    const combined = Buffer.concat([encrypted, authTag]);
    return {
      encrypted: combined.toString('base64'),
      iv: iv.toString('base64'),
    };
  }

  decrypt(encryptedBase64: string, ivBase64: string): string {
    const combined = Buffer.from(encryptedBase64, 'base64');
    const iv = Buffer.from(ivBase64, 'base64');
    // Last 16 bytes are the auth tag
    const authTag = combined.subarray(combined.length - 16);
    const ciphertext = combined.subarray(0, combined.length - 16);
    const decipher = createDecipheriv(ALGORITHM, this.keyBuffer, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  async snapshot(
    appId: string,
    deploymentId: string,
    filePath: string,
  ): Promise<string | null> {
    if (!(await this.exists(filePath))) return null;
    const content = await this.read(filePath);
    const { encrypted, iv } = this.encrypt(content);
    const contentChecksum = this.checksum(content);

    const [row] = await this.db
      .insert(envFiles)
      .values({
        id:               randomUUID(),
        appId,
        deploymentId,
        encryptedContent: encrypted,
        contentChecksum,
        iv,
        createdAt:        new Date(),
      })
      .returning();

    return row?.id ?? null;
  }

  async restore(envFileId: string, targetPath: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(envFiles)
      .where(eq(envFiles.id, envFileId))
      .limit(1);

    if (!row) throw new Error(`Env snapshot ${envFileId} not found`);

    const plaintext = this.decrypt(row.encryptedContent, row.iv);
    await this.write(targetPath, plaintext);
    this.logger.info({ targetPath, envFileId }, '.env restored from snapshot');
  }

  mergeVars(existing: string, overrides: Record<string, string>): string {
    const lines = existing.split('\n');
    const seen = new Set<string>();

    const updated = lines.map(line => {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/i);
      if (match?.[1] && overrides[match[1]] !== undefined) {
        seen.add(match[1]);
        return `${match[1]}=${overrides[match[1]]}`;
      }
      return line;
    });

    for (const [key, value] of Object.entries(overrides)) {
      if (!seen.has(key)) {
        updated.push(`${key}=${value}`);
      }
    }

    return updated.join('\n');
  }
}
