/**
 * send_file — 向指定 thread 发送本地文件或图片附件
 *
 * 外脑 LLM 通过此工具将内脑产出的文件（报告、图片等）以附件形式发给用户。
 * 每个 channel 适配器负责将 file:// URL 实际上传到对应平台。
 */

import fs from 'fs';
import path from 'path';

import type { ObTool } from './types.js';
import type { ChannelRegistry } from '../../channels/registry.js';
import type { MessageAttachment } from '../../channels/types.js';

/** 根据扩展名推断附件类型 */
function inferType(filePath: string): MessageAttachment['type'] {
  const ext = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return 'image';
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.m4a', '.amr'].includes(ext)) return 'audio';
  return 'file';
}

export function createSendFileTool(channelRegistry: ChannelRegistry): ObTool {
  return {
    name: 'send_file',
    description:
      '将本地文件（报告、图片、音频等）以附件形式发送给用户。' +
      '支持一次发送多个文件（逗号分隔路径）。' +
      'thread_id 格式：<channel>:<type>:<id>，如 "feishu:dm:alice"。',
    parameters: {
      thread_id: {
        type: 'string',
        description: '目标 thread_id',
        required: true,
      },
      file_paths: {
        type: 'string',
        description: '本地文件绝对路径，多个文件用英文逗号分隔',
        required: true,
      },
      caption: {
        type: 'string',
        description: '随附文字说明（可选）',
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const threadId  = String(args['thread_id']  ?? '').trim();
      const rawPaths  = String(args['file_paths'] ?? '').trim();
      const caption   = args['caption'] ? String(args['caption']).trim() : '';

      if (!threadId)  return { ok: false, output: 'thread_id 不能为空' };
      if (!rawPaths)  return { ok: false, output: 'file_paths 不能为空' };

      const filePaths = rawPaths.split(',').map((p) => p.trim()).filter(Boolean);
      const attachments: MessageAttachment[] = [];
      const missing: string[] = [];

      for (const fp of filePaths) {
        if (!fs.existsSync(fp)) {
          missing.push(fp);
          continue;
        }
        const stat = fs.statSync(fp);
        attachments.push({
          type: inferType(fp),
          url:  `file://${fp}`,
          name: path.basename(fp),
          size: stat.size,
        });
      }

      if (missing.length > 0) {
        return { ok: false, output: `以下文件不存在：\n${missing.join('\n')}` };
      }
      if (attachments.length === 0) {
        return { ok: false, output: '未解析到有效文件路径' };
      }

      try {
        await channelRegistry.send({
          thread_id:   threadId,
          content:     caption,
          attachments,
        });
        const names = attachments.map((a) => a.name).join(', ');
        return { ok: true, output: `已发送 ${attachments.length} 个附件到 ${threadId}：${names}` };
      } catch (e) {
        return { ok: false, output: `发送失败：${String(e)}` };
      }
    },
  };
}
