# YeYing AppStore Smoke Test Runbook

This runbook verifies the first real AppStore V1 loop:

```text
Publisher release -> Node approve/publish -> Project install/upgrade/uninstall proxy -> Runtime Agent claim -> Docker Compose -> healthcheck -> local Project menu state
```

## 1. Prerequisites

- Node contains the Runtime Task lifecycle changes from PR #49.
- Project contains the AppStore proxy changes from Project PR #21.
- Project `.env` has `APPSTORE_INTERNAL_URL`, `APPSTORE_INSTANCE_ID`, `APPSTORE_AGENT_ID` and `APPSTORE_AGENT_TOKEN`.
- Node `config.js` has the same instance ID under `appStoreAgent.instances`.
- The smoke image must be a real immutable digest reference, for example `registry.example/smoke@sha256:<64 hex>`. Floating tags are rejected by the release validator.

Generate the Agent token hash for Node:

```bash
printf '%s' "$APPSTORE_AGENT_TOKEN" | sha256sum | awk '{print $1}'
```

Configure Node:

```js
appStoreAgent: {
  instances: {
    'project-production': { tokenSha256: '<sha256>', leaseSeconds: 300 }
  }
}
```

## 2. Create A Smoke Release

From the Node repository:

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

Paste the printed public key into `config.js`:

```js
appStoreRelease: {
  publisherKeys: {
    'smoke-publisher': { owner: '0xYourPublisherWallet', publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n' }
  }
}
```

Restart Node after changing `config.js`.

## 3. Submit, Approve And Publish

Use a Node access token for the same publisher wallet:

```bash
curl -fsS -X POST "$NODE_URL/api/v1/publisher/releases/submit" \
  -H "Authorization: Bearer $NODE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @tmp/smoke-0.1.0.json
```

Capture `release_id`, then publish it:

```bash
curl -fsS -X POST "$NODE_URL/api/v1/admin/releases/$RELEASE_ID/approve"
curl -fsS -X POST "$NODE_URL/api/v1/admin/releases/$RELEASE_ID/publish"
```

## 4. Install Through Project

Use a Project admin token:

```bash
curl -fsS -X POST "$PROJECT_URL/api/appstore/install" \
  -H "Token: $PROJECT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"app_id":"smoke","version":"0.1.0"}'
```

On the Project server:

```bash
cd /opt/deploy/project
scripts/appstore-agent.sh --dry-run
scripts/appstore-agent.sh --once
```

Verify:

```bash
test -f docker/appstore/config/smoke/config.yml
test -f docker/appstore/config/smoke/nginx.conf
docker compose -p yeying-app-smoke ps
curl -fsS http://127.0.0.1:25080/
```

Refresh Project and confirm the smoke app appears in the Application page.

## 5. Upgrade And Rollback

Create and publish `0.1.1` with the same healthy image and route:

```bash
node scripts/create-appstore-smoke-release.cjs \
  --app-id smoke \
  --version 0.1.1 \
  --image registry.example/smoke@sha256:<64 hex> \
  --publisher-key-id smoke-publisher \
  --publisher-owner 0xYourPublisherWallet \
  --host-port 25080 \
  --container-port 8080 \
  --health-path / \
  --out tmp/smoke-0.1.1.json
```

Submit, approve and publish it, then request upgrade:

```bash
curl -fsS -X POST "$PROJECT_URL/api/appstore/upgrade" \
  -H "Token: $PROJECT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"app_id":"smoke","version":"0.1.1"}'

cd /opt/deploy/project
scripts/appstore-agent.sh --once
```

For rollback verification, publish `0.1.2` with an intentionally bad health path:

```bash
node scripts/create-appstore-smoke-release.cjs \
  --app-id smoke \
  --version 0.1.2 \
  --image registry.example/smoke@sha256:<64 hex> \
  --publisher-key-id smoke-publisher \
  --publisher-owner 0xYourPublisherWallet \
  --host-port 25080 \
  --container-port 8080 \
  --health-path /__missing_healthcheck__ \
  --out tmp/smoke-0.1.2-bad.json
```

After requesting upgrade and running the Agent, Node should end the task as `rolled_back`, and Project local state should still point at the previous healthy release.

## 6. Uninstall

```bash
curl -fsS -X POST "$PROJECT_URL/api/appstore/uninstall" \
  -H "Token: $PROJECT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"app_id":"smoke"}'

cd /opt/deploy/project
scripts/appstore-agent.sh --once
```

Verify:

```bash
test ! -d docker/appstore/config/smoke
docker compose -p yeying-app-smoke ps
```

The Runtime Agent uses `down --remove-orphans` and does not delete named volumes by default.
