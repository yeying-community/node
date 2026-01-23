# Business Workflows (Detailed)

This section describes the core market workflows and key implementation details.

## 1) Application Publish
```mermaid
sequenceDiagram
  actor U as Publisher
  participant FE as Frontend
  participant BE as Backend
  participant DB as Database

  U ->> FE: Fill application form
  FE ->> BE: POST /api/v1/application/create
  BE ->> DB: Save applications (is_online defaults to true)
  BE -->> FE: Success
```

### Notes
- `applications.is_online` is set to `true` on create (`convertApplicationTo`).
- Audit approval is **not enforced** before going online.

### Application Lifecycle (Target Model)
> Note: this is a logical state machine; current implementation only uses `is_online`.
```mermaid
stateDiagram-v2
  [*] --> CREATED
  CREATED --> AUDITED: approved
  CREATED --> REFUSED: rejected
  AUDITED --> ONLINE: publish
  ONLINE --> OFFLINE: unpublish
  OFFLINE --> ONLINE: republish
  REFUSED --> CREATED: resubmit
```

## 2) Service Publish
```mermaid
sequenceDiagram
  actor U as Publisher
  participant FE as Frontend
  participant BE as Backend
  participant DB as Database

  U ->> FE: Fill service form
  FE ->> BE: POST /api/v1/service/create
  BE ->> DB: Save services (is_online defaults to true)
  BE -->> FE: Success
```

### Notes
- `services.is_online` is set to `true` on create (`convertServiceTo`).
- Online state is currently decoupled from audit results.

### Service Lifecycle (Target Model)
```mermaid
stateDiagram-v2
  [*] --> CREATED
  CREATED --> AUDITED: approved
  CREATED --> REFUSED: rejected
  AUDITED --> ONLINE: publish
  ONLINE --> OFFLINE: unpublish
  OFFLINE --> ONLINE: republish
  REFUSED --> CREATED: resubmit
```

## 3) Audit Flow (Apply & Review)
```mermaid
flowchart TD
  A[Submit application
/audit/create]
  B[Create audits ticket]
  C[Reviewer views
/audit/search]
  D{Decision}
  E[/audit/approve]
  F[/audit/reject]
  G[Write comments
and update audits]

  A --> B --> C --> D
  D -- Approve --> E --> G
  D -- Reject --> F --> G
```

### Notes
- `audits.app_or_service_metadata` stores the target metadata JSON.
- `comments.status` supports `AGREE` / `REJECT` only.
- Audit results currently do **not** automatically toggle `is_online`.

## 4) Search & Filter Flow
```mermaid
flowchart TD
  A[Search condition]
  B{Has keyword?}
  C[Search by keyword + is_online=true]
  D[Search by name/owner/code]
  E[No condition => is_online=true]

  A --> B
  B -- Yes --> C
  B -- No --> D
  D --> E
```

### Notes
- With keyword, `is_online=true` is enforced.
- With no condition, `is_online=true` is enforced.
- With name/owner/code filters, `is_online` is **not enforced** today.

## 5) Auth & Permission
- All business APIs require `Authorization: Bearer <JWT|UCAN>`.
- UCAN `aud` must match server `UCAN_AUD` exactly, otherwise 401.
- Role/status checks and signature verification are **not enforced** (see `permissions.md`).
