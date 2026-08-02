# YeYing AppStore Runtime Agent（历史文档）

本文是历史索引。Runtime Agent 的运行控制面已经从 Node 迁移到 `agent` 仓库。

## 当前边界

- Node 只保留 Registry、发布审核、release artifact、签名校验和授权入口。
- Agent Runtime 负责 Project 安装、升级、失败回滚、卸载、任务状态和健康检查。
- Project 通过 `api/appstore/*` 兼容入口调用 Agent Runtime，不直接调用 Node 的运行时任务接口。

## 迁移后的调用关系

```text
Project -> Agent Runtime -> Node Registry
```

Node 侧仍维护应用协议、release bundle 校验和发布流程。Agent 侧维护运行时 API、任务状态机、执行器和回滚策略。

## 相关文档

- Node 发布协议：`docs/YeYing-Application-Protocol-v1.md`
- Node 开发手册：`docs/YeYing-AppStore-Developer-Manual.md`
- Agent Runtime 设计：`agent/docs/agent-runtime-design.md`
