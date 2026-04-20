import { execa } from 'execa';
import path from 'path';
import fs from 'fs/promises';

export async function buildImageFromDir(dir: string, tag: string, buildArgs?: Record<string, string>, timeoutSeconds = 300) {
  const args = ['build', '-t', tag, '.'];
  if (buildArgs) {
    for (const [k, v] of Object.entries(buildArgs)) {
      args.splice(2, 0, '--build-arg', `${k}=${v}`);
    }
  }

  const proc = execa('docker', args, { cwd: dir, timeout: timeoutSeconds * 1000 });
  const { stdout } = await proc;
  return stdout;
}

export default { buildImageFromDir };
