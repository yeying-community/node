import { describe, expect, it } from 'vitest'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { ApplicationDO, ApplicationReleaseDO } from '../src/domain/mapper/entity'
import { ApplicationReleaseService } from '../src/domain/service/applicationRelease'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'

function applicationRecord(overrides: Partial<ApplicationDO> = {}): ApplicationDO {
  return {
    uid: 'application-1',
    owner: '0x1111111111111111111111111111111111111111',
    ownerName: 'Owner',
    network: 'ethereum',
    address: '',
    did: 'did:app:application-1',
    version: 2,
    name: 'Test application',
    description: 'Application description',
    code: 'APPLICATION_CODE_TEST',
    location: 'https://app.example.com',
    serviceCodes: 'svc-a',
    redirectUris: 'https://app.example.com/callback',
    ucanAudience: 'app:all:application-1',
    ucanCapabilities: '[{"with":"app:all:application-1","can":"invoke"}]',
    avatar: '',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    signature: '',
    codePackagePath: '',
    status: 'BUSINESS_STATUS_ONLINE',
    isOnline: true,
    ...overrides,
  } as ApplicationDO
}

function releaseRecord(version: number, status: string): ApplicationReleaseDO {
  return {
    uid: `release-${version}`,
    applicationUid: 'application-1',
    version,
    metadataJson: JSON.stringify({
      uid: 'application-1',
      owner: '0x1111111111111111111111111111111111111111',
      ownerName: 'Owner',
      did: 'did:app:application-1',
      version,
      name: `Test application v${version}`,
      description: `Version ${version}`,
      code: 'APPLICATION_CODE_TEST',
      location: 'https://app.example.com',
      serviceCodes: 'svc-a',
      redirectUris: 'https://app.example.com/callback',
      ucanAudience: 'app:all:application-1',
      ucanCapabilities: '[{"with":"app:all:application-1","can":"invoke"}]',
    }),
    releaseDigest: `sha256:${String(version).padStart(64, '0')}`,
    signature: `signature-${version}`,
    status,
    createdAt: `2026-09-0${version}T00:00:00.000Z`,
    updatedAt: `2026-09-0${version}T00:00:00.000Z`,
  } as ApplicationReleaseDO
}

describe('application release lifecycle', () => {
  it('lists and resolves releases by the stable application uid and version', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    await dataSource.getRepository(ApplicationDO).save(applicationRecord())
    await dataSource.getRepository(ApplicationReleaseDO).save(releaseRecord(1, 'published'))
    await dataSource.getRepository(ApplicationReleaseDO).save(releaseRecord(2, 'draft'))

    const service = new ApplicationReleaseService()
    const releases = await service.listByApplicationUid('application-1')
    const versionOne = await service.getByApplicationVersion('application-1', 1)

    expect(releases.map((item) => item.version)).toEqual([2, 1])
    expect(releases[0]).toMatchObject({
      applicationUid: 'application-1',
      version: 2,
      status: 'draft',
      releaseDigest: expect.stringMatching(/^sha256:/),
    })
    expect(versionOne?.application).toMatchObject({
      uid: 'application-1',
      version: 1,
      name: 'Test application v1',
      isOnline: true,
    })
  })

  it('withdraws the current published release and keeps the application registration', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    await dataSource.getRepository(ApplicationDO).save(applicationRecord({ version: 1 }))
    await dataSource.getRepository(ApplicationReleaseDO).save(releaseRecord(1, 'published'))

    const release = await new ApplicationReleaseService().withdrawVersion('application-1', 1)

    expect(release.status).toBe('withdrawn')
    expect(await dataSource.getRepository(ApplicationDO).findOneBy({ uid: 'application-1' })).toMatchObject({
      uid: 'application-1',
      did: 'did:app:application-1',
      version: 1,
      status: 'BUSINESS_STATUS_OFFLINE',
      isOnline: false,
    })
    expect(await dataSource.getRepository(ApplicationReleaseDO).findOneBy({ uid: 'release-1' })).toMatchObject({
      applicationUid: 'application-1',
      version: 1,
      status: 'withdrawn',
    })
  })

  it('withdraws an older release without taking a newer published version offline', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    await dataSource.getRepository(ApplicationDO).save(applicationRecord({ version: 2 }))
    await dataSource.getRepository(ApplicationReleaseDO).save(releaseRecord(1, 'published'))
    await dataSource.getRepository(ApplicationReleaseDO).save(releaseRecord(2, 'published'))

    await new ApplicationReleaseService().withdrawVersion('application-1', 1)

    expect(await dataSource.getRepository(ApplicationReleaseDO).findOneBy({ uid: 'release-1' })).toMatchObject({
      status: 'withdrawn',
    })
    expect(await dataSource.getRepository(ApplicationReleaseDO).findOneBy({ uid: 'release-2' })).toMatchObject({
      status: 'published',
    })
    expect(await dataSource.getRepository(ApplicationDO).findOneBy({ uid: 'application-1' })).toMatchObject({
      status: 'BUSINESS_STATUS_ONLINE',
      isOnline: true,
    })
  })

  it('rejects withdrawing a release that is not currently published', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    await dataSource.getRepository(ApplicationDO).save(applicationRecord())
    await dataSource.getRepository(ApplicationReleaseDO).save(releaseRecord(2, 'draft'))

    await expect(new ApplicationReleaseService().withdrawVersion('application-1', 2))
      .rejects.toThrow('RELEASE_NOT_PUBLISHED')
  })
})
