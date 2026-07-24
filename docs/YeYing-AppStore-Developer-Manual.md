# YeYing AppStore 开发手册

本文面向 YeYing 社区应用开发者，说明应用从本地开发到发布、审核、安装和运行时接入的最小闭环。协议版本为 `yeying.app/v1`。

## 1. 开发边界

应用由独立服务提供业务能力，YeYing Project 负责用户、组织、权限和菜单入口，社区 Node 负责目录、发布审核和安装任务。应用不得直接控制部署机 Docker Socket，也不得要求 Project 启动 MySQL、Redis、Manticore 等共享中间件。

运行时依赖必须在 release 中声明，由部署机 Runtime Agent 检查连接和执行受控部署。

## 2. Release bundle

每个发布版本必须提供不可变 bundle：

```text
application.json
runtime.json
config.schema.json
permissions.json
compose.yaml
checksums.json
signature.json
```

可选内容包括 `openapi.yaml`、`ai-kb/` 和 `assets/`。完整字段定义见仓库 `protocol/yeying-app/v1/`。

关键要求：

- 应用 ID 使用小写字母、数字和连字符，例如 `ai`。
- 版本使用 SemVer，发布后不能覆盖同一 `app_id + version`。
- 镜像必须使用不可变 `@sha256:` digest，禁止只使用 tag。
- Compose 禁止 `privileged`、host network、host PID、设备映射和 Docker Socket。
- 配置 Schema 必须将密钥声明为 `x-yeying-secret: true`。
- bundle 的 checksums 必须由已登记发布者的 Ed25519 私钥签名。

## 3. 发布流程

1. 构建镜像并记录 digest。
2. 创建 bundle，生成 `checksums.json` 和 `signature.json`。
3. 使用发布者登录态调用：

```http
POST /api/v1/publisher/releases/submit
```

请求体包含 `publisher_key_id` 和 `files`。`publisher_key_id` 必须在社区 Node 配置中登记，且 owner 必须与当前登录钱包一致。

4. 服务端校验 Schema、校验和、签名、镜像 digest 和 Compose 策略，成功后创建 `submitted` release。
5. 社区管理员依次调用 `approve`、`publish`。只有 `published` release 会出现在目录并允许安装。

审核状态：

```text
submitted -> approved -> published -> withdrawn
submitted -> rejected
approved  -> rejected
```

## 4. Project 接入

Project 管理员通过 AppStore Adapter 查询目录并请求安装：

```http
GET  /api/v1/internal/catalog
POST /api/v1/internal/install
```

安装请求只提交 `app_id` 和可选版本，不能提交镜像、Compose 或菜单。Adapter 只接受已发布制品，随后创建 Runtime Agent 任务。

已安装应用继续使用兼容响应：

```json
{
  "code": 200,
  "data": [{
    "id": "ai",
    "version": "0.1.0",
    "install_at": "2026-07-24T00:00:00Z",
    "menu_items": []
  }]
}
```

## 5. Runtime Agent

部署机 Agent 使用实例专属 Bearer Token 领取任务：

```http
POST /api/v1/runtime/tasks/claim
POST /api/v1/runtime/tasks/{taskId}/heartbeat
POST /api/v1/runtime/tasks/{taskId}/report
POST /api/v1/runtime/tasks/{taskId}/release
GET  /api/v1/runtime/releases/{appId}/{version}
```

任务状态：

```text
pending -> claimed -> applying -> verifying -> succeeded
                    \-> failed
```

只有成功回报了任务一致的 `release_digest` 且 `healthcheck.ok=true`，Adapter 才把应用标记为 `installed`。`release` 用于 dry-run，归还 `claimed` 任务而不改变安装状态。

Project 可使用：

```bash
scripts/appstore-agent.sh --dry-run
```

该命令仅校验 release 和依赖连通性，不拉镜像、不修改配置、不启动或停止容器。

## 6. 权限与事件

应用在 `permissions.json` 声明所需的 Host API、事件和应用 API 能力。升级新增权限必须由管理员重新确认。

生命周期事件使用签名 HTTP 回调，禁止在 release 中包含任意 Shell Hook。应用应按 `event_id` 幂等处理事件。

标准事件包括 `application.installed`、`application.upgraded`、`application.uninstalled`、`user.onboarded`、`user.updated` 和 `user.offboarded`。

## 7. 参考资料

- [应用协议 v1](./YeYing-Application-Protocol-v1.md)
- [Runtime Agent 设计](./YeYing-AppStore-Runtime-Agent.md)
- [P1 实施说明](./YeYing-AppStore-P1.md)
