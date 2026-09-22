import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { computeReleaseDigest } from '../src/appstore/release/validator'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { AppReleaseDO } from '../src/domain/mapper/entity'
import { AppReleaseService } from '../src/domain/service/appRelease'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function createStoredFiles() {
  const files: Record<string, string> = {
    'application.json': JSON.stringify({
      metadata: { id: 'ai', name: { 'zh-CN': 'AI' } },
      spec: {
        version: '0.1.0',
        host: { project: '>=1.0.0' },
        entries: [],
      },
    }),
    'runtime.json': '{}',
    'config.schema.json': '{}',
    'permissions.json': '{}',
    'compose.yaml': 'services: {}',
  }
  const checksums = Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, sha256(content)]),
  )
  files['checksums.json'] = JSON.stringify(checksums)
  files['signature.json'] = '{}'
  return {
    files,
    releaseDigest: computeReleaseDigest(files),
  }
}

describe('published release artifact integrity', () => {
  it('rejects an artifact whose stored file no longer matches the release digest', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yeying-node-release-'))
    const stored = createStoredFiles()
    const relativePath = 'ai/0.1.0/release.json'
    const artifactPath = path.join(artifactDir, relativePath)
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
    fs.writeFileSync(artifactPath, JSON.stringify({ files: stored.files }))

    await dataSource.getRepository(AppReleaseDO).save({
      uid: 'release-integrity-1',
      appId: 'ai',
      version: '0.1.0',
      publisher: '0x1111111111111111111111111111111111111111',
      publisherKeyId: 'publisher-1',
      releaseDigest: stored.releaseDigest,
      image: 'ghcr.io/yeying-community/ai@sha256:' + 'a'.repeat(64),
      status: 'published',
      artifactPath: relativePath,
      validationJson: '{}',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })

    try {
      const service = new AppReleaseService()
      await expect(service.getPublishedArtifact({
        appId: 'ai',
        version: '0.1.0',
        artifactDir,
      })).resolves.toMatchObject({
        release: { releaseDigest: stored.releaseDigest },
        files: stored.files,
      })

      const tamperedFiles = {
        ...stored.files,
        'permissions.json': '{"host_api":["project.admin"]}',
      }
      fs.writeFileSync(artifactPath, JSON.stringify({ files: tamperedFiles }))

      await expect(service.getPublishedArtifact({
        appId: 'ai',
        version: '0.1.0',
        artifactDir,
      })).rejects.toThrow('checksum mismatch')
    } finally {
      fs.rmSync(artifactDir, { recursive: true, force: true })
    }
  })
})
