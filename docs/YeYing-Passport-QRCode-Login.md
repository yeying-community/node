# YeYing Passport 通行证二维码登录方案

## 1. 背景

Project 当前的二维码登录是“已登录移动端扫码确认”：

- PC 登录页生成随机 `qrcode` code。
- 手机端必须已经登录 Project App 或移动端 Web。
- 手机扫码后调用 Project 的 `users/login/qrcode`，把当前 Project 用户授权给 PC。
- PC 轮询同一个 code，拿到 Project 用户 token。

这条链路适合 App 内扫码，但不适合“手机相机扫码登录”。手机相机打开的是浏览器 URL，浏览器未必有 Project 登录态，也无法天然代表某个 Project 用户。

新的目标是把二维码升级为 YeYing Passport 通行证入口：

- 用户用手机系统相机扫码。
- 手机浏览器打开 Node 托管的 Passport 授权页。
- 用户用 Passkey、钱包、TOTP 或已有 Node 会话完成身份确认。
- Node 生成一次性授权码。
- Project PC 登录页通过授权码换取 Project 登录态。

## 2. 总体结论

可行，但不应在旧 `users/login/qrcode` 接口上继续扩展。应新增一套 Passport 授权协议，由 Node 作为应用中心和身份授权中心统一承载。

推荐定位：

- Node 是 YeYing AppStore Registry，也是 Passport Provider。
- Project 作为一个正式应用发布到 Node 应用中心。
- Project 登录二维码不再只表达“Project 本地扫码确认”，而是表达“向 Node Passport 请求登录 Project 应用”。
- Node 使用已发布应用的 `appId`、`redirectUri`、`audience` 和 `capabilities` 约束授权范围。
- Project 只信任来自 Node 的一次性授权码或短期票据，不信任二维码 URL 本身。

## 3. 角色

| 角色 | 职责 |
| --- | --- |
| Node | 应用中心、Passport 授权页、Passkey/TOTP/钱包登录、一次性授权码签发 |
| Project | 登录发起方、业务 Host、Project 用户体系和登录态签发方 |
| Project Runtime Agent | 后续负责把 Project 自身作为应用发布、升级和健康检查 |
| 用户手机浏览器 | 扫码后完成 Passport 认证和授权确认 |
| 用户 PC 浏览器 | 展示二维码、轮询状态、拿到 Project 登录态 |

## 4. Project 作为应用发布到应用中心

Project 需要在 Node 的应用中心登记为一个特殊应用：

```json
{
  "uid": "project",
  "code": "project",
  "name": "YeYing Project",
  "is_online": true,
  "location": "https://project.yeying.pub",
  "redirectUris": [
    "https://project.yeying.pub/passport/callback"
  ],
  "ucanAudience": "did:web:project.yeying.pub",
  "ucanCapabilities": [
    { "with": "app:project:login", "can": "login" }
  ]
}
```

这样 Node 可以复用当前已存在的应用授权约束：

- `appId` 必须是已发布应用。
- `redirectUri` 必须精确命中应用发布字段。
- `audience + capabilities` 由服务端根据应用策略解析，不允许客户端覆写。
- Node 签发给 Project 的授权结果天然受应用目录治理。

Project 既是 AppStore 的 Host，又可以是 AppStore 中的一个“核心应用”。这两层角色不要混淆：

- Host 角色：Project 提供用户、组织、菜单、文件、任务等业务能力。
- Application 角色：Project 自身可作为可登录、可授权、可升级的应用登记到 Node。

## 5. 登录协议

### 5.1 PC 发起

PC 登录页向 Project 后端创建 Passport 登录请求：

```text
POST /api/passport/login/request
```

Project 生成本地 `login_session_id` 和 PKCE `codeVerifier/codeChallenge`，保存 `codeVerifier` 后调用 Node：

```text
POST /api/v1/public/auth/passport/authorize/request
```

请求体：

```json
{
  "appId": "project",
  "redirectUri": "https://project.yeying.pub/passport/callback",
  "state": "project-login-session-id",
  "codeChallenge": "S256_PKCE_CODE_CHALLENGE",
  "codeChallengeMethod": "S256",
  "requestTtlMs": 120000
}
```

