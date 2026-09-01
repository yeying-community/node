# Node Pusher 接入示例

本文给 Project、Router、Warehouse 等社区项目提供 Node Pusher 一期接入示例。

一期推荐使用 Node 原生协议：

- 服务端发布：`POST /api/v1/public/pusher/apps/:appId/events`
- 前端订阅：`GET /api/v1/public/pusher/apps/:appId/stream`
- 签名方式：`x-pusher-key` + `x-pusher-timestamp` + `x-pusher-signature`
- 私有用户频道：`private-user.<wallet-address-or-node-subject>`
- 私有 Project 频道：`private-project.<instanceId>`

## 创建 Pusher App

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

返回里的 `secret` 只在创建时明文返回一次，Project 后端应保存到自己的服务端配置或密钥系统中，不能下发到浏览器。

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
