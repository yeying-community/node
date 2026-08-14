# 钱包身份 Issuer V1 实现说明

当前 Node 的钱包身份 issuer 是独立于旧 Passport 的新模块。它不创建、不解析、不返回 `subjectId` 或 `sub_xxx`。

## 当前端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/.well-known/jwks.json` | 发布 Ed25519 issuer 公钥 |
| GET | `/.well-known/openid-credential-issuer` | 发布 issuer、JWKS 和 credential status 地址 |
| POST | `/api/v1/public/identity/credentials/status` | 查询凭证状态（数据库权威） |

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

邮箱验证码、用户名规范化和唯一性、账户关联 proof 校验，以及 Wallet/web3-bs 的端到端 presentation 仍需跨仓库联调。生产启用前必须完成密钥轮换、限流、审计导出和多实例验收。

此模块不替代普通 SIWE。DApp 不请求身份 scope 时，仍然只使用原有 SIWE challenge/verify 流程，Node 不参与身份资料获取。