Node 返回：

```json
{
  "requestId": "passport-request-id",
  "verifyUrl": "https://node.yeying.pub/passport/authorize?requestId=passport-request-id",
  "expiresAt": 1785500000000,
  "appName": "YeYing Project",
  "status": "pending"
}
```

PC 二维码内容使用 `verifyUrl`。Project 本地保存映射和 PKCE verifier：

```text
login_session_id -> passport_request_id -> code_verifier -> pending
```

### 5.2 手机扫码

手机相机打开：

```text
https://node.yeying.pub/passport/authorize?requestId=passport-request-id
```

Node 页面展示：

- 应用名称：YeYing Project
- 目标域名：project.yeying.pub
- 请求时间、过期时间
- 当前 Passport 账号或待登录入口
- 风险提示：确认是否本人正在登录 PC

若手机端未登录 Passport，则按优先级认证：

1. Passkey
2. 钱包 SIWE
3. TOTP
4. 已有 Node JWT/UCAN 会话

### 5.3 手机确认

手机认证成功后调用：

```text
POST /api/v1/public/auth/passport/authorize/approve
```

请求体：

```json
{
  "requestId": "passport-request-id",
  "method": "passkey",
  "credential": {}
}
```

Node 校验：

- request 未过期。
- request 未被使用。
- appId 是已发布应用。
- redirectUri 命中应用登记值。
- subject 已通过 Passkey、钱包或 TOTP 认证。
- 风险策略通过，例如限流、IP/UA 记录、失败次数。

成功后 Node 生成一次性 authorization code：

```json
{
  "authorizationCode": "one-time-code",
  "authorizationCodeExpiresAt": 1785500060000,
  "redirectTo": "https://project.yeying.pub/passport/callback?code=one-time-code&state=project-login-session-id"
}
```

手机页面可以停留在成功页，不必须真的跳转 Project；PC 端轮询也可以完成登录。保留 `redirectTo` 是为了兼容 OAuth 风格和移动端回跳。

### 5.4 PC 轮询

PC 登录页轮询 Project：

```text
GET /api/passport/login/status?session_id=project-login-session-id
```

Project 后端查询本地 session 状态。如果 Node 已批准，Project 用服务端凭据向 Node 换取授权结果：

```text
POST /api/v1/public/auth/passport/authorize/exchange
```

请求体：

```json
{
  "code": "one-time-code",
  "appId": "project",
  "redirectUri": "https://project.yeying.pub/passport/callback"
}
```

Node 返回：

```json
{
  "subject": "did:pkh:eip155:1:0x...",
  "appId": "project",
  "token": "node-jwt",
  "ucan": "node-issued-ucan",
  "audience": "did:web:project.yeying.pub",
  "capabilities": [
    { "with": "app:project:login", "can": "login" }
  ],
  "expiresAt": 1785500900000
}
```

Project 根据 `subject` 找到或创建绑定用户，然后签发 Project 自己的登录 token，返回给 PC。

## 6. 身份映射

Node Passport 的主体不等同于 Project 用户 ID。需要显式映射：

```text
passport_subject -> project_userid
```

建议 Project 新增绑定表：

```text
user_passport_bindings
```

字段建议：

| 字段 | 说明 |
| --- | --- |
| id | 主键 |
| userid | Project 用户 ID |
| provider | `node-passport` |
| subject | Node Passport subject，例如钱包地址 DID |
| subject_type | `wallet`、`passkey`、`email`、`did` |
| bound_at | 绑定时间 |
| last_login_at | 最近登录时间 |
| revoked_at | 解绑时间 |

绑定策略：

- 已绑定 subject：直接登录对应 Project 用户。
- 未绑定 subject 且邮箱/手机号可信匹配：可提示绑定已有账号。
- 未绑定 subject 且允许注册：创建 Project 用户。
- 未绑定 subject 且关闭注册：拒绝并提示联系管理员。

不要把 Node 的 subject 直接当作 Project `userid`，也不要把 Project token 交给 Node 保存。

## 7. 与现有 Node 能力的关系

当前 Node 已经有三块可以复用：

