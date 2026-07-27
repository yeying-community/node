# YeYing AppStore Runtime Agent

本设计的协议字段、状态机和发布流程以 [YeYing 应用协议 v1](./YeYing-Application-Protocol-v1.md) 为准。

## 结论

Runtime Agent 运行在 Project 部署机器上，通过出站 HTTPS 轮询社区 AppStore。社区 Node 不连接部署机 Docker Socket、不通过 SSH 执行命令，也不保存部署机系统权限。

这是一种拉取式执行模型：部署机器保留执行权限，社区中心只保存受控的应用发布制品和任务状态。

## 为什么当前不能直接执行安装

Project 当前 `docker/appstore/apps/*/config.yml` 是旧 AppStore 的应用元数据，包含菜单、配置字段与部分 Hook，但不包含运行时所需的完整声明：

- 不包含每个服务的 Compose 定义。
- 不包含端口、网络、卷和只读挂载。
- 不包含镜像 digest。
- 不包含健康检查与就绪判定。
- 不包含升级回滚策略。

因此 `image` 字段不能单独构成可执行安装单。Agent 不得根据应用名称、镜像名或历史目录猜测 Docker 参数。

## 角色与权限

| 角色 | 权限 |
| --- | --- |
| Project 管理员 | 在 AppStore 请求安装、升级、卸载 |
| 社区 Node | 保存目录、发布制品和任务状态；签发只读任务给 Agent |
| Runtime Agent | 校验制品、写入本地运行配置、调用受限部署入口、回报结果 |
| Project 主程序 | 消费 `installed` 状态和本地插件配置，不管理容器 |

## 制品规范

每个已发布版本必须提供签名后的 `runtime-manifest.json`。Node 的目录记录只引用该制品摘要，不把可执行配置开放给浏览器请求。

```json
{
  "schema_version": 1,
  "app_id": "ai",
  "version": "0.1.0",
  "image": {
    "reference": "ghcr.io/yeying-community/ai@sha256:<digest>"
  },
  "runtime": {
    "compose_file": "compose.yaml",
    "service_name": "ai",
    "healthcheck": {
      "url": "http://127.0.0.1:<port>/health",
      "timeout_seconds": 60
    }
  },
  "dependencies": ["project-api", "redis", "manticore"],
  "config_schema": "config.schema.json",
  "signature": {
    "algorithm": "ed25519",
    "key_id": "yeying-release-2026-01",
    "value": "<base64>"
  }
}
```

发布校验规则：

- 镜像必须使用 `@sha256:` digest，禁止浮动标签。
- Compose 文件只能引用该 manifest 中允许的镜像与服务名。
- 配置 Schema 区分普通值和 secret；secret 不出现在任务列表和日志。
- 卷挂载必须使用 Agent 明确允许的目录。
- 网络、特权模式、Docker Socket、host network 和任意 hostPath 默认拒绝。

## Agent 协议

Agent 使用实例专属凭据访问以下内部接口。凭据只保存在部署机受限配置中，Node 数据库存储不可逆哈希与轮换信息。

```text
POST /api/v1/runtime/tasks/claim
POST /api/v1/runtime/tasks/{taskId}/heartbeat
POST /api/v1/runtime/tasks/{taskId}/report
POST /api/v1/runtime/tasks/{taskId}/release
GET  /api/v1/runtime/releases/{appId}/{version}
```

`claim` 只返回属于该实例、状态为 `pending` 的任务。任务被领取后进入 `running`，有租约；Agent 中断时租约到期后可重新领取。

`report` 只能将当前 Agent 已领取的任务推进到协议允许的状态。成功回报必须包含与任务相同的 release digest 和通过的健康检查结果；Node 才会将对应安装记录标记为 `installed`。Node 不能自行把任务直接标记为 `installed`。

`release` 仅允许任务处于 `claimed` 时调用，用于 dry-run 等未执行部署的检查完成后归还任务；它清除租约并将任务恢复为 `pending`，不改变安装记录。

当前 Node 已实现 `/api/v1/runtime/tasks/claim`、`/{taskId}/heartbeat`、`/{taskId}/report` 和 `/{taskId}/release`。Agent 使用 `X-YeYing-Instance`、`X-YeYing-Agent` 和 Bearer Token；Node 配置只保存 Token SHA-256。任务使用 revision 乐观锁和租约，建议为镜像拉取配置 300 秒租约。安装与升级只有 `claimed -> applying -> verifying -> succeeded` 才会更新安装记录；升级失败进入 `rolling_back`，成功恢复旧 release 后终止于 `rolled_back`。卸载成功清空安装状态但默认保留命名卷。

## Agent 执行流程

```text
claim pending task
  -> 下载并验证签名的 release bundle
  -> 校验 digest、Compose 白名单和本机依赖连通性
  -> 生成 staging 配置
  -> 受限部署入口执行升级
  -> 健康检查
  -> 原子写入 docker/appstore/config/{appId}/config.yml
  -> report installed
```

失败时：停止新服务、恢复上一稳定版本、保留脱敏日志、`report failed`。不得在健康检查前写入 `status: installed`。

## Project 集成边界

Agent 应成为 Project 发布包中的独立命令，例如 `scripts/appstore-agent.sh`，由 systemd timer 或显式运维命令运行。它不启动 MySQL、Redis、Manticore 等共享中间件，只验证配置与连通性。

Project 仅在 Agent 成功后看到 `docker/appstore/config/{appId}/config.yml`；这保留现有 `Apps::isInstalled()` 的兼容行为。目录迁移到新路径将在旧 AppStore 完全移除后再进行。

## 实施顺序

1. 为 AI Assistant 制作首个签名 release bundle：Compose、配置 Schema、健康检查和镜像 digest。
2. 在 Node 增加任务租约、Agent 凭据哈希和 release 下载接口。
3. 在 Project 增加只消费这些受控接口的 Agent，并完成 dry-run。
4. 用 AI Assistant 验证安装、升级、失败回滚。
5. 移除旧 `dootask/appstore` 容器和 Nginx `/appstore/` 代理。
