import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveIdentity, acquirePathLock, releasePathLock, deriveAgentId } from '../src/identity/index.js';

const TMP = path.join(os.tmpdir(), 'kuroneko-test-identity');

process.env['OPENKURONEKO_TMP'] = TMP;

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('resolveIdentity', () => {
  it('produces a 16-char hex agent_id', () => {
    const id = resolveIdentity('/tmp/agent-a');
    expect(id.agentId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('same path → same agent_id', () => {
    const a = resolveIdentity('/tmp/agent-a');
    const b = resolveIdentity('/tmp/agent-a');
    expect(a.agentId).toBe(b.agentId);
  });

  it('different paths → different agent_ids', () => {
    const a = resolveIdentity('/tmp/agent-a');
    const b = resolveIdentity('/tmp/agent-b');
    expect(a.agentId).not.toBe(b.agentId);
  });

  it('creates tempDir on disk', () => {
    const id = resolveIdentity('/tmp/agent-a');
    expect(fs.existsSync(id.tempDir)).toBe(true);
  });
});

describe('deriveAgentId', () => {
  it('matches resolveIdentity agentId for same path', () => {
    const identity = resolveIdentity('/tmp/agent-x');
    const derived  = deriveAgentId('/tmp/agent-x');
    expect(derived).toBe(identity.agentId);
  });
});

describe('path lock', () => {
  it('acquires and releases cleanly', () => {
    const identity = resolveIdentity('/tmp/agent-lock');
    expect(() => acquirePathLock(identity)).not.toThrow();
    expect(() => releasePathLock(identity)).not.toThrow();
  });

  it('throws when same path is locked by current PID', () => {
    const identity = resolveIdentity('/tmp/agent-dup');
    acquirePathLock(identity);
    expect(() => acquirePathLock(identity)).toThrow(/already locked/);
    releasePathLock(identity);
  });

  it('clears stale lock when PID no longer exists', () => {
    const identity = resolveIdentity('/tmp/agent-stale');
    // Write a fake lock with a dead PID (1 is always alive on POSIX, use 99999999)
    const lockFile = path.join(TMP, identity.agentId + '.lock');
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(lockFile, '99999999', 'utf8');
    // Should succeed (stale lock removed)
    expect(() => acquirePathLock(identity)).not.toThrow();
    releasePathLock(identity);
  });
});