- 应用中心应用登记：`applications.uid`、`redirectUris`、`ucanAudience`、`ucanCapabilities`。
- TOTP 授权桥：`/api/v1/public/auth/totp/authorize/*`。
- Passport Passkey 授权桥：`/api/v1/public/auth/passport/authorize/*` 与 `/api/v1/public/auth/passport/passkey/*`。

Passport 协议可以先作为聚合层，而不是复制所有能力：

```text
/passport/authorize/request
  -> resolve published app
  -> create authorize request

/passport/authorize/approve
  -> passkey approve 或 totp approve 或 wallet approve
  -> create one-time authorization code

/passport/authorize/exchange
  -> consume one-time code
  -> return normalized Passport authorization result
```

短期也可以先复用 `passkey/authorize/*` 的实现，只是在文档和前端上统一叫 Passport。等流程稳定后再抽象成 `passport` 路由。

## 8. 与 AppStore Runtime Agent 的关系

Project 发布到应用中心后，Runtime Agent 仍然负责应用生命周期：

- 发布 Project release bundle。
- 校验 Project 制品签名和 digest。
- 安装或升级 Project。
- 健康检查 `https://project.yeying.pub/health`。
- 回报安装状态给 Node。

Passport 登录只解决身份入口，不替代 Runtime Agent：

- Runtime Agent 负责“Project 这个应用是否安装、升级、可用”。
- Passport 负责“某个用户是否可以登录 Project 这个应用”。

二者结合后的完整闭环：

```text
Project release 发布到 Node
  -> Runtime Agent 安装/升级 Project
  -> Node 标记 Project 应用可用
  -> 用户打开 Project 登录页
  -> Project 向 Node 创建 Passport 登录请求
  -> 手机扫码完成 Passport 认证
  -> Project 换取授权并签发本地登录态
```

## 9. 安全边界

必须满足：

- 二维码只包含 `verifyUrl` 和随机 requestId，不包含 token。
- requestId 至少 128 bit 随机熵，默认 2 分钟过期。
- authorization code 一次性使用，默认 60 秒过期。
- Node 不保存 Project 登录 token。
- Project 不接受浏览器直接提交的 subject，必须服务端向 Node exchange。
- redirectUri 精确匹配，不支持通配。
- PC 轮询只拿 Project 本地 session 状态，不直接暴露 Node token。
- 手机确认页必须展示应用名和目标域名。
- 登录成功后废弃 requestId 和 authorization code。
- 所有限流按 IP + requestId + subject 分桶。

建议增强：

- request 绑定 PC 端 UA hash 和 IP 前缀，确认页展示来源信息。
- 高风险登录要求二次确认或 TOTP。
- Project 管理后台提供 Passport 绑定/解绑列表。
- Node 审计记录 `passport.login_requested`、`passport.login_approved`、`passport.code_exchanged`。
- Project 审计记录 `passport_login_succeeded`、`passport_binding_created`。

## 10. 失败状态

状态机：

```text
pending -> approved -> exchanged
   |          |            |
   v          v            v
expired    revoked       used
   |
   v
failed
```

典型错误：

| 错误 | 处理 |
| --- | --- |
| request expired | PC 端提示二维码过期，允许刷新 |
| request used | 拒绝重复消费 |
| redirect mismatch | 拒绝并记录安全审计 |
| app offline | 拒绝创建请求 |
| subject not bound | Project 引导绑定或注册 |
| passkey unavailable | 手机端降级到钱包或 TOTP |
| exchange timeout | PC 端允许重新发起 |

## 11. 数据模型建议

Node 侧可复用内存态作为 V0，但生产建议落库：

```text
passport_authorize_requests
passport_authorize_codes
passport_audit_logs
```

`passport_authorize_requests`：

| 字段 | 说明 |
| --- | --- |
| request_id | 随机 ID |
| app_id | 应用 ID，例如 `project` |
| redirect_uri | 精确回跳地址 |
| state | Project 登录 session ID |
| subject | 批准前为空，批准后写入 |
| status | pending/approved/exchanged/expired/revoked |
| audience | 服务端解析出的 audience |
| capabilities_json | 服务端解析出的 capabilities |
| expires_at | 请求过期时间 |
| approved_at | 手机确认时间 |
| exchanged_at | Project 换码时间 |

