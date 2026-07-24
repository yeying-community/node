import crypto from 'crypto'
import { Express, Request, Response } from 'express'
import { getConfig } from '../../config/runtime'
import { AppStoreAgentRuntimeConfig } from '../../config'
import { AppRuntimeTaskService } from '../../domain/service/appRuntimeTask'
import { AppReleaseService } from '../../domain/service/appRelease'

function authenticateAgent(req: Request, res: Response) {
  const instanceId = String(req.header('X-YeYing-Instance') || '').trim()
  const agentId = String(req.header('X-YeYing-Agent') || '').trim()
  const authorization = String(req.header('Authorization') || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  const configured = (getConfig<AppStoreAgentRuntimeConfig>('appStoreAgent') || {}).instances?.[instanceId]
  if (!instanceId || !agentId || !token || !configured || !/^[a-f0-9]{64}$/.test(configured.tokenSha256)) {
    res.status(401).json({ code: 401, message: 'Invalid Runtime Agent credentials', data: null })
    return null
  }
  const actual = Buffer.from(crypto.createHash('sha256').update(token).digest('hex'))
  const expected = Buffer.from(configured.tokenSha256)
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    res.status(401).json({ code: 401, message: 'Invalid Runtime Agent credentials', data: null })
    return null
  }
  return { instanceId, agentId, leaseSeconds: Math.max(15, Math.min(300, configured.leaseSeconds || 60)) }
}

function taskData(task: { uid: string; appId: string; operation: string; targetVersion: string; releaseDigest: string; status: string; leaseExpiresAt: string; revision: number }) {
  return {
    task_id: task.uid, app_id: task.appId, operation: task.operation,
    target_version: task.targetVersion, release_digest: task.releaseDigest,
    status: task.status, lease_expires_at: task.leaseExpiresAt, revision: task.revision,
  }
}

function runtimeError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : 'Runtime task failed'
  if (message === 'TASK_NOT_FOUND') return res.status(404).json({ code: 404, message, data: null })
  if (message === 'TASK_LEASE_CONFLICT' || message === 'TASK_NOT_ACTIVE' || message === 'INVALID_TASK_TRANSITION') {
    return res.status(409).json({ code: 409, message, data: null })
  }
  if (message === 'TASK_SUCCESS_UNVERIFIED') return res.status(422).json({ code: 422, message, data: null })
  return res.status(500).json({ code: 500, message: 'Runtime task failed', data: null })
}

export function registerRuntimeTaskRoutes(app: Express) {
  app.post('/api/v1/runtime/tasks/claim', async (req, res) => {
    const agent = authenticateAgent(req, res)
    if (!agent) return
    try {
      const task = await new AppRuntimeTaskService().claim(agent.instanceId, agent.agentId, agent.leaseSeconds)
      res.json({ code: 200, message: 'ok', data: task ? taskData(task) : null })
    } catch (error) { runtimeError(res, error) }
  })
  app.post('/api/v1/runtime/tasks/:uid/heartbeat', async (req, res) => {
    const agent = authenticateAgent(req, res)
    if (!agent) return
    try {
      const task = await new AppRuntimeTaskService().heartbeat(agent.instanceId, agent.agentId, req.params.uid, Number(req.body?.revision), agent.leaseSeconds)
      res.json({ code: 200, message: 'ok', data: taskData(task) })
    } catch (error) { runtimeError(res, error) }
  })
  app.post('/api/v1/runtime/tasks/:uid/release', async (req, res) => {
    const agent = authenticateAgent(req, res)
    if (!agent) return
    try {
      const task = await new AppRuntimeTaskService().release(agent.instanceId, agent.agentId, req.params.uid, Number(req.body?.revision))
      res.json({ code: 200, message: 'ok', data: taskData(task) })
    } catch (error) { runtimeError(res, error) }
  })
  app.post('/api/v1/runtime/tasks/:uid/report', async (req, res) => {
    const agent = authenticateAgent(req, res)
    if (!agent) return
    try {
      const task = await new AppRuntimeTaskService().report({
        instanceId: agent.instanceId, agentId: agent.agentId, taskId: req.params.uid,
        revision: Number(req.body?.revision), status: String(req.body?.status || ''), result: req.body?.result,
      })
      res.json({ code: 200, message: 'ok', data: taskData(task) })
    } catch (error) { runtimeError(res, error) }
  })
  app.get('/api/v1/runtime/releases/:appId/:version', async (req, res) => {
    const agent = authenticateAgent(req, res)
    if (!agent) return
    try {
      const config = getConfig<{ artifactDir?: string }>('appStoreRelease') || {}
      const artifact = await new AppReleaseService().getPublishedArtifact({
        appId: req.params.appId,
        version: req.params.version,
        artifactDir: String(config.artifactDir || 'data/appstore/releases'),
      })
      if (!artifact) {
        res.status(404).json({ code: 404, message: 'Published release not found', data: null })
        return
      }
      res.json({ code: 200, message: 'ok', data: {
        app_id: artifact.release.appId,
        version: artifact.release.version,
        release_digest: artifact.release.releaseDigest,
        files: artifact.files,
      } })
    } catch {
      res.status(500).json({ code: 500, message: 'Release retrieval failed', data: null })
    }
  })
}
