# 应用 AppId 与版本迁移方案

> 状态：阶段二、阶段三基础能力已实现；生产数据迁移待执行
>
> 关联规范：[应用标识与应用空间规范](../../books/yeying/夜莺社区/产品/公共能力/应用标识与应用空间规范.md)

## 1. 目标

让 Node 应用中心同时满足：

1. `appId` 在应用生命周期内稳定。
2. 新版本复用原 `appId`，不创建新的应用空间。
3. `(appId, version)` 唯一定位一个发布版本。
4. 身份授权、`redirectUris`、应用配置和 Pusher 归属继续绑定应用，而不是绑定某个版本记录。
5. 旧的 `applications.uid`、审计记录和已发布应用可以平滑迁移。

## 2. 历史结构与风险

历史 `applications` 表的 `uid` 是 UUID 主键，`version` 与应用元数据放在同一行：

```text
applications.uid      -> 单行主键
applications.did      -> 现有应用/资源 DID（兼容标识）
applications.version  -> 该行版本
```

当前身份授权通过 `queryByUid(appId)` 查找应用，因此现有 `applications.uid` 是外部兼容 AppId。但如果每个版本新建一行并生成新的 UID，会造成：

- `authorize/request` 使用新的 AppId；
- `redirectUris` 和刷新会话绑定发生变化；
- Warehouse 的 `/apps/<appId>` 目录发生变化；
- Router/Warehouse UCAN capability 发生变化；
- Chat Web 与桌面端读到不同的历史数据。

不能只修改 Chat 的环境变量解决这个问题。

## 3. 当前兼容数据模型

当前实现将逻辑应用和版本发布拆开：

```text
applications
  uid/app_id       # 稳定 AppId，保留现有 UID 作为兼容值
  did              # 现有应用/资源 DID，继续用于兼容查询和审核
  owner            # 发布者钱包主体
  redirect_uris    # 应用级回调白名单
  status           # 应用整体状态

application_releases
  uid              # 版本记录内部 UID
  application_uid  # applications.uid
  version          # 当前兼容 int；后续 YAP 制品版本使用 SemVer
  digest           # 制品摘要
  signature        # 现有兼容签名/后续 Registry 签名字段，不代表 appDid
  status           # submitted/approved/published/withdrawn

UNIQUE(application_uid, version)
```

`applications` 中的展示字段可以保存当前发布版本的快照；完整历史以 `application_releases` 为准。已有 `app_releases` 是 YAP release 目录模型，迁移时要建立它与应用中心 `applications.uid` 的明确映射，不能靠名称或域名猜测。

## 4. API 兼容策略

### 4.1 现有接口

- `appId` 继续接受 `applications.uid`。
- `/identity/authorize/*` 不改变请求字段，仍提交 `appId + redirectUri`。
- `queryByUid` 返回稳定应用记录，不返回某个历史版本的随机 UID。
- `redirectUris` 归属于应用；应用新增版本不应要求所有客户端重新登记回调。

### 4.2 发布能力

当前已实现：

- 首次注册同时写入应用当前快照和 release 快照
- 携带已有 `uid` 发布更高版本并复用稳定 AppId
- 事务内保存旧快照、新 release 和当前应用快照
- 通过 `(application_uid, version)` 唯一约束禁止覆盖
- 旧的按 `did + version` 查询在当前表未命中时回落到 release 快照
- 应用发布和下架同步更新 release 状态
- 已上线应用提交新版本时保持应用级 `isOnline=true`，release 独立进入 `draft/reviewing`，避免审核期间中断登录授权

后续仍需增加：

- 查询应用当前发布版本
- 查询指定 `appId + version` 的 release
- 撤回指定版本而不删除应用注册
- 后续再设计应用制品签名身份和 verification methods；当前接口不依赖它们

旧的按 `did + version` 查询接口保留兼容，但内部应先解析到稳定应用，再查询 release。

## 5. 迁移步骤

### 阶段一：盘点

对每条已发布应用记录记录：

- `applications.uid`
- `did`
- `version`
- `owner`
- `redirectUris`
- `ucanAudience` / `ucanCapabilities`
- Chat、Router、Warehouse 当前使用的 AppId
- Warehouse 中实际存在的 `/apps/<id>` 目录

如果同一产品存在多个 UID，必须先指定一个保留 AppId，其余 UID 只能作为历史别名。

### 阶段二：建立版本表

1. 新增 `application_releases` 表和唯一约束 `(application_uid, version)`。
2. 为现有 `applications` 行生成对应 release 快照。
3. 保留原 UID，不修改已有授权请求、配置和审计引用。
4. 保留已有 `applications.did` 和历史签名字段；当前不创建或补齐独立 `appDid`。

### 阶段三：切换发布流程

1. 新应用创建一次 `applications` 记录。
2. 新版本只创建 `application_releases` 记录。
3. 发布流程检查 `appId` 所有权、版本不可覆盖和制品 digest；应用制品签名身份留待后续扩展。
4. 应用上下架和回调白名单仍作用于稳定应用；版本发布状态作用于 release。

### 阶段四：切换资源服务

1. Chat Web 和桌面使用相同的稳定 AppId。
2. UCAN capability 使用 `app:all:<appId>`。
3. Warehouse 目录使用 `/apps/<appId>`。
4. Router、Warehouse 和 Node 对新的 capability/issuer 做联调。
5. 旧目录迁移完成前保留只读或显式兼容窗口。

## 6. 回滚条件

出现以下任一情况不得切换生产：

- 同一应用存在多个候选 AppId 但无法确定历史数据归属。
- `authorize/request` 使用新 AppId 后无法命中已有 `redirectUris`。
- Chat Web 与桌面无法读取同一个 Warehouse 目录。
- Router 或 Warehouse 拒绝新的 `app:all:<appId>` capability。
- release 的完整制品签名闭环尚未启用，不应把当前兼容 `signature` 字段当作 appDid 验签结果。

## 7. 验收清单

- 同一应用的两个版本使用同一个 AppId。
- 旧版本仍可按 `appId + version` 查询和回滚。
- 应用升级不改变 WebDAV `/apps/<appId>` 路径。
- 刷新会话不会因为应用版本升级失效。
- Web、桌面、扩展登记的回调都能精确命中。
- Node Registry 签名（如启用）和 UCAN 用户授权边界彼此独立且可审计；应用级签名身份属于后续扩展。

## 8. 当前明确不做的内容

- 不新增或要求独立的 `appDid`。
- 不要求发布者生成应用签名密钥或 verification method。
- 不使用 `appDid` 作为登录 `appId`、Warehouse 目录名或 UCAN capability。
- 不因为版本升级改变现有 `applications.did`、`appId` 或应用空间。
