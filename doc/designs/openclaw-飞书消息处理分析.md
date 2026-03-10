# OpenClaw 飞书消息处理分析

基于 [openclaw/openclaw](https://github.com/openclaw/openclaw) 源码（`extensions/feishu/`）整理，说明其飞书消息的**身份识别**、**@ 提及**、**发文件**、**发图片**实现方式，便于本仓库（openKuroneko）参考或对齐。

本地已克隆的 openclaw 源码路径：`c:\UGit\openclaw-src`。

---

## 1. 身份识别

### 1.1 消息事件中的身份字段

飞书事件里发送方身份来自 `event.sender.sender_id`，包含三种 ID（见 `bot.ts` 中 `FeishuMessageEvent`）：

- **open_id**：`ou_xxx`，开放平台用户标识，**推荐作为主身份**（DM、群内路由、配对都用它）
- **user_id**：租户内用户 ID
- **union_id**：跨租户统一 ID

解析后的上下文（`parseFeishuMessageEvent`）中：

- `senderOpenId` = `sender_id.open_id ?? sender_id.user_id`（无 open_id 时用 user_id，常见于部分移动端）
- `senderId` = `user_id ?? open_id`
- 会话路由里 **From** 统一为 `feishu:${senderOpenId}`，保证同一用户在不同会话中身份一致

### 1.2 发送方展示名解析（可选）

为让 Agent 知道“谁在说话”，openclaw 会按 **open_id / union_id / user_id** 调用飞书 `contact/v3/users/:user_id` 解析展示名（`bot.ts` 中 `resolveFeishuSenderName`）：

- 通过 `open_id` 前缀 `ou_`、`union_id` 前缀 `on_` 等判断 `user_id_type`
- 结果缓存 10 分钟（`SENDER_NAME_TTL_MS`），减少 API 调用
- 若未开通通讯录权限会得到 99991672 权限错误，会带 grantUrl 提示用户去授权，并做 5 分钟冷却避免刷屏

配置项：`channels.feishu.resolveSenderNames`（默认 true），关闭可省 API 配额。

### 1.3 配对与 DM 身份校验

- **Pairing**：`channel.ts` 中 `pairing.idLabel: "feishuUserId"`，允许名单条目会先去掉 `feishu:` / `user:` / `open_id:` 前缀再匹配
- **DM 策略**：`dmPolicy: "open" | "pairing" | "allowlist"`，校验时用 `resolveFeishuAllowlistMatch`，支持按 open_id、user_id、展示名匹配 `allowFrom`

### 1.4 发送目标（to）的解析

`targets.ts` + `send-target.ts` 负责把“发给谁”转成飞书 API 的 `receive_id` + `receive_id_type`：

- **格式**：支持 `user:open_id`、`chat:chat_id`、`group:chat_id`、`open_id:ou_xxx`、裸的 `oc_xxx`（群）、`ou_xxx`（用户）等
- **规则**：
  - 以 `chat:` / `group:` / `channel:` 或裸的 `oc_` → `receive_id_type: "chat_id"`
  - 以 `user:` / `dm:` / `open_id:` 或裸的 `ou_` → `open_id` 或 `user_id`
- `normalizeFeishuTarget` 会剥掉 `feishu:` / `lark:` 等前缀，只保留 ID；`resolveReceiveIdType` 据此返回 `chat_id` | `open_id` | `user_id`

因此：**身份在收消息侧 = sender 的 open_id（或 user_id 回退）；在发消息侧 = to 里的 user/open_id 或 chat_id**。

---

## 2. @ 提及（Mention）

### 2.1 收消息：解析 @

- 事件里 `event.message.mentions` 数组，每项含 `key`（如 `@_user_1`）、`id.open_id` / `user_id` / `union_id`、`name`
- **是否 @ 了机器人**：`checkBotMentioned()`  
  - 先看文本是否包含 `@_all`（视为 @ 所有人，包含机器人）  
  - 再看 `mentions` 里是否有 `open_id === botOpenId`  
  - 富文本 post 消息可能没有 mentions，则用 `parsePostContent(content).mentionedOpenIds` 判断
- **正文去占位符**：`normalizeMentions(rawContent, mentions, botOpenId)`  
  - 把 mention 的 key 替换成 `<at user_id="open_id">显示名</at>`，若是机器人自己的 @ 则替换为空，避免 `/help` 等命令被截断

### 2.2 收消息：@ 转发（mention forward）

- 若“同时 @ 了机器人和其他人”，视为要把回复一并 @ 给那些人（`mention.ts` 中 `isMentionForwardRequest`）
- 群：必须同时 @ 机器人和至少一个其他用户；DM：只要 @ 了任意非机器人用户即可
- 被 @ 的用户列表用 `extractMentionTargets(event, botOpenId)` 得到（排除机器人），写入 `ctx.mentionTargets`，在构造给 Agent 的 body 里会加一句说明“回复将自动 @ 这些人”

### 2.3 发消息：带上 @

- **纯文本 / post**：`mention.ts` 中 `formatMentionForText(target)` → `<at user_id="${openId}">${name}</at>`
- **卡片 Markdown**：`formatMentionForCard(target)` → `<at id=${openId}></at>`
- **@ 所有人**：`formatMentionAllForText()` → `<at user_id="all">Everyone</at>`；卡片用 `<at id=all></at>`

发送时（`send.ts`）：

- `sendMessageFeishu` 若传入 `mentions`，会先 `buildMentionedMessage(mentions, text)` 把 @ 拼在正文前，再按 post 发送
- `sendMarkdownCardFeishu` 若传入 `mentions`，用 `buildMentionedCardContent(mentions, text)` 拼进卡片 Markdown

回复分发（`reply-dispatcher.ts`）里，最终发送文本/卡片时会把 `mentionTargets` 传给上述接口，且**只在第一个 chunk 带 mention**（`first ? mentionTargets : undefined`），避免每条分段都 @ 一遍。

### 2.4 Channel 层 strip 规则

`channel.ts` 中 `mentions.stripPatterns` 返回 `['<at user_id="[^"]*">[^<]*</at>']`，用于在需要“纯文本 probe”的场景（如命令检测）里去掉 @ 标签。

---

## 3. 发文件

### 3.1 上传

- **入口**：`media.ts` 中 `uploadFileFeishu`
- **API**：飞书 `im/file/create`，参数：`file_type`（opus | mp4 | pdf | doc | xls | ppt | stream）、`file_name`、`file`（Buffer 或本地路径 ReadStream）、可选 `duration`（音视频毫秒）
- **文件名**：非 ASCII 文件名用 `sanitizeFileNameForUpload` 做 RFC 5987 编码，避免 form-data 导致上传静默失败
- **限制**：单文件最大约 30MB（与飞书文档一致）

### 3.2 发送

- **入口**：`media.ts` 中 `sendFileFeishu`
- **参数**：`cfg, to, fileKey, msgType?, replyToMessageId?, replyInThread?, accountId?`
- **msgType**：`file`（普通文件）、`audio`（opus）、`media`（如 mp4 可播放）
- **逻辑**：  
  - 若有 `replyToMessageId`：`im.message.reply`，可选 `reply_in_thread: true`  
  - 否则：`im.message.create`，`receive_id` + `receive_id_type` 由 `resolveFeishuSendTarget(to)` 得到

### 3.3 从 URL/本地路径/Buffer 发“媒体”（含文件）

- **入口**：`sendMediaFeishu`（同文件在 `media.ts`）
- 若 `mediaUrl` 为本地路径，需传 `mediaLocalRoots` 白名单（安全策略）
- 根据扩展名判断是图片还是文件：图片走 `uploadImageFeishu` + `sendImageFeishu`，否则走 `uploadFileFeishu` + `sendFileFeishu`，其中 `detectFileType` 会选 opus/mp4/pdf/doc/xls/ppt/stream

Agent 回复中的“带文件”是通过 `ReplyPayload.mediaUrls` / `mediaUrl` 传到 reply-dispatcher，再对每个 URL 调 `sendMediaFeishu`（支持 URL 或本地路径 + mediaLocalRoots）。

---

## 4. 发图片

### 4.1 上传

- **入口**：`media.ts` 中 `uploadImageFeishu`
- **API**：`im/image/create`，`image_type: "message" | "avatar"`，`image` 为 Buffer 或文件路径（ReadStream）
- **格式**：JPEG, PNG, WEBP, GIF, TIFF, BMP, ICO

### 4.2 发送

- **入口**：`sendImageFeishu`（`media.ts`）
- **参数**：`cfg, to, imageKey, replyToMessageId?, replyInThread?, accountId?`
- **content**：`JSON.stringify({ image_key: imageKey })`，`msg_type: "image"`
- **发法**：与文件一样，有 reply 则 `im.message.reply`，否则 `im.message.create`

### 4.3 收消息里的图片

- 消息类型为 `image` 时，content 里含 `image_key`；post 里可能嵌多张图，用 `parsePostContent(content).imageKeys` 取
- 下载：统一走 `downloadMessageResourceFeishu`（`im.messageResource.get`，type 传 `image` 或 `file`），不再用已废弃的 `image.get`（仅适用于 im/v1/images 上传的图）
- 下载后通过 runtime 的 `channel.media.saveMediaBuffer` 落盘，再以占位符 `<media:image>` 等形式注入 Agent 上下文

---

## 5. 小结表

| 能力       | 身份/键 | 收消息 | 发消息 |
|------------|----------|--------|--------|
| 身份识别   | open_id / user_id，sender_id | parseFeishuMessageEvent → senderOpenId；可选 resolveFeishuSenderName | to → normalizeFeishuTarget + resolveReceiveIdType |
| @ 提及     | mentions[].id.open_id, key, name | checkBotMentioned；normalizeMentions；mentionTargets | buildMentionedMessage / buildMentionedCardContent；仅首 chunk 带 mentions |
| 发文件     | file_key | messageResource.get(type: "file")；saveMediaBuffer | uploadFileFeishu → sendFileFeishu(msgType: file/audio/media) |
| 发图片     | image_key | messageResource.get(type: "image") 或 post 内 imageKeys | uploadImageFeishu → sendImageFeishu |

核心代码位置（openclaw-src）：

- 身份与消息解析：`extensions/feishu/src/bot.ts`（FeishuMessageEvent、parseFeishuMessageEvent、resolveFeishuSenderName、checkBotMentioned、normalizeMentions、resolveFeishuMediaList）
- @ 逻辑：`extensions/feishu/src/mention.ts`
- 发送目标：`extensions/feishu/src/targets.ts`、`send-target.ts`
- 文本/卡片发送：`extensions/feishu/src/send.ts`（sendMessageFeishu、sendMarkdownCardFeishu）
- 媒体上传与发送：`extensions/feishu/src/media.ts`
- 回复分发（含 mention + 媒体）：`extensions/feishu/src/reply-dispatcher.ts`

若要在 openKuroneko 中实现或对齐飞书行为，可优先对照上述模块的入参、API 调用和错误处理（含 reply 撤回时的 fallback 发新消息）。

---

## 6. 引用（回复某条消息）

### 6.1 飞书事件字段

- **parent_id**：当前消息直接回复的那条消息的 message_id（即「被引用」的那条）。
- **root_id**：若在话题（thread）里，表示话题根消息的 message_id；首条创建话题时可能只有 message_id，后续才有 root_id/thread_id。
- **thread_id**：话题 ID（若在话题内）。

### 6.2 OpenClaw 的引用处理

**入站：**

1. 从事件取 `parent_id`、`root_id`、`thread_id`，写入上下文（如 `ReplyToId`、`RootMessageId`）。
2. 若有 `parent_id`，调用 `getMessageFeishu(cfg, parentId)` 拉取被引用消息的正文，得到 `quotedContent`。
3. 给 Agent 的 body 中若有 `quotedContent`，拼成：`[Replying to: "${quotedContent}"]\n\n${ctx.content}`；同时上下文中带 `ReplyToBody: quotedContent`。

**出站：**

- 回复时用「回复消息」接口：`POST /im/v1/messages/:message_id/reply`，path 里为被回复消息的 message_id（在话题模式下可能用 root_id 作为回复目标以保持在同一话题线）。
- 若回复目标已撤回（如 230011），OpenClaw 会 fallback 为「发新消息」而不是报错。

### 6.3 openKuroneko 中的实现要点

- **入站**：`InboundMessage.reply_to = message.parent_id`，下游可知「本条是回复哪条」；可选增强：拉取被引用消息内容并拼进 content 或单独字段，方便 Agent 理解语境。
- **出站**：当 `OutboundMessage.reply_to` 有值时，飞书适配器应调 `POST /im/v1/messages/:reply_to/reply` 而不是 create，这样飞书端会显示为「引用该消息的回复」。
- **对话循环**：若用户消息带 `reply_to`，在调用 `reply_to_user` 时未传 `reply_to_msg_id` 则自动带入；无工具调用时的直接回复也带上 `msg.reply_to`。
