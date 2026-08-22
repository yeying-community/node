#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const YAML = require('yaml')

const outputPath = path.resolve(__dirname, '../docs/openapi/node.openapi.yaml')
const checkOnly = process.argv.includes('--check')

const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
const jsonContent = (schema) => ({
  'application/json': { schema },
})

const document = {
  openapi: '3.1.0',
  info: {
    title: 'YeYing Node API',
    version: '1.0.0',
    license: { name: 'ISC', identifier: 'ISC' },
    description:
      'YeYing 社区 Node 枢纽服务接口，覆盖身份授权、应用中心、审核、MPC 协调、钱包托管、通知、AppStore Registry 和 release artifact。',
  },
  servers: [{ url: 'https://node.yeying.pub', description: 'Community production node' }],
  tags: Object.entries({
    Health: '服务可用性检查。',
    Auth: 'SIWE、JWT 和中心化 UCAN。',
    Identity: '钱包身份 DID、账户关联、邮箱/用户名凭证、身份级 Passkey 和授权码登录。',
    TOTP: 'TOTP 绑定和无钱包授权。',
    Profile: '当前认证身份信息。',
    Applications: '应用元数据、配置、搜索和发布状态。',
    Audits: '应用审核申请和审批。',
    MPC: '多方计算会话、消息和事件流。',
    Custody: '钱包客户端加密密钥托管。',
    Notifications: '通知收件箱、事件流和 Webhook。',
    Publisher: '应用发布包提交、审核和 release artifact 管理。',
    Admin: '管理员治理接口。',
  }).map(([name, description]) => ({ name, description })),
  paths: {},
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT or UCAN',
        description: 'SIWE JWT、钱包签发 UCAN 或中心化签发 UCAN。',
      },
      refreshCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'refresh_token',
      },
    },
    schemas: {
      JsonObject: { type: 'object', additionalProperties: true },
      Envelope: {
        type: 'object',
        required: ['code', 'message', 'data', 'timestamp'],
        properties: {
          code: { type: 'integer', examples: [0] },
          message: { type: 'string', examples: ['ok'] },
          data: {},
          timestamp: { type: 'integer', format: 'int64' },
        },
      },
      ErrorEnvelope: {
        allOf: [
          ref('Envelope'),
          {
            type: 'object',
            properties: {
              code: { type: 'integer', minimum: 400 },
              data: { type: ['object', 'null'] },
            },
          },
        ],
      },
      SignedActionFields: {
        type: 'object',
        required: ['requestId', 'timestamp', 'signature'],
        properties: {
          requestId: { type: 'string', description: '幂等请求 ID / 签名 nonce。' },
          timestamp: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          signature: { type: 'string', description: '钱包 personal_sign 签名。' },
        },
      },
      AuthChallengeRequest: {
        type: 'object', required: ['address'],
        properties: {
          address: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
          scope: { type: 'array', items: { type: 'string' }, description: '可选钱包身份 scope。' },
        },
      },
      AuthVerifyRequest: {
        type: 'object', required: ['address', 'signature'],
        properties: {
          address: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
          signature: { type: 'string' },
        },
      },
      IdentityDid: {
        type: 'string',
        pattern: '^did:yeying:wid_[A-Za-z0-9_-]{22,}$',
      },
      IdentityAccount: {
        type: 'object',
        required: ['chainKey', 'address'],
        properties: {
          chainKey: { type: 'string', examples: ['eip155:1'] },
          address: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
        },
      },
      IdentityAccountLinkChallengeRequest: {
        type: 'object',
        required: ['identity', 'account'],
        properties: {
          identity: ref('IdentityDid'),
          account: ref('IdentityAccount'),
        },
      },
      IdentityAccountLinkVerifyRequest: {
        type: 'object',
        required: ['identity', 'identityDocument', 'account', 'nonce', 'issuedAt', 'expiresAt', 'accountSignature'],
        properties: {
          identity: ref('IdentityDid'),
          identityDocument: { type: 'object', additionalProperties: true },
          account: ref('IdentityAccount'),
          nonce: { type: 'string' },
          issuedAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
          accountSignature: { type: 'string', description: '账户钱包对账户关联 message 的签名。' },
        },
      },
      IdentityVerificationRequest: {
        type: 'object',
        required: ['identity', 'account', 'email', 'types'],
        properties: {
          identity: ref('IdentityDid'),
          account: ref('IdentityAccount'),
          email: { type: 'string', format: 'email' },
          username: { type: 'string', minLength: 3, maxLength: 32 },
          type: { type: 'string', enum: ['email', 'username'] },
          types: { type: 'array', items: { type: 'string', enum: ['email', 'username'] } },
        },
      },
      IdentityVerificationConfirmRequest: {
        type: 'object',
        required: ['verificationId', 'code', 'types'],
        properties: {
          verificationId: { type: 'string' },
          code: { type: 'string' },
          codes: { type: 'object', additionalProperties: { type: 'string' } },
          type: { type: 'string', enum: ['email', 'username'] },
          types: { type: 'array', items: { type: 'string', enum: ['email', 'username'] } },
        },
      },
      IdentityCredentialsStatusRequest: {
        type: 'object',
        required: ['credentials'],
        properties: {
          issuer: { type: 'string' },
          credentials: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
      },
      IdentityPasskeyRegisterRequest: {
        type: 'object',
        required: ['identity', 'identityDocument'],
        properties: {
          identity: ref('IdentityDid'),
          identityDocument: { type: 'object', additionalProperties: true },
          deviceName: { type: 'string' },
        },
      },
      IdentityPasskeyRegisterConfirmRequest: {
        type: 'object',
        required: ['identity', 'requestId', 'credential'],
        properties: {
          identity: ref('IdentityDid'),
          requestId: { type: 'string', description: '注册挑战 requestId。' },
          deviceName: { type: 'string' },
          credential: { type: 'object', additionalProperties: true },
        },
      },
      IdentityPasskeyListRequest: {
        type: 'object',
        required: ['identity'],
        properties: {
          identity: ref('IdentityDid'),
        },
      },
      IdentityPasskeyRevokeRequest: {
        type: 'object',
        required: ['identity', 'identityDocument', 'credentialId'],
        properties: {
          identity: ref('IdentityDid'),
          identityDocument: { type: 'object', additionalProperties: true },
          credentialId: { type: 'string' },
        },
      },
      IdentityAuthorizeRequest: {
        type: 'object',
        required: ['appId', 'redirectUri', 'codeChallenge'],
        properties: {
          appId: { type: 'string' },
          redirectUri: { type: 'string', format: 'uri' },
          state: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string', enum: ['identity.basic', 'identity.wallet', 'identity.username', 'identity.email'] } },
          scope: { type: 'array', items: { type: 'string', enum: ['identity.basic', 'identity.wallet', 'identity.username', 'identity.email'] } },
          codeChallenge: { type: 'string', minLength: 43, maxLength: 128 },
          code_challenge: { type: 'string', minLength: 43, maxLength: 128 },
          codeChallengeMethod: { type: 'string', enum: ['S256'] },
          code_challenge_method: { type: 'string', enum: ['S256'] },
        },
      },
      IdentityAuthorizeChallengeRequest: {
        type: 'object',
        required: ['requestId'],
        properties: {
          requestId: { type: 'string' },
        },
      },
      IdentityAuthorizeApproveRequest: {
        type: 'object',
        required: ['requestId'],
        properties: {
          requestId: { type: 'string' },
          presentation: { type: 'object', additionalProperties: true, description: 'Wallet 插件签发的钱包身份 presentation。' },
          passkeyRequestId: { type: 'string', description: '无 Bearer Passkey approve 时必填。' },
          challengeId: { type: 'string', description: 'passkeyRequestId 的兼容别名。' },
          credential: { type: 'object', additionalProperties: true },
        },
      },
      IdentityAuthorizeExchangeRequest: {
        type: 'object',
        required: ['code', 'appId', 'redirectUri', 'codeVerifier'],
        properties: {
          code: { type: 'string' },
          appId: { type: 'string' },
          redirectUri: { type: 'string', format: 'uri' },
          codeVerifier: { type: 'string', minLength: 43, maxLength: 128 },
          code_verifier: { type: 'string', minLength: 43, maxLength: 128 },
        },
      },
      CustodyStatus: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          passkeyBound: { type: 'boolean' },
          passkeyCount: { type: 'integer' },
          enabled: { type: 'boolean' },
          recordCount: { type: 'integer' },
          records: { type: 'array', items: ref('CustodyRecord') },
        },
      },
      CustodyStatusEnvelope: {
        allOf: [
          ref('Envelope'),
          { type: 'object', properties: { data: ref('CustodyStatus') } },
        ],
      },
      CustodyRecord: {
        type: 'object',
        required: ['walletId'],
        properties: {
          walletId: { type: 'string' },
          accountId: { type: 'string' },
          address: { type: 'string' },
          ciphertext: { type: 'string', description: '仅详情接口返回的客户端加密密文。' },
          metadata: { type: 'object', additionalProperties: true },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
          lastVerifiedAt: { type: 'string' },
        },
      },
      CustodyUpsertRequest: {
        type: 'object', required: ['walletId', 'ciphertext'],
        properties: {
          walletId: { type: 'string' },
          accountId: { type: 'string' },
          address: { type: 'string' },
          ciphertext: { type: 'string', description: '必须在客户端完成加密。' },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
      MpcSessionCreateRequest: {
        allOf: [
          ref('SignedActionFields'),
          {
            type: 'object', required: ['type', 'walletId', 'threshold', 'participants'],
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
              walletId: { type: 'string' },
              threshold: { type: 'integer', minimum: 1 },
              participants: { type: 'array', items: { type: 'string' } },
              curve: { type: 'string' },
              expiresAt: { type: 'string' },
              keyVersion: { type: 'integer' },
              shareVersion: { type: 'integer' },
            },
          },
        ],
      },
      MpcJoinRequest: {
        allOf: [
          ref('SignedActionFields'),
          {
            type: 'object', required: ['participantId', 'deviceId', 'identity', 'e2ePublicKey'],
            properties: {
              participantId: { type: 'string' }, deviceId: { type: 'string' },
              identity: { type: 'string' }, e2ePublicKey: { type: 'string' },
              signingPublicKey: { type: 'string' },
            },
          },
        ],
      },
      ReleaseSubmitRequest: {
        type: 'object', required: ['publisher_key_id', 'files'],
        properties: {
          publisher_key_id: { type: 'string' },
          files: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: '文件路径到文本内容的映射。',
          },
        },
      },
    },
    responses: {
      Success: { description: '统一成功响应', content: jsonContent(ref('Envelope')) },
      BadRequest: { description: '请求参数或签名错误', content: jsonContent(ref('ErrorEnvelope')) },
      Unauthorized: { description: '缺少或无效的 JWT/UCAN/Agent token', content: jsonContent(ref('ErrorEnvelope')) },
      Forbidden: { description: '角色、状态、capability 或资源权限不足', content: jsonContent(ref('ErrorEnvelope')) },
      Conflict: { description: '幂等冲突、状态冲突或租约冲突', content: jsonContent(ref('ErrorEnvelope')) },
    },
  },
}

