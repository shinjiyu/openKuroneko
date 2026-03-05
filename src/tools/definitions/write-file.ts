import fs from 'node:fs';
import path from 'node:path';
import { isPathAllowed, pathSecurityError } from './workdir-guard.js';
import type { Tool } from '../index.js';

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write text content to a file in the working directory (overwrites).',
  async call(args): Promise<{ ok: boolean; output: string }> {
    const filePath = String(args['path'] ?? '').trim();
    const content  = String(args['content'] ?? '');
    if (!filePath) return { ok: false, output: 'Missing required argument: path' };
    const abs = path.resolve(filePath);
    if (!isPathAllowed(abs)) return { ok: false, output: pathSecurityError(abs) };
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      return { ok: true, output: `Written ${content.length} chars to ${abs}` };
    } catch (e) {
      return { ok: false, output: String(e) };
    }
  },
};
