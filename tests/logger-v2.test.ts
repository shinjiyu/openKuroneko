import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendAnalysisMarker, createLogger } from '../src/logger/index.js';

describe('logger v2 schema', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logv2-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes schema_version, log_id, analyzed, optional tags', () => {
    const logger = createLogger('test-agent', dir, { defaultTags: ['outer-brain'] });
    logger.info('testmod', {
      event: 'unit.test',
      tags: ['replay-critical'],
      data: { n: 1 },
    });

    const logsDir = path.join(dir, 'logs');
    const files = fs.readdirSync(logsDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
    expect(files.length).toBe(1);
    const line = fs.readFileSync(path.join(logsDir, files[0]!), 'utf8').trim();
    const row = JSON.parse(line) as Record<string, unknown>;

    expect(row['schema_version']).toBe(2);
    expect(typeof row['log_id']).toBe('string');
    expect(String(row['log_id']).length).toBeGreaterThan(30);
    expect(row['analyzed']).toBe(false);
    expect(row['tags']).toEqual(['outer-brain', 'replay-critical']);
    expect(row['event']).toBe('unit.test');
  });

  it('appendAnalysisMarker creates analysis-markers.jsonl', () => {
    appendAnalysisMarker(dir, {
      log_id: 'abc-123',
      analyzed: true,
      analyzed_at: '2026-03-05T00:00:00.000Z',
      analyst: 'vitest',
    });
    const p = path.join(dir, 'logs', 'analysis-markers.jsonl');
    expect(fs.existsSync(p)).toBe(true);
    const row = JSON.parse(fs.readFileSync(p, 'utf8').trim()) as Record<string, unknown>;
    expect(row['schema_version']).toBe(1);
    expect(row['log_id']).toBe('abc-123');
    expect(row['analyzed']).toBe(true);
  });
});
