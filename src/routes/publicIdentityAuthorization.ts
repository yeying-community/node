import { Express, Request, Response } from 'express'
import { fail, ok } from '../auth/envelope'
import { IdentityAuthorizationService } from '../domain/service/identityAuthorization'
import { getPasskeyAuthStatus } from '../auth/identityPasskeyAuth'

function handle(error: unknown, res: Response) {
  const message = error instanceof Error ? error.message : 'Identity authorization failed'
  const explicit = Number((error as { status?: unknown })?.status)
  const status = Number.isInteger(explicit) && explicit >= 400 && explicit <= 599 ? explicit : message.includes('NOT_FOUND') ? 404 : message.includes('EXPIRED') ? 410 : message.includes('UNAUTHORIZED') || message.includes('MISMATCH') || message.includes('INVALID') || message.includes('CONTEXT') || message.includes('REQUIRED') || message.includes('PASSKEY') || message.includes('WebAuthn') || message.includes('origin') || message.includes('RPID') || message.includes('challenge') ? 400 : 503
  res.status(status).json(fail(status, message))
}

export function registerPublicIdentityAuthorizationRoutes(app: Express) {
  const service = new IdentityAuthorizationService()
  app.get('/identity/authorize', (_req: Request, res: Response) => {
    res.type('html').send(identityAuthorizePage())
  })
  app.get('/api/v1/public/identity/status', (_req: Request, res: Response) => {
    res.json(ok({ passkey: getPasskeyAuthStatus() }))
  })
  app.post('/api/v1/public/identity/authorize/request', async (req: Request, res: Response) => {
    try { res.json(ok(await service.create({ appId: req.body?.appId, redirectUri: req.body?.redirectUri, state: req.body?.state, codeChallenge: req.body?.codeChallenge ?? req.body?.code_challenge, codeChallengeMethod: req.body?.codeChallengeMethod ?? req.body?.code_challenge_method, scopes: req.body?.scopes ?? req.body?.scope }))) } catch (error) { handle(error, res) }
  })
  app.get('/api/v1/public/identity/authorize/request/:requestId', async (req: Request, res: Response) => {
    try { res.json(ok(await service.get(req.params.requestId))) } catch (error) { handle(error, res) }
  })
  app.post('/api/v1/public/identity/authorize/approve', async (req: Request, res: Response) => {
    try {
      if (req.body?.credential || req.body?.passkeyRequestId || req.body?.challengeId) {
        res.json(ok(await service.confirmPasskeyAuthorization({ requestId: req.body?.requestId, passkeyRequestId: req.body?.passkeyRequestId ?? req.body?.challengeId, credential: req.body?.credential })))
        return
      }
      res.json(ok(await service.approve({ requestId: req.body?.requestId, presentation: req.body?.presentation })))
    } catch (error) { handle(error, res) }
  })
  app.post('/api/v1/public/identity/authorize/challenge', async (req: Request, res: Response) => {
    try { res.json(ok(await service.createPasskeyAuthorizationChallenge({ requestId: req.body?.requestId }))) } catch (error) { handle(error, res) }
  })
  app.post('/api/v1/public/identity/authorize/exchange', async (req: Request, res: Response) => {
    try { res.json(ok(await service.exchange({ code: req.body?.code, appId: req.body?.appId, redirectUri: req.body?.redirectUri, codeVerifier: req.body?.codeVerifier ?? req.body?.code_verifier }))) } catch (error) { handle(error, res) }
  })
  app.post('/api/v1/public/identity/passkeys/register/request', async (req: Request, res: Response) => {
    try { res.json(ok(await service.createPasskeyRegisterRequest({ identity: req.body?.identity, identityDocument: req.body?.identityDocument, deviceName: req.body?.deviceName }))) } catch (error) { handle(error, res) }
  })
  app.post('/api/v1/public/identity/passkeys/register/confirm', async (req: Request, res: Response) => {
    try { res.json(ok(await service.confirmPasskeyRegistration({ identity: req.body?.identity, requestId: req.body?.requestId, credential: req.body?.credential, deviceName: req.body?.deviceName, requestOrigin: req.headers.origin }))) } catch (error) { handle(error, res) }
  })
  app.post('/api/v1/public/identity/passkeys/list', async (req: Request, res: Response) => {
    try { res.json(ok(await service.listPasskeyCredentials({ identity: req.body?.identity }))) } catch (error) { handle(error, res) }
  })
  app.post('/api/v1/public/identity/passkeys/revoke', async (req: Request, res: Response) => {
    try { res.json(ok(await service.revokePasskeyCredential({ identity: req.body?.identity, identityDocument: req.body?.identityDocument, credentialId: req.body?.credentialId }))) } catch (error) { handle(error, res) }
  })
}

