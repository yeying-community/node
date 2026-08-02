# YeYing AppStore P1（历史文档）

本文是历史索引。P1 阶段曾尝试让 Node 同时承担应用目录、Project AppStore Adapter 和 Runtime Task 协调。当前架构已经调整为：

```text
Project -> Agent Runtime -> Node Registry
```

## 当前结论

- Node 不再注册 Project `api/v1/internal/*` 安装、升级、卸载兼容接口。
- Node 不再注册 Runtime Agent 任务领取、心跳、释放和上报接口。
- Node 保留应用目录、发布审核、release artifact、签名校验和授权入口。
- Agent Runtime 接管安装任务、升级任务、失败回滚、卸载、健康检查和运行状态。
- Project 侧保留 `api/appstore/*` 兼容入口，但该入口应指向 Agent Runtime。

## 保留价值

P1 期间沉淀的 release bundle、固定镜像 digest、禁止 Docker Socket、禁止特权容器、健康检查和本地安装状态镜像等约束仍然有效，但执行位置从 Node 迁移到 Agent。

## 相关文档

- Node 发布协议：`docs/YeYing-Application-Protocol-v1.md`
- Node 开发手册：`docs/YeYing-AppStore-Developer-Manual.md`
- Agent Runtime 设计：`agent/docs/agent-runtime-design.md`
