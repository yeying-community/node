import path from 'path'
import { Express, Request, Response } from 'express'
import { fail, ok } from '../../auth/envelope'
import { getRequestUser } from '../../common/requestContext'
import { ensureUserActive, ensureUserCanWriteBusinessData } from '../../common/permission'
import { getConfig } from '../../config/runtime'
import { AppStoreReleaseRuntimeConfig } from '../../config'
import { validateReleaseBundle } from '../../appstore/release/validator'
import { AppReleaseService } from '../../domain/service/appRelease'

function normalizeFiles(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result: Record<string, string> = {}
  for (const [name, content] of Object.entries(value as Record<string, unknown>)) {
    if (typeof content !== 'string') return null
    result[name] = content
  }
  return result
}

export function registerPublisherReleaseRoutes(app: Express) {
  app.post('/api/v1/publisher/releases/submit', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser()
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'))
        return
      }
      await ensureUserActive(user.address)
      await ensureUserCanWriteBusinessData(user.address)
      const files = normalizeFiles(req.body?.files)
      const keyId = String(req.body?.publisher_key_id || '').trim()
      if (!files || !keyId) {
        res.status(400).json(fail(400, 'Missing release files or publisher_key_id'))
        return
      }
      const config = getConfig<AppStoreReleaseRuntimeConfig>('appStoreRelease') || {}
      const publisherKey = config.publisherKeys?.[keyId]
      if (!publisherKey || publisherKey.owner.toLowerCase() !== user.address.toLowerCase()) {
        res.status(403).json(fail(403, 'Publisher key is not registered for current user'))
        return
      }
      const bundleBytes = Buffer.byteLength(JSON.stringify(files))
      if (bundleBytes > (config.maxBundleBytes || 2 * 1024 * 1024)) {
        res.status(413).json(fail(413, 'Release bundle is too large'))
        return
      }
      const validation = validateReleaseBundle(
        { files },
        { trustedPublisherKeys: { [keyId]: publisherKey.publicKey } },
      )
      const artifactDir = path.resolve(config.artifactDir || 'data/appstore/releases')
      const release = await new AppReleaseService().submit({
        publisher: user.address,
        publisherKeyId: keyId,
        artifactDir,
        files,
        validation,
      })
      res.status(202).json(ok({
        release_id: release.uid,
        app_id: release.appId,
        version: release.version,
        release_digest: release.releaseDigest,
        status: release.status,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Release submission failed'
      if (message === 'RELEASE_VERSION_IMMUTABLE') {
        res.status(409).json(fail(409, 'Application version already exists with another digest'))
        return
      }
      if (message.startsWith('Invalid release bundle:')) {
        res.status(422).json(fail(422, message))
        return
      }
      res.status(500).json(fail(500, 'Release submission failed'))
    }
  })
}