function identityAuthorizePage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>夜莺钱包身份授权</title>
  <style>
    :root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f6f7f9}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
    main{width:min(420px,100%);background:#fff;border:1px solid #d9dee8;border-radius:8px;padding:24px;box-shadow:0 10px 28px rgba(15,23,42,.08)}
    h1{font-size:20px;margin:0 0 8px}
    p{font-size:14px;line-height:1.6;margin:8px 0;color:#526075}
    dl{display:grid;grid-template-columns:72px 1fr;gap:8px 12px;margin:18px 0;font-size:13px}
    dt{color:#68758a}dd{margin:0;word-break:break-word}
    button{width:100%;height:42px;border:0;border-radius:6px;background:#1f6feb;color:white;font-size:15px;cursor:pointer}
    button:disabled{opacity:.6;cursor:not-allowed}
    .status{min-height:22px;margin-top:12px;color:#9a3412}
    .ok{color:#166534}
    @media (prefers-color-scheme:dark){:root{background:#111827;color:#e5e7eb}main{background:#172033;border-color:#334155}p,dt{color:#aab4c4}}
  </style>
</head>
<body>
<main>
  <h1>钱包身份授权</h1>
  <p>使用设备 Passkey 确认当前 Web3 应用登录。确认后应用将只能获得本次请求范围内的钱包身份信息。</p>
  <dl>
    <dt>应用</dt><dd id="appName">-</dd>
    <dt>范围</dt><dd id="scopes">-</dd>
    <dt>状态</dt><dd id="requestStatus">读取中</dd>
  </dl>
  <button id="approve" disabled>使用 Passkey 确认</button>
  <p id="status" class="status"></p>
</main>
<script>
const requestId = new URLSearchParams(location.search).get('requestId') || new URLSearchParams(location.search).get('request_id') || '';
const $ = (id) => document.getElementById(id);
function b64ToBuf(value){const s=String(value||'').replace(/-/g,'+').replace(/_/g,'/');const bin=atob(s.padEnd(s.length+((4-s.length%4)%4),'='));const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out.buffer}
function bufToB64(value){if(!value)return '';const bytes=new Uint8Array(value);let bin='';for(const b of bytes)bin+=String.fromCharCode(b);return btoa(bin).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')}
async function parse(res){const json=await res.json().catch(()=>({}));if(!res.ok||json.code!==0)throw new Error(json.message||res.statusText);return json.data}
async function load(){if(!requestId)throw new Error('缺少授权请求 ID');const data=await parse(await fetch('/api/v1/public/identity/authorize/request/'+encodeURIComponent(requestId)));$('appName').textContent=data.appName||data.appId||'-';$('scopes').textContent=(data.scopes||[]).join(', ');$('requestStatus').textContent=data.status||'-';$('approve').disabled=data.status!=='pending'}
async function approve(){
  $('approve').disabled=true;$('status').className='status';$('status').textContent='正在打开 Passkey 确认...';
  try{
    if(!window.PublicKeyCredential||!navigator.credentials)throw new Error('当前浏览器或设备不支持 Passkey');
    const challenge=await parse(await fetch('/api/v1/public/identity/authorize/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId})}));
    const req=challenge.passkeyRequest;
    const credential=await navigator.credentials.get({publicKey:{challenge:b64ToBuf(req.challenge),rpId:req.rpId,timeout:req.timeout,allowCredentials:(req.allowCredentials||[]).map(x=>({id:b64ToBuf(x.id),type:'public-key',transports:x.transports})),userVerification:req.userVerification}});
    if(!credential)throw new Error('Passkey 未返回凭证');
    const r=credential.response;
    const payload={id:credential.id,rawId:bufToB64(credential.rawId),type:credential.type,response:{authenticatorData:bufToB64(r.authenticatorData),clientDataJSON:bufToB64(r.clientDataJSON),signature:bufToB64(r.signature),userHandle:bufToB64(r.userHandle)},clientExtensionResults:credential.getClientExtensionResults()};
    const approved=await parse(await fetch('/api/v1/public/identity/authorize/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,passkeyRequestId:req.requestId,credential:payload})}));
    $('status').className='status ok';$('status').textContent='已确认，正在返回应用...';
    location.href=approved.redirectTo;
  }catch(error){$('status').textContent=error.message||'授权失败';$('approve').disabled=false}
}
$('approve').addEventListener('click',approve);
load().catch(error=>{$('requestStatus').textContent='不可用';$('status').textContent=error.message||'授权请求不可用'});
</script>
</body>
</html>`
}
