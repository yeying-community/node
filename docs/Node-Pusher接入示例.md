# Node Pusher 接入示例

本文给 Project、Router、Warehouse 等社区项目提供 Node Pusher 一期接入示例。

服务端发布按应用现状选择协议：

- Laravel 已使用 Laravel Broadcasting：使用 Pusher-compatible HTTP `POST /apps/{appId}/events`，无需改造已有广播事件的发布实现。
- 其它服务端或需要 Node 专有通知字段：使用 Node 原生 `POST /api/v1/public/pusher/apps/:appId/events`，由 `x-pusher-key`、`x-pusher-timestamp`、`x-pusher-signature` 签名。
- 当前客户端订阅优先使用 SSE：`GET /api/v1/public/pusher/apps/:appId/stream`。
- 私有用户频道：`private-user.<wallet-address-or-node-subject>`；应用私有频道：`private-<application-defined-resource>`，例如 `private-workspace.<workspaceId>`。

## 什么时候接入

Node Pusher 用于把业务事件从一个应用发布给多个订阅者。它适合跨应用扇出、统一通知或需要在线订阅与断线回放的事件；它不是业务 API、任务队列或数据库事务的替代品。

| 场景 | 建议 |
| --- | --- |
| 同一应用页面内的任务、看板、讨论即时刷新 | 继续使用该应用已有 WebSocket；无需仅为刷新页面接入 Node Pusher |
| Router、Warehouse、移动应用或 Node 通知中心需要订阅某应用的业务变化 | 接入 Node Pusher，按业务事件发布，不暴露内部模型变更 |
| 事件需要统一收件箱、Webhook 或 Email | 接入 Node Pusher；当前使用 Node 原生发布 API 传递 `eventId`、`persist`、`notification` 等 Node 专有字段 |
| 事件需要通过 SSE 在线订阅和游标回放 | 接入 Node Pusher；按用户/资源权限配置 private channel 和 ACL |
| 输入状态、光标、presence 等高频临时状态 | 保留现有 WebSocket；当前 Node 不支持 Pusher WebSocket、presence 或 client event |
| 要求可靠执行、顺序处理或明确消费确认的后台任务 | 使用队列或 transactional outbox；Pusher 负责通知/扇出，消费者仍须幂等，不能把它当任务队列 |
| 浏览器必须直接使用 `pusher-js` / Laravel Echo 连接 Node | 暂不接入该订阅方式；Node 尚未实现 Pusher WebSocket，可先使用 Node SSE |

### 选择接入协议

| 应用或客户端 | 发布 / 订阅方式 |
| --- | --- |
| Laravel 服务端已有 Laravel Broadcasting 事件，且只需发布普通实时事件 | 官方 `pusher/pusher-php-server` 发布到标准 `POST /apps/{appId}/events`；浏览器暂用 Node SSE 订阅 |
| 需要 Node 专有的稳定 `eventId`、通知中心、Webhook/Email 投递，或非 Laravel 服务端 | Node 原生 `POST /api/v1/public/pusher/apps/:appId/events`，使用 Node 原生签名 |
| 浏览器或服务端订阅 Node 事件 | Node SSE；私有频道使用 Node 登录令牌和 channel ACL |
| 已有 Project 内部 Swoole `PushTask` 流程 | 原样保留；只有跨应用事件另行发布到 Node |

## 应用接入步骤

1. 先定义业务事件名、发布时机、channel、接收方及事件是否需要通知中心投递。推送只提示状态变化，客户端仍应通过业务 API 查询权威数据。
2. 为每个应用创建独立 Pusher App 凭据，并把 `channelPatterns` 限制到该应用实际需要的范围。`secret` 只保存在服务端密钥或部署配置中。
3. 根据上表选 Node 原生 API 或标准 Pusher HTTP API，不要把两种签名格式混用。
4. 明确订阅侧身份与私有频道 ACL；浏览器不得持有 app secret。通知中心、Email 或 Webhook 只对明确需要离线投递的事件启用。
5. 先用一个低频、可幂等的事件联调发布、订阅和权限，再逐步扩大事件范围；避免同一用户可见通知由旧 WebSocket 和 Node 各生成一份。

