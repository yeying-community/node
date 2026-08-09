# YeYing Node 文档说明

本文是 `docs/` 目录入口，用于说明 Node 文档的分层、维护边界和后续合并方向。

Node 在社区生态中的定位以 [社区产品关系与开发边界](https://github.com/yeying-community/books/blob/main/yeying/%E7%A4%BE%E5%8C%BA%E4%BA%A7%E5%93%81%E5%85%B3%E7%B3%BB%E4%B8%8E%E5%BC%80%E5%8F%91%E8%BE%B9%E7%95%8C.md) 为上位约束：Node 是社区应用和智能体的 Registry / Portal / Passport Provider，负责应用登记、发布目录、审核、release artifact、身份登录与用户确认授权；Project 拥有项目、任务和业务权限；Agent Runtime 拥有安装、升级、失败回滚、卸载、健康检查和运行状态。

## 推荐阅读顺序

1. [节点架构V1.md](./节点架构V1.md)：当前 Node 已实现能力和运行边界。
2. [节点架构V2.md](./节点架构V2.md)：尚未实现或需要体系化迭代的能力。
3. [生产环境部署手册.md](./生产环境部署手册.md)：生产主机准备、发布包、密钥、Nginx、升级、回滚和验收。
4. [Node使用指南.md](./Node使用指南.md)：配置、鉴权、MPC、通知、托管和 Registry 使用方式。
5. [接口说明.md](./接口说明.md)：人工可读 API 概览。
6. [openapi/node.openapi.yaml](./openapi/node.openapi.yaml)：机器可读 OpenAPI 3.1 规范。

## 文档分层

| 层级 | 文档 | 维护目的 |
| --- | --- | --- |
| 总览 | [节点架构V1.md](./节点架构V1.md)、[节点架构V2.md](./节点架构V2.md)、[项目概览.md](./项目概览.md)、[系统架构.md](./系统架构.md) | 描述 Node 的生态定位、已实现能力、未实现能力和架构演进方向 |
| 使用与接口 | [生产环境部署手册.md](./生产环境部署手册.md)、[Node使用指南.md](./Node使用指南.md)、[接口说明.md](./接口说明.md)、[运行配置.md](./运行配置.md)、[openapi/README.md](./openapi/README.md) | 面向部署、联调、SDK 生成和运维配置 |
| 身份授权 | [登录授权.md](./登录授权.md)、[UCAN签发模式.md](./UCAN签发模式.md)、[UCAN权限设计规划.md](./UCAN权限设计规划.md)、[权限与签名.md](./权限与签名.md) | 维护 SIWE、JWT、UCAN、TOTP、Passkey、业务写签名和权限边界 |
| 业务域 | [业务流程.md](./业务流程.md)、[数据结构.md](./数据结构.md)、[通知中心.md](./通知中心.md)、[加密启动.md](./加密启动.md) | 维护应用、审核、通知、托管密钥、MPC 等具体业务设计 |
| 应用发布 | [YeYing-Application-Protocol-v1.md](./YeYing-Application-Protocol-v1.md)、[YeYing-AppStore-Developer-Manual.md](./YeYing-AppStore-Developer-Manual.md) | 维护 release bundle、发布审核、制品校验和开发者接入说明 |
| 专题方案 | [YeYing-Passport-QRCode-Login.md](./YeYing-Passport-QRCode-Login.md) | 维护 Passport 二维码登录专题方案 |

## 合并评估

已合并和删除：

- `YeYing-AppStore-P1.md`：内容已经收敛为“Node 不承载 Project 安装和 Runtime Task”，结论进入 [节点架构V1.md](./节点架构V1.md) 和 [节点架构V2.md](./节点架构V2.md)。
- `YeYing-AppStore-Runtime-Agent.md`：运行控制面已经迁移到 Agent Runtime，Node 侧只保留边界说明。
- `YeYing-AppStore-Smoke-Test.md`：Node 侧 release smoke test 已并入 [YeYing-AppStore-Developer-Manual.md](./YeYing-AppStore-Developer-Manual.md)。

暂不删除：

- `YeYing-AppStore-Developer-Manual.md`：后端会将该文档作为 `/development/manual` 线上页面来源。
- `YeYing-Application-Protocol-v1.md`：仍是 release bundle 和发布协议的主契约。
- `YeYing-Passport-QRCode-Login.md`：仍是 Passport 登录专题方案，不宜混入通用登录授权文档。

后续可继续合并：

- `UCAN权限设计规划.md` 的长期稳定部分可逐步并入 `登录授权.md` 和 `权限与签名.md`，保留规划文档只记录增量路线。
- `项目概览.md` 与 `系统架构.md` 存在定位重复，后续可由 `节点架构V1.md` / `节点架构V2.md` 承接总览，二者逐步缩减为索引。
- `接口说明.md` 应保持人工概览，具体接口字段以 OpenAPI 为准，避免和 `node.openapi.yaml` 双写。
