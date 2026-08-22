# 钱包身份 Issuer V1 实现说明

当前 Node 的钱包身份 issuer 是独立于旧 Passport 的新模块。它不创建、不解析、不返回 `subjectId` 或 `sub_xxx`。

## 当前端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/.well-known/jwks.json` | 发布 Ed25519 issuer 公钥 |
| GET | `/.well-known/openid-credential-issuer` | 发布 issuer、JWKS 和 credential status 地址 |
| POST | `/api/v1/public/identity/credentials/status` | 查询凭证状态（数据库权威） |
| POST | `/api/v1/public/identity/account-links/challenge` | 创建钱包身份账户关联 challenge |
| POST | `/api/v1/public/identity/account-links/verify` | 验证身份控制器签名和账户签名 |
| POST | `/api/v1/public/identity/verifications/request` | 请求邮箱/用户名验证 |
| POST | `/api/v1/public/identity/verifications/confirm` | 签发 `EmailCredential` / `UsernameCredential` |
| POST | `/api/v1/public/identity/passkeys/register/request` | 为钱包身份创建 Passkey 注册请求 |
| POST | `/api/v1/public/identity/passkeys/register/confirm` | 保存身份级 Passkey credential |
| POST | `/api/v1/public/identity/authorize/request` | 创建 Web3 应用身份授权请求，返回 `verifyUrl` |
| POST | `/api/v1/public/identity/authorize/exchange` | 换取 DID、钱包地址和已授权凭证 |

## 配置

开发和生产环境都复用 Node 的 `secrets.file`，默认是 `run/secrets.enc.json`。以下敏感项必须通过加密 vault 解密后读取，不能通过环境变量注入：

```text
IDENTITY_ISSUER_DID
IDENTITY_ISSUER_PRIVATE_KEY
```

以下非敏感项放在 `config.js` 的 `issuer.identity`：

```js
issuer: {
  identity: {
  enabled: true,
  baseUrl: 'http://localhost:8100',
  usernameNamespace: 'node.yeying.pub'
  }
}
```

私钥不能写入 `config.js`，也不能提交到仓库。JWT-VC 使用 `EdDSA`，header 中的 `kid` 必须和 JWKS 一致。凭证默认有效期 24 小时，最大 7 天。

## 当前边界

凭证状态从 `identity_credentials` 数据库表读取，未知凭证返回 `unknown`，已过期凭证返回 `expired`，撤销/替换状态按数据库记录返回。状态查询失败返回 503，不能降级为 `active`。

邮箱验证码、用户名规范化和唯一性、账户关联 proof 校验、Wallet presentation、Router 登录和无钱包 Passkey 授权已经接入同一钱包身份模型。生产启用前仍必须完成密钥轮换、限流、审计导出、多实例验收，以及 DApp 后端对 JWT-VC issuer/JWKS/status 的强校验。

此模块不替代普通 SIWE。DApp 不请求身份 scope 时，仍然只使用原有 SIWE challenge/verify 流程，Node 不参与身份资料获取。

## 身份授权码结果

`/api/v1/public/identity/authorize/exchange` 返回的钱包身份结果使用以下字段：

```json
{
  "did": "did:yeying:wid_example",
  "walletIdentityId": "wid_example",
  "walletAddress": "0x...",
  "scopes": ["identity.basic", "identity.wallet", "identity.email"],
  "credentials": [
    {
      "type": "EmailCredential",
      "credentialId": "urn:yeying:credential:email:...",
      "credential": "compact-jwt-vc"
    }
  ]
}
```

该结果不包含 `subjectId`、`sub_xxx` 或 Passport assertion。
