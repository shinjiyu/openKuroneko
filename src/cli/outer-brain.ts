#!/usr/bin/env node
/**
 * 外脑 CLI 入口
 *
 * Usage:
 *   kuroneko-ob --dir <obDir> --inner-dir <innerAgentDir>
 *               [--soul <path/to/soul.md>]
 *               [--webchat-port <port>]
 *               [--feishu-app-id <id> --feishu-app-secret <secret> --feishu-verify-token <token>]
 *               [--feishu-port <port>]
 *               [--escalation-wait-ms <ms>]
 *
 * 多实例内脑：
 *   每次 set_goal 都会在 <obDir>/tasks/<instanceId>/ 创建独立工作目录并启动新内脑进程。
 *   内脑命令通过 --inner-cmd 指定（其中 --dir 参数会被池自动替换为实例目录）。
 *
 * 示例：
 *   # 仅 CLI 模式
 *   kuroneko-ob --dir ./ob-agent --inner-dir ./chat-agent
 *
 *   # 同时开启 WebChat（端口 8091）
 *   kuroneko-ob --dir ./ob-agent --inner-dir ./chat-agent --webchat-port 8091
 */

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { createLogger } from '../logger/index.js';
import { createOpenAIAdapter } from '../adapter/index.js';
import { createFilesystemStore } from '../archive/index.js';
import { createOuterBrain, InnerBrainPool } from '../outer-brain/index.js';
import { mergeWorkDirSkillsToAgentPool } from '../outer-brain/agent-pool.js';
import { resolveIdentity } from '../identity/index.js';
import { loadConfig } from '../config/index.js';
import { CliChannelAdapter } from '../channels/adapters/cli.js';
import { FeishuChannelAdapter, type RelayIngestRef } from '../channels/adapters/feishu.js';
import { DingTalkChannelAdapter }  from '../channels/adapters/dingtalk.js';
import { FeishuOpenIdMap } from '../users/feishu-openid-map.js';
import { WebchatChannelAdapter }   from '../channels/adapters/webchat.js';

// ── CLI 定义 ──────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('kuroneko-ob')
  .description('openKuroneko 外脑（Outer Brain）— 多频道人类交互层')
  .requiredOption('--dir <path>', '外脑工作目录（存储 threads/、users.json、soul.md）')
  .requiredOption('--inner-dir <path>', '内脑 agent 目录（作为内脑启动命令模板中 --dir 的默认值）')
  .option('--soul <path>', 'soul.md 路径（默认 <dir>/soul.md）')
  .option('--webchat-port <port>', '开启 WebChat 频道，监听指定端口（如 8091）')
  .option('--webchat-cors <origin>', 'WebChat CORS 允许来源（默认 "*"）')
  .option('--agent-name <name>', 'Agent 在群聊中被 @ 的名字（仅 WebChat；飞书由应用名提供，不设则无默认）')
  .option('--feishu-app-id <id>', '飞书 App ID')
  .option('--feishu-app-secret <secret>', '飞书 App Secret')
  .option('--feishu-verify-token <token>', '飞书 HTTP Webhook 事件验证 Token')
  .option('--feishu-encrypt-key <key>', '飞书 HTTP Webhook 消息加密 Key（可选）')
  .option('--feishu-mode <mode>', '飞书接入模式：webhook（需公网，默认）| websocket（长连接，推荐）')
  .option('--feishu-port <port>', '飞书 Webhook 监听端口（默认 8090，仅 webhook 模式）')
  .option('--feishu-agent-union-id <id>', '本机（机器人）的 union_id，用于过滤自身消息与 @ 判定（必配）')
  .option('--relay-url <url>', '消息中转服务器 WebSocket URL（如 ws://localhost:9090），与 relay-key、relay-agent-id 同配则启用')
  .option('--relay-key <key>', '消息中转鉴权 key，与服务器 RELAY_KEY 一致')
  .option('--relay-agent-id <id>', '本 agent 在中转上的标识（如 kuroneko）')
  .option('--dingtalk-client-id <id>',     '钉钉 AppKey（Stream 模式）')
  .option('--dingtalk-client-secret <s>',  '钉钉 AppSecret（Stream 模式）')
  .option('--escalation-wait-ms <ms>', 'BLOCK 升级等待时间（ms，默认 1800000=30min）')
  .option(
    '--inner-cmd <cmd>',
    '内脑启动命令模板（set_goal 时自动拉起新实例）。\n' +
    '池会自动将其中的 --dir 参数替换为每个实例的独立工作目录。\n' +
    '例："node dist/cli/index.js --dir ./chat-agent --loop fast"\n' +
    '不填则内脑需手动启动（不支持多实例）。',
  )
  .option(
    '--max-concurrent <n>',
    '最大并发内脑实例数（默认 4）',
  )
  .option(
    '--fast-model <model>',
    '用于群聊参与决策（SPEAK/SILENT 分类）的快速模型名称。\n' +
    '建议使用无 thinking 的 flash 级模型，如 glm-4-flash。',
  )
  .option('--no-cli', '禁用 CLI 频道（默认启用）')
  .parse(process.argv);

