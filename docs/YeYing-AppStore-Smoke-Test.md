# YeYing AppStore Smoke Test Runbook（迁移说明）

本文记录 AppStore V1 smoke test 的新边界。旧的“Node 创建 Runtime Task、部署机 Runtime Agent 从 Node 领取任务”流程已经迁移到 Agent Runtime。

## 当前闭环

```text
Publisher release
  -> Node approve/publish
  -> Project install/upgrade/uninstall proxy
  -> Agent Runtime task
  -> healthcheck / rollback / uninstall
  -> Project local installed state
```

## Node 侧验证

Node 只验证发布包和 Registry 流程：

```bash
node scripts/create-appstore-smoke-release.cjs \
  --app-id smoke \
  --version 0.1.0 \
  --image registry.example/smoke@sha256:<64 hex> \
  --publisher-key-id smoke-publisher \
  --publisher-owner 0xYourPublisherWallet \
  --host-port 25080 \
  --container-port 8080 \
  --health-path / \
  --out tmp/smoke-0.1.0.json
```

提交 release：

```bash
curl -fsS -X POST "$NODE_URL/api/v1/publisher/releases/submit" \
  -H "Authorization: Bearer $NODE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @tmp/smoke-0.1.0.json
```

审核发布：

```bash
curl -fsS -X POST "$NODE_URL/api/v1/admin/releases/$RELEASE_ID/approve"
curl -fsS -X POST "$NODE_URL/api/v1/admin/releases/$RELEASE_ID/publish"
```

## Project / Agent 侧验证

Project `.env` 应配置：

```dotenv
AGENT_INTERNAL_URL=http://127.0.0.1:3900
AGENT_INSTANCE_ID=project
AGENT_INTERNAL_TOKEN=<same-as-agent-HUB_INTERNAL_TOKEN>
```

Project 管理员触发安装：

```bash
curl -fsS -X POST "$PROJECT_URL/api/appstore/install" \
  -H "Token: $PROJECT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"app_id":"smoke","version":"0.1.0"}'
```

Agent Runtime 的 dry-run、执行、回滚和卸载命令由 `agent` 仓库维护。Node runbook 不再描述部署机任务执行细节。
