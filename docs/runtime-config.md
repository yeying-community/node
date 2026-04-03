# 运行配置

本文档说明 Node 服务的运行时配置来源、加载优先级、默认值，以及哪些项支持环境变量覆盖。

## 配置加载方式
- 默认从项目根目录的 `config.js` 加载。
- 可通过环境变量 `APP_CONFIG_PATH` 指定其他配置文件路径。
- 支持 `.js` / `.cjs` 模块导出，也支持 JSON 文件。

启动前通常先复制模板：

```bash
cp config.js.template config.js
```

配置加载入口见：
- `src/config/runtime.ts`
- `config.js.template`

## 优先级
默认优先级如下：

1. 环境变量
2. `config.js`
3. 代码内置默认值

注意：
- 不是所有配置项都支持环境变量覆盖。
- `ACTION_SIGNATURE_MAX_AGE_MS`、`ACTION_SIGNATURE_FUTURE_SKEW_MS` 是 env-only，不读取 `config.js`。

## 配置项总览

### `app`
- `app.env`
  - 说明：运行环境标识
  - 默认：`dev`
  - 环境变量：无
- `app.port`
  - 说明：HTTP 服务端口
  - 默认：`8100`
  - 环境变量：`APP_PORT`

### `database`
- `database.type`
  - 说明：数据库类型，支持 `sqlite` / `mysql` / `postgres`
- `database.database`
  - 说明：数据库名；sqlite 场景下为文件路径
- `database.host`
- `database.port`
- `database.username`
- `database.password`
- `database.synchronize`
  - 说明：默认模板的 sqlite 快速启动模式可开启；mysql/postgres 场景应保持关闭并走 migration
- `database.logging`
- `database.schema`
  - 说明：Postgres schema 名
- 环境变量覆盖：无

### `auth`
- `auth.jwtSecret`
  - 默认：`replace-this-in-production`
  - 环境变量：`JWT_SECRET`
- `auth.accessTtlMs`
  - 默认：`15 * 60 * 1000`
  - 环境变量：`ACCESS_TTL_MS`
- `auth.refreshTtlMs`
  - 默认：`7 * 24 * 60 * 60 * 1000`
  - 环境变量：`REFRESH_TTL_MS`
- `auth.challengeTtlMs`
  - 默认：`5 * 60 * 1000`
  - 环境变量：`AUTH_CHALLENGE_TTL_MS`
- `auth.refreshCookieName`
  - 默认：`refresh_token`
  - 环境变量：`AUTH_REFRESH_COOKIE_NAME`
- `auth.cookieSameSite`
  - 默认：`lax`
  - 环境变量：`COOKIE_SAMESITE`
- `auth.cookieSecure`
  - 默认：`false`
  - 环境变量：`COOKIE_SECURE`

### `idempotency`
- `idempotency.successRetentionDays`
  - 说明：成功响应缓存保留天数
  - 默认：`7`
- `idempotency.failureRetentionDays`
  - 说明：失败响应缓存保留天数
  - 默认：`1`
- `idempotency.pendingTimeoutMs`
  - 说明：`pending` 请求超时清理阈值
  - 默认：`15 * 60 * 1000`
- `idempotency.cleanupIntervalMs`
  - 说明：后台清理任务执行间隔
  - 默认：`15 * 60 * 1000`
- 环境变量覆盖：无

说明：
- 成功响应按 `2xx-3xx` 归类。
- 失败响应按 `4xx-5xx` 归类。
- 若旧配置中仍存在 `idempotency.responseRetentionDays`，当前代码会将其作为 `successRetentionDays` 的回退值，并用于 `failureRetentionDays` 的默认推导；新配置应优先使用 `successRetentionDays` / `failureRetentionDays`。

### 写签名时间窗（env-only）
- `ACTION_SIGNATURE_MAX_AGE_MS`
  - 说明：签名最大有效时长
  - 默认：`5 * 60 * 1000`
- `ACTION_SIGNATURE_FUTURE_SKEW_MS`
  - 说明：允许的未来时间偏移
  - 默认：`30 * 1000`

说明：
- 这两个值只从环境变量读取，不支持 `config.js`。
- 代码位置：`src/auth/actionSignature.ts`

### 前端静态目录（env-only）
- `WEB_DIST_DIR`
  - 说明：Node 服务托管前端静态资源时使用的目录
  - 默认：`<project-root>/web/dist`

说明：
- 目录下需要存在 `index.html`
- 未设置且默认目录不存在时，Node 服务仅提供 API，不托管前端页面

### `ucan`
- `ucan.aud`
  - 默认：`did:web:localhost:8100`
  - 环境变量：`UCAN_AUD`
- `ucan.with`
  - 默认：`app:all:localhost-5173`
  - 环境变量：`UCAN_WITH`
- `ucan.can`
  - 默认：`invoke`
  - 环境变量：`UCAN_CAN`

说明：
- `UCAN_AUD` 必须与前端生成 token 时的 audience 完全一致。
- 若未配置 `UCAN_AUD`，默认值会基于 `APP_PORT` / `app.port` 推导。

### `audit`
- `audit.approvers`
  - 说明：默认审批人地址列表
  - 默认：空，由模板示例给出占位地址
- `audit.requiredApprovals`
  - 说明：默认通过阈值
  - 默认：`1`
  - 环境变量覆盖：无

### `mpc`
- `mpc.messageRetentionDays`
  - 默认：`7`
- `mpc.auditRetentionDays`
  - 默认：`30`
- `mpc.cleanupIntervalMs`
  - 默认：`15 * 60 * 1000`
- `mpc.ucanWith`
  - 默认：`mpc`
- `mpc.ucanCan`
  - 默认：`coordinate`
- 环境变量覆盖：无

### `redis`
- `redis.enabled`
- `redis.host`
- `redis.port`
- `redis.username`
- `redis.password`
- `redis.db`
- `redis.keyPrefix`
- `redis.channel`
- `redis.tls`
- `redis.instanceId`
- `redis.streamEnabled`
- `redis.streamOnly`
- `redis.streamKeyPrefix`
- `redis.streamMaxLen`
- `redis.streamApprox`
- 环境变量覆盖：无

说明：
- `redis.enabled=true` 时启用跨实例 Pub/Sub。
- `redis.streamEnabled=true` 时保留事件流，支持 SSE 续传。

### `logger`
- `logger.level`
  - 默认：`info`
- `logger.file`
  - 可选：开启按日切分文件日志
  - 字段：
    - `filename`
    - `dirname`
    - `datePattern`
    - `maxSize`
    - `maxFiles`
- 环境变量覆盖：无

### 管理员白名单（env-only）
- `ADMIN_DIDS`
  - 说明：额外管理员地址白名单，逗号分隔
  - 默认：空
  - 代码位置：`src/common/permission.ts`

## 推荐最小配置
至少应明确以下几项：
- `database.*`
- `auth.jwtSecret`
- `ucan.aud`
- `audit.approvers`
- `audit.requiredApprovals`

生产前建议额外明确：
- `auth.cookieSecure=true`
- `logger.file.*`
- `redis.*`（若需要 MPC 跨实例）
