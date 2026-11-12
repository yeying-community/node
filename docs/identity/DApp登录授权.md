# DApp 登录授权

本文说明 DApp 如何依赖 Node 完成用户身份登录授权。Node 在此流程中作为 Identity Provider：DApp 创建身份授权请求，用户在 Node 页面确认，Node 签发一次性授权码，DApp 后端使用 PKCE verifier 兑换获批的 DID、身份资料和可选资源授权会话。

这套流程建立的是 DApp 自己的登录会话。它与用户登录 Node 本身的 SIWE/JWT 或邮箱 OTP/DID JWT 会话不同，DApp 不应把 Node 的登录令牌当作自己的会话凭证。Node 登录入口见[Node登录授权](Node登录授权.md)；术语见[核心概念](../architecture/核心概念.md)。

本文涉及的 Web 身份验证（Web Authentication，简称 WebAuthn）由浏览器调用认证器完成；通行密钥（Passkey）是认证器创建或持有的 WebAuthn 凭证。

## 信任边界

- DApp 以已登记的 `appId` 发起请求，Web 回调地址必须匹配登记值；桌面应用使用 `clientType=desktop` 和 PKCE。
- 用户可在 Node 授权页面通过钱包身份 Presentation 或身份级 Passkey 完成身份确认。
- Node 校验身份、应用、回调地址、scope 和用户确认后签发短期一次性授权码。
- DApp 后端持有 PKCE verifier 并兑换授权码；DApp 根据返回的 DID 和获批资料建立自己的会话。
- Node 会话、身份 VC、DApp 会话和 UCAN/资源授权会话各自承担不同职责。

## 钱包身份授权码与 PKCE 流程

```mermaid
sequenceDiagram
  participant App as Project / Chat
  participant Node as Node Identity / 授权页面
  actor User as 用户
  participant Wallet as Wallet 插件
  participant Authenticator as Passkey 认证器

  App ->> Node: POST /identity/authorize/request\nWeb: appId + redirectUri; Desktop: appId + clientType=desktop + codeChallenge + scopes
  Node -->> App: requestId + verifyUrl + expiresAt
  User ->> Node: GET /identity/authorize?requestId=...
  Node -->> User: 展示应用信息、回调地址和请求 scope
  alt 使用 Wallet 插件
    User ->> Wallet: 确认身份出示
    Wallet -->> Node: DID controller 签名的 Identity Presentation
    User ->> Node: POST /identity/authorize/approve\nWallet Presentation
  else 使用身份级 Passkey
    User ->> Node: POST /identity/authorize/challenge\nrequestId
    Node -->> User: WebAuthn assertion options + passkeyRequestId
    User ->> Authenticator: 完成用户验证并签署 challenge
    Authenticator -->> User: credential assertion
    User ->> Node: POST /identity/authorize/approve\npasskeyRequestId + credential
  end
  Node -->> User: authorizationCode + redirectTo（desktop 模式为空）
  App ->> Node: POST /identity/authorize/exchange\ncode + codeVerifier + issueUcanSession
  Node -->> App: did + walletAddress + credentials + ucanSession + refreshToken
  App ->> Node: POST /auth/central/issue\nBearer ucanSession + audience + capabilities
  Node -->> App: scoped UCAN
  App ->> Node: POST /identity/session/refresh\nrefreshToken + appId + redirectUri
  Node -->> App: rotated refreshToken + new ucanSession
```

实现说明：

