/**
 * capability_gap_handler — 能力缺口元规则
 *
 * 本轮仅标记缺口，写入 <tempDir>/capability-gaps.jsonl；
 * 下一轮通过 web_search + write_file 自举（Agent 自行决策）。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Tool } from '../index.js';

export interface CapabilityGapRecord {
  ts: string;
  gap: string;
  reason: string;
  status: 'pending' | 'resolved';
}

let _tempDir: string | null = null;

/** CLI 启动时注入 tempDir */
export function setCapabilityGapTempDir(tempDir: string): void {
  _tempDir = tempDir;
}

export const capabilityGapTool: Tool = {
  name: 'capability_gap_handler',
  description:
    'Record a capability gap for self-bootstrapping in the next loop round. ' +
    'gap (required): what capability is missing. ' +
    'reason (optional): why it is needed.',

  async call(args): Promise<{ ok: boolean; output: string }> {
    const gap    = String(args['gap'] ?? '').trim();
    const reason = String(args['reason'] ?? '').trim();

    if (!gap) return { ok: false, output: 'Missing required argument: gap' };

    const record: CapabilityGapRecord = {
      ts: new Date().toISOString(),
      gap,
      reason,
      status: 'pending',
    };

    // Persist to disk if tempDir is available
    if (_tempDir) {
      const gapFile = path.join(_tempDir, 'capability-gaps.jsonl');
      try {
        fs.appendFileSync(gapFile, JSON.stringify(record) + '\n', 'utf8');
      } catch (e) {
        return { ok: false, output: `Failed to write gap record: ${String(e)}` };
      }
    }

    return {
      ok: true,
      output:
        `Capability gap recorded: "${gap}". ` +
        `Next loop round: use web_search to find a solution, then write_file / shell_exec to self-bootstrap.`,
    };
  },
};

/** 读取所有未解决的缺口（供 Runner R 阶段检索） */
export function readPendingGaps(tempDir: string): CapabilityGapRecord[] {
  const gapFile = path.join(tempDir, 'capability-gaps.jsonl');
  if (!fs.existsSync(gapFile)) return [];
  return fs
    .readFileSync(gapFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapabilityGapRecord)
    .filter((r) => r.status === 'pending');
}

/** 将某条缺口标记为已解决 */
export function resolveGap(tempDir: string, gap: string): void {
  const gapFile = path.join(tempDir, 'capability-gaps.jsonl');
  if (!fs.existsSync(gapFile)) return;
  const updated = fs
    .readFileSync(gapFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const r = JSON.parse(line) as CapabilityGapRecord;
      return JSON.stringify(r.gap === gap ? { ...r, status: 'resolved' } : r);
    })
    .join('\n') + '\n';
  fs.writeFileSync(gapFile, updated, 'utf8');
}
