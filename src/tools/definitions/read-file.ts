import fs from 'node:fs';
import path from 'node:path';
import type { Tool } from '../index.js';

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read a file from the working directory. Returns its text content.',
  async call(args) {
    const filePath = String(args['path'] ?? '');
    if (!filePath) return { ok: false, output: 'Missing required argument: path' };
    try {
      const abs = path.resolve(filePath);
      const content = fs.readFileSync(abs, 'utf8');
      return { ok: true, output: content };
    } catch (e) {
      return { ok: false, output: String(e) };
    }
  },
};