- `authorize/request` 校验应用已上架；Web 请求要求 `redirectUri` 命中应用登记值，桌面请求使用 `clientType=desktop` 且不需要 `redirectUri`。Node 为桌面请求生成 `urn:yeying:app:<applications.uid>` audience，持久化 `clientType`、`codeChallenge` 和请求 scopes，并返回 Node Web `/identity/authorize?requestId=...` 的 `verifyUrl`。桌面完成确认后不执行浏览器回跳，由客户端轮询并 exchange。
- `authorize/challenge` 持久化 WebAuthn authentication challenge，支持 discoverable credential，不要求用户先输入钱包地址。
- `authorize/approve` 支持两种确认方式：Wallet presentation，或 `passkeyRequestId + credential` 的 Passkey assertion。
- `authorize/exchange` 校验一次性 code、`appId`、`redirectUri` 和 PKCE `codeVerifier`。需要访问 Router、Warehouse 或 WebDAV 的应用可显式传入 `issueUcanSession: true`，直接获得绑定已认证钱包身份的短期 UCAN 签发会话，不再依赖旧 SIWE JWT 创建会话。
- exchange 返回的 `refreshToken` 是绑定 `appId + redirectUri + DID` 的可轮换身份刷新会话凭证，默认有效期 30 天；`ucanSession` 到期后，应用应调用 `/api/v1/public/identity/session/refresh` 换取新的 `ucanSession`，而不是让用户重新走授权页。刷新会话过期或被撤销时，才需要重新登录。
- refresh session 会固化 exchange 时应用登记的 `ucanAudience/ucanCapabilities`；应用之后修改登记策略不会扩大已经发出的 refresh session 权限，轮换出的新 session 继续沿用原策略。
- exchange 结果不包含 Passport assertion、`subjectId` 或应用侧绑定关系；可选 `ucanSession` 也不是身份凭证。业务应用按授权 scopes 使用 `did`、钱包地址和 `EmailCredential` / `UsernameCredential`。`did` 是外部身份主键，钱包地址只是该 DID 下的已验证链账户。
- Router 等明确要求邮箱的应用必须请求 `identity.email`，没有已验证邮箱时应提示用户先在钱包插件完成钱包身份和邮箱验证。

### DApp 的 UCAN 资源授权

身份授权回答“哪个 DID 登录了应用、用户批准了哪些身份资料”；UCAN 则回答“该应用或客户端可以访问哪个资源服务、执行哪些动作”。二者不能互相替代。DApp 应先完成身份授权，再根据已登记的 `ucanAudience/ucanCapabilities` 策略获取资源授权。

当 exchange 请求 `issueUcanSession: true` 时，Node 返回绑定已认证 DID 和应用策略的短期 `ucanSession`。DApp 后端可用它调用 `/api/v1/public/auth/central/issue`，针对每个目标后端签发单独的 UCAN。一个 audience 的 UCAN 不得复用到另一个 audience；每次签发的 capabilities 都必须是应用登记策略及 Issuer 全局上限的子集。需要多个后端时，应逐个 audience 签发。

资源访问 UCAN 的撤销与身份授权 refresh session 的生命周期不同：UCAN 用于受限资源访问；refresh token 只用于轮换应用身份授权会话，不能直接访问资源。应用退出时应按协议撤销应用 refresh session；Node 管理签发 session 与 UCAN 撤销状态。Issuer 信任、密钥轮换和验证规则见[Node登录授权](Node登录授权.md#ucan-验证签发与撤销)。


## 与 Node 登录的区别

| 项目 | 用户登录 Node | DApp 依赖 Node 登录授权 |
| --- | --- | --- |
| 目的 | 建立用户访问 Node 自身接口的会话 | 让 DApp 识别用户并建立 DApp 自己的会话 |
| 典型凭证 | Node JWT（SIWE 或邮箱身份登录签发） | 一次性授权码，经 PKCE 兑换授权结果；可选短期 UCAN 签发会话 |
| 用户确认对象 | Node 服务 | 明确的应用、回调地址和身份 scope |
| 会话管理方 | Node | DApp 自己；身份 refresh session 由 Node 提供轮换能力 |
| 是否自动互通 | 否 | DApp 必须单独发起授权请求 |

应用身份资料的签发和验证见[身份凭证](身份凭证.md)；Node API 的业务角色、资源权限、写请求签名和 UCAN Issuer 运维见[Node登录授权](Node登录授权.md)。接口字段以 [OpenAPI Identity](../openapi/node.openapi.yaml) 为准。
