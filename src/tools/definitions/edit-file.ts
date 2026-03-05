import fs from 'node:fs';
import path from 'node:path';
import type { Tool } from '../index.js';

export const editFileTool: Tool = {
  name: 'edit_file',
  description: 'Replace a specific string in a file with a new string (first occurrence).',
  async call(args) {
    const filePath = String(args['path'] ?? '');
    const oldStr = String(args['old_string'] ?? '');
    const newStr = String(args['new_string'] ?? '');
    if (!filePath || !oldStr) {
      return { ok: false, output: 'Missing required arguments: path, old_string' };
    }
    try {
      const abs = path.resolve(filePath);
      const content = fs.readFileSync(abs, 'utf8');
      if (!content.includes(oldStr)) {
        return { ok: false, output: `old_string not found in ${abs}` };
      }
      fs.writeFileSync(abs, content.replace(oldStr, newStr), 'utf8');
      return { ok: true, output: `Replaced in ${abs}` };
    } catch (e) {
      return { ok: false, output: String(e) };
    }
  },
};
