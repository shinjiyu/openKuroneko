/**
 * read_file — 外脑读取工作区文件（受限）
 *
 * 可读范围：
 * - scope=ob：仅 <obDir> 下（不含越界 ..）
 * - scope=inner_temp / inner_work：仅已登记内脑实例的 tempDir / workDir（需 instance_id）
 *
 * 用于读取内脑 output、status、input、.brain 下文档等，避免外脑只能靠口述「没有工具」。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '../../logger/index.js';
import type { ObTool } from './types.js';
import type { InnerBrainPool } from '../inner-brain-pool.js';

const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_MAX_BYTES     = 2 * 1024 * 1024;

function resolveUnderRoot(
  root: string,
  relativePath: string,
): { ok: true; abs: string } | { ok: false; reason: string } {
  const rel = relativePath.trim().replace(/\\/g, '/');
  if (!rel || rel.includes('\0')) return { ok: false, reason: '路径无效' };
  const parts = rel.split('/').filter((p) => p.length > 0);
  if (parts.some((p) => p === '..')) return { ok: false, reason: '禁止使用 ..' };
  const abs = path.resolve(root, ...parts);
  const rootResolved = path.resolve(root);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (abs !== rootResolved && !abs.startsWith(prefix)) {
    return { ok: false, reason: '路径越出允许根目录' };
  }
  return { ok: true, abs };
}

function readTextWithLimits(
  abs: string,
  maxBytes: number,
  tailLines?: number,
): { content: string; truncated: boolean; note?: string } {
  const stat = fs.statSync(abs);
  if (!stat.isFile()) return { content: '', truncated: false, note: '不是普通文件' };

  if (tailLines != null && tailLines > 0) {
    const readSize = Math.min(stat.size, maxBytes);
    const fd = fs.openSync(abs, 'r');
    try {
      const buf = Buffer.alloc(readSize);
      const start = stat.size > readSize ? stat.size - readSize : 0;
      fs.readSync(fd, buf, 0, readSize, start);
      let text = buf.toString('utf8');
      if (stat.size > readSize) {
        const nl = text.indexOf('\n');
        if (nl >= 0) text = text.slice(nl + 1);
      }
      const lines = text.split('\n');
      const tail = lines.slice(-tailLines).join('\n');
      return {
        content: tail,
        truncated: stat.size > readSize || lines.length > tailLines,
        ...(stat.size > readSize
          ? { note: `文件较大，仅读取末尾约 ${readSize} 字节中的最后 ${tailLines} 行` }
          : {}),
      };
    } finally {
      fs.closeSync(fd);
    }
  }

  if (stat.size > maxBytes) {
    const fd = fs.openSync(abs, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      fs.readSync(fd, buf, 0, maxBytes, 0);
      return {
        content: buf.toString('utf8') + '\n…（已截断，文件总大小 ' + stat.size + ' 字节，可用 tail_lines 读末尾）',
        truncated: true,
      };
    } finally {
      fs.closeSync(fd);
    }
  }

  return { content: fs.readFileSync(abs, 'utf8'), truncated: false };
}

export function createReadFileTool(
  obDir: string,
  pool: InnerBrainPool | null,
  logger?: Logger,
): ObTool {
  const obRoot = path.resolve(obDir);

  return {
    name: 'read_file',
    description:
      '读取外脑工作区或内脑实例目录下的文本文件。用于查看内脑 output、status、input、.brain/goal.md 等。' +
      'scope=ob 时读 <外脑目录>/relative_path；内脑需指定 instance_id（可先 list_inner_brains）。' +
      '常用：scope=inner_temp, relative_path=output 读内脑产出；relative_path=status 读状态 JSON。',
    parameters: {
      scope: {
        type: 'string',
        description: 'ob=外脑目录；inner_temp=实例临时目录（含 output/status/input/logs）；inner_work=实例任务工作目录（tasks/ib-xxx 下）',
        required: true,
      },
      instance_id: {
        type: 'string',
        description: '内脑实例 ID（scope 为 inner_* 时必填）',
        required: false,
      },
      relative_path: {
        type: 'string',
        description: '相对路径，如 output、status、input、logs/某日.jsonl、.brain/goal.md',
        required: true,
      },
      max_bytes: {
        type: 'string',
        description: '最多读取字节数（默认 262144），上限 2097152',
        required: false,
      },
      tail_lines: {
        type: 'string',
        description: '若设置，只返回文件最后 N 行（适合大 output；仍受 max_bytes 窗口限制）',
        required: false,
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const scope = String(args['scope'] ?? '').trim();
      const relativePath = String(args['relative_path'] ?? '').trim();
      const instanceId = args['instance_id'] ? String(args['instance_id']).trim() : '';

      let maxBytes = DEFAULT_MAX_BYTES;
      if (args['max_bytes'] != null && String(args['max_bytes']).trim() !== '') {
        const n = parseInt(String(args['max_bytes']), 10);
        if (!Number.isNaN(n) && n > 0) maxBytes = Math.min(n, MAX_MAX_BYTES);
      }

      let tailLines: number | undefined;
      if (args['tail_lines'] != null && String(args['tail_lines']).trim() !== '') {
        const n = parseInt(String(args['tail_lines']), 10);
        if (!Number.isNaN(n) && n > 0) tailLines = Math.min(n, 50_000);
      }

      if (!relativePath) {
        return { ok: false, output: 'relative_path 不能为空' };
      }

      let root: string;
      if (scope === 'ob') {
        root = obRoot;
      } else if (scope === 'inner_temp' || scope === 'inner_work') {
        if (!pool) {
          return { ok: false, output: '当前未启用内脑进程池，仅可使用 scope=ob。' };
        }
        if (!instanceId) {
          return { ok: false, output: 'scope 为 inner_temp / inner_work 时必须提供 instance_id。' };
        }
        const record = pool.get(instanceId);
        if (!record) {
          return { ok: false, output: `找不到实例 ${instanceId}，请先 list_inner_brains 查看有效 ID。` };
        }
        root = scope === 'inner_temp' ? path.resolve(record.tempDir) : path.resolve(record.workDir);
      } else {
        return { ok: false, output: `未知 scope="${scope}"，应为 ob | inner_temp | inner_work` };
      }

      const resolved = resolveUnderRoot(root, relativePath);
      if (!resolved.ok) {
        logger?.warn('outer-brain', { event: 'read_file.denied', data: { scope, reason: resolved.reason } });
        return { ok: false, output: resolved.reason };
      }

      if (!fs.existsSync(resolved.abs)) {
        return { ok: false, output: `文件不存在：${relativePath}` };
      }

      try {
        const { content, truncated, note } = readTextWithLimits(resolved.abs, maxBytes, tailLines);
        logger?.info('outer-brain', {
          event: 'read_file',
          data: {
            scope,
            instance_id: instanceId || null,
            path:        relativePath,
            truncated,
            preview:     content.slice(0, 120),
          },
        });
        const head = note ? `${note}\n\n` : truncated && !note ? '（内容已截断）\n\n' : '';
        return { ok: true, output: head + content };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger?.error('outer-brain', { event: 'read_file.error', data: { path: relativePath, error: msg } });
        return { ok: false, output: `读取失败：${msg}` };
      }
    },
  };
}
