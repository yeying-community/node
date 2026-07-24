# YeYing AppStore P1

## 范围

P1 将 YeYing 社区 `node` 项目作为应用目录和 Project AppStore Adapter。目标是替换旧 `dootask/appstore` 的已安装应用读取协议；本阶段不授予社区服务 Docker Socket，也不执行容器安装、升级或卸载。

## 数据边界

- `applications`：社区应用目录及发布信息，不表示任何 Project 已安装。
- `project_instances`：一个已登记的 Project 部署实例，包含实例 ID、Project API 地址与启用状态。
- `project_app_installations`：一个实例中某应用的运行时安装状态。只有 `status=installed` 会返回给 Project。

`runtime_config_json` 仅保存运行时配置的结构化引用或非敏感配置。密钥后续接入密钥库，不写入 API 响应。

## 已实现接口

`GET /api/v1/internal/installed`

请求头：

- `Token`：Project 当前登录用户 Token，必填。
- `X-YeYing-Instance`：Project 实例 ID。缺省时使用 `projectAdapter.defaultInstanceId`。

Adapter 会调用 `{project_api_url}/api/users/info` 验证 Token。读取菜单不要求管理员；安装、升级、卸载接口将在后续阶段要求 `data.identity` 包含 `admin`。

`GET /api/v1/internal/catalog` 返回当前可安装的已发布应用目录。

`POST /api/v1/internal/install` 仅允许 Project 管理员调用，请求体为 `{"app_id":"ai","version":"0.1.0"}`。接口只创建或更新 `pending` 安装任务，绝不拉取镜像、写入 Project 文件或操作容器。Runtime Agent 在后续阶段成功执行健康检查后，才会将状态改为 `installed`。

## 标准 Manifest

P1 的第一个 Manifest 为 `src/appstore/manifests/ai.ts`。Manifest 是服务端受控的应用发布数据，包含应用 ID、版本、镜像、最低 Project 版本和菜单项；安装请求不能提交或覆盖这些字段。

成功响应保持 Project 现有前端兼容：

```json
{
  "code": 200,
  "data": [{
    "id": "ai",
    "version": "0.1.0",
    "install_at": "2026-07-23T00:00:00Z",
    "menu_items": [{
      "location": "application",
      "label": "YeYing AI Assistant",
      "url": "apps/ai/",
      "visible_to": "all"
    }]
  }]
}
```

## 配置与初始化

在 `config.js` 配置默认实例 ID。首次登记实例和安装记录由后续受控 Runtime Agent 创建；在 Agent 落地前，不应把数据库手工写入作为生产安装流程。

```sql
INSERT INTO project_instances (instance_id, project_api_url, status, created_at, updated_at)
VALUES ('local-project', 'http://127.0.0.1:2222', 'active', '2026-07-23T00:00:00Z', '2026-07-23T00:00:00Z');
```

## 后续顺序

1. 按 [Runtime Agent 设计](./YeYing-AppStore-Runtime-Agent.md) 先完成 AI Assistant 的签名 release bundle，再实现 Agent。
2. 增加卸载与升级的任务状态机，并由 Agent 消费。
3. Project 移除旧 AppStore 容器，仅保留 Adapter URL 配置。
4. 以 AI Assistant 作为第一个完整迁移样板。

## 安全约束

- Node 社区中心不得直接连接生产 Docker Socket。
- Project Token 只用于当前请求身份验证，不持久化。
- 插件密钥按实例和应用隔离，后续由密钥库管理。
- 安装状态只有在 Runtime Agent 健康检查成功后才能写为 `installed`。
