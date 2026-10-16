import crypto from 'node:crypto'
import net from 'node:net'
import { DataSource, EntityManager, LessThan } from 'typeorm'
import { getConfig } from '../../config/runtime'
import { getCurrentUtcString } from '../../common/date'
import { SingletonDataSource } from '../facade/datasource'
import {
    PaymentMerchantDO,
    PaymentProviderEventDO,
    PaymentRefundDO,
    PaymentRequestNonceDO,
    PaymentTransactionDO,
    PaymentWebhookDeliveryDO,
} from '../mapper/entity'
import {
    decryptPaymentMerchantSecret,
    encryptPaymentMerchantSecret,
    verifyMerchantPaymentSignature,
} from './paymentCrypto'
import {
    defaultPaymentProviderResolver,
    PaymentProvider,
    PaymentProviderCreateInput,
    PaymentProviderWebhookResult,
} from './paymentProvider'
import { deliverPaymentWebhook, validatePaymentCallbackTarget, validatePaymentCallbackUrl } from './paymentWebhookDelivery'

type PaymentDataSource = Pick<DataSource, 'getRepository' | 'transaction' | 'options'>
type SecretCrypto = { encrypt: (value: string) => string; decrypt: (value: string) => string }

type MerchantSignedRequest = {
    merchantId: string
    timestamp: string
    nonce: string
    signature: string
    body: Record<string, unknown>
}
export type PaymentTransactionInput = {
    externalOrderId: unknown
    amountMinor: unknown
    currency?: unknown
    description: unknown
    clientType?: unknown
    returnUrl?: unknown
    idempotencyKey: unknown
    clientIp?: string
}

export type PaymentTransactionResult = {
    tradeNo: string
    merchantId: string
    externalOrderId: string
    amountMinor: string
    currency: string
    status: string
    provider: string
    paymentUrl: string
    expiresAt: string
    paidAt: string
}

function normalizeText(value: unknown): string {
    return String(value ?? '').trim()
}

function normalizeOwner(value: unknown): string {
    return normalizeText(value).toLowerCase()
}

function hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex')
}

function validateAmountMinor(value: unknown, label = 'amountMinor'): string {
    const text = normalizeText(value)
    if (!/^\d{1,15}$/.test(text)) throw new Error('PAYMENT_AMOUNT_INVALID')
    const amount = BigInt(text)
    if (amount <= 0n || amount > 999999999999999n) throw new Error('PAYMENT_AMOUNT_INVALID')
    return amount.toString()
}

function validateIdempotencyKey(value: unknown): string {
    const key = normalizeText(value)
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new Error('PAYMENT_IDEMPOTENCY_KEY_INVALID')
    return key
}

function normalizeHttpsUrl(value: unknown, allowHttpLocal = false): string {
    const text = normalizeText(value)
    let url: URL
    try { url = new URL(text) } catch { throw new Error('PAYMENT_CALLBACK_URL_INVALID') }
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase().replace(/^\[|\]$/g, ''))
    const production = String(getConfig<string>('app.env') || '').toLowerCase() === 'production'
        || String(process.env.NODE_ENV || '').toLowerCase() === 'production'
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(allowHttpLocal && !production && local && url.protocol === 'http:'))) {
        throw new Error('PAYMENT_CALLBACK_URL_INVALID')
    }
    if (local && production) throw new Error('PAYMENT_CALLBACK_URL_INVALID')
    return url.toString()
}

function stableTransactionRequest(input: {
    merchantId: string
    externalOrderId: string
    amountMinor: string
    currency: string
    description: string
    clientType: string
    returnUrl: string
}): string {
    return JSON.stringify(input)
}

function toTransactionResult(row: PaymentTransactionDO): PaymentTransactionResult {
    return {
        tradeNo: row.tradeNo,
        merchantId: row.merchantId,
        externalOrderId: row.externalOrderId,
        amountMinor: String(row.amountMinor),
        currency: row.currency,
        status: row.status,
        provider: row.provider,
        paymentUrl: row.paymentUrl,
        expiresAt: row.expiresAt,
        paidAt: row.paidAt,
    }
}

function normalizeProviderError(error: unknown): string {
    const message = error instanceof Error ? error.message : ''
    if (message === 'PAYMENT_WECHAT_DISABLED' || message === 'PAYMENT_MOCK_PROVIDER_DISABLED') return message
    return 'PAYMENT_PROVIDER_REQUEST_FAILED'
}

function isUniqueConstraintViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const value = error as { code?: unknown; driverError?: { code?: unknown }; message?: unknown }
    return value.code === '23505' || value.driverError?.code === '23505'
        || /duplicate key|unique constraint/i.test(String(value.message || ''))
}

function getTimestampMs(value: string): number {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return NaN
    return value.length <= 10 ? numeric * 1000 : numeric
}

