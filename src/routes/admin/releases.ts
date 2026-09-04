import { Express, Request, Response } from 'express'
import { fail, ok } from '../../auth/envelope'
import { AppReleaseService } from '../../domain/service/appRelease'
import { executeSignedAction, getActionSignatureErrorStatus } from '../../auth/actionSignature'
import { getRequestUser } from '../../common/requestContext'

function registerTransition(app: Express, action: string, targetStatus: string) {
  app.post(`/api/v1/admin/releases/:uid/${action}`, async (req: Request, res: Response) => {
    try {
      const user = getRequestUser()
      if (!user?.address) { res.status(401).json(fail(401, 'Missing access token')); return }
      const uid = String(req.params.uid || '')
      const result = await executeSignedAction({
        raw: req.body || {}, action: `admin_release_${action}`, actor: user.address,
        payload: { releaseId: uid, targetStatus },
        execute: async () => {
          const release = await new AppReleaseService().transition(uid, targetStatus)
          return { status: 200, body: ok({ release_id: release.uid, app_id: release.appId, version: release.version, status: release.status }) }
        },
        onError: error => { const message = error instanceof Error ? error.message : 'Release transition failed'; const status = getActionSignatureErrorStatus(message) ?? 500; return { status, body: fail(status, message) } }
      })
      res.status(result.status).json(result.body)
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
