# YeYing 应用协议 v1

## 1. 目标

YeYing Application Protocol（YAP）定义社区应用从开发、发布、审核、安装到接入 Project 的完整契约。协议参与方包括：

- Publisher：应用开发者和发布流水线。
- Registry：YeYing 社区 Node，保存应用、版本、审核和制品索引。
- Runtime Agent：运行在 Project 部署机上的受控执行器。
- Host：YeYing Project，提供用户、权限、菜单和业务 API。
- Application：安装后的独立应用服务。

v1 优先保证发布和接入流程可运行，不包含计费、许可证交易和跨集群调度。

## 2. 设计原则

1. 发布与安装分离：应用上架不表示任何 Project 已安装。
2. 控制面与执行面分离：Registry 创建任务，Agent 执行任务。
3. 制品不可变：同一 `app_id + version` 只能对应一个 release digest。
4. 权限显式声明：应用只能调用审核通过的 Host API 能力。
5. 禁止任意脚本：协议不接受远程 Shell Hook、特权容器或 Docker Socket。
6. 共享中间件只检查：MySQL、Redis、Manticore 等由部署环境提供，应用不得要求 Project 创建通用中间件。
7. 失败不污染状态：健康检查成功前不能进入 `installed`。
8. 兼容当前 Project：保留已安装菜单结构、`Token` 用户验证和本地安装状态镜像。

## 3. 标识与版本

- 协议版本：`yeying.app/v1`。
- 应用 ID：小写字母开头，只允许小写字母、数字和连字符，例如 `ai`、`meeting-room`。
- 应用版本：SemVer，例如 `1.2.0`，发布后不可覆盖。
- 实例 ID：每个 Project 部署生成的 UUID。
- Release ID：`{app_id}@{version}`。
- Task ID、Event ID：UUID。

应用升级兼容性使用 SemVer Range；Project 版本、协议版本和 Agent 版本分别校验，不混为一个版本字段。

## 4. 发布制品

一个 release bundle 是不可变压缩包：

```text
ai-0.1.0/
├── application.json
├── runtime.json
├── config.schema.json
├── permissions.json
├── compose.yaml
├── openapi.yaml             # 可选，应用向 Host 暴露的能力
├── ai-kb/                   # 可选，产品知识库
├── assets/                  # 图标和截图
├── checksums.json
└── signature.json
```

职责划分：

- `application.json`：目录展示、菜单、入口、兼容版本。
- `runtime.json`：镜像 digest、服务、健康检查、依赖和资源边界。
- `config.schema.json`：管理员安装表单与 Agent 配置校验。
- `permissions.json`：应用申请的 Project API 和事件权限。
- `compose.yaml`：受限 Compose 子集，由 Agent 校验后执行。
- `checksums.json`：包内文件 SHA-256。
- `signature.json`：发布者对 checksums digest 的 Ed25519 签名。

Schema 位于 `protocol/yeying-app/v1/`。

## 5. 应用目录协议

`application.json` 必须通过 `application.schema.json`：

```json
{
  "api_version": "yeying.app/v1",
  "kind": "Application",
  "metadata": {
    "id": "ai",
    "name": { "zh-CN": "YeYing AI 助手", "en-US": "YeYing AI Assistant" },
    "description": { "zh-CN": "社区 AI 助手", "en-US": "Community AI assistant" },
    "license": "MIT",
    "homepage": "https://github.com/yeying-community/ai"
  },
  "spec": {
    "version": "0.1.0",
    "host": { "project": ">=1.0.0", "protocol": "^1.0.0" },
    "entries": [{
      "id": "main",
      "location": "application",
      "label": { "zh-CN": "AI 助手", "en-US": "AI Assistant" },
      "path": "/apps/ai/",
      "render": "iframe",
      "visibility": "all"
    }]
  }
}
```

入口只允许相对路径或审核通过的 HTTPS Origin。`user_token` 不允许出现在 URL；Host 通过短期接入票据完成 iframe 或独立应用登录。

## 6. 运行时协议

`runtime.json` 必须通过 `runtime.schema.json`，关键字段包括：