## Project 接入判断

Project 当前已有 LaravelS/Swoole WebSocket，任务、看板、文件和讨论的在线同步不依赖 Node Pusher。Node Pusher 一期不替换这条内部链路，只作为跨应用事件、统一通知中心、持久化回放、Webhook/Email 和多实例 fanout 的标准入口。

判断是否需要接入 Node Pusher：

- 只要求 Project 网页里在线用户实时看到任务变更：继续使用现有 WebSocket，不需要 Node Pusher。
- 外部应用、个人应用或 Node 通知中心需要订阅 Project 事件：接入 Node Pusher。
- 事件需要持久化、断线回放、审计、邮件、Webhook 或后续 Web Push：接入 Node Pusher。
- 只是配置了 `PUSHER_APP_ID` / `PUSHER_APP_KEY` / `PUSHER_APP_SECRET`：只代表服务端凭据可用，不代表业务已经发布事件或前端已经订阅。

建议先接少量低频、跨应用有价值的事件，例如 `project.task.assigned`、`project.task.due_changed`、`project.mention.created`、`project.file.shared`。不要把所有高频字段更新同时双发到 Node Pusher，避免重复通知和重复未读。

## 创建 Pusher App

推荐在个人应用 / 应用中心里为应用创建一次性 Pusher 凭据：

```http
POST /api/v1/public/applications/:uid/pusher/credentials
Authorization: Bearer <application owner token>
Content-Type: application/json

{
  "pusherAppId": "project",
  "allowedOrigins": [
    "https://project.example.com"
  ],
  "requestId": "<uuid>",
  "timestamp": "2026-09-02T00:00:00.000Z",
  "signature": "<owner personal_sign signature>"
}
```

`secret` 只在创建时明文返回一次，Project 后端应保存到自己的服务端配置或密钥系统中，不能下发到浏览器。

已创建应用如果之前没有创建过 Pusher 凭据，仍然调用同一个创建接口即可。应用中心可以先查询当前状态：

```http
GET /api/v1/public/applications/:uid/pusher/credentials
Authorization: Bearer <application owner token>
```

已存在时只返回 `key`、`secretMasked`、`appId`、`allowedOrigins`、`channelPatterns` 等元数据，不返回明文 `secret`。不存在时返回 404，前端再展示“创建 Pusher 凭据”。

如果后续泄露、遗失或需要重新生成服务端 Pusher 参数，创建一条凭据轮换记录：

```http
POST /api/v1/public/applications/:uid/pusher/credentials/rotations
Authorization: Bearer <application owner token>
Content-Type: application/json

{
  "allowedOrigins": [
    "https://project.example.com"
  ],
  "requestId": "<uuid>",
  "timestamp": "2026-09-02T00:00:00.000Z",
  "signature": "<owner personal_sign signature>"
}
```

轮换会保持 `appId` 不变，只生成新的 `key` 和 `secret`；旧 `key` / `secret` 立即失效。`secret` 仍只在轮换响应里明文返回一次。

后台管理接口只作为平台兜底或初始化入口，常规创建和轮换应在个人应用 / 应用中心界面完成：

管理员可以通过 API 创建：

```http
POST /api/v1/admin/pusher/apps
Authorization: Bearer <admin token>
Content-Type: application/json

{
  "appId": "project",
  "channelPatterns": [
    "public-*",
    "private-user.*",
    "private-*"
  ],
  "allowedOrigins": [
    "https://project.example.com"
  ]
}
```

返回里的 `secret` 同样只在创建时明文返回一次。

## Project smoke 验证

Project 服务端配置好 Node Pusher 凭据后，先验证服务端能发布到 Node：

```bash
./cmd artisan pusher:smoke \
  --channel=public-project-smoke \
  --type=project.smoke \
  --persist=1 \
  --timeout=10
```

通过标准：Node 返回 HTTP 200，响应中 `code=0` 且 `data.accepted=true`。这只证明 Project 服务端凭据、签名和 Node publish API 可用；业务是否生效，还需要确认真实业务动作已经调用 Project publish client，并且订阅方正在监听对应 channel。

