# YeYing AppStore 开发手册

本文面向 YeYing 社区应用开发者，说明应用从本地开发到发布、审核、安装和运行时接入的最小闭环。协议版本为 `yeying.app/v1`。

## 1. 开发边界

应用由独立服务提供业务能力，YeYing Project 负责用户、组织、权限和菜单入口，社区 Node 负责目录、发布审核和 release artifact，Agent Runtime 负责安装、升级、失败回滚和卸载。应用不得直接控制部署机 Docker Socket，也不得要求 Project 启动 MySQL、Redis、Manticore 等共享中间件。

运行时依赖必须在 release 中声明，由 Agent Runtime 检查连接和执行受控部署。

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

## 4. Project / Agent 接入

Project 管理员通过 Project 的 `api/appstore/*` 兼容入口请求安装，Project 再调用 Agent Runtime：

```http
GET  <agent>/api/v1/internal/installed
POST <agent>/api/v1/internal/install
```

安装请求只提交 `app_id` 和可选版本，不能提交镜像、Compose 或菜单。Agent Runtime 只接受 Node 已发布 release，并由 Agent 负责创建任务、校验制品、执行健康检查和失败回滚。

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

V1 release 的 `runtime.json.service` 必须声明固定镜像对应的服务名、容器端口、仅绑定回环地址的主机端口，以及与应用 ID 一致的 `route_prefix`（例如 `ai` 为 `/apps/ai/`）。Agent 只从白名单 Project 环境变量生成运行时环境文件，并根据 `route_prefix` 生成受控反代；发布包不得携带 Nginx 配置或任意宿主机挂载。

升级健康检查失败时，Agent 使用同一个 Compose project 启动上一份已验证 release，并回报 `rolled_back`。卸载使用 `down --remove-orphans`，默认保留命名卷。

部署机 Agent 的 internal API、任务领取、心跳、状态上报和 release 下载协议由 `agent` 仓库维护。Node 文档只定义 release bundle、发布审核和 Registry 查询边界。

任务状态：

```text
pending -> claimed -> applying -> verifying -> succeeded
                    \-> failed
```

只有 Agent Runtime 校验到任务一致的 `release_digest` 且 `healthcheck.ok=true`，Project 才应看到 `installed` 状态。dry-run、执行、回滚和卸载命令由 `agent` 仓库维护。

## 6. 权限与事件

应用在 `permissions.json` 声明所需的 Host API、事件和应用 API 能力。升级新增权限必须由管理员重新确认。

生命周期事件使用签名 HTTP 回调，禁止在 release 中包含任意 Shell Hook。应用应按 `event_id` 幂等处理事件。

标准事件包括 `application.installed`、`application.upgraded`、`application.uninstalled`、`user.onboarded`、`user.updated` 和 `user.offboarded`。

## 7. 参考资料

- [应用协议 v1](./YeYing-Application-Protocol-v1.md)
- [Runtime Agent 历史说明](./YeYing-AppStore-Runtime-Agent.md)
- [P1 实施说明](./YeYing-AppStore-P1.md)
