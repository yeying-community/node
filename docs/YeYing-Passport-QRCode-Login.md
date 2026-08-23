# 已废弃：YeYing Passport 通行证二维码登录方案

该历史实验方案已移除，不再作为 Node、Wallet、Router 或 web3-bs 的实现依据。新的登录模型使用钱包身份 DID。

- 钱包身份 DID 是外部身份主键，格式为 `did:yeying:wid_*`。
- Wallet 地址、Passkey、用户名和邮箱都是钱包身份下的账户或凭证。
- 通行证只表示无钱包插件场景下的 Passkey 认证器入口，不表示独立 Passport subject。
- Web3 应用通过 `/api/v1/public/identity/authorize/request`、`/api/v1/public/identity/authorize/approve`、`/api/v1/public/identity/authorize/exchange` 完成授权码登录。
- exchange 结果不包含 Passport assertion、`subjectId` 或应用侧绑定关系。

当前方案见：

- [钱包身份 Issuer V1 实现说明](./钱包身份IssuerV1实现说明.md)
- [登录与授权](./登录授权.md)
- [接口说明](./接口说明.md)
