import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/security/secretVault', () => ({
  getDerivedRuntimeSecret: () => 'pusher-app-master-key-for-test',
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