- 镜像使用 `registry/repository@sha256:digest`。
- `healthcheck` 必须有协议、路径、超时和成功状态码。
- `dependencies` 只能引用协议预定义能力，如 `redis`、`mysql`、`manticore`、`project-api`。
- 依赖声明包含 `required` 和连接配置引用，不包含中间件启动定义。
- `mounts` 只能使用 Agent 分配的应用数据目录和显式只读 Host 目录。
- 默认禁止 `privileged`、`host_network`、`docker_socket`、任意设备和任意宿主机路径。

Compose 是运行时描述的补充，不是权限来源；当 Compose 与 `runtime.json` 冲突时必须拒绝安装。

## 7. 配置协议

配置使用 JSON Schema Draft 2020-12，并增加 `x-yeying-*` 扩展：

```json
{
  "type": "object",
  "properties": {
    "LLM_API_KEY": {
      "type": "string",
      "title": "LLM API Key",
      "x-yeying-secret": true
    },
    "REDIS_URL": {
      "type": "string",
      "format": "uri",
      "x-yeying-source": "dependency.redis.url"
    }
  },
  "required": ["LLM_API_KEY", "REDIS_URL"],
  "additionalProperties": false
}
```

- secret 只进入部署机密钥存储和容器环境，不进入任务响应、日志或本地普通 YAML。
- `$random:48` 迁移为 `x-yeying-generate: {"type":"random","length":48}`。
- `user_select` 等 UI 控件使用 `x-yeying-control`，不改变字段的数据类型和校验语义。

## 8. 权限与身份协议

应用声明最小权限：

```json
{
  "host_api": [
    { "resource": "project.tasks", "actions": ["read"], "reason": "生成任务摘要" }
  ],
  "events": ["user.onboarded", "user.updated", "user.offboarded"],
  "application_api": ["badge.write"]
}
```

安装页面向管理员展示权限差异，新增权限的升级必须重新确认。运行时使用应用独立身份，不复用全局 `APP_KEY`：

- Host 为每个 `instance_id + app_id` 签发应用凭据。
- 用户访问应用时，Host 签发短期 access ticket，包含用户、实例、应用、过期时间和授权范围。
- 应用调用 Host API 时使用应用凭据或代表用户的短期票据。
- `APP_SECRET` 作为 v1 兼容机制保留，但必须按应用隔离和轮换。

## 9. 生命周期事件

旧 `hooks.app_install`、`app_update`、`app_uninstall` 的 Shell 命令不进入新协议。应用使用声明式 HTTP 事件订阅：

```json
{
  "subscriptions": [{
    "event": "application.installed",
    "endpoint": "/internal/events",
    "delivery": "at-least-once",
    "timeout_seconds": 10
  }]
}
```

事件信封必须通过 `event.schema.json`，包含 `event_id`、`event_type`、`occurred_at`、`instance_id`、`subject` 和 `data`。请求使用应用独立密钥签名；接收方按 `event_id` 幂等处理。

标准事件：

- `application.installed`
- `application.upgraded`
- `application.uninstalled`
- `user.onboarded`
- `user.updated`
- `user.offboarded`
- `knowledge.changed`

用户事件仅发送应用已声明且审核通过的字段，删除事件不携带无关用户资料。

## 10. 安装任务协议

管理员请求安装后，Registry 创建任务：

```text
requested -> pending -> claimed -> applying -> verifying -> succeeded
                                      |             |
                                      +-> failed <--+
```

升级失败还需进入 `rolling_back`，最终为 `rolled_back` 或 `rollback_failed`。任务结构使用 `task.schema.json`。

Agent 协议：

```text
POST /api/v1/runtime/tasks/claim
POST /api/v1/runtime/tasks/{taskId}/heartbeat
POST /api/v1/runtime/tasks/{taskId}/report
GET  /api/v1/runtime/releases/{appId}/{version}
```

- Claim 使用实例 Agent 凭据，并产生租约。
- Heartbeat 延长租约，防止双重执行。
- Report 带当前状态、release digest、脱敏日志摘要和健康检查结果。
- 状态转换使用乐观锁版本，Registry 拒绝越级或重复转换。
- 相同实例、应用、目标版本和操作使用幂等键去重。

## 11. Registry 发布 API

