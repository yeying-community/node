import { Express, Request, Response } from 'express'
import { fail, ok } from '../../auth/envelope'
import { AppReleaseService } from '../../domain/service/appRelease'

function registerTransition(app: Express, action: string, targetStatus: string) {
  app.post(`/api/v1/admin/releases/:uid/${action}`, async (req: Request, res: Response) => {
    try {
      const release = await new AppReleaseService().transition(String(req.params.uid || ''), targetStatus)
      res.json(ok({
        release_id: release.uid,
        app_id: release.appId,
        version: release.version,
        status: release.status,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Release transition failed'
      if (message === 'RELEASE_NOT_FOUND') {
        res.status(404).json(fail(404, 'Release not found'))
        return
      }
      if (message === 'INVALID_RELEASE_TRANSITION') {
        res.status(409).json(fail(409, 'Invalid release status transition'))
        return
      }
      res.status(500).json(fail(500, 'Release transition failed'))
    }
  })
}

export function registerAdminReleaseRoutes(app: Express) {
  registerTransition(app, 'approve', 'approved')
  registerTransition(app, 'reject', 'rejected')
  registerTransition(app, 'publish', 'published')
  registerTransition(app, 'withdraw', 'withdrawn')
}
