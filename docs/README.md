# YeYing Node 文档索引

本文是 `docs/` 的唯一维护入口，说明推荐阅读顺序、文档职责、权威来源和合并边界。

权威正文按职责放在 `architecture/`、`identity/`、`operations/`、`integrations/` 和 `business/` 子目录。人工可读 API 概览与机器可读契约统一放在 `openapi/`；根目录保留本索引和 Node 线上页面直接读取的应用发布文档。

Node 在社区生态中的定位以[社区产品关系与开发边界](https://github.com/yeying-community/books/blob/main/yeying/%E7%A4%BE%E5%8C%BA%E4%BA%A7%E5%93%81%E5%85%B3%E7%B3%BB%E4%B8%8E%E5%BC%80%E5%8F%91%E8%BE%B9%E7%95%8C.md)为上位约束：Node 是社区应用和智能体的 Registry / Portal / Identity Provider，负责应用登记、发布目录、审核、release artifact、钱包身份凭证、身份登录与用户确认授权；Project 拥有项目、任务和业务权限；Agent Runtime 拥有安装、升级、失败回滚、卸载、健康检查和运行状态。

## 推荐阅读顺序

1. [核心概念.md](architecture/核心概念.md)：Node 身份、Passkey/WebAuthn、VC、授权流程和云端恢复术语。
2. [系统架构.md](architecture/系统架构.md)：当前 Node 的产品职责、逻辑架构和已实现能力概览。
3. [Node使用指南.md](operations/Node使用指南.md)：配置、鉴权、MPC、通知、托管和 Registry 使用方式。
4. [认证器.md](identity/认证器.md)：先理解身份主体、认证器、Passkey、钱包密钥和应用会话的边界。
5. [Node登录授权.md](identity/Node登录授权.md)：查用户登录 Node 本身的 SIWE/JWT、邮箱身份登录和身份敏感操作流程。
6. [DApp登录授权.md](identity/DApp登录授权.md)：查 DApp 依赖 Node 的身份授权码、PKCE 和应用会话流程。
7. 按专题查阅： [身份凭证](identity/身份凭证.md)。Node API 的 UCAN 与业务权限规则见 [Node登录授权](identity/Node登录授权.md)。
8. [生产环境部署手册.md](operations/生产环境部署手册.md)：生产主机准备、发布包、密钥、Nginx、升级、回滚和验收。
9. [接口说明.md](openapi/接口说明.md)：人工可读 API 概览。
10. [openapi/node.openapi.yaml](./openapi/node.openapi.yaml)：机器可读 OpenAPI 3.1 规范。

支付、推送、应用发布等专项文档见下方索引。

## 文档职责索引

| 分类 | 文档 | 职责 |
| --- | --- | --- |
| 概念与架构 | [核心概念.md](architecture/核心概念.md)、[系统架构.md](architecture/系统架构.md)、[数据结构.md](architecture/数据结构.md) | 集中定义关键术语；说明产品边界、逻辑架构、当前能力和核心数据模型 |
| 身份与授权 | [认证器.md](identity/认证器.md)、[Node登录授权.md](identity/Node登录授权.md)、[DApp登录授权.md](identity/DApp登录授权.md)、[身份凭证.md](identity/身份凭证.md) | 分别解释认证器与安全边界、定义 Node 登录和 Node API 授权规则、定义 DApp 应用登录流程、说明身份凭证类型与验证 |
| 使用、部署与接口 | [Node使用指南.md](operations/Node使用指南.md)、[生产环境部署手册.md](operations/生产环境部署手册.md)、[接口说明.md](openapi/接口说明.md)、[openapi/README.md](./openapi/README.md) | 面向使用者、运维人员和 API 调用方；运行参数以配置模板为准 |
| 平台推送 | [Node-Pusher设计.md](integrations/Node-Pusher设计.md)、[Node-Pusher接入示例.md](integrations/Node-Pusher接入示例.md) | 定义 Node 实时事件网关边界、协议和接入方式 |
| 应用发布 | [应用协议 v1](./protocols/YeYing-Application-Protocol-v1.md)、[AppStore 开发者手册](./protocols/YeYing-AppStore-Developer-Manual.md) | 维护 release bundle、发布审核、制品校验和开发者接入说明 |
| 业务流程与数据 | [应用中心.md](business/应用中心.md)、[MPC协调器.md](business/MPC协调器.md)、[通知中心.md](business/通知中心.md)、[钱包托管.md](business/钱包托管.md) | 按应用发布、MPC 协调、通知、钱包密钥托管等领域维护业务模型、架构和流程；核心数据模型见架构分类 |
| 支付 | [支付收银台.md](business/支付收银台.md) | 说明商户、DApp 集成、微信收款、退款回调和提现边界 |
| 开发与运维参考 | [scripts-specification.md](operations/scripts-specification.md)、[生产环境部署手册.md](operations/生产环境部署手册.md)、[openapi/README.md](./openapi/README.md) | 维护脚本约定、生产运维和机器可读接口规范使用说明 |

## 权威来源与状态规则

- **术语定义**：[核心概念.md](architecture/核心概念.md)。其他文档可以使用简称，并在各自职责内说明流程和规则。
- **产品边界与实现概览**：[系统架构.md](architecture/系统架构.md)；具体运行行为以代码和测试为准。
- **API 字段**：[openapi/node.openapi.yaml](./openapi/node.openapi.yaml)，由 `scripts/generate-openapi.cjs` 生成。
- **运行配置**：根目录 `config.js.template`、密钥模板和[生产环境部署手册](operations/生产环境部署手册.md)。
- **协议、安全和业务规则**：由对应领域文档维护；概览、索引不覆盖领域规范。
- **实现状态**：以代码、测试和明确的现行规范为准；已废弃方案不再保留在当前文档目录中。

## 合并记录与保留边界

以下旧文档已合并到当前权威正文，不再单独维护：

- `项目概览.md`、`系统架构.md`：稳定内容合入[系统架构.md](architecture/系统架构.md)。
- `钱包身份账户关联V1.md`、`钱包身份邮箱凭证V1.md`：合入[身份凭证](identity/身份凭证.md)。
- `钱包身份生产部署检查清单.md`：合入[生产环境部署手册.md](operations/生产环境部署手册.md)的身份服务上线验收章节。
- `Project-实时SSE集成研究.md`：已确认结论合入[Node-Pusher接入示例.md](integrations/Node-Pusher接入示例.md)。
- `YeYing-AppStore-P1.md`、`YeYing-AppStore-Runtime-Agent.md`：Node 与 Project 安装及 Agent Runtime 执行控制面的职责边界，已纳入架构和历史路线说明。
- `YeYing-AppStore-Smoke-Test.md`：Node release smoke test 已并入 [AppStore 开发者手册](./protocols/YeYing-AppStore-Developer-Manual.md)。

以下文档继续独立维护，因为它们承担不同职责或有外部路径依赖：

- `business/通知中心.md`与`integrations/Node-Pusher设计.md`：分别定义通知持久化/投递和实时事件入口/fanout。
- [openapi/接口说明.md](openapi/接口说明.md)：维护人工可读 API 分组概览，具体字段以 OpenAPI 为准。
- [协议目录](./protocols/README.md)：维护 YeYing 应用协议和 AppStore 开发者操作手册；后者也是 Node 线上页面的内容来源。
- `应用 AppId 与版本迁移方案.md`：生产迁移完成后不再单独维护；稳定 AppId 与版本规则已并入[应用中心](business/应用中心.md)，数据模型见[数据结构](architecture/数据结构.md)。

新增文档应明确读者和职责，并加入本索引；具体要求见社区[项目文档编写规范](https://github.com/yeying-community/deployer/blob/main/specification/DOCUMENTATION_GUIDELINES.md)。