function makeTradeNo(prefix: string): string {
    return `${prefix}${Date.now()}${crypto.randomBytes(6).toString('hex').toUpperCase()}`
}

function normalizeClientIp(value: string): string {
    const ip = normalizeText(value).replace(/^::ffff:/i, '')
    return ip && (net.isIP(ip) === 4 || net.isIP(ip) === 6) ? ip : '127.0.0.1'
}

export class PaymentService {
    private readonly dataSource: PaymentDataSource
    private readonly provider?: PaymentProvider
    private readonly secrets: SecretCrypto
    private readonly deliverWebhook: typeof deliverPaymentWebhook

    constructor(options: {
        dataSource?: PaymentDataSource
        provider?: PaymentProvider
        secrets?: SecretCrypto
        deliverWebhook?: typeof deliverPaymentWebhook
    } = {}) {
        this.dataSource = options.dataSource || SingletonDataSource.get()
        this.provider = options.provider
        this.secrets = options.secrets || { encrypt: encryptPaymentMerchantSecret, decrypt: decryptPaymentMerchantSecret }
        this.deliverWebhook = options.deliverWebhook || deliverPaymentWebhook
    }

    private requireEnabled(): void {
        if (getConfig<boolean>('payment.enabled') === false) throw new Error('PAYMENT_DISABLED')
    }

    private getProvider(name = String(getConfig<string>('payment.provider') || 'wechat')): PaymentProvider {
        return this.provider || defaultPaymentProviderResolver(name)
    }

    async createMerchant(ownerInput: string, input: { name?: unknown; callbackUrl?: unknown }) {
        this.requireEnabled()
        const owner = normalizeOwner(ownerInput)
        const name = normalizeText(input.name)
        if (!owner) throw new Error('PAYMENT_OWNER_REQUIRED')
        if (!name || name.length > 128) throw new Error('PAYMENT_MERCHANT_NAME_INVALID')
        const callbackUrl = await validatePaymentCallbackTarget(normalizeHttpsUrl(input.callbackUrl, true))
        const now = getCurrentUtcString()
        const merchantId = `pm_${crypto.randomBytes(18).toString('base64url')}`
        const secret = crypto.randomBytes(32).toString('base64url')
        const merchant = new PaymentMerchantDO()
        Object.assign(merchant, {
            merchantId,
            owner,
            name,
            callbackUrl,
            secretCiphertext: this.secrets.encrypt(secret),
            secretMasked: `${secret.slice(0, 4)}...${secret.slice(-4)}`,
            status: 'active',
            createdAt: now,
            updatedAt: now,
        })
        await this.dataSource.getRepository(PaymentMerchantDO).save(merchant)
        return { ...this.serializeMerchant(merchant), secret }
    }

    async listMerchants(ownerInput: string) {
        const owner = normalizeOwner(ownerInput)
        const rows = await this.dataSource.getRepository(PaymentMerchantDO).find({
            where: { owner },
            order: { createdAt: 'DESC' },
        })
        return rows.map((row) => this.serializeMerchant(row))
    }

    async disableMerchant(ownerInput: string, merchantIdInput: string) {
        const owner = normalizeOwner(ownerInput)
        const merchantId = normalizeText(merchantIdInput)
        const repository = this.dataSource.getRepository(PaymentMerchantDO)
        const merchant = await repository.findOneBy({ owner, merchantId })
        if (!merchant) throw new Error('PAYMENT_MERCHANT_NOT_FOUND')
        if (merchant.status !== 'disabled') {
            merchant.status = 'disabled'
            merchant.updatedAt = getCurrentUtcString()
            await repository.save(merchant)
        }
        return this.serializeMerchant(merchant)
    }

    private serializeMerchant(row: PaymentMerchantDO) {
        return {
            merchantId: row.merchantId,
            name: row.name,
            callbackUrl: row.callbackUrl,
            secretMasked: row.secretMasked,
            status: row.status,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        }
    }

