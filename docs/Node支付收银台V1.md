# Node 支付收银台 V1

Project 199 将 `yeying-room` 的支付边界迁移到 Node。V1 迁移的是标准化收银台和渠道状态，不直接迁移 PHP 的优惠券、时长卡、储值、座位、打印或储物柜履约模型。

## 运行边界

- Node 负责商户、交易、渠道下单、渠道通知验签、查询、取消、退款和业务回调。
- 业务应用负责根据 `payment.succeeded` / `refund.succeeded` 回调完成自己的发货或权益发放。
- `yeying-room` 现有 PHP 订单继续由 PHP 处理。Node 与 PHP 不共享支付表，也不能让两个系统同时消费同一笔渠道通知。
- 生产切换需要先部署 Node、完成测试商户联调，再将新订单的渠道通知地址切到 Node；历史订单保留原 PHP 通知入口。

## 配置和密钥

`config.js.template` 中的 `payment` 只放非敏感参数。商户密钥和微信商户凭据必须写入 Node secrets vault：

- `PAYMENT_WECHAT_APP_ID`
- `PAYMENT_WECHAT_MCH_ID`
- `PAYMENT_WECHAT_API_V2_KEY`
- `PAYMENT_WECHAT_CERT_PEM`
- `PAYMENT_WECHAT_KEY_PEM`
- `NODE_KEY_DERIVATION_SECRET`，用于加密 Node 数据库中的商户签名密钥

当前实现按来源项目使用的微信支付 V2 协议实现统一下单、订单查询、关闭订单、退款、退款查询和 XML 通知验签。V3 证书/平台证书协议不与 V2 混用，后续接入需要单独增加 provider。

生产环境微信 API 只允许 `api.mch.weixin.qq.com`；测试环境如使用官方以外的沙箱代理或 stub，必须显式配置 `payment.wechat.allowedApiHosts`，不能使用任意 URL。

## 商户管理

登录 Node 网页后可打开 `/payments` 支付中心，完成以下操作：

- 创建和停用收款商户；创建成功时明文商户密钥只展示一次。
- 发起扫码或 H5 测试订单，查询/取消订单，以及对已支付订单发起退款和查询退款。
- 使用邮箱登录的用户无需安装钱包插件即可进入该页面；钱包登录用户仍复用现有登录态。

该页面用于开发者联调和最小金额验证，不是业务收银台。生产业务应由 Router 等后端服务保存商户密钥并调用 Node，浏览器不得持久化或承载商户密钥。真实微信配置下的测试订单会产生真实扣款，必须确认回调、入账和退款链路后再接入业务流量。

商户管理使用 Node 的 Bearer JWT/UCAN：

```text
POST   /api/v1/public/payment/gateway/merchants
GET    /api/v1/public/payment/gateway/merchants
DELETE /api/v1/public/payment/gateway/merchants/:merchantId
```

创建请求：

```json
{
  "name": "社区应用",
  "callbackUrl": "https://app.example.com/api/payment/callback"
}
```

创建响应中的 `secret` 只返回一次。调用方必须立即保存，后续请求使用 `X-Payment-*` 头：

- `X-Payment-Merchant`
- `X-Payment-Timestamp`：Unix 毫秒或秒
- `X-Payment-Nonce`：16 至 128 位唯一随机值
- `X-Payment-Signature`

签名消息为（商户 ID 参与签名，防止签名在不同商户上下文中复用）：

```text
HMAC-SHA256(secret, merchantId + "." + timestamp + "." + nonce + "." + canonicalJson(body))
```

`canonicalJson` 对对象键递归排序。服务器会检查时间窗并持久化消费 nonce；重复 nonce、篡改 body、过期请求都会被拒绝。

## 交易接口

```text
POST /api/v1/public/payment/gateway/transactions
POST /api/v1/public/payment/gateway/transactions/query
POST /api/v1/public/payment/gateway/transactions/cancel
POST /api/v1/public/payment/gateway/refunds
POST /api/v1/public/payment/gateway/refunds/query
```

创建交易 body：

```json
{
  "externalOrderId": "room-order-1001",
  "amountMinor": "12800",
  "currency": "CNY",
  "description": "学习空间时长卡",
  "clientType": "native",
  "idempotencyKey": "checkout-20261015-1001"
}
```

金额以分存储，禁止浮点金额。`clientType=native` 返回微信 `code_url`，`clientType=h5` 需要 `returnUrl` 并返回微信 `mweb_url`。

交易状态：

```text
creating -> pending -> paid
creating -> failed
pending  -> cancelled
paid     -> refund_pending -> partially_refunded | refunded
```

同一商户的 `idempotencyKey` 只能对应一组业务字段；重复请求返回原交易，字段不一致返回冲突。渠道通知按 `provider + eventId` 去重，先验签、验商户、验金额，再改变状态。

## 渠道通知和业务回调

微信通知：

```text
POST /api/v1/public/payment/gateway/webhooks/wechat
```

Node 返回微信 XML 成功响应后，将业务事件写入回调 outbox。后台 worker 使用固定超时、有限重试和指数退避投递商户回调：

- `X-Yeying-Payment-Event`
- `X-Yeying-Payment-Timestamp`
- `X-Yeying-Payment-Nonce`
- `X-Yeying-Payment-Signature`

回调 body 是 JSON，包含 `merchantId`，签名使用同一套商户 ID 绑定的 HMAC-SHA256。回调 URL 创建时会校验 DNS 目标，只允许 HTTP(S)，生产必须使用 HTTPS；每次回调投递时重新解析 DNS 并阻止私有/保留地址，开发环境只放行 loopback HTTP。

## 数据库迁移

Node 启动时自动执行 `20261015100000-add-payments`：

- `payment_merchants`
- `payment_transactions`
- `payment_refunds`
- `payment_request_nonces`
- `payment_provider_events`
- `payment_webhook_deliveries`

生产发布前应备份数据库并确认 migration 完成；回滚代码不能自动回滚已产生的支付记录或渠道交易。

## 与 yeying-room 的迁移切换

1. 在 Node 创建测试商户，使用测试域名和测试微信配置完成下单、通知、查询、退款联调。
2. 新业务应用改用 Node 收银台，并由业务应用实现签名回调履约。
3. 旧 PHP 订单继续使用原通知地址；不要将旧订单 webhook 直接发送到 Node。
4. 对需要保留的优惠券、时长卡或余额业务，增加明确的业务适配器和一次性迁移记录，再逐类切换。
5. 切换期间监控 `payment_transactions`、provider event 去重和 callback delivery 状态，必要时按订单归属回滚到 PHP。
