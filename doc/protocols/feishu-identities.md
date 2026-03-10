# 飞书用户身份文件协议（feishu-identities.json）

## 名称与版本

- 协议名：feishu-identities
- 版本：1.0

## 参与方

- **生产者**：外脑（openKuroneko）在启动时及每次飞书事件合并 open_id/union_id/name 后，写入 `<obDir>/feishu-identities.json`。
- **消费者**：内脑（或其它需要「谁是谁」的模块）读取该文件，获知 user_id、展示名、union_id、open_id 的对应关系。

## 数据格式

- **编码**：UTF-8
- **格式**：JSON 数组，每项为对象：

| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | string | 内部统一用户 ID（UserStore） |
| display_name | string | 展示名（飞书 contact 或映射表解析） |
| union_id | string \| null | 飞书 union_id（on_xxx），跨应用一致 |
| open_id | string \| null | 本应用下飞书 open_id（ou_xxx），发 DM 等 API 使用 |

- **示例**：

```json
[
  {
    "user_id": "feishu_on_94626acdda9676a3ff1aee6c9c58bf73",
    "display_name": "blackcat",
    "union_id": "on_94626acdda9676a3ff1aee6c9c58bf73",
    "open_id": "ou_141ae8811fd13f0599a3201991abb4b7"
  }
]
```

## 语义约定

- **写入**：覆盖整个文件；写入时机为（1）外脑启动后、（2）每次 `onFeishuIdsSeen` 合并新条目并回写 UserStore 展示名后。
- **读取**：内脑可按需读取；文件不存在或为空数组表示尚无飞书用户映射。
- **主键**：本仓库以 **union_id** 为飞书侧主键（thread_id 的 DM 部分、UserStore 的 raw_id）；open_id 为本应用下实例，发私信等需用 open_id。

## 错误行为

- 文件损坏或非 JSON：消费者按「无映射」处理。
- 缺字段：消费者对缺失字段按 null 或空字符串处理。

## 相关

- 映射表持久化：`<obDir>/feishu-openid-map.json`（open_id → name, union_id）
- 用户与频道绑定：`<obDir>/users.json`（UserStore）