这个 smoke 命令验证的是 Node 原生 publish 接口和签名，不依赖 Laravel `BROADCAST_DRIVER=pusher`。

## Laravel Pusher 标准 HTTP 接入

Project 使用 Laravel `pusher/pusher-php-server` 时，将 Pusher driver 的 host 指向 Node：

当前 Project 分支已在 `composer.json` / `composer.lock` 声明该 SDK。同步依赖后，在 Project 仓库根目录执行：

```bash
./cmd composer install
```

生产发布环境安装锁定依赖时使用：

```bash
./cmd composer install --no-dev --optimize-autoloader
```

只有在其它分支或项目尚未声明此依赖时，才需要添加依赖并更新锁文件：

```bash
./cmd composer require pusher/pusher-php-server:^7.0
```

已有 `composer.lock` 时不要重复执行 `require`，用 `install` 安装已锁定版本。

```env
BROADCAST_DRIVER=pusher
PUSHER_APP_ID=project
PUSHER_APP_KEY=pk_...
PUSHER_APP_SECRET=ps_...
PUSHER_APP_HOST=node.example.com
PUSHER_APP_SCHEME=https
PUSHER_APP_PORT=443
```

Node 提供标准入口 `POST /apps/{appId}/events`，校验 `auth_key`、`auth_timestamp`、
`auth_version`、`body_md5` 和 `auth_signature`，支持单频道 `channel` 和多频道 `channels` 发布。
当前不支持 `/batch_events`、Pusher WebSocket、presence channel 或 client event；
`pusher-js` / Laravel Echo 所需的 WebSocket 仍需后续实现。

`PUSHER_APP_HOST` 只填写主机名，不要填写 `/api/v1` 路径。Node 的标准兼容入口位于根路径。
Node 前的反向代理也必须把 `/apps/` 转发到 Node 服务。

这只启用 Laravel Pusher broadcaster 的服务端 HTTP 发布能力，不会自动把 Project 的
Swoole `PushTask` 改道到 Node。Project 当前仍使用 `BROADCAST_DRIVER=log`，代码中没有
`ShouldBroadcast` 广播事件；要实际产生 Laravel 广播流量，仍需由业务代码显式使用
Laravel Broadcasting。标准端点当前不会读取 Node 原生协议的 `eventId`、`persist`、
`notification`、`recipients` 扩展字段，也不会创建通知中心投递；需要这些能力时应调用
Node 原生 API。现有 `pusher:smoke` 命令走的是 Project 原生 Node Pusher API，
不验证 Laravel SDK 的标准协议链路。

Project 不使用 Laravel Queue。标准协议联调应使用 `ShouldBroadcastNow`，并在业务事务提交后触发；不要为实时推送引入 queued `ShouldBroadcast` job。Project 当前 `.env` 仍是 `BROADCAST_DRIVER=log`。启用 Laravel driver 前，需准备 Node 中该 app 的 `appId`、`key`、`secret`，配置上面的 host/scheme/port，再通过同步广播事件完成标准协议联调。修改配置后执行 `./cmd php restart`。不要把 `BROADCAST_DRIVER=pusher` 当作把 `PushTask` 自动迁移到 Node 的开关。

## 写入 Channel ACL

`private-*` 订阅需要 Node 能判断当前登录用户是否被目标应用授权访问该频道。

Node core 不维护 Project user id 等应用专用映射。Project 应在自己的业务层判断成员关系，然后把授权结果转换成通用 DID 或 account，写入 Node Pusher channel ACL：

```http
POST /api/v1/admin/pusher/channel/acls
Authorization: Bearer <admin token>
Content-Type: application/json

{
  "appId": "project",
  "channel": "private-workspace.project-main",
  "subject": "did:yeying:wid_abc",
  "subjectType": "identity",
  "metadata": {
    "nickname": "Alice"
  }
}
```

当前 Node 登录态里的 subject 仍主要来自钱包地址，因此 `walletAddress` 建议同步。后续身份体系稳定后，订阅鉴权可以优先使用 `identityDid`。

## Project 服务端发布事件

Node 使用 canonical JSON 做签名。发布方必须保证签名前后的 body 结构一致。