    async authenticateMerchantRequest(input: MerchantSignedRequest): Promise<PaymentMerchantDO> {
        this.requireEnabled()
        const merchantId = normalizeText(input.merchantId)
        const timestamp = normalizeText(input.timestamp)
        const nonce = normalizeText(input.nonce)
        const signature = normalizeText(input.signature)
        if (!merchantId || !/^\d{10,13}$/.test(timestamp) || !/^[A-Za-z0-9._~-]{16,128}$/.test(nonce)) {
            throw new Error('PAYMENT_SIGNATURE_HEADERS_INVALID')
        }
        const windowMs = Number(getConfig<number>('payment.signatureWindowMs')) > 0
            ? Number(getConfig<number>('payment.signatureWindowMs')) : 5 * 60 * 1000
        const timestampMs = getTimestampMs(timestamp)
        if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > windowMs) {
            throw new Error('PAYMENT_SIGNATURE_TIMESTAMP_EXPIRED')
        }
        const merchant = await this.dataSource.getRepository(PaymentMerchantDO).findOneBy({ merchantId, status: 'active' })
        if (!merchant) throw new Error('PAYMENT_MERCHANT_NOT_FOUND')
        const secret = this.secrets.decrypt(merchant.secretCiphertext)
        if (!verifyMerchantPaymentSignature({ merchantId, timestamp, nonce, body: input.body, secret, signature })) {
            throw new Error('PAYMENT_SIGNATURE_INVALID')
        }
        const requestHash = hash(`${timestamp}.${nonce}.${JSON.stringify(input.body)}`)
        const nonceRepository = this.dataSource.getRepository(PaymentRequestNonceDO)
        await this.cleanupRequestNonces(nonceRepository, merchantId, windowMs)
        const existingNonce = await nonceRepository.findOneBy({ merchantId, nonce })
        if (existingNonce) throw new Error('PAYMENT_SIGNATURE_REPLAYED')
        const record = new PaymentRequestNonceDO()
        Object.assign(record, { merchantId, nonce, requestHash, createdAt: getCurrentUtcString() })
        try {
            await nonceRepository.save(record)
        } catch {
            throw new Error('PAYMENT_SIGNATURE_REPLAYED')
        }
        return merchant
    }

    private async cleanupRequestNonces(repository: ReturnType<PaymentDataSource['getRepository']>, merchantId: string, windowMs: number): Promise<void> {
        const cutoff = Date.now() - Math.max(windowMs * 2, 60 * 60 * 1000)
        await repository.delete({ merchantId, createdAt: LessThan(new Date(cutoff).toISOString()) })
    }

    async createTransaction(merchant: PaymentMerchantDO, input: PaymentTransactionInput): Promise<PaymentTransactionResult> {
        this.requireEnabled()
        const externalOrderId = normalizeText(input.externalOrderId)
        const amountMinor = validateAmountMinor(input.amountMinor)
        const currency = normalizeText(input.currency || 'CNY').toUpperCase()
        const description = normalizeText(input.description)
        const clientType = normalizeText(input.clientType || 'native').toLowerCase()
        const returnUrl = input.returnUrl ? normalizeHttpsUrl(input.returnUrl, true) : ''
        const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
        if (!externalOrderId || externalOrderId.length > 64) throw new Error('PAYMENT_EXTERNAL_ORDER_ID_INVALID')
        if (currency !== 'CNY') throw new Error('PAYMENT_CURRENCY_UNSUPPORTED')
        if (!description || description.length > 127) throw new Error('PAYMENT_DESCRIPTION_INVALID')
        if (!['native', 'h5'].includes(clientType)) throw new Error('PAYMENT_CLIENT_TYPE_INVALID')
        if (clientType === 'h5' && !returnUrl) throw new Error('PAYMENT_RETURN_URL_REQUIRED')

        const request = { merchantId: merchant.merchantId, externalOrderId, amountMinor, currency, description, clientType, returnUrl }
        const requestHash = hash(stableTransactionRequest(request))
        const repository = this.dataSource.getRepository(PaymentTransactionDO)
        const existing = await repository.findOneBy({ merchantId: merchant.merchantId, idempotencyKey })
        if (existing) {
            if (existing.requestHash !== requestHash) throw new Error('PAYMENT_IDEMPOTENCY_CONFLICT')
            return toTransactionResult(existing)
        }

        const now = getCurrentUtcString()
        const transaction = new PaymentTransactionDO()
        Object.assign(transaction, {
            tradeNo: makeTradeNo('PAY'),
            merchantId: merchant.merchantId,
            externalOrderId,
            amountMinor,
            currency,
            description,
            clientType,
            provider: String(getConfig<string>('payment.provider') || 'wechat'),
            providerOrderId: '',
            paymentUrl: '',
            returnUrl,
            status: 'creating',
            idempotencyKey,
            requestHash,
            paidAt: '',
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            createdAt: now,
            updatedAt: now,
        })
        try {
            await repository.save(transaction)
        } catch {
            const raced = await repository.findOneBy({ merchantId: merchant.merchantId, idempotencyKey })
            if (raced?.requestHash === requestHash) return toTransactionResult(raced)
            throw new Error('PAYMENT_IDEMPOTENCY_CONFLICT')
        }

        let provider: PaymentProvider
        try {
            provider = this.getProvider(transaction.provider)
        } catch (error) {
            await repository.update({ uid: transaction.uid, status: 'creating' }, {
                status: 'failed', updatedAt: getCurrentUtcString(),
            })
            const current = await repository.findOneBy({ uid: transaction.uid })
            if (current?.status === 'paid') return toTransactionResult(current)
            throw new Error(normalizeProviderError(error))
        }
        let result
        try {
            result = await provider.createPayment({
                tradeNo: transaction.tradeNo,
                amountMinor,
                currency,
                description,
                clientType,
                externalOrderId,
                clientIp: normalizeClientIp(input.clientIp || ''),
                returnUrl,
            } as PaymentProviderCreateInput)
        } catch (error) {
            transaction.status = 'failed'
            transaction.updatedAt = getCurrentUtcString()
            await repository.save(transaction)
            throw new Error(normalizeProviderError(error))
        }
        const updated = await this.dataSource.transaction(async manager => {
            const transactionRepository = manager.getRepository(PaymentTransactionDO)
            const current = await transactionRepository.findOne({
                where: { merchantId: merchant.merchantId, tradeNo: transaction.tradeNo },
                lock: { mode: 'pessimistic_write' },
            })
            if (!current) throw new Error('PAYMENT_TRANSACTION_NOT_FOUND')
            current.provider = provider.name
            current.providerOrderId = current.providerOrderId || result.providerOrderId
            current.paymentUrl = result.paymentUrl
            if (current.status === 'creating') current.status = 'pending'
            current.updatedAt = getCurrentUtcString()
            await transactionRepository.save(current)
            return current
        })
        return toTransactionResult(updated)
    }

    async queryTransaction(merchant: PaymentMerchantDO, tradeNoInput: string) {
        const tradeNo = normalizeText(tradeNoInput)
        const transaction = await this.dataSource.getRepository(PaymentTransactionDO).findOneBy({ merchantId: merchant.merchantId, tradeNo })
        if (!transaction) throw new Error('PAYMENT_TRANSACTION_NOT_FOUND')
        return toTransactionResult(transaction)
    }

    async requestRefund(merchant: PaymentMerchantDO, input: {
        tradeNo?: unknown; amountMinor?: unknown; reason?: unknown; idempotencyKey?: unknown
    }) {
        const tradeNo = normalizeText(input.tradeNo)
        const amountMinor = validateAmountMinor(input.amountMinor, 'refund amountMinor')
        const reason = normalizeText(input.reason).slice(0, 255)
        const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
        const requestHash = hash(JSON.stringify({ tradeNo, amountMinor, reason }))
        let pending: { refund: PaymentRefundDO; transaction: PaymentTransactionDO; isNew: boolean }
        try {
            pending = await this.dataSource.transaction(async manager => {
            const refundRepository = manager.getRepository(PaymentRefundDO)
            const transactionRepository = manager.getRepository(PaymentTransactionDO)
            const existing = await refundRepository.findOneBy({ merchantId: merchant.merchantId, idempotencyKey })
            if (existing) {
                if (existing.requestHash !== requestHash) throw new Error('PAYMENT_IDEMPOTENCY_CONFLICT')
                const transaction = await transactionRepository.findOneBy({ merchantId: merchant.merchantId, tradeNo: existing.tradeNo })
                if (!transaction) throw new Error('PAYMENT_TRANSACTION_NOT_FOUND')
                return { refund: existing, transaction, isNew: false }
            }
            const transaction = await transactionRepository.findOne({
                where: { merchantId: merchant.merchantId, tradeNo },
                lock: { mode: 'pessimistic_write' },
            })
            if (!transaction) throw new Error('PAYMENT_TRANSACTION_NOT_FOUND')
            const raced = await refundRepository.findOneBy({ merchantId: merchant.merchantId, idempotencyKey })
            if (raced) {
                if (raced.requestHash !== requestHash) throw new Error('PAYMENT_IDEMPOTENCY_CONFLICT')
                return { refund: raced, transaction, isNew: false }
            }
            if (!['paid', 'partially_refunded', 'refund_pending'].includes(transaction.status)) throw new Error('PAYMENT_TRANSACTION_NOT_REFUNDABLE')
            const refunds = await refundRepository.find({ where: { tradeNo } })
            const unavailable = refunds
                .filter(row => ['pending', 'processing', 'succeeded'].includes(row.status))
                .reduce((sum, row) => sum + BigInt(String(row.amountMinor)), 0n)
            if (BigInt(amountMinor) + unavailable > BigInt(String(transaction.amountMinor))) {
                throw new Error('PAYMENT_REFUND_AMOUNT_EXCEEDED')
            }
            const now = getCurrentUtcString()
            const refund = new PaymentRefundDO()
            Object.assign(refund, {
                refundNo: makeTradeNo('RFD'), tradeNo, merchantId: merchant.merchantId,
                amountMinor, reason, status: 'pending', providerRefundId: '', idempotencyKey,
                requestHash, createdAt: now, updatedAt: now,
            })
            await refundRepository.save(refund)
            return { refund, transaction, isNew: true }
            })
        } catch (error) {
            if (isUniqueConstraintViolation(error)) {
                const raced = await this.dataSource.getRepository(PaymentRefundDO).findOneBy({ merchantId: merchant.merchantId, idempotencyKey })
                if (raced?.requestHash === requestHash) {
                    const racedTransaction = await this.dataSource.getRepository(PaymentTransactionDO).findOneBy({ merchantId: merchant.merchantId, tradeNo: raced.tradeNo })
                    if (racedTransaction) return this.serializeRefund(raced)
                }
                throw new Error('PAYMENT_IDEMPOTENCY_CONFLICT')
            }
            throw error
        }
        if (!pending.isNew) return this.serializeRefund(pending.refund)
        const refund = pending.refund
        const transaction = pending.transaction
        let result: { providerRefundId: string }
        let provider: PaymentProvider
        try {
            provider = this.getProvider(transaction.provider)
            result = await provider.refundPayment({
                tradeNo,
                refundNo: refund.refundNo,
                totalAmountMinor: String(transaction.amountMinor),
                refundAmountMinor: amountMinor,
                reason,
            })
        } catch (error) {
            const current = await this.dataSource.getRepository(PaymentRefundDO).findOneBy({
                merchantId: merchant.merchantId, refundNo: refund.refundNo,
            })
            if (current?.status === 'pending') {
                current.status = 'failed'
                current.updatedAt = getCurrentUtcString()
                await this.dataSource.getRepository(PaymentRefundDO).save(current)
            }
            throw new Error(normalizeProviderError(error))
        }
        const updated = await this.dataSource.transaction(async manager => {
            const refundRepository = manager.getRepository(PaymentRefundDO)
            const transactionRepository = manager.getRepository(PaymentTransactionDO)
            const currentRefund = await refundRepository.findOne({
                where: { merchantId: merchant.merchantId, refundNo: refund.refundNo },
                lock: { mode: 'pessimistic_write' },
            })
            const currentTransaction = await transactionRepository.findOne({
                where: { merchantId: merchant.merchantId, tradeNo },
                lock: { mode: 'pessimistic_write' },
            })
            if (!currentRefund || !currentTransaction) throw new Error('PAYMENT_TRANSACTION_NOT_FOUND')
            if (currentRefund.status !== 'pending') return currentRefund
            currentRefund.providerRefundId = result.providerRefundId
            currentRefund.status = 'processing'
            currentRefund.updatedAt = getCurrentUtcString()
            await refundRepository.save(currentRefund)
            currentTransaction.status = 'refund_pending'
            currentTransaction.updatedAt = currentRefund.updatedAt
            await transactionRepository.save(currentTransaction)
            return currentRefund
        })
        return this.serializeRefund(updated)
    }

    private serializeRefund(row: PaymentRefundDO) {
        return {
            refundNo: row.refundNo,
            tradeNo: row.tradeNo,
            amountMinor: String(row.amountMinor),
            status: row.status,
            providerRefundId: row.providerRefundId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        }
    }

    async handleProviderWebhook(providerName: string, input: { rawBody: string; body?: Record<string, unknown> }) {
        this.requireEnabled()
        const provider = this.getProvider(providerName)
        const event = await provider.verifyWebhook(input)
        return await this.applyProviderEvent(provider.name, event)
    }

    private async applyProviderEvent(providerName: string, event: PaymentProviderWebhookResult) {
        return await this.dataSource.transaction(async manager => {
            const repository = manager.getRepository(PaymentTransactionDO)
            const eventRepository = manager.getRepository(PaymentProviderEventDO)
            const transaction = await repository.findOne({
                where: { tradeNo: event.tradeNo, provider: providerName },
                lock: { mode: 'pessimistic_write' },
            })
            if (!transaction) throw new Error('PAYMENT_TRANSACTION_NOT_FOUND')
            if (String(transaction.amountMinor) !== String(event.amountMinor)) throw new Error('PAYMENT_WEBHOOK_AMOUNT_MISMATCH')
            const existingEvent = await eventRepository.findOneBy({ provider: providerName, eventId: event.eventId })
            if (existingEvent) {
                if (existingEvent.tradeNo && existingEvent.tradeNo !== transaction.tradeNo) {
                    throw new Error('PAYMENT_WEBHOOK_DUPLICATE_EVENT')
                }
                if (transaction.status === 'paid') {
                    await this.ensureMerchantCallback(transaction, 'payment.succeeded', this.paymentSucceededPayload(transaction), manager)
                }
                return { duplicate: true, transaction: toTransactionResult(transaction) }
            }
            if (transaction.status === 'paid') {
                await this.recordProviderEvent(eventRepository, providerName, event)
                await this.ensureMerchantCallback(transaction, 'payment.succeeded', this.paymentSucceededPayload(transaction), manager)
                return { duplicate: true, transaction: toTransactionResult(transaction) }
            }
            if (!['pending', 'creating'].includes(transaction.status)) throw new Error('PAYMENT_TRANSACTION_STATE_INVALID')
            const now = getCurrentUtcString()
            if (event.status !== 'paid') {
                transaction.status = 'failed'
                transaction.updatedAt = now
                await repository.save(transaction)
                await this.recordProviderEvent(eventRepository, providerName, event)
                return { duplicate: false, transaction: toTransactionResult(transaction) }
            }

            transaction.status = 'paid'
            transaction.providerOrderId = event.providerOrderId || transaction.providerOrderId
            transaction.paidAt = now
            transaction.updatedAt = now
            await repository.save(transaction)
            await this.recordProviderEvent(eventRepository, providerName, event)
            await this.ensureMerchantCallback(transaction, 'payment.succeeded', this.paymentSucceededPayload(transaction), manager)
            return { duplicate: false, transaction: toTransactionResult(transaction) }
        })
    }

    private paymentSucceededPayload(transaction: PaymentTransactionDO): Record<string, unknown> {
        return {
            eventId: `payment.succeeded:${transaction.tradeNo}`,
            type: 'payment.succeeded',
            merchantId: transaction.merchantId,
            tradeNo: transaction.tradeNo,
            externalOrderId: transaction.externalOrderId,
            amountMinor: String(transaction.amountMinor),
            currency: transaction.currency,
            provider: transaction.provider,
            providerOrderId: transaction.providerOrderId,
            paidAt: transaction.paidAt,
        }
    }

    private async recordProviderEvent(repository: ReturnType<PaymentDataSource['getRepository']>, providerName: string, event: PaymentProviderWebhookResult): Promise<void> {
        const record = new PaymentProviderEventDO()
        Object.assign(record, { provider: providerName, eventId: event.eventId, tradeNo: event.tradeNo, eventType: event.eventType, createdAt: getCurrentUtcString() })
        await repository.save(record)
    }

    private async ensureMerchantCallback(transaction: PaymentTransactionDO, eventType: string, payload: Record<string, unknown>, manager?: EntityManager) {
        const merchantRepository = manager ? manager.getRepository(PaymentMerchantDO) : this.dataSource.getRepository(PaymentMerchantDO)
        const deliveryRepository = manager ? manager.getRepository(PaymentWebhookDeliveryDO) : this.dataSource.getRepository(PaymentWebhookDeliveryDO)
        const merchant = await merchantRepository.findOneBy({ merchantId: transaction.merchantId })
        if (!merchant) throw new Error('PAYMENT_MERCHANT_NOT_FOUND')
        const existing = await deliveryRepository.findOneBy({ eventId: String(payload.eventId) })
        if (existing) return existing
        const delivery = new PaymentWebhookDeliveryDO()
        const now = getCurrentUtcString()
        Object.assign(delivery, {
            eventId: String(payload.eventId),
            merchantId: merchant.merchantId,
            targetUrl: merchant.callbackUrl,
            payloadJson: JSON.stringify({ ...payload, type: eventType }),
            status: 'pending',
            attemptCount: 0,
            nextRetryAt: '',
            lockToken: '',
            lockedAt: '',
            lastError: '',
            deliveredAt: '',
            createdAt: now,
            updatedAt: now,
        })
        await deliveryRepository.save(delivery)
        return delivery
    }

    async queryProviderPayment(merchant: PaymentMerchantDO, tradeNoInput: string) {
        const result = await this.queryTransaction(merchant, tradeNoInput)
        if (!['pending', 'creating'].includes(result.status)) return result
        const transaction = await this.dataSource.getRepository(PaymentTransactionDO).findOneBy({ merchantId: merchant.merchantId, tradeNo: result.tradeNo })
        if (!transaction) throw new Error('PAYMENT_TRANSACTION_NOT_FOUND')
        const provider = this.getProvider(transaction.provider)
        let providerState
        try {
            providerState = await provider.queryPayment(transaction.tradeNo)
        } catch (error) {
            throw new Error(normalizeProviderError(error))
        }
        if (providerState.status === 'paid') {
            if (String(providerState.amountMinor) !== String(transaction.amountMinor)) throw new Error('PAYMENT_WEBHOOK_AMOUNT_MISMATCH')
            await this.applyProviderEvent(provider.name, {
                status: 'paid', eventType: 'payment.succeeded', eventId: `query:${providerState.providerOrderId || transaction.tradeNo}`,
                tradeNo: transaction.tradeNo, amountMinor: providerState.amountMinor,
                providerOrderId: providerState.providerOrderId, raw: providerState.raw,
            })
            return await this.queryTransaction(merchant, transaction.tradeNo)
        }
        if (providerState.status === 'failed') {
            await this.applyProviderEvent(provider.name, {
                status: 'failed', eventType: 'payment.failed', eventId: `query:${providerState.providerOrderId || transaction.tradeNo}:failed`,
                tradeNo: transaction.tradeNo, amountMinor: String(transaction.amountMinor),
                providerOrderId: providerState.providerOrderId, raw: providerState.raw,
            })
            return await this.queryTransaction(merchant, transaction.tradeNo)
        }
        return result
    }

    async cancelTransaction(merchant: PaymentMerchantDO, tradeNoInput: string) {
        const result = await this.queryTransaction(merchant, tradeNoInput)
        if (!['pending', 'creating'].includes(result.status)) return result
        const repository = this.dataSource.getRepository(PaymentTransactionDO)
        const transaction = await repository.findOneBy({ merchantId: merchant.merchantId, tradeNo: result.tradeNo })
        if (!transaction) throw new Error('PAYMENT_TRANSACTION_NOT_FOUND')
        try {
            await this.getProvider(transaction.provider).closePayment(transaction.tradeNo)
        } catch (error) {
            throw new Error(normalizeProviderError(error))
        }
        const changed = await repository.update({ uid: transaction.uid, status: transaction.status }, { status: 'cancelled', updatedAt: getCurrentUtcString() })
        const current = await repository.findOneBy({ uid: transaction.uid })
        if (!Number(changed.affected || 0) && current?.status !== 'paid') throw new Error('PAYMENT_TRANSACTION_STATE_INVALID')
        return toTransactionResult(current || transaction)
    }

    async queryRefund(merchant: PaymentMerchantDO, refundNoInput: string) {
        const refundNo = normalizeText(refundNoInput)
        const repository = this.dataSource.getRepository(PaymentRefundDO)
        const refund = await repository.findOneBy({ merchantId: merchant.merchantId, refundNo })
        if (!refund) throw new Error('PAYMENT_REFUND_NOT_FOUND')
        if (refund.status === 'succeeded' || refund.status === 'failed') return this.serializeRefund(refund)
        const transactionRepository = this.dataSource.getRepository(PaymentTransactionDO)
        const transaction = await transactionRepository.findOneBy({ merchantId: merchant.merchantId, tradeNo: refund.tradeNo })
        if (!transaction) throw new Error('PAYMENT_TRANSACTION_NOT_FOUND')
        let status: Awaited<ReturnType<PaymentProvider['queryRefund']>>
        try {
            status = await this.getProvider(transaction.provider).queryRefund(refundNo)
        } catch (error) {
            throw new Error(normalizeProviderError(error))
        }
        return await this.dataSource.transaction(async manager => {
            const refundRepository = manager.getRepository(PaymentRefundDO)
            const transactionRepository = manager.getRepository(PaymentTransactionDO)
            const currentRefund = await refundRepository.findOne({
                where: { merchantId: merchant.merchantId, refundNo },
                lock: { mode: 'pessimistic_write' },
            })
            const currentTransaction = await transactionRepository.findOne({
                where: { merchantId: merchant.merchantId, tradeNo: refund.tradeNo },
                lock: { mode: 'pessimistic_write' },
            })
            if (!currentRefund || !currentTransaction) throw new Error('PAYMENT_TRANSACTION_NOT_FOUND')
            if (['succeeded', 'failed'].includes(currentRefund.status)) return this.serializeRefund(currentRefund)
            const changed = status.status !== currentRefund.status
            currentRefund.status = status.status
            currentRefund.providerRefundId = status.providerRefundId || currentRefund.providerRefundId
            currentRefund.updatedAt = getCurrentUtcString()
            await refundRepository.save(currentRefund)
            if (status.status === 'succeeded') {
                const refunds = await refundRepository.find({ where: { tradeNo: currentTransaction.tradeNo } })
                const succeeded = refunds.filter(row => row.status === 'succeeded').reduce((sum, row) => sum + BigInt(String(row.amountMinor)), 0n)
                const total = BigInt(String(currentTransaction.amountMinor))
                currentTransaction.status = succeeded >= total ? 'refunded' : 'partially_refunded'
                currentTransaction.updatedAt = currentRefund.updatedAt
                await transactionRepository.save(currentTransaction)
                if (changed) {
                    await this.ensureMerchantCallback(currentTransaction, 'refund.succeeded', {
                        eventId: `refund.succeeded:${currentRefund.refundNo}`, type: 'refund.succeeded',
                        merchantId: merchant.merchantId, refundNo: currentRefund.refundNo, tradeNo: currentTransaction.tradeNo,
                        amountMinor: String(currentRefund.amountMinor), status: currentRefund.status, refundedAt: currentRefund.updatedAt,
                    }, manager)
                }
            } else if (status.status === 'failed') {
                const refunds = await refundRepository.find({ where: { tradeNo: currentTransaction.tradeNo } })
                const active = refunds.some(row => ['pending', 'processing'].includes(row.status))
                const succeeded = refunds.some(row => row.status === 'succeeded')
                if (!active) {
                    currentTransaction.status = succeeded ? 'partially_refunded' : 'paid'
                    currentTransaction.updatedAt = currentRefund.updatedAt
                    await transactionRepository.save(currentTransaction)
                }
            }
            return this.serializeRefund(currentRefund)
        })
    }

    async deliverCallbacksOnce(limit = 20): Promise<number> {
        const repository = this.dataSource.getRepository(PaymentWebhookDeliveryDO)
        const nowMs = Date.now()
        const now = new Date(nowMs).toISOString()
        const claimTimeoutMs = Number(getConfig<number>('payment.webhookClaimTimeoutMs')) > 0
            ? Number(getConfig<number>('payment.webhookClaimTimeoutMs')) : 60 * 1000
        const maxAttempts = Number(getConfig<number>('payment.webhookMaxAttempts')) > 0
            ? Number(getConfig<number>('payment.webhookMaxAttempts')) : 5
        const retryBaseDelayMs = Number(getConfig<number>('payment.webhookRetryBaseDelayMs')) > 0
            ? Number(getConfig<number>('payment.webhookRetryBaseDelayMs')) : 15 * 1000
        const retryMaxDelayMs = Number(getConfig<number>('payment.webhookRetryMaxDelayMs')) > 0
            ? Number(getConfig<number>('payment.webhookRetryMaxDelayMs')) : 10 * 60 * 1000
        const delivering = await repository.find({ where: { status: 'delivering' } })
        for (const row of delivering) {
            if (Date.parse(String(row.lockedAt || '')) <= nowMs - claimTimeoutMs) {
                await repository.update({ uid: row.uid, status: 'delivering', lockToken: row.lockToken }, {
                    status: 'failed', nextRetryAt: row.attemptCount < maxAttempts ? now : '',
                    lockToken: '', lockedAt: '', updatedAt: now,
                    lastError: 'PAYMENT_CALLBACK_CLAIM_EXPIRED',
                })
            }
        }
        const failed = await repository.find({ where: { status: 'failed' }, order: { createdAt: 'ASC' }, take: limit * 2 })
        const pending = await repository.find({ where: { status: 'pending' }, order: { createdAt: 'ASC' }, take: limit })
        const candidates = [...pending, ...failed.filter(row => row.attemptCount < maxAttempts && (!row.nextRetryAt || row.nextRetryAt <= now))]
            .slice(0, limit)
        let processed = 0
        for (const row of candidates) {
            const previousStatus = row.status
            const token = crypto.randomUUID()
            const claimed = await repository.update({ uid: row.uid, status: previousStatus, attemptCount: row.attemptCount }, {
                status: 'delivering', lockToken: token, lockedAt: now,
                attemptCount: row.attemptCount + 1, updatedAt: now,
            })
            if (!Number(claimed.affected || 0)) continue
            processed += 1
            try {
                const merchant = await this.dataSource.getRepository(PaymentMerchantDO).findOneBy({ merchantId: row.merchantId })
                if (!merchant) throw new Error('PAYMENT_MERCHANT_NOT_FOUND')
                const secret = this.secrets.decrypt(merchant.secretCiphertext)
                const result = await this.deliverWebhook({
                    url: row.targetUrl,
                    payload: row.payloadJson,
                    secret,
                    eventId: row.eventId,
                    merchantId: row.merchantId,
                    timeoutMs: Number(getConfig<number>('payment.webhookTimeoutMs')) || 10000,
                })
                await repository.update({ uid: row.uid, status: 'delivering', lockToken: token }, {
                    status: 'delivered', deliveredAt: new Date().toISOString(), nextRetryAt: '',
                    lastError: '', lockToken: '', lockedAt: '', updatedAt: new Date().toISOString(),
                })
                void result
            } catch (error) {
                const attempts = row.attemptCount + 1
                const nextRetryAt = attempts >= maxAttempts ? '' : new Date(nowMs + Math.min(retryBaseDelayMs * (2 ** (attempts - 1)), retryMaxDelayMs)).toISOString()
                await repository.update({ uid: row.uid, status: 'delivering', lockToken: token }, {
                    status: 'failed', nextRetryAt, lastError: error instanceof Error ? error.message.slice(0, 512) : 'PAYMENT_CALLBACK_FAILED',
                    lockToken: '', lockedAt: '', updatedAt: new Date().toISOString(),
                })
            }
        }
        return processed
    }
}