const operations = [
  ['get', '/api/v1/public/health', 'Health', '健康检查', 'none'],
  ['get', '/api/v1/public/healthCheck', 'Health', '兼容健康检查', 'none'],
  ['get', '/api/v1/public/ready', 'Health', '数据库就绪检查', 'none'],
  ['post', '/api/v1/public/auth/challenge', 'Auth', '创建 SIWE 登录挑战', 'none', 'AuthChallengeRequest'],
  ['post', '/api/v1/public/auth/verify', 'Auth', '验证钱包签名并签发 JWT', 'none', 'AuthVerifyRequest'],
  ['post', '/api/v1/public/auth/refresh', 'Auth', '刷新访问令牌', 'cookie'],
  ['post', '/api/v1/public/auth/logout', 'Auth', '注销刷新会话', 'cookie'],
  ['get', '/api/v1/public/auth/central/issuer', 'Auth', '查询中心化 UCAN issuer', 'none'],
  ['post', '/api/v1/public/auth/central/session', 'Auth', '创建中心化签发会话', 'bearer'],
  ['post', '/api/v1/public/auth/central/issue', 'Auth', '签发中心化 UCAN', 'bearer'],
  ['post', '/api/v1/public/auth/central/revoke', 'Auth', '撤销中心化签发会话', 'bearer'],
  ['get', '/.well-known/jwks.json', 'Identity', '查询钱包身份 issuer JWKS', 'none'],
  ['get', '/.well-known/openid-credential-issuer', 'Identity', '查询钱包身份 issuer 元数据', 'none'],
  ['get', '/api/v1/public/identity/status', 'Identity', '查询钱包身份 Passkey 运行状态', 'none'],
  ['post', '/api/v1/public/identity/credentials/status', 'Identity', '查询钱包身份凭证状态', 'none', 'IdentityCredentialsStatusRequest'],
  ['post', '/api/v1/public/identity/account-links/challenge', 'Identity', '创建钱包身份账户关联 challenge', 'none', 'IdentityAccountLinkChallengeRequest'],
  ['post', '/api/v1/public/identity/account-links/verify', 'Identity', '校验钱包身份账户关联证明', 'none', 'IdentityAccountLinkVerifyRequest'],
  ['post', '/api/v1/public/identity/verifications/request', 'Identity', '请求用户名和邮箱验证', 'none', 'IdentityVerificationRequest'],
  ['post', '/api/v1/public/identity/verifications/confirm', 'Identity', '确认验证码并签发钱包身份凭证', 'none', 'IdentityVerificationConfirmRequest'],
  ['post', '/api/v1/public/identity/passkeys/register/request', 'Identity', '创建身份级 Passkey 注册请求', 'none', 'IdentityPasskeyRegisterRequest'],
  ['post', '/api/v1/public/identity/passkeys/register/confirm', 'Identity', '保存身份级 Passkey credential', 'none', 'IdentityPasskeyRegisterConfirmRequest'],
  ['post', '/api/v1/public/identity/passkeys/list', 'Identity', '查询钱包身份 Passkey credential 列表', 'none', 'IdentityPasskeyListRequest'],
  ['post', '/api/v1/public/identity/passkeys/revoke', 'Identity', '撤销钱包身份 Passkey credential', 'none', 'IdentityPasskeyRevokeRequest'],
  ['post', '/api/v1/public/identity/authorize/request', 'Identity', '创建钱包身份授权码请求', 'none', 'IdentityAuthorizeRequest'],
  ['get', '/api/v1/public/identity/authorize/request/{requestId}', 'Identity', '查询钱包身份授权请求', 'none'],
  ['post', '/api/v1/public/identity/authorize/challenge', 'Identity', '创建无钱包登录 Passkey challenge', 'none', 'IdentityAuthorizeChallengeRequest'],
  ['post', '/api/v1/public/identity/authorize/approve', 'Identity', '批准钱包身份授权请求', 'none', 'IdentityAuthorizeApproveRequest'],
  ['post', '/api/v1/public/identity/authorize/exchange', 'Identity', '兑换钱包身份授权码', 'none', 'IdentityAuthorizeExchangeRequest'],
  ['get', '/api/v1/public/auth/totp/status', 'TOTP', '查询 TOTP 服务状态', 'none'],
  ['get', '/api/v1/public/auth/totp/totp/provision', 'TOTP', '获取当前身份 TOTP 配置', 'bearer'],
  ['post', '/api/v1/public/auth/totp/bind/request', 'TOTP', '创建 TOTP 绑定请求', 'bearer'],
  ['get', '/api/v1/public/auth/totp/bind/request/{requestId}', 'TOTP', '查询 TOTP 绑定请求', 'none'],
  ['post', '/api/v1/public/auth/totp/bind/approve', 'TOTP', '确认 TOTP 绑定', 'none'],
  ['post', '/api/v1/public/auth/totp/authorize/request', 'TOTP', '创建 TOTP 授权请求', 'none'],
  ['get', '/api/v1/public/auth/totp/authorize/request/{requestId}', 'TOTP', '查询 TOTP 授权请求', 'none'],
  ['post', '/api/v1/public/auth/totp/authorize/approve', 'TOTP', '使用 TOTP 确认授权', 'none'],
  ['post', '/api/v1/public/auth/totp/authorize/exchange', 'TOTP', '兑换 TOTP 授权码', 'none'],
  ['get', '/api/v1/public/profile/me', 'Profile', '查询当前认证身份', 'bearer'],
  ['post', '/api/v1/public/applications', 'Applications', '创建应用', 'bearer'],
  ['patch', '/api/v1/public/applications/{uid}', 'Applications', '更新应用', 'bearer'],
  ['get', '/api/v1/public/applications/{uid}', 'Applications', '查询应用详情', 'bearer'],
  ['get', '/api/v1/public/applications/{uid}/config', 'Applications', '查询应用用户配置', 'bearer'],
  ['put', '/api/v1/public/applications/{uid}/config', 'Applications', '更新应用用户配置', 'bearer'],
  ['get', '/api/v1/public/applications/by-did', 'Applications', '按 DID 和版本查询应用', 'bearer'],
  ['post', '/api/v1/public/applications/search', 'Applications', '搜索应用', 'bearer'],
  ['delete', '/api/v1/public/applications/{uid}', 'Applications', '删除应用', 'bearer'],
  ['post', '/api/v1/public/applications/{uid}/publish', 'Applications', '发布应用', 'bearer'],
  ['post', '/api/v1/public/applications/{uid}/unpublish', 'Applications', '下架应用', 'bearer'],
  ['post', '/api/v1/public/audits', 'Audits', '创建审核申请', 'bearer'],
  ['post', '/api/v1/public/audits/search', 'Audits', '搜索审核申请', 'bearer'],
  ['get', '/api/v1/public/audits/{uid}', 'Audits', '查询审核详情', 'bearer'],
  ['delete', '/api/v1/public/audits/{uid}', 'Audits', '撤销审核申请', 'bearer'],
  ['post', '/api/v1/admin/audits/{uid}/approve', 'Admin', '批准审核', 'bearer'],
  ['post', '/api/v1/admin/audits/{uid}/reject', 'Admin', '驳回审核', 'bearer'],
  ['post', '/api/v1/public/mpc/sessions', 'MPC', '创建 MPC 会话', 'bearer', 'MpcSessionCreateRequest'],
  ['post', '/api/v1/public/mpc/sessions/{sessionId}/join', 'MPC', '加入 MPC 会话', 'bearer', 'MpcJoinRequest'],
  ['post', '/api/v1/public/mpc/sessions/{sessionId}/cancel', 'MPC', '取消未完成的 MPC Keygen 会话', 'bearer', 'SignedActionFields'],
  ['post', '/api/v1/public/mpc/sessions/{sessionId}/messages', 'MPC', '发送 MPC 消息', 'bearer'],
  ['get', '/api/v1/public/mpc/sessions/{sessionId}/messages', 'MPC', '拉取 MPC 消息', 'bearer'],
  ['get', '/api/v1/public/mpc/sessions/{sessionId}', 'MPC', '查询 MPC 会话', 'bearer'],
  ['get', '/api/v1/public/mpc/ws', 'MPC', '订阅 MPC SSE 事件流', 'bearer', null, true],
  ['get', '/api/v1/public/custody/status', 'Custody', '查询身份 Passkey 和托管状态', 'bearer'],
  ['get', '/api/v1/public/custody/secrets', 'Custody', '列出托管记录', 'bearer'],
  ['get', '/api/v1/public/custody/secrets/{walletId}', 'Custody', '获取托管密文', 'bearer'],
  ['get', '/api/v1/public/custody/recovery/secrets', 'Custody Recovery', '使用一次性恢复令牌列出托管记录', 'bearer'],
  ['get', '/api/v1/public/custody/recovery/secrets/{walletId}', 'Custody Recovery', '使用一次性恢复令牌获取托管密文', 'bearer'],
  ['post', '/api/v1/public/custody/secrets', 'Custody', '上传或更新托管密文', 'bearer', 'CustodyUpsertRequest'],
  ['delete', '/api/v1/public/custody/secrets/{walletId}', 'Custody', '删除托管记录', 'bearer'],
  ['get', '/api/v1/public/notifications', 'Notifications', '查询通知列表', 'bearer'],
  ['get', '/api/v1/public/notifications/unread-count', 'Notifications', '查询未读数量', 'bearer'],
  ['post', '/api/v1/public/notifications/{uid}/read', 'Notifications', '标记通知已读', 'bearer'],
  ['post', '/api/v1/public/notifications/read-all', 'Notifications', '标记全部已读', 'bearer'],
  ['get', '/api/v1/public/notifications/stream', 'Notifications', '订阅通知 SSE', 'bearer', null, true],
  ['get', '/api/v1/public/notifications/{uid}', 'Notifications', '查询通知详情', 'bearer'],
  ['get', '/api/v1/public/notifications/webhooks', 'Notifications', '列出 Webhook', 'bearer'],
  ['post', '/api/v1/public/notifications/webhooks', 'Notifications', '创建 Webhook', 'bearer'],
  ['patch', '/api/v1/public/notifications/webhooks/{uid}', 'Notifications', '更新 Webhook', 'bearer'],
  ['delete', '/api/v1/public/notifications/webhooks/{uid}', 'Notifications', '删除 Webhook', 'bearer'],
  ['get', '/api/v1/public/notifications/webhooks/{uid}/deliveries', 'Notifications', '查询 Webhook 投递', 'bearer'],
  ['post', '/api/v1/public/notifications/webhooks/{uid}/deliveries/{deliveryUid}/retry', 'Notifications', '重试 Webhook 投递', 'bearer'],
  ['post', '/api/v1/public/notifications/webhooks/{uid}/replay/{notificationUid}', 'Notifications', '重放通知到 Webhook', 'bearer'],
  ['get', '/api/v1/admin/notifications/{uid}/deliveries', 'Admin', '管理员查询通知投递', 'bearer'],
  ['post', '/api/v1/publisher/releases/submit', 'Publisher', '提交签名发布包', 'bearer', 'ReleaseSubmitRequest'],
  ['post', '/api/v1/admin/releases/{uid}/approve', 'Admin', '批准发布包', 'bearer'],
  ['post', '/api/v1/admin/releases/{uid}/reject', 'Admin', '驳回发布包', 'bearer'],
  ['get', '/api/v1/admin/users', 'Admin', '查询用户列表', 'bearer'],
  ['get', '/api/v1/admin/users/{did}', 'Admin', '查询用户详情', 'bearer'],
  ['patch', '/api/v1/admin/users/{did}/role', 'Admin', '修改用户角色', 'bearer'],
  ['patch', '/api/v1/admin/users/{did}/status', 'Admin', '修改用户状态', 'bearer'],
]