```ts
import crypto from 'crypto'

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function signPusherEvent(input: {
  timestamp: string
  body: Record<string, unknown>
  secret: string
}) {
  const payload = `${input.timestamp}.${canonicalJson(input.body)}`
  return `sha256=${crypto.createHmac('sha256', input.secret).update(payload).digest('hex')}`
}

export async function publishProjectEvent(input: {
  nodeBaseUrl: string
  appId: string
  key: string
  secret: string
  eventId: string
  projectInstanceId: string
  projectUserWallet: string
  taskId: number
}) {
  const body = {
    eventId: input.eventId,
    type: 'project.task.updated',
    source: 'project',
    channels: [
      `private-workspace.${input.projectInstanceId}`,
      `private-user.${input.projectUserWallet.toLowerCase()}`,
    ],
    data: {
      taskId: input.taskId,
      status: 'done',
    },
    persist: true,
    recipients: [input.projectUserWallet.toLowerCase()],
    notification: {
      title: '任务已更新',
      body: `任务 ${input.taskId} 已完成`,
      level: 'success',
      subjectType: 'project_task',
      subjectId: String(input.taskId),
    },
  }
  const timestamp = new Date().toISOString()
  const response = await fetch(
    `${input.nodeBaseUrl.replace(/\/$/, '')}/api/v1/public/pusher/apps/${input.appId}/events`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pusher-key': input.key,
        'x-pusher-timestamp': timestamp,
        'x-pusher-signature': signPusherEvent({
          timestamp,
          body,
          secret: input.secret,
        }),
      },
      body: JSON.stringify(body),
    }
  )
  if (!response.ok) {
    throw new Error(`Node Pusher publish failed: HTTP ${response.status}`)
  }
  return response.json()
}
```

## 前端订阅 SSE

浏览器端只能拿登录态 token 订阅，不能拿 app secret。

```ts
const channel = `private-user.${walletAddress.toLowerCase()}`
const url = new URL(`/api/v1/public/pusher/apps/project/stream`, nodeBaseUrl)
url.searchParams.set('channels', channel)

const response = await fetch(url.toString(), {
  headers: {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'text/event-stream',
  },
})

if (!response.ok || !response.body) {
  throw new Error(`Node Pusher stream failed: HTTP ${response.status}`)
}

const reader = response.body.getReader()
const decoder = new TextDecoder()
let buffer = ''

while (true) {
  const { value, done } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  const frames = buffer.split('\n\n')
  buffer = frames.pop() || ''
  for (const frame of frames) {
    const event = frame
      .split('\n')
      .find((line) => line.startsWith('event: '))
      ?.slice('event: '.length)
    const data = frame
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice('data: '.length)
    if (event === 'project.task.updated' && data) {
      const payload = JSON.parse(data)
      console.log('task updated', payload.data)
    }
  }
}
```

如果要使用浏览器原生 `EventSource`，需要后续增加短期 stream token 或同域 cookie/session。不要把长期 access token 或 app secret 放进 URL。

## 一期边界

- `public-*` 频道不做成员校验。
- `private-user.<subject>` 必须匹配当前登录主体。
- 其它 `private-*` 必须存在 active channel ACL。
- `allowedOrigins` 为空数组表示不限制；配置后，SSE 订阅请求的 `Origin` 必须匹配。
- Redis 开启后，Pusher 使用 `redis.pusherChannel` 做多实例实时 fanout；Redis 关闭时退回单实例内存 fanout。
- SSE 断线回放仍从数据库 `pusher_events` 按 cursor 读取，不依赖 Redis Streams。
- Email 模板优先使用事件 payload 中的 `emailTemplateId` / `templateId`，否则按 `source + type` 匹配。
- 安全类事件，例如 `security.login`，不能通过通知偏好完全关闭邮件，只能后续做限流或异常抑制。
- 不支持 Pusher WebSocket。
- 不支持 presence channel。
- 不支持 client event。
- Pusher 已支持通过 `redis.pusherChannel` 做多实例实时 fanout；Redis 关闭时退回当前实例内存 fanout。断线回放仍以数据库 cursor 为准。
