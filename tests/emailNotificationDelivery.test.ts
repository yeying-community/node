import { describe, expect, it, vi } from 'vitest'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { EmailTemplateDO, IdentityAccountLinkDO, IdentityCredentialDO, NotificationDO, NotificationDeliveryDO } from '../src/domain/mapper/entity'
import { NotificationService } from '../src/domain/service/notification'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'

const sendMailMock = vi.fn()

vi.doMock('../src/config/runtime', () => ({
  getConfig: () => ({
    emailDeliveryEnabled: true,
    emailDeliveryBatchSize: 10,
    emailMaxAttempts: 3,
  }),
}))

vi.doMock('../src/domain/service/mailProvider', () => ({
  sendMail: sendMailMock,
}))

const { runEmailNotificationDeliveryOnce } = await import('../src/domain/service/emailNotificationDelivery')

function emailCredentialToken(email: string) {
  return [
    'header',
    Buffer.from(JSON.stringify({
      vc: {
        credentialSubject: {
          id: 'did:yeying:wid_1234567890123456789012',
          email,
        },
      },
    })).toString('base64url'),
    'signature',
  ].join('.')
}

describe('email notification delivery', () => {
  it('prepares email deliveries from direct identity DID recipients', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    await dataSource.getRepository(IdentityCredentialDO).save({
      credentialId: 'email-1',
      identityDid: 'did:yeying:wid_1234567890123456789012',
      credentialType: 'EmailCredential',
      token: emailCredentialToken('alice@example.com'),
      status: 'active',
      issuedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2999-09-01T00:00:00.000Z',
      revokedAt: '',
    })
    const service = new NotificationService()
    const notification = {
      uid: 'notification-1',
      type: 'project.task.updated',
      source: 'project',
      subjectType: 'project_task',
      subjectId: '123',
      actor: '',
      audienceType: 'user',
      audienceIds: '[]',
      level: 'warning',
      title: '任务已更新',
      body: '任务 123 已完成',
      payload: '{}',
      status: 'delivered',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '',
    } as NotificationDO

    const deliveries = await (service as any).prepareEmailDeliveries(
      notification,
      ['did:yeying:wid_1234567890123456789012'],
      '2026-09-01T00:00:00.000Z'
    )

    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].channel).toBe('email')
    expect(deliveries[0].target).toBe('alice@example.com')
    expect(deliveries[0].status).toBe('pending')
  })

  it('prepares email deliveries when DID casing differs between recipient and credential', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    await dataSource.getRepository(IdentityCredentialDO).save({
      credentialId: 'email-mixed-case',
      identityDid: 'did:yeying:wid_R93C5XHt0lJ5LUzRbYCpzg',
      credentialType: 'EmailCredential',
      token: emailCredentialToken('alice@example.com'),
      status: 'active',
      issuedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2999-09-01T00:00:00.000Z',
      revokedAt: '',
    })
    const service = new NotificationService()
    const notification = {
      uid: 'notification-mixed-case',
      type: 'warehouse.storage.quota.warning',
      source: 'warehouse',
      subjectType: 'warehouse_user',
      subjectId: '1001',
      actor: '',
      audienceType: 'user',
      audienceIds: '[]',
      level: 'warning',
      title: '存储额度接近上限',
      body: '当前已使用 97.61%。',
      payload: JSON.stringify({ emailTemplateId: 'warehouse-storage-quota-warning' }),
      status: 'delivered',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '',
    } as NotificationDO

    const deliveries = await (service as any).prepareEmailDeliveries(
      notification,
      ['did:yeying:wid_r93c5xht0lj5luzrbycpzg'],
      '2026-09-01T00:00:00.000Z'
    )

    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].target).toBe('alice@example.com')
  })

  it('prepares email deliveries from active identity account links', async () => {
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    await dataSource.getRepository(IdentityAccountLinkDO).save({
      uid: 'link-1',
      identityDid: 'did:yeying:wid_1234567890123456789012',
      chainKey: 'eip155:1',
      accountId: '0x2222222222222222222222222222222222222222',
      status: 'active',
      verifiedAt: '2026-09-01T00:00:00.000Z',
      revokedAt: '',
    })
    await dataSource.getRepository(IdentityCredentialDO).save({
      credentialId: 'email-2',
      identityDid: 'did:yeying:wid_1234567890123456789012',
      credentialType: 'EmailCredential',
      token: emailCredentialToken('alice@example.com'),
      status: 'active',
      issuedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2999-09-01T00:00:00.000Z',
      revokedAt: '',
    })
    const service = new NotificationService()
    const notification = {
      uid: 'notification-2',
      type: 'warehouse.balance.insufficient',
      source: 'warehouse',
      subjectType: 'warehouse_user',
      subjectId: '1001',
      actor: '',
      audienceType: 'user',
      audienceIds: '[]',
      level: 'warning',
      title: '存储额度接近上限',
      body: '当前已使用 91.54%。',
      payload: JSON.stringify({ emailTemplateId: 'warehouse-balance-insufficient' }),
      status: 'delivered',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '',
    } as NotificationDO

    const deliveries = await (service as any).prepareEmailDeliveries(
      notification,
      ['0x2222222222222222222222222222222222222222'],
      '2026-09-01T00:00:00.000Z'
    )

    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].target).toBe('alice@example.com')
  })

  it('sends pending email deliveries and marks them delivered', async () => {
    sendMailMock.mockReset()
    sendMailMock.mockResolvedValue('provider-message-1')
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    await dataSource.getRepository(NotificationDO).save({
      uid: 'notification-1',
      type: 'security.login',
      source: 'node',
      subjectType: 'identity',
      subjectId: 'did:yeying:wid_1234567890123456789012',
      actor: '',
      audienceType: 'user',
      audienceIds: '[]',
      level: 'warning',
      title: '安全提醒',
      body: '你的账号完成了一次登录。',
      payload: '{}',
      status: 'delivered',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '',
    })
    await dataSource.getRepository(NotificationDeliveryDO).save({
      uid: 'delivery-1',
      notificationUid: 'notification-1',
      webhookUid: '',
      channel: 'email',
      target: 'alice@example.com',
      status: 'pending',
      lockToken: '',
      lockedAt: '',
      attemptCount: 0,
      lastError: '',
      deliveredAt: '',
      nextRetryAt: '',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })

    await runEmailNotificationDeliveryOnce()

    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'alice@example.com',
      subject: '【夜莺社区】安全提醒',
    }))
    const delivery = await dataSource.getRepository(NotificationDeliveryDO).findOneBy({ uid: 'delivery-1' })
    expect(delivery?.status).toBe('delivered')
    expect(delivery?.lastError).toBe('providerMessageId:provider-message-1')
    expect(delivery?.lockToken).toBe('')
    expect(delivery?.lockedAt).toBe('')
  })

  it('clears the worker lock after a failed delivery', async () => {
    sendMailMock.mockReset()
    sendMailMock.mockRejectedValue(new Error('SMTP unavailable'))
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    await dataSource.getRepository(NotificationDO).save({
      uid: 'notification-failure',
      type: 'security.login',
      source: 'node',
      subjectType: 'identity',
      subjectId: 'did:yeying:wid_1234567890123456789012',
      actor: '',
      audienceType: 'user',
      audienceIds: '[]',
      level: 'warning',
      title: '安全提醒',
      body: '发送失败测试',
      payload: '{}',
      status: 'delivered',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '',
    })
    await dataSource.getRepository(NotificationDeliveryDO).save({
      uid: 'delivery-failure',
      notificationUid: 'notification-failure',
      webhookUid: '',
      channel: 'email',
      target: 'alice@example.com',
      status: 'pending',
      lockToken: '',
      lockedAt: '',
      attemptCount: 0,
      lastError: '',
      deliveredAt: '',
      nextRetryAt: '',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })

    await runEmailNotificationDeliveryOnce()

    const delivery = await dataSource.getRepository(NotificationDeliveryDO).findOneBy({ uid: 'delivery-failure' })
    expect(delivery?.status).toBe('failed')
    expect(delivery?.lockToken).toBe('')
    expect(delivery?.lockedAt).toBe('')
    expect(delivery?.nextRetryAt).not.toBe('')
  })

  it('renders matching database email templates before falling back to the default template', async () => {
    sendMailMock.mockReset()
    sendMailMock.mockResolvedValue('provider-message-2')
    const dataSource = createInMemoryDataSource()
    SingletonDataSource.set(dataSource as any)
    await dataSource.getRepository(EmailTemplateDO).save({
      uid: 'template-1',
      templateId: 'security-login',
      version: 1,
      appId: 'node',
      category: 'security',
      eventTypesJson: JSON.stringify(['security.login']),
      subjectJson: JSON.stringify({ 'zh-CN': '安全事件：{{notification.title}}' }),
      htmlBodyJson: JSON.stringify({ 'zh-CN': '<p>{{notification.body}}</p><p>{{data.ip}}</p>' }),
      textBodyJson: JSON.stringify({ 'zh-CN': '{{notification.body}} {{data.ip}}' }),
      variablesJson: JSON.stringify(['notification.title', 'notification.body', 'data.ip']),
      enabled: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    await dataSource.getRepository(NotificationDO).save({
      uid: 'notification-2',
      type: 'security.login',
      source: 'node',
      subjectType: 'identity',
      subjectId: 'did:yeying:wid_1234567890123456789012',
      actor: '',
      audienceType: 'user',
      audienceIds: '[]',
      level: 'warning',
      title: '登录提醒',
      body: '<script>alert(1)</script>',
      payload: JSON.stringify({ ip: '127.0.0.1' }),
      status: 'delivered',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '',
    })
    await dataSource.getRepository(NotificationDeliveryDO).save({
      uid: 'delivery-2',
      notificationUid: 'notification-2',
      webhookUid: '',
      channel: 'email',
      target: 'alice@example.com',
      status: 'pending',
      lockToken: '',
      lockedAt: '',
      attemptCount: 0,
      lastError: '',
      deliveredAt: '',
      nextRetryAt: '',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })

    await runEmailNotificationDeliveryOnce()

    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      subject: '安全事件：登录提醒',
      text: '<script>alert(1)</script> 127.0.0.1',
      html: '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>127.0.0.1</p>',
    }))
  })
})
