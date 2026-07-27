import { Express, Request, Response } from 'express'
import { getConfig } from '../../config/runtime'
import { ProjectAppInstallationService } from '../../domain/service/projectAppInstallation'
import { AppReleaseService } from '../../domain/service/appRelease'
import { AppRuntimeTaskService } from '../../domain/service/appRuntimeTask'

type ProjectAdapterConfig = {
  defaultInstanceId?: string
  requestTimeoutMs?: number
}

type AppStoreReleaseConfig = {
  artifactDir?: string
}

function releaseArtifactDir(): string {
  return String((getConfig<AppStoreReleaseConfig>('appStoreRelease') || {}).artifactDir || 'data/appstore/releases')
}

type ProjectUserInfoResponse = {
  ret?: number
  data?: { userid?: number | string; identity?: unknown; email?: string; nickname?: string }
}

function resolveInstanceId(req: Request): string {
  const configured = getConfig<ProjectAdapterConfig>('projectAdapter') || {}
  const requested = String(req.header('X-YeYing-Instance') || '').trim()
  return requested || String(configured.defaultInstanceId || '').trim()
}

async function verifyProjectToken(projectApiUrl: string, token: string, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${projectApiUrl.replace(/\/$/, '')}/api/users/info`, {
      headers: { Token: token, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const payload = await response.json() as ProjectUserInfoResponse
    if (payload.ret !== 1 || !payload.data?.userid) return null
    const identity = Array.isArray(payload.data.identity) ? payload.data.identity.map(String) : []
    return { userId: String(payload.data.userid), isAdmin: identity.includes('admin') }
  } finally {
    clearTimeout(timer)
  }
}

async function authenticateProjectRequest(req: Request, res: Response) {
  const instanceId = resolveInstanceId(req)
  const token = String(req.header('Token') || '').trim()
  if (!instanceId || !token) {
    res.status(401).json({ code: 401, data: null, message: 'Missing Project instance or Token' })
    return null
  }
  const service = new ProjectAppInstallationService()
  const instance = await service.getActiveInstance(instanceId)
  if (!instance) {
    res.status(404).json({ code: 404, data: null, message: 'Project instance not found' })
    return null
  }
  const config = getConfig<ProjectAdapterConfig>('projectAdapter') || {}
  try {
    const user = await verifyProjectToken(instance.projectApiUrl, token, config.requestTimeoutMs || 5000)
    if (!user) {
      res.status(401).json({ code: 401, data: null, message: 'Invalid Project Token' })
      return null
    }
    return { instanceId, service, user }
  } catch {
    res.status(502).json({ code: 502, data: null, message: 'Project identity verification failed' })
    return null
  }
}

export function registerInternalAppStoreRoutes(app: Express) {
  app.get('/api/v1/internal/installed', async (req: Request, res: Response) => {
    const context = await authenticateProjectRequest(req, res)
    if (!context) return
    try {
      const installations = await context.service.getInstalled(context.instanceId)
      res.json({
        code: 200,
        data: installations.map((item) => ({
          id: item.appId,
          version: item.installVersion,
          install_at: item.installAt,
          menu_items: item.menuItems,
        })),
      })
    } catch {
      res.status(500).json({ code: 500, data: [], message: 'Failed to load installed applications' })
    }
  })

  app.get('/api/v1/internal/catalog', async (req: Request, res: Response) => {
    const context = await authenticateProjectRequest(req, res)
    if (!context) return
    res.json({
      code: 200,
      data: (await new AppReleaseService().listPublishedManifests(releaseArtifactDir())).map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        minimum_project_version: manifest.minimumProjectVersion,
      })),
    })
  })

  app.post('/api/v1/internal/install', async (req: Request, res: Response) => {
    const context = await authenticateProjectRequest(req, res)
    if (!context) return
    if (!context.user.isAdmin) {
      res.status(403).json({ code: 403, data: null, message: 'Project administrator permission required' })
      return
    }
    const appId = String(req.body?.app_id || '').trim()
    const version = String(req.body?.version || '').trim()
    const manifest = await new AppReleaseService().findPublishedManifest({
      appId,
      version: version || undefined,
      artifactDir: releaseArtifactDir(),
    })
    if (!manifest) {
      res.status(404).json({ code: 404, data: null, message: 'Published application version not found' })
      return
    }
    const release = await new AppReleaseService().findPublishedRelease(manifest.id, manifest.version)
    if (!release) {
      res.status(409).json({ code: 409, data: null, message: 'Published release record not found' })
      return
    }
    try {
      const task = await new AppRuntimeTaskService().requestOperation({
        instanceId: context.instanceId,
        operation: 'install',
        manifest,
        releaseDigest: release.releaseDigest,
      })
      res.status(202).json({
        code: 202,
        data: {
          id: task.appId,
          version: task.targetVersion,
          status: task.status,
          task_id: task.uid,
          requested_by: context.user.userId,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Install request failed'
      const code = message === 'APPLICATION_ALREADY_INSTALLED' ? 409 : 500
      res.status(code).json({ code, data: null, message })
    }
  })

  app.post('/api/v1/internal/upgrade', async (req: Request, res: Response) => {
    const context = await authenticateProjectRequest(req, res)
    if (!context) return
    if (!context.user.isAdmin) {
      res.status(403).json({ code: 403, data: null, message: 'Project administrator permission required' })
      return
    }
    const appId = String(req.body?.app_id || '').trim()
    const version = String(req.body?.version || '').trim()
    const manifest = await new AppReleaseService().findPublishedManifest({ appId, version: version || undefined, artifactDir: releaseArtifactDir() })
    if (!manifest) {
      res.status(404).json({ code: 404, data: null, message: 'Published application version not found' })
      return
    }
    const release = await new AppReleaseService().findPublishedRelease(manifest.id, manifest.version)
    if (!release) {
      res.status(409).json({ code: 409, data: null, message: 'Published release record not found' })
      return
    }
    try {
      const task = await new AppRuntimeTaskService().requestOperation({ instanceId: context.instanceId, operation: 'upgrade', manifest, releaseDigest: release.releaseDigest })
      res.status(202).json({ code: 202, data: { id: task.appId, version: task.targetVersion, status: task.status, task_id: task.uid, requested_by: context.user.userId } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upgrade request failed'
      res.status(message === 'APPLICATION_NOT_INSTALLED' ? 409 : 500).json({ code: message === 'APPLICATION_NOT_INSTALLED' ? 409 : 500, data: null, message })
    }
  })

  app.post('/api/v1/internal/uninstall', async (req: Request, res: Response) => {
    const context = await authenticateProjectRequest(req, res)
    if (!context) return
    if (!context.user.isAdmin) {
      res.status(403).json({ code: 403, data: null, message: 'Project administrator permission required' })
      return
    }
    const appId = String(req.body?.app_id || '').trim()
    try {
      const task = await new AppRuntimeTaskService().requestOperation({ instanceId: context.instanceId, operation: 'uninstall', appId })
      res.status(202).json({ code: 202, data: { id: task.appId, version: task.targetVersion, status: task.status, task_id: task.uid, requested_by: context.user.userId } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Uninstall request failed'
      res.status(message === 'APPLICATION_NOT_INSTALLED' ? 409 : 500).json({ code: message === 'APPLICATION_NOT_INSTALLED' ? 409 : 500, data: null, message })
    }
  })
}
