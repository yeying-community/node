# 核心业务与优先事项

## 核心业务接口分组
- **应用（Application）**：创建/更新、详情、查询、搜索、下架
- **服务（Service）**：创建/更新、详情、查询、搜索、下架
- **审核（Audit）**：提交申请、审批通过/拒绝、撤销、详情、搜索
- **用户/身份（User/State）**：用户详情、状态更新、角色管理（当前未强制）
- **认证/健康检查（Auth/Health）**：登录（SIWE/UCAN）、刷新/登出、健康检查
- **MPC 协调器（MPC）**：会话创建/加入、消息转发、SSE 推送

> 完整接口以 `docs/zh/api.md` 为准。

## MPC 事件分发
- 默认内存事件总线（单实例）。
- 启用 `redis.enabled=true` 后使用 Redis Pub/Sub 跨实例分发（SSE 客户端可跨节点接收）。
- 启用 `redis.streamEnabled=true` 后使用 Redis Streams 保留事件，SSE 可用 `Last-Event-ID` 或 `cursor` 追读。
- 若设置 `redis.streamOnly=true`，SSE 仅通过 Streams 拉取，不再依赖 Pub/Sub。

## 必要的鉴权/权限规则（应落地）
- **统一鉴权**：除 public auth 外，所有接口必须 `Authorization: Bearer <JWT|UCAN>`。
- **UCAN 规则**：`aud == UCAN_AUD`；capabilities 含 `UCAN_RESOURCE/UCAN_ACTION`。
- **资源归属**：
  - 应用/服务只能由 owner 更新、下架、删除。
- **审核权限**：
  - 仅审核人/管理员可 approve/reject。
- **用户状态**：
  - 仅管理员可冻结/解冻；被冻结用户不可发布/审批。
- **上线约束**：
  - 必须审核通过后才能上线；搜索默认仅返回已上线资源。

## 后续应优先完善的模块（建议优先级）
1. **审核流（Audit）**
   - 审核人与权限校验（已落地：仅审批人可审批）
   - 审核结果与资源上线状态联动（已落地）
2. **申请流（Apply）**
   - 申请对象元数据校验（已落地）
   - 重复申请/撤销逻辑（已落地：未结工单不可重复提交）
3. **服务/应用上架下架**
   - 明确状态机（created/audited/online/offline）（已落地）
   - 搜索与展示统一使用状态（已落地）
   - 上/下架接口已具备，继续强化审核门槛与归属校验
4. **权限模型落地**
   - 角色/状态与接口权限绑定
5. **签名校验（部分）**
   - 已对上架申请/审核通过/驳回启用钱包签名（personal_sign）
   - 其他流程暂不强制