const opts = program.opts<{
  dir:                  string;
  innerDir:             string;
  soul?:                string;
  webchatPort?:         string;
  webchatCors?:         string;
  agentName?:           string;
  feishuAppId?:         string;
  feishuAppSecret?:     string;
  feishuVerifyToken?:   string;
  feishuEncryptKey?:    string;
  feishuMode?:          string;
  feishuPort?:          string;
  feishuAgentUnionId?:  string;
  relayUrl?:            string;
  relayKey?:            string;
  relayAgentId?:        string;
  dingtalkClientId?:    string;
  dingtalkClientSecret?: string;
  escalationWaitMs?:    string;
  innerCmd?:            string;
  maxConcurrent?:       string;
  fastModel?:           string;
  cli:                  boolean;
}>();

// ── Bootstrap ──────────────────────────────────────────────────────────────────

async function main() {
  const obDir    = path.resolve(opts.dir);
  const innerDir = path.resolve(opts.innerDir);

  fs.mkdirSync(obDir, { recursive: true });

  const obAgentId = `ob-${path.basename(obDir)}`;

  // 日志（外脑独立日志目录）
  const obTempDir = path.join(os.tmpdir(), 'kuroneko', obAgentId);
  fs.mkdirSync(path.join(obTempDir, 'logs'), { recursive: true });
  const logger = createLogger(obAgentId, obTempDir);

  logger.info('cli', {
    event: 'ob.start',
    data: { obDir, innerDir },
  });

  // 配置（从 innerDir 派生的 tempDir 读取 agent.config.json）
  const innerIdentity = resolveIdentity(innerDir);
  const innerTempDir  = innerIdentity.tempDir;
  const config = loadConfig(innerTempDir);
  // 外脑主 LLM：关闭 thinking。Kimi k2.5 用 thinking: { type: "disabled" }，否则 reasoning_content 会报错
  const baseUrl = process.env['OPENAI_BASE_URL'] ?? '';
  const noThinkingBody = baseUrl.includes('moonshot')
    ? { thinking: { type: 'disabled' as const } }
    : { enable_thinking: false };
  const llm = createOpenAIAdapter(
    config.model ? { model: config.model, extraBody: noThinkingBody } : { extraBody: noThinkingBody },
  );

  const fastModelName = opts.fastModel ?? process.env['FAST_MODEL'];
  const fastLlm = fastModelName
    ? createOpenAIAdapter({
        model:     fastModelName,
        extraBody: baseUrl.includes('moonshot') ? { thinking: { type: 'disabled' as const } } : { enable_thinking: false },
      })
    : undefined;

  if (fastLlm) {
    logger.info('cli', { event: 'fast-model.ready', data: { model: fastModelName } });
  }

  // ── 内脑进程池 ───────────────────────────────────────────────────────────

  let innerBrainPool: InnerBrainPool | undefined;
  if (opts.innerCmd) {
    const launchCommandTemplate = opts.innerCmd.trim().split(/\s+/);
    const maxConcurrent = opts.maxConcurrent ? parseInt(opts.maxConcurrent, 10) : 4;

    innerBrainPool = new InnerBrainPool({
      obDir,
      launchCommandTemplate,
      maxConcurrent,
      logger,
      onInstanceExit: (inst) => {
        logger.info('cli', {
          event: 'inner-brain.exit',
          data: { id: inst.id, code: inst.exitCode, signal: inst.exitSignal },
        });
        mergeWorkDirSkillsToAgentPool(obDir, inst.workDir, logger);
      },
    });

    logger.info('cli', {
      event: 'inner-brain-pool.ready',
      data: { cmd: opts.innerCmd, maxConcurrent },
    });
  }

  // ── 频道适配器 ───────────────────────────────────────────────────────────

  const adapters: import('../channels/types.js').ChannelAdapter[] = [];

  // CLI 频道（默认开启）
  if (opts.cli !== false) {
    // CLI 频道使用 innerDir 对应的 tempDir（调试用，单实例）
    const inputPath  = path.join(innerTempDir, 'input');
    const outputPath = path.join(innerTempDir, 'output');
    adapters.push(new CliChannelAdapter({
      inputPath,
      outputPath,
      userId: 'local',
    }));
    logger.info('cli', { event: 'channel.registered', data: { channel: 'cli' } });
  }

  // WebChat 频道
  if (opts.webchatPort) {
    const webchatUsersPath = path.join(obDir, 'webchat-users.json');
    adapters.push(new WebchatChannelAdapter({
      port:             parseInt(opts.webchatPort, 10),
      usersConfigPath:  fs.existsSync(webchatUsersPath) ? webchatUsersPath : undefined,
      agentName:        opts.agentName,
      corsOrigin:       opts.webchatCors,
      pool:             innerBrainPool,
    }));
    logger.info('cli', {
      event: 'channel.registered',
      data: {
        channel:  'webchat',
        port:     opts.webchatPort,
        auth:     fs.existsSync(webchatUsersPath) ? 'token' : 'anonymous',
      },
    });
  }

  // 飞书频道
  // resolveUserFn 使用 lazy closure：ob 创建后注入 userStore，实现渠道→内部身份映射。
  // 已知用户（users.json / identity-config.json 中预配置）直接命中；
  // 未知用户自动注册为 "feishu_<open_id>"，管理员可事后调用 linkChannel 关联到真实身份。
  let _feishuUserStore: import('../users/store.js').UserStore | null = null;

  const relayUrl    = opts.relayUrl ?? process.env['RELAY_URL'];
  const relayKey    = opts.relayKey ?? process.env['RELAY_KEY'];
  const relayAgentId = opts.relayAgentId ?? process.env['RELAY_AGENT_ID'];
  const relayIngestRef: RelayIngestRef = { current: null };

  // websocket 模式无需 verifyToken（仅 webhook 模式需要）
  const feishuAgentUnionId = opts.feishuAgentUnionId?.trim()
    || process.env['FEISHU_AGENT_UNION_ID']?.trim()
    || undefined;

  // 中转注册 id：优先用飞书 union_id（多实例同一应用同一 id，不同应用不同 id），否则用 RELAY_AGENT_ID
  const relayRegisterId = (feishuAgentUnionId || relayAgentId)?.trim() || undefined;

  if (opts.feishuAppId && opts.feishuAppSecret) {
    if (relayUrl && relayKey && relayRegisterId) {
      console.log(`[relay] 配置已加载 url=${relayUrl} agent=${relayRegisterId}${feishuAgentUnionId ? ' (union_id)' : ''}`);
    } else if (relayUrl || relayKey) {
      console.log('[relay] 未启用（需设置 RELAY_URL、RELAY_KEY，以及 FEISHU_AGENT_UNION_ID 或 RELAY_AGENT_ID）');
    }
  }

  const { writeFeishuIdentitiesFile } = await import('../users/feishu-identities.js');
  let feishuOpenIdMap: FeishuOpenIdMap | null = null;
  let feishuAdapter: import('../channels/adapters/feishu.js').FeishuChannelAdapter | null = null;
  if (opts.feishuAppId && opts.feishuAppSecret && (opts.feishuVerifyToken || opts.feishuMode === 'websocket')) {
    feishuOpenIdMap = new FeishuOpenIdMap(obDir);
    feishuAdapter = new FeishuChannelAdapter({
      appId:        opts.feishuAppId,
      appSecret:    opts.feishuAppSecret,
      ...(opts.feishuVerifyToken ? { verifyToken: opts.feishuVerifyToken } : {}),
      ...(opts.feishuEncryptKey  ? { encryptKey:  opts.feishuEncryptKey  } : {}),
      mode:         (opts.feishuMode as 'webhook' | 'websocket' | undefined) ?? 'webhook',
      webhookPort:  opts.feishuPort ? parseInt(opts.feishuPort, 10) : 8090,
      agentUnionId: feishuAgentUnionId,
      onFeishuIdsSeen: (entries) => {
        feishuOpenIdMap?.merge(entries);
        if (_feishuUserStore && feishuOpenIdMap) {
          for (const e of entries) {
            const name = e.name?.trim() ?? feishuOpenIdMap.getName(e.openId);
            if (!name) continue;
            const uid = _feishuUserStore.resolveUser(e.openId, 'feishu') ?? (e.unionId ? _feishuUserStore.resolveUser(e.unionId, 'feishu') : null);
            if (uid) _feishuUserStore.updateDisplayName(uid, name);
          }
          writeFeishuIdentitiesFile(obDir, _feishuUserStore, feishuOpenIdMap);
        }
      },
      getFeishuDisplayName: (id) => feishuOpenIdMap?.getDisplayName(id),
      getOpenIdForUnionId: (uid) => feishuOpenIdMap?.getOpenIdForUnionId(uid) ?? null,
      getOpenIdForDisplayName: (name) => feishuOpenIdMap?.getOpenIdByDisplayName(name),
      logger,
      resolveUserFn: (rawId, channelId) => {
        if (_feishuUserStore) {
          return _feishuUserStore.resolveUser(rawId, channelId, true) ?? rawId;
        }
        return rawId;
      },
      ...(relayUrl && relayKey && relayRegisterId
        ? { relayUrl, relayKey, relayAgentId: relayRegisterId, relayIngestRef, relayLogger: logger }
        : {}),
    });
    adapters.push(feishuAdapter);
    logger.info('cli', {
      event: 'channel.registered',
      data:  { channel: 'feishu', relay: !!(relayUrl && relayKey && relayRegisterId) },
    });
  }

  // 钉钉频道（Stream 长连接，无需公网 URL）
  let _dingtalkUserStore: import('../users/store.js').UserStore | null = null;
  if (opts.dingtalkClientId && opts.dingtalkClientSecret) {
    adapters.push(new DingTalkChannelAdapter({
      clientId:     opts.dingtalkClientId,
      clientSecret: opts.dingtalkClientSecret,
      resolveUserFn: (rawId, channelId) => {
        if (_dingtalkUserStore) {
          return _dingtalkUserStore.resolveUser(rawId, channelId, true) ?? rawId;
        }
        return rawId;
      },
    }));
    logger.info('cli', { event: 'channel.registered', data: { channel: 'dingtalk' } });
  }

  // ── 创建外脑 ──────────────────────────────────────────────────────────────

  const knowledgeStore = createFilesystemStore();

  const ob = createOuterBrain({
    obDir,
    llm,
    logger,
    knowledgeStore,
    extraAdapters: adapters,
    getAgentDisplayName: () => feishuAdapter?.getBotDisplayName?.(),
    ...(opts.soul ? { soulPath: opts.soul } : {}),
    ...(opts.escalationWaitMs ? { escalationWaitMs: parseInt(opts.escalationWaitMs, 10) } : {}),
    ...(innerBrainPool ? { innerBrainPool } : {}),
    ...(fastLlm ? { fastLlm } : {}),
  });

  // 将 userStore 注入各频道 resolver（创建后立即注入，start() 之前完成）
  _feishuUserStore    = ob.userStore;
  _dingtalkUserStore  = ob.userStore;

  // 飞书身份文件：启动时写一次，之后每次 onFeishuIdsSeen 合并后也会写，供内脑读取 union_id/open_id/用户名
  if (feishuOpenIdMap) {
    writeFeishuIdentitiesFile(obDir, ob.userStore, feishuOpenIdMap);
  }

  // 中转广播插入：收到其它 agent 发言时写入本机 thread；带 sender_name/union_id/open_id 时注册用户与身份映射；并触发参与决策以便有机会回复
  // 若飞书已推送过同一条（其他机器人发言），可能已 append 过一次，用简单去重避免重复写入
  relayIngestRef.current = (threadId, userId, content, ts, ingestOpts) => {
    ob.threadStore.ensureThread(threadId, 'feishu', ts);
    if (ingestOpts?.sender_name) {
      ob.userStore.register({
        userId:      userId,
        displayName: ingestOpts.sender_name,
        role:        'member',
        channels:    ingestOpts.sender_open_id ? [{ channelId: 'feishu', rawId: ingestOpts.sender_open_id }] : [],
      });
    }
    if (feishuOpenIdMap && ingestOpts?.sender_open_id?.trim()) {
      const entry: { openId: string; unionId?: string; name?: string } = {
        openId: ingestOpts.sender_open_id.trim(),
      };
      if (ingestOpts.sender_union_id) entry.unionId = ingestOpts.sender_union_id;
      if (ingestOpts.sender_name) entry.name = ingestOpts.sender_name;
      feishuOpenIdMap.merge([entry]);
    }
    const history = ob.threadStore.getHistory(threadId);
    const last = history[history.length - 1];
    const likelyDuplicate =
      last?.role === 'user' &&
      last.user_id === userId &&
      last.content === content &&
      Math.abs((last.ts ?? 0) - ts) < 15_000;
    if (!likelyDuplicate) {
      ob.threadStore.appendUser(threadId, userId, content, ts);
    }
    ob.onRelayMessageIngested(threadId, userId, content, ts, ingestOpts);
  };

  // ── 信号处理 ──────────────────────────────────────────────────────────────

  const cleanup = async () => {
    logger.info('cli', { event: 'ob.shutdown', data: {} });
    await ob.stop();
    if (innerBrainPool?.isAnyRunning()) {
      logger.info('cli', { event: 'inner-brain.stopping-all', data: {} });
      await innerBrainPool.stopAll();
    }
    process.exit(0);
  };

  process.on('SIGINT',  () => void cleanup());
  process.on('SIGTERM', () => void cleanup());

  // ── 启动 ──────────────────────────────────────────────────────────────────

  await ob.start();

  logger.info('cli', {
    event: 'ob.ready',
    data: { channels: adapters.map((a) => a.channel_id) },
  });

  process.stdin.resume();
}

main().catch((e: unknown) => {
  console.error('[kuroneko-ob] Fatal error:', e);
  process.exit(1);
});