```text
POST /api/v1/publisher/releases/initiate
PUT  /api/v1/publisher/releases/{releaseId}/artifact
POST /api/v1/publisher/releases/{releaseId}/submit
POST /api/v1/admin/releases/{releaseId}/approve
POST /api/v1/admin/releases/{releaseId}/reject
POST /api/v1/admin/releases/{releaseId}/publish
POST /api/v1/admin/releases/{releaseId}/withdraw
```

发布状态：

```text
draft -> uploaded -> validating -> submitted -> approved -> published
                     |              |             |
                     -> invalid     -> rejected    -> withdrawn
```

自动校验至少包括 Schema、校验和、签名、镜像 digest、许可证、Compose 策略、权限声明、恶意文件和版本不可变性。

当前 Node 已实现首个 release bundle 校验器：`src/appstore/release/validator.ts`。它使用 Registry 已登记的发布者公钥校验 Ed25519 签名，拒绝浮动镜像标签、Docker Socket、特权容器、host 网络、host PID、设备映射、路径穿越和校验和不一致。发布上传 API 接入前必须复用该校验器。

当前发布入口为 `POST /api/v1/publisher/releases/submit`。请求使用 Node JWT/UCAN 登录态，`publisher_key_id` 必须在 `appStoreRelease.publisherKeys` 中登记且 owner 与当前钱包一致。接口校验 bundle 后以内容寻址方式保存制品，并创建 `submitted` release；同一应用版本禁止用不同 digest 覆盖。

审核接口位于 `/api/v1/admin/releases/{releaseId}/approve|reject|publish|withdraw`，仅 Node 管理员可调用。状态只能依次从 `submitted -> approved -> published`，发布后只允许撤回。Adapter 的 catalog 与安装接口只读取 `published` release 的已校验制品，不再使用内置或写死的应用列表。

## 12. Host 接入 API

Project 与 AppStore Adapter 保持以下兼容入口：

```text
GET  /internal
GET  /api/v1/internal/catalog
GET  /api/v1/internal/installed
POST /api/v1/internal/install
POST /api/v1/internal/upgrade
POST /api/v1/internal/uninstall
```

`installed` 继续返回 Project 当前消费的 `id`、`version`、`install_at` 和 `menu_items`。Adapter 负责把协议中的多语言 label、entry 和 visibility 转换为当前格式。

## 13. 本地状态镜像

Agent 成功安装后原子写入：

```text
docker/appstore/config/{appId}/config.yml
```

兼容字段：

```yaml
status: installed
install_version: 0.1.0
install_at: 2026-07-23T00:00:00Z
release_digest: sha256:...
```

Registry 是任务与安装历史的权威数据源，本地文件是 Host 运行时镜像。应用 secret 不再写入普通 YAML；Project 的 `Apps::appSecret()` 后续迁移到受限密钥文件。

## 14. 当前 Project 迁移映射

| 当前字段或行为 | YAP v1 |
| --- | --- |
| 顶层 `name/description/author` | `application.metadata` |
| `menu_items` | `application.spec.entries` |
| `require_version` | `application.spec.host.project` |
| `fields` | `config.schema.json` |
| `$random:48` | `x-yeying-generate` |
| `knowledge_base` | bundle `ai-kb/` capability |
| `openapi` | bundle `openapi.yaml` + permissions |
| Shell lifecycle Hook | 签名 HTTP lifecycle event |
| `APP_SECRET` | 独立应用身份；兼容期保留 |
| `/api/v1/internal/installed` | Adapter 兼容输出 |
| AppStore 挂 Docker Socket | 部署机拉取式受限 Agent |

## 15. 最小闭环

首个闭环以 AI Assistant 为样板：

1. AI 仓库构建固定 digest 镜像和 release bundle。
2. Publisher 使用钱包/发布密钥签名并上传 Registry。
3. Registry 自动校验，管理员审核后发布。
4. Project 管理员请求安装并确认权限与配置。
5. Agent claim 任务，校验、部署、健康检查并 report。
6. Registry 标记安装成功，Project `installed` 接口返回 AI 菜单。
7. Host 签发用户 access ticket，AI 使用声明权限访问 Project API。
8. 升级和卸载沿用同一任务与事件协议。

完成上述闭环后，再迁移 Approve、OKR、Search；不批量照搬旧应用包。
