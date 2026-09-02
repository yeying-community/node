import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/security/secretVault', () => ({
  getDerivedRuntimeSecret: () => 'pusher-app-master-key-for-test',
  getRuntimeSecret: () => '',
}))

import {
  buildPusherPublishSignature,
  decryptPusherAppSecret,
  encryptPusherAppSecret,
  PusherService,
} from '../src/domain/service/pusher'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { ProjectIdentityMappingDO, PusherAppDO } from '../src/domain/mapper/entity'
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

  it('authorizes private project channels through project identity mappings', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    await dataSource.getRepository(PusherAppDO).save({
      uid: 'app-1',
      appId: 'project',
      key: 'pk_test',
      secretMasked: '***',
      secretCiphertext: encryptPusherAppSecret('ps_test'),
      allowedOriginsJson: '[]',
      channelPatternsJson: JSON.stringify(['private-project.*']),
      status: 'active',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    await dataSource.getRepository(ProjectIdentityMappingDO).save({
      uid: 'mapping-1',
      instanceId: 'project-main',
      projectUserId: '1001',
      identityDid: 'did:yeying:wid_1',
      walletAddress: '0x1111111111111111111111111111111111111111',
      metadataJson: '{}',
      status: 'active',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })

    const service = new PusherService()
    await expect(
      service.assertCanSubscribe({
        appId: 'project',
        channels: ['private-project.project-main'],
        subject: '0x1111111111111111111111111111111111111111',
      })
    ).resolves.toBeUndefined()
    await expect(
      service.assertCanSubscribe({
        appId: 'project',
        channels: ['private-project.project-main'],
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
