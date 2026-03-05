import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentIdentity } from './index.js';

const GLOBAL_TMP = process.env['OPENKURONEKO_TMP'] ?? path.join(os.tmpdir(), 'openkuroneko');
const LOCK_SUFFIX = '.lock';

function getMac(): string {
  const interfaces = os.networkInterfaces();
  for (const ifaces of Object.values(interfaces)) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac;
      }
    }
  }
  return '00:00:00:00:00:00';
}

export function resolveIdentity(agentPath: string, workDir?: string): AgentIdentity {
  const mac = getMac();
  const absPath = path.resolve(agentPath);
  const raw = `${mac}::${absPath}`;
  const agentId = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const tempDir = path.join(GLOBAL_TMP, agentId);

  fs.mkdirSync(tempDir, { recursive: true });

  return {
    agentId,
    mac,
    agentPath: absPath,
    tempDir,
    workDir: path.resolve(workDir ?? agentPath),
  };
}

export function acquirePathLock(identity: AgentIdentity): void {
  const lockFile = path.join(GLOBAL_TMP, identity.agentId + LOCK_SUFFIX);
  if (fs.existsSync(lockFile)) {
    const pid = fs.readFileSync(lockFile, 'utf8').trim();
    throw new Error(
      `Agent path already locked by PID ${pid}. Only one agent per path is allowed.`
    );
  }
  fs.writeFileSync(lockFile, String(process.pid), 'utf8');
}

export function releasePathLock(identity: AgentIdentity): void {
  const lockFile = path.join(GLOBAL_TMP, identity.agentId + LOCK_SUFFIX);
  fs.rmSync(lockFile, { force: true });
}
