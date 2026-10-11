# scripts 脚本说明

本文说明仓库根目录 `scripts/` 下脚本的用途、入口关系和典型使用场景。除特别说明外，命令均在仓库根目录执行。

## 统一入口

根目录 `./cmd` 是生产和源码态共用的运维入口，主要封装 `scripts/starter.sh`、`scripts/health-check.sh`、密钥仓脚本和管理员授权脚本。

```bash
./cmd service start|stop|restart|status|logs
./cmd health [health-check options]
./cmd secrets init|set|remove|unlock|verify|migrate-config|migrate [args]
./cmd admin allow add|remove|list [did-or-wallet]
```

## 生产运维脚本

| 脚本 | 用途 | 常用入口 |
| --- | --- | --- |
| `starter.sh` | 启动、停止、重启 Node 服务；创建运行目录，读取密钥配置，校验构建产物，维护 PID 和日志。 | `./cmd service start`、`./cmd service stop`、`./cmd service restart` |
| `health-check.sh` | 执行服务健康检查，支持 readiness、liveness、dependency、all 等级，并可输出 text 或 json。 | `./cmd health --level readiness --retries 3` |
| `config_backup.sh` | 按 `/data/${MODULE_NAME}/backup.conf` 配置将当前发布目录的 `config.js`、`run/` 和存在的 Nginx 配置打包加密备份到 `/opt/backup`。 | `bash scripts/config_backup.sh` |
| `upgrade.sh` | 通过 `copy-config` 阶段迁移 `config.js` 和加密 secrets 文件，并执行其他标准升级钩子。不会复制 `secrets.passwordFile`；生产环境应将其配置为版本目录之外的共享绝对路径。 | `bash scripts/upgrade.sh copy-config <current-dir> <target-dir>` |

## 密钥仓脚本

| 脚本 | 用途 | 常用入口 |
| --- | --- | --- |
| `secret-vault.cjs` | 密钥仓公共库，提供加密、解密、读写、替换 vault、密码读取和 DID/密钥派生等能力；通常不直接执行。 | 被其它密钥脚本 `require` |
| `init-secrets.cjs` | 初始化加密密钥仓，生成默认密钥并写入 `run/secrets.enc.json` 或指定文件。 | `./cmd secrets init`、`npm run secrets:init` |
| `set-secret.cjs` | 设置或更新单个密钥值。 | `./cmd secrets set DATABASE_PASSWORD`、`npm run secrets:set -- DATABASE_PASSWORD` |
| `remove-secret.cjs` | 从密钥仓删除单个密钥。 | `./cmd secrets remove KEY`、`npm run secrets:remove -- KEY` |
| `unlock-secrets.cjs` | 验证密钥仓密码是否可解密，并列出密钥名称。 | `./cmd secrets unlock`、`npm run secrets:unlock` |
| `verify-secrets.cjs` | 根据 `config.js` 需要的配置项校验密钥仓中必需密钥是否存在。 | `./cmd secrets verify`、`npm run secrets:verify` |
| `migrate-config-secrets.cjs` | 将 `config.js` 中仍以明文保存的敏感项迁移到加密密钥仓，并从配置文件移除明文。 | `./cmd secrets migrate-config`、`npm run secrets:migrate-config` |
| `migrate-secrets.cjs` | 迁移旧版 vault key，并按统一密钥模型重加密 Webhook 相关记录；执行前会备份 vault 文件。 | `./cmd secrets migrate`、`npm run secrets:migrate` |
| `admin-allow.cjs` | 管理密钥仓中的 `ADMIN_DIDS`，用于添加、删除、查看管理员 DID 或钱包地址。 | `./cmd admin allow add 0x...`、`npm run admin:allow -- list` |

## 发布与接口脚本

| 脚本 | 用途 | 常用入口 |
| --- | --- | --- |
| `package.sh` | 基于 Git tag 和当前构建产物生成生产发布包，拷贝运行所需文件、脚本和模板到 `output/`。 | `npm run package:release -- vX.Y.Z` |
| `generate-openapi.cjs` | 生成或检查 `docs/openapi/node.openapi.yaml`，作为机器可读 OpenAPI 3.1 规范来源。 | `npm run openapi:generate`、`npm run openapi:check` |
| `check-api-prefixes.cjs` | 检查 API 路由前缀约定，避免新增接口绕过既定 `/api/v1/...` 结构。 | `npm run check:api-prefixes` |
| `create-appstore-smoke-release.cjs` | 生成 AppStore 联调 smoke release 的提交 JSON，并输出需要登记到 `config.js` 的 publisher 公钥配置。 | `npm run appstore:smoke-release -- --image repo@sha256:...` |

## 开发与联调脚本

| 脚本 | 用途 | 常用入口 |
| --- | --- | --- |
| `dev-secure.cjs` | 使用加密密钥仓读取敏感配置后启动本地开发服务。 | `npm run dev:secure` |
| `mpc_sse_smoke.sh` | 对 MPC SSE 流程做冒烟测试：打开 SSE、创建 session、join、发送消息并检查事件。 | `TOKEN=... IDENTITY=... bash scripts/mpc_sse_smoke.sh` |
| `sync.sh` | 开发协作脚本：检查 Git 仓库、origin/upstream、工作区状态，拉取上游并按配置推送当前分支。 | `bash scripts/sync.sh` |
| `pr.sh` | 创建 GitHub Pull Request 的辅助脚本；可自动检查或安装 `gh`，推送当前分支并创建 PR。 | `bash scripts/pr.sh` |

## 模板文件

| 文件 | 用途 |
| --- | --- |
| `backup.conf.template` | `config_backup.sh` 的配置模板，用于控制是否启用配置备份、备份文件名前缀和后缀。生产环境应复制为 `/data/${MODULE_NAME}/backup.conf` 后按需修改。 |
| `.passphrase-file.template` | `config_backup.sh` 加密备份所需密码文件模板。生产环境应复制为 `/data/${MODULE_NAME}/.passphrase-file`，并限制文件权限。 |

## 返回值约定

- 成功执行的脚本返回 `0`。
- 参数缺失、路径不存在、依赖命令缺失、健康检查失败、密钥校验失败等异常情况返回非 `0`。
- `config_backup.sh` 在目标备份文件已经存在时返回 `255`，用于避免覆盖已有备份。

## 维护约定

- 新增可直接执行的脚本应使用清晰的参数校验，并在失败时向 `stderr` 输出错误。
- 涉及生产运行、升级、备份的脚本应保持幂等或明确说明覆盖行为。
- 涉及敏感信息的脚本不得打印密钥明文，文件权限应尽量限制为当前用户可读写。
- 修改 API 路由后应同步执行 `npm run openapi:generate` 和 `npm run check:api-prefixes`。
