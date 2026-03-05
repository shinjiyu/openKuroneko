/**
 * 文件型 I/O 端点实现
 *
 * Input：读取文件内容后 truncate（消费语义）。
 * Output：写入文件（覆盖语义）。
 */

import fs from 'node:fs';
import type { InputEndpoint, OutputEndpoint } from './index.js';

export function createFileInputEndpoint(id: string, filePath: string): InputEndpoint {
  return {
    id,
    async read(): Promise<string | null> {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (!content) return null;
      fs.truncateSync(filePath, 0);
      return content;
    },
  };
}

export function createFileOutputEndpoint(id: string, filePath: string): OutputEndpoint {
  return {
    id,
    async write(content: string): Promise<void> {
      fs.writeFileSync(filePath, content, 'utf8');
    },
  };
}
