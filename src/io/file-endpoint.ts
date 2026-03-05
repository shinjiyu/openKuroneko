/**
 * 文件型 I/O 端点实现
 *
 * Input：读取文件内容后 truncate（消费语义）。
 * Output：写入文件（覆盖语义）。
 */

import fs from 'node:fs';
import type { InputEndpoint, OutputEndpoint } from './index.js';

export function createFileInputEndpoint(id: string, filePath: string): InputEndpoint {
  let readOffset = 0;

  return {
    id,
    async read(): Promise<string | null> {
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      if (stat.size <= readOffset) return null; // no new bytes

      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(stat.size - readOffset);
      fs.readSync(fd, buf, 0, buf.length, readOffset);
      fs.closeSync(fd);
      readOffset = stat.size;

      const content = buf.toString('utf8').trim();
      return content || null;
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