function operationId(method, route) {
  return `${method}_${route}`
    .replace(/^\w+_api_v1_/, '')
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function securityFor(auth) {
  if (auth === 'none') return []
  if (auth === 'cookie') return [{ refreshCookie: [] }]
  return [{ bearerAuth: [] }]
}

for (const [method, route, tag, summary, auth, bodySchema, sse] of operations) {
  const parameters = [...route.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1], in: 'path', required: true, schema: { type: 'string' },
  }))
  const operation = {
    tags: [tag],
    summary,
    operationId: operationId(method, route),
    security: securityFor(auth),
    parameters,
    responses: sse
      ? {
          200: {
            description: 'SSE event stream',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        }
      : {
          200: { $ref: '#/components/responses/Success' },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { $ref: '#/components/responses/Conflict' },
        },
  }
  if (['post', 'put', 'patch'].includes(method)) {
    operation.requestBody = {
      required: bodySchema !== null,
      content: jsonContent(bodySchema ? ref(bodySchema) : ref('JsonObject')),
    }
  }
  document.paths[route] ||= {}
  document.paths[route][method] = operation
}

document.paths['/api/v1/public/custody/status'].get.responses[200] = {
  description: '身份 Passkey 和托管记录状态',
  content: jsonContent(ref('CustodyStatusEnvelope')),
}

const rendered = YAML.stringify(document, { lineWidth: 0 })
if (checkOnly) {
  const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : ''
  if (existing !== rendered) {
    process.stderr.write('docs/openapi/node.openapi.yaml is out of date. Run npm run openapi:generate.\n')
    process.exit(1)
  }
  process.stdout.write(`OpenAPI document is current (${operations.length} operations).\n`)
  process.exit(0)
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, rendered)
process.stdout.write(`Generated ${path.relative(process.cwd(), outputPath)} with ${operations.length} operations.\n`)
