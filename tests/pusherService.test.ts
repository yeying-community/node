import { describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'

vi.mock('../src/security/secretVault', () => ({
  getDerivedRuntimeSecret: () => 'pusher-app-master-key-for-test',
  getRuntimeSecret: () => '',
}))

vi.mock('../src/domain/service/pusherEvents', () => ({
  publishPusherEvent: vi.fn(),
}))

import {
  buildPusherPublishSignature,
  buildPusherStandardSignature,
  decryptPusherAppSecret,
  encryptPusherAppSecret,
  PusherService,
} from '../src/domain/service/pusher'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { IdentityAccountLinkDO, PusherAppDO, PusherChannelAclDO } from '../src/domain/mapper/entity'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'

describe('pusher service helpers', () => {
  it('encrypts and decrypts pusher app secrets with the configured master key', () => {
    const ciphertext = encryptPusherAppSecret('ps_secret-value-123')
    expect(ciphertext).toMatch(/^v1\./)
    expect(ciphertext).not.toContain('ps_secret-value-123')
    expect(decryptPusherAppSecret(ciphertext)).toBe('ps_secret-value-123')
  })

  it('builds deterministic sha256 publish signatures with canonical JSON', () => {
    const signature = buildPusherPublishSignature({
      timestamp: '2026-09-01T00:00:00.000Z',
      body: {
        type: 'task.updated',
        channels: ['private-user.0x1'],
        data: {
          status: 'done',
          taskId: 123,
        },
      },
      secret: 'ps_secret-value-123',
    })
    expect(signature).toBe('sha256=d76205d19074f16bb3177375908afbfa4d8f5f7401266fd66a71e3d03ac944e2')
  })

  it('accepts standard Pusher HTTP publish signatures and converts the payload', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    const service = new PusherService()
    const created = await service.createApp({
      appId: 'project-standard',
      channelPatterns: ['public-*'],
    })
    const body = {
      name: 'task.updated',
      channels: ['public-project'],
      data: JSON.stringify({ taskId: 123, status: 'done' }),
      socket_id: '123.456',
    }
    const rawBody = JSON.stringify(body)
    const authTimestamp = Math.floor(Date.now() / 1000).toString()
    const bodyMd5 = crypto.createHash('md5').update(rawBody).digest('hex')
    const authSignature = buildPusherStandardSignature({
      path: '/apps/project-standard/events',
      authKey: created.key,
      authTimestamp,
      authVersion: '1.0',
      bodyMd5,
      secret: created.secret,
    })

    await expect(service.publishStandard({
      appId: 'project-standard',
      authKey: created.key,
      authTimestamp,
      authVersion: '1.0',
      bodyMd5,
      authSignature,
      body,
      rawBody,
      path: '/apps/project-standard/events',
    })).resolves.toMatchObject({
      accepted: true,
      channels: ['public-project'],
      persisted: false,
    })
  })

  it('accepts the singular channel field used by the Laravel Pusher SDK', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    const service = new PusherService()
    const created = await service.createApp({
      appId: 'project-single-channel',
      channelPatterns: ['public-*'],
    })
    const body = {
      name: 'task.updated',
      channel: 'public-project',
      data: JSON.stringify({ taskId: 456 }),
    }
    const rawBody = JSON.stringify(body)
    const authTimestamp = Math.floor(Date.now() / 1000).toString()
    const bodyMd5 = crypto.createHash('md5').update(rawBody).digest('hex')
    const authSignature = buildPusherStandardSignature({
      path: '/apps/project-single-channel/events',
      authKey: created.key,
      authTimestamp,
      authVersion: '1.0',
      bodyMd5,
      secret: created.secret,
    })

    await expect(service.publishStandard({
      appId: 'project-single-channel',
      authKey: created.key,
      authTimestamp,
      authVersion: '1.0',
      bodyMd5,
      authSignature,
      body,
      rawBody,
      path: '/apps/project-single-channel/events',
    })).resolves.toMatchObject({
      accepted: true,
      channels: ['public-project'],
    })
  })

  it('creates one pusher app per application uid', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    const service = new PusherService()

    const created = await service.createApp({
      appId: 'project',
      applicationUid: 'application-1',
      owner: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
      allowedOrigins: ['http://127.0.0.1:2222'],
      channelPatterns: ['private-user.*'],
    })

    expect(created.applicationUid).toBe('application-1')
    expect(created.owner).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    expect(created.secret).toMatch(/^ps_/)
    await expect(
      service.createApp({
        appId: 'project-secondary',
        applicationUid: 'application-1',
      })
    ).rejects.toThrow('Pusher app already exists for application')
  })

  it('rotates pusher app credentials and invalidates the old key', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    const service = new PusherService()

    const created = await service.createApp({
      appId: 'project',
      applicationUid: 'application-rotate',
      owner: '0x1111111111111111111111111111111111111111',
      allowedOrigins: ['http://127.0.0.1:2222'],
      channelPatterns: ['private-user.*'],
    })
    const rotated = await service.rotateAppCredentials({
      applicationUid: 'application-rotate',
      allowedOrigins: ['http://127.0.0.1:3333'],
    })

    expect(rotated.appId).toBe(created.appId)
    expect(rotated.applicationUid).toBe(created.applicationUid)
    expect(rotated.key).not.toBe(created.key)
    expect(rotated.secret).not.toBe(created.secret)
    expect(rotated.allowedOrigins).toEqual(['http://127.0.0.1:3333'])

    const timestamp = new Date().toISOString()
    const body = {
      eventId: 'evt-rotate-1',
      type: 'task.updated',
      channels: ['private-user.0x1'],
      data: { ok: true },
    }
    await expect(
      service.publish({
        appId: 'project',
        key: created.key,
        timestamp,
        signature: buildPusherPublishSignature({ timestamp, body, secret: created.secret }),
        body,
      })
    ).rejects.toThrow('Invalid pusher key')
    await expect(
      service.publish({
        appId: 'project',
        key: rotated.key,
        timestamp,
        signature: buildPusherPublishSignature({ timestamp, body, secret: rotated.secret }),
        body,
      })
    ).resolves.toMatchObject({ accepted: true, idempotent: false })
  })

  it('authorizes private application channels through pusher channel ACLs', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    await dataSource.getRepository(PusherAppDO).save({
      uid: 'app-1',
      appId: 'project',
      key: 'pk_test',
      secretMasked: '***',
      secretCiphertext: encryptPusherAppSecret('ps_test'),
      allowedOriginsJson: '[]',
      channelPatternsJson: JSON.stringify(['private-*']),
      status: 'active',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    await dataSource.getRepository(IdentityAccountLinkDO).save({
      uid: 'link-1',
      identityDid: 'did:yeying:wid_1',
      chainKey: 'eip155:1',
      accountId: '0x1111111111111111111111111111111111111111',
      status: 'active',
      verifiedAt: '2026-09-01T00:00:00.000Z',
      revokedAt: '',
    })
    await dataSource.getRepository(PusherChannelAclDO).save({
      uid: 'acl-1',
      appId: 'project',
      channel: 'private-workspace.workspace-1',
      subject: 'did:yeying:wid_1',
      subjectType: 'identity',
      metadataJson: '{}',
      status: 'active',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '',
    })

    const service = new PusherService()
    await expect(
      service.assertCanSubscribe({
        appId: 'project',
        channels: ['private-workspace.workspace-1'],
        subject: '0x1111111111111111111111111111111111111111',
      })
    ).resolves.toBeUndefined()
    await expect(
      service.assertCanSubscribe({
        appId: 'project',
        channels: ['private-workspace.workspace-1'],
        subject: '0x2222222222222222222222222222222222222222',
      })
    ).rejects.toThrow('subscription denied')
  })

  it('does not allow security email notifications to be disabled', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    const service = new PusherService()

    await expect(
      service.upsertNotificationPreference({
        subject: '0x1111111111111111111111111111111111111111',
        appId: 'node',
        eventType: 'security.login',
        emailEnabled: false,
      })
    ).rejects.toThrow('Security email notifications cannot be disabled')
  })
})
