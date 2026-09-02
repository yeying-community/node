# Node Pusher 接入示例

本文给 Project、Router、Warehouse 等社区项目提供 Node Pusher 一期接入示例。

一期推荐使用 Node 原生协议：

- 服务端发布：`POST /api/v1/public/pusher/apps/:appId/events`
- 前端订阅：`GET /api/v1/public/pusher/apps/:appId/stream`
- 签名方式：`x-pusher-key` + `x-pusher-timestamp` + `x-pusher-signature`
- 私有用户频道：`private-user.<wallet-address-or-node-subject>`
- 私有 Project 频道：`private-project.<instanceId>`

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

后台管理接口只作为平台兜底或初始化入口：

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
    "private-project.*"
  ],
  "allowedOrigins": [
    "https://project.example.com"
  ]
}
```

也可以使用脚本：

```bash
NODE_ADMIN_TOKEN="<admin token>" \
npm run pusher:create-app -- \
  --app-id project \
  --channel-pattern 'public-*' \
  --channel-pattern 'private-user.*' \
  --channel-pattern 'private-project.*' \
  --origin 'https://project.example.com'
```

返回里的 `secret` 同样只在创建时明文返回一次。

## Project smoke 验证

Project 服务端配置好 Node Pusher 凭据后，先验证服务端能发布到 Node：

```bash
php artisan pusher:smoke \
  --channel=public-project-smoke \
  --type=project.smoke \
  --persist=1 \
  --timeout=10
```

通过标准：Node 返回 HTTP 200，响应中 `code=0` 且 `data.accepted=true`。这只证明 Project 服务端凭据、签名和 Node publish API 可用；业务是否生效，还需要确认真实业务动作已经调用 Project publish client，并且订阅方正在监听对应 channel。

一期原生 HTTP publish 不依赖 Laravel `BROADCAST_DRIVER=pusher`，Project 可以继续保持 `BROADCAST_DRIVER=log`。只有后续启用 Pusher-compatible HTTP / WebSocket 时，才需要评估 Laravel Broadcasting 配置。

## 同步 Project 身份映射

`private-project.<instanceId>` 订阅需要 Node 能判断当前登录用户是否属于 Project 实例。

一期先由管理端或同步脚本写入映射：

```http
POST /api/v1/admin/pusher/project-identities
Authorization: Bearer <admin token>
Content-Type: application/json

{
  "instanceId": "project-main",
  "projectUserId": "1001",
  "identityDid": "did:yeying:wid_abc",
  "walletAddress": "0x1111111111111111111111111111111111111111",
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
      `private-project.${input.projectInstanceId}`,
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
- `private-project.<instanceId>` 必须存在 active Project 身份映射。
- `allowedOrigins` 为空数组表示不限制；配置后，SSE 订阅请求的 `Origin` 必须匹配。
- Redis 开启后，Pusher 使用 `redis.pusherChannel` 做多实例实时 fanout；Redis 关闭时退回单实例内存 fanout。
- SSE 断线回放仍从数据库 `pusher_events` 按 cursor 读取，不依赖 Redis Streams。
- Email 模板优先使用事件 payload 中的 `emailTemplateId` / `templateId`，否则按 `source + type` 匹配。
- 安全类事件，例如 `security.login`，不能通过通知偏好完全关闭邮件，只能后续做限流或异常抑制。
- 不支持 Pusher WebSocket。
- 不支持 presence channel。
- 不支持 client event。
- 多实例 fanout 还未接 Redis，当前适合单实例或粘性会话环境。