`passport_authorize_codes`：

| 字段 | 说明 |
| --- | --- |
| code_hash | 授权码哈希，不保存明文 |
| request_id | 关联 request |
| app_id | 应用 ID |
| redirect_uri | 精确回跳地址 |
| payload_ciphertext | 加密后的授权结果 |
| expires_at | code 过期时间 |
| used_at | 消费时间 |

Project 侧：

```text
passport_login_sessions
user_passport_bindings
```

Project 的登录 session 建议只保存短期状态，不保存 Node token。

## 12. 接口草案

Node：

```text
POST /api/v1/public/auth/passport/authorize/request
GET  /api/v1/public/auth/passport/authorize/request/:requestId
POST /api/v1/public/auth/passport/passkey/register/request
POST /api/v1/public/auth/passport/passkey/register/confirm
POST /api/v1/public/auth/passport/authorize/challenge
POST /api/v1/public/auth/passport/authorize/approve
POST /api/v1/public/auth/passport/authorize/exchange
GET  /api/v1/public/auth/passport/status
```

Project：

```text
POST /api/passport/login/request
GET  /api/passport/login/status
POST /api/passport/login/exchange
GET  /passport/callback
GET  /api/passport/bindings
POST /api/passport/bindings/revoke
```

Project 可以把 `login/exchange` 合并进 `login/status`：PC 轮询发现 Node 已批准后，由 Project 后端自动 exchange 并返回 Project token。

## 13. 分阶段落地

### V0：文档和协议对齐

- 把 Project 登记为 Node 应用中心的核心应用。
- 明确 Project 的 `redirectUri`、`audience`、`capabilities`。
- 确认 Project 用户与 Passport subject 的绑定规则。
- 明确旧二维码接口继续保留，仅用于 App 内扫码确认。

### V1：手机相机扫码登录 Project

- Node 提供 Passport 授权页。
- Node 复用 Passkey 授权接口完成 approve/exchange。
- Project 登录页展示 Node `verifyUrl` 二维码。
- Project 后端完成 code exchange 和本地登录 token 签发。
- 只支持已绑定 Passport subject 的用户登录。

### V1.1：绑定与注册闭环

- 未绑定 subject 时支持绑定已有 Project 账号。
- 管理员可配置是否允许 Passport 自动创建用户。
- Project 用户中心展示 Passport 绑定设备和 subject。

### V2：Project 作为应用中心应用发布

- Project release bundle 进入 Node 应用中心。
- Runtime Agent 支持 Project 自身安装、升级、健康检查和回滚。
- Node 的 Passport 登录请求只允许发给已安装、健康的 Project 实例。

### V3：统一 YeYing Passport

- Passport 成为所有 YeYing 应用的统一登录入口。
- 第三方应用使用同一授权协议接入。
- Node 支持多应用、多实例、多后端 UCAN 签发。
- 用户在 Node 管理自己的 Passkey、钱包、TOTP、应用授权和设备。

## 14. 开放问题

- Project 当前用户体系是否以邮箱为主，还是需要钱包地址成为主身份。
- Passport subject 与 Project 用户首次绑定时，是否必须由管理员邀请。
- Project 是否允许“无邮箱，仅钱包/Passkey”的用户。
- Project 登录 token 是否继续使用现有 JWT，还是增加 Node issuer 校验。
- Node 是否需要为每个 Project instance 单独登记 appId，例如 `project-prod`、`project-dev`。
- Project 作为应用发布时，是否仍由独立部署脚本升级，还是全部交给 Runtime Agent。

## 15. 推荐下一步

1. 在 Node 中把 Project 登记为发布应用，补齐 `redirectUri` 和 UCAN policy。
2. 在 Project 设计 `passport_login_sessions` 和 `user_passport_bindings`。
3. 先基于现有 `passkey/authorize/*` 跑通“手机相机扫码 -> Node Passkey -> Project 登录”。
4. 跑通后再抽象 `/passport/*` 路由，统一 TOTP、钱包和 Passkey。
5. 最后把 Project 自身发布纳入 AppStore Runtime Agent 生命周期。
