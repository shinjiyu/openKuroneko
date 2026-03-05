import fs from 'node:fs';
import path from 'node:path';
import type { Tool } from '../index.js';

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write text content to a file in the working directory (overwrites).',
  async call(args) {
    const filePath = String(args['path'] ?? '');
    const content = String(args['content'] ?? '');
    if (!filePath) return { ok: false, output: 'Missing required argument: path' };
    try {
      const abs = path.resolve(filePath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      return { ok: true, output: `Written ${content.length} chars to ${abs}` };
    } catch (e) {
      return { ok: false, output: String(e) };
    }
  },
};
