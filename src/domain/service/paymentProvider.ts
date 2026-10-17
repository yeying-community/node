import crypto from 'node:crypto'
import https from 'node:https'
import net from 'node:net'
import { XMLParser } from 'fast-xml-parser'
import { getConfig } from '../../config/runtime'
import { getRuntimeSecret } from '../../security/secretVault'

export type PaymentProviderCreateInput = {
    tradeNo: string
    amountMinor: string
    currency: string
    description: string
    clientType: string
    externalOrderId: string
    clientIp: string
    returnUrl: string
}
export type PaymentProviderCreateResult = {
    providerOrderId: string
    paymentUrl: string
    raw: Record<string, unknown>
}

export type PaymentProviderQueryResult = {
    status: 'pending' | 'paid' | 'failed'
    providerOrderId: string
    amountMinor: string
    raw: Record<string, unknown>
}

export type PaymentProviderRefundInput = {
    tradeNo: string
    refundNo: string
    totalAmountMinor: string
    refundAmountMinor: string
    reason: string
}

export type PaymentProviderRefundResult = {
    providerRefundId: string
    raw: Record<string, unknown>
}

export type PaymentProviderRefundQueryResult = {
    status: 'processing' | 'succeeded' | 'failed'
    providerRefundId: string
    raw: Record<string, unknown>
}

export type PaymentProviderWebhookResult = {
    eventId: string
    eventType: string
    tradeNo: string
    amountMinor: string
    providerOrderId: string
    status: 'paid' | 'failed'
    raw: Record<string, unknown>
}

export interface PaymentProvider {
    readonly name: string
    createPayment(input: PaymentProviderCreateInput): Promise<PaymentProviderCreateResult>
    queryPayment(tradeNo: string): Promise<PaymentProviderQueryResult>
    closePayment(tradeNo: string): Promise<void>
    refundPayment(input: PaymentProviderRefundInput): Promise<PaymentProviderRefundResult>
    queryRefund(refundNo: string): Promise<PaymentProviderRefundQueryResult>
    verifyWebhook(input: { rawBody: string; body?: Record<string, unknown> }): Promise<PaymentProviderWebhookResult>
    successWebhookResponse(): string
}

async function readLimitedResponse(response: Response, maximumBytes = 64 * 1024): Promise<string> {
    if (!response.body) return ''
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let received = 0
    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > maximumBytes) {
            await reader.cancel()
            throw new Error('PAYMENT_PROVIDER_RESPONSE_INVALID')
        }
        chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks).toString('utf8')
}

function required(value: unknown, message: string): string {
    const normalized = String(value ?? '').trim()
    if (!normalized) throw new Error(message)
    return normalized
}

function parsePositiveMinor(value: string, label: string): number {
    if (!/^\d+$/.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
        throw new Error(`${label} must be a positive integer`)
    }
    return Number(value)
}

function xmlEscape(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

function buildXml(payload: Record<string, unknown>): string {
    const items = Object.entries(payload)
        .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
        .map(([key, value]) => `<${key}>${xmlEscape(value)}</${key}>`)
        .join('')
    return `<xml>${items}</xml>`
}

function parseXml(raw: string): Record<string, string> {
    if (!raw || Buffer.byteLength(raw, 'utf8') > 64 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(raw)) {
        throw new Error('PAYMENT_PROVIDER_RESPONSE_INVALID')
    }
    const parsed = new XMLParser({
        ignoreAttributes: true,
        trimValues: true,
        parseTagValue: false,
        removeNSPrefix: true,
        processEntities: false,
    }).parse(raw)
    const root = parsed?.xml && typeof parsed.xml === 'object' ? parsed.xml : parsed
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
        throw new Error('PAYMENT_PROVIDER_RESPONSE_INVALID')
    }
    const result: Record<string, string> = {}
    Object.entries(root as Record<string, unknown>).forEach(([key, value]) => {
        result[key] = String(value ?? '').trim()
    })
    return result
}

function signV2(payload: Record<string, unknown>, apiKey: string): string {
    const canonical = Object.keys(payload)
        .filter((key) => key !== 'sign' && String(payload[key] ?? '') !== '')
        .sort()
        .map((key) => `${key}=${String(payload[key])}`)
        .join('&')
    return crypto.createHash('md5').update(`${canonical}&key=${apiKey}`, 'utf8').digest('hex').toUpperCase()
}

function verifyV2Signature(payload: Record<string, unknown>, apiKey: string): boolean {
    const received = String(payload.sign ?? '').trim().toUpperCase()
    if (!received) return false
    const expected = signV2(payload, apiKey)
    return received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

function resolveHttpsUrl(baseUrl: string, path: string): string {
    const base = new URL(baseUrl)
    if (base.protocol !== 'https:' || base.username || base.password || base.hash || net.isIP(base.hostname)) {
        throw new Error('PAYMENT_WECHAT_API_MUST_USE_HTTPS')
    }
    return new URL(path, base).toString()
}

function assertSafeWechatApiBaseUrl(baseUrl: string): void {
    const base = new URL(baseUrl)
    if (base.protocol !== 'https:' || base.username || base.password || base.hash || net.isIP(base.hostname)) {
        throw new Error('PAYMENT_WECHAT_API_MUST_USE_HTTPS')
    }
    const hostname = base.hostname.toLowerCase()
    const production = String(getConfig<string>('app.env') || '').toLowerCase() === 'production'
        || String(process.env.NODE_ENV || '').toLowerCase() === 'production'
    if (production && hostname !== 'api.mch.weixin.qq.com') {
        throw new Error('PAYMENT_WECHAT_API_HOST_INVALID')
    }
    if (!production && hostname === 'api.mch.weixin.qq.com') return
    const allowlistedHosts = getConfig<string[]>('payment.wechat.allowedApiHosts') || []
    if (!production && !allowlistedHosts.map(host => host.toLowerCase()).includes(hostname)) {
        throw new Error('PAYMENT_WECHAT_API_HOST_INVALID')
    }
}

async function postXml(url: string, body: string, timeoutMs: number, tls?: { cert?: string; key?: string }): Promise<string> {
    if (tls?.cert || tls?.key) {
        return await new Promise<string>((resolve, reject) => {
            const target = new URL(url)
            const request = https.request(target, {
                method: 'POST',
                cert: tls.cert,
                key: tls.key,
                timeout: timeoutMs,
                headers: {
                    'content-type': 'application/xml',
                    'content-length': Buffer.byteLength(body),
                },
            }, response => {
                const chunks: Buffer[] = []
                let received = 0
                response.on('data', chunk => {
                    received += Buffer.byteLength(chunk)
                    if (received > 64 * 1024) {
                        request.destroy(new Error('PAYMENT_PROVIDER_RESPONSE_INVALID'))
                        return
                    }
                    chunks.push(Buffer.from(chunk))
                })
                response.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8')
                    if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
                        reject(new Error(`PAYMENT_PROVIDER_HTTP_${response.statusCode || 500}`))
                        return
                    }
                    resolve(text)
                })
            })
            request.on('error', reject)
            request.on('timeout', () => request.destroy(new Error('PAYMENT_PROVIDER_TIMEOUT')))
            request.write(body)
            request.end()
        })
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/xml' },
            body,
            signal: controller.signal,
        })
        const text = await readLimitedResponse(response)
        if (!response.ok) throw new Error(`PAYMENT_PROVIDER_HTTP_${response.status}`)
        return text
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw new Error('PAYMENT_PROVIDER_TIMEOUT')
        throw error
    } finally {
        clearTimeout(timer)
    }
}

function assertSuccessfulResponse(response: Record<string, string>): void {
    if (response.return_code !== 'SUCCESS' || response.result_code !== 'SUCCESS') {
        throw new Error('PAYMENT_PROVIDER_REQUEST_FAILED')
    }
}

function resolveWechatSecret(name: string, label: string): string {
    return required(getRuntimeSecret(name), `${label} is required in secrets.enc.json`)
}

export class WechatPayV2Provider implements PaymentProvider {
    readonly name = 'wechat'

    private readonly baseUrl: string
    private readonly timeoutMs: number
    private readonly apiKey: string
    private readonly appId: string
    private readonly merchantId: string
    private readonly notifyUrl: string

    constructor() {
        const config = (getConfig<Record<string, unknown>>('payment.wechat') || {}) as Record<string, unknown>
        if (config.enabled === false) throw new Error('PAYMENT_WECHAT_DISABLED')
        this.baseUrl = required(config.apiBaseUrl || 'https://api.mch.weixin.qq.com', 'payment.wechat.apiBaseUrl')
        assertSafeWechatApiBaseUrl(this.baseUrl)
        this.timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : 10000
        this.apiKey = resolveWechatSecret('PAYMENT_WECHAT_API_V2_KEY', 'PAYMENT_WECHAT_API_V2_KEY')
        this.appId = resolveWechatSecret('PAYMENT_WECHAT_APP_ID', 'PAYMENT_WECHAT_APP_ID')
        this.merchantId = resolveWechatSecret('PAYMENT_WECHAT_MCH_ID', 'PAYMENT_WECHAT_MCH_ID')
        this.notifyUrl = required(config.notifyUrl, 'payment.wechat.notifyUrl')
    }

    async createPayment(input: PaymentProviderCreateInput): Promise<PaymentProviderCreateResult> {
        const amount = parsePositiveMinor(input.amountMinor, 'amountMinor')
        const nonce = crypto.randomBytes(16).toString('hex')
        const tradeType = input.clientType === 'h5' ? 'MWEB' : 'NATIVE'
        const payload: Record<string, unknown> = {
            appid: this.appId,
            mch_id: this.merchantId,
            nonce_str: nonce,
            body: input.description,
            out_trade_no: input.tradeNo,
            total_fee: amount,
            spbill_create_ip: input.clientIp || '127.0.0.1',
            notify_url: this.notifyUrl,
            trade_type: tradeType,
        }
        if (tradeType === 'MWEB') {
            const returnUrl = new URL(input.returnUrl)
            payload.scene_info = JSON.stringify({ h5_info: { type: 'Wap', wap_url: returnUrl.origin, wap_name: 'YeYing Community' } })
        }
        payload.sign = signV2(payload, this.apiKey)
        const response = parseXml(await postXml(resolveHttpsUrl(this.baseUrl, '/pay/unifiedorder'), buildXml(payload), this.timeoutMs))
        assertSuccessfulResponse(response)
        if (!verifyV2Signature(response, this.apiKey)) throw new Error('PAYMENT_PROVIDER_SIGNATURE_INVALID')
        this.assertMerchantResponse(response)
        const paymentUrl = response.code_url || response.mweb_url || ''
        if (!paymentUrl) throw new Error('PAYMENT_PROVIDER_PAYLOAD_EMPTY')
        return { providerOrderId: response.prepay_id || response.transaction_id || input.tradeNo, paymentUrl, raw: response }
    }

    async queryPayment(tradeNo: string): Promise<PaymentProviderQueryResult> {
        const payload: Record<string, unknown> = {
            appid: this.appId,
            mch_id: this.merchantId,
            nonce_str: crypto.randomBytes(16).toString('hex'),
            out_trade_no: tradeNo,
        }
        payload.sign = signV2(payload, this.apiKey)
        const response = parseXml(await postXml(resolveHttpsUrl(this.baseUrl, '/pay/orderquery'), buildXml(payload), this.timeoutMs))
        if (response.return_code !== 'SUCCESS') throw new Error('PAYMENT_PROVIDER_REQUEST_FAILED')
        if (!verifyV2Signature(response, this.apiKey)) throw new Error('PAYMENT_PROVIDER_SIGNATURE_INVALID')
        this.assertMerchantResponse(response)
        const status = response.trade_state === 'SUCCESS' ? 'paid' : response.trade_state === 'NOTPAY' || response.trade_state === 'USERPAYING' ? 'pending' : 'failed'
        return { status, providerOrderId: response.transaction_id || response.prepay_id || tradeNo, amountMinor: response.total_fee || '', raw: response }
    }

    async closePayment(tradeNo: string): Promise<void> {
        const payload: Record<string, unknown> = {
            appid: this.appId,
            mch_id: this.merchantId,
            nonce_str: crypto.randomBytes(16).toString('hex'),
            out_trade_no: tradeNo,
        }
        payload.sign = signV2(payload, this.apiKey)
        const response = parseXml(await postXml(resolveHttpsUrl(this.baseUrl, '/pay/closeorder'), buildXml(payload), this.timeoutMs))
        assertSuccessfulResponse(response)
        if (!verifyV2Signature(response, this.apiKey)) throw new Error('PAYMENT_PROVIDER_SIGNATURE_INVALID')
        this.assertMerchantResponse(response)
    }

    async refundPayment(input: PaymentProviderRefundInput): Promise<PaymentProviderRefundResult> {
        const cert = resolveWechatSecret('PAYMENT_WECHAT_CERT_PEM', 'PAYMENT_WECHAT_CERT_PEM')
        const key = resolveWechatSecret('PAYMENT_WECHAT_KEY_PEM', 'PAYMENT_WECHAT_KEY_PEM')
        const payload: Record<string, unknown> = {
            appid: this.appId,
            mch_id: this.merchantId,
            nonce_str: crypto.randomBytes(16).toString('hex'),
            out_trade_no: input.tradeNo,
            out_refund_no: input.refundNo,
            total_fee: parsePositiveMinor(input.totalAmountMinor, 'totalAmountMinor'),
            refund_fee: parsePositiveMinor(input.refundAmountMinor, 'refundAmountMinor'),
            refund_desc: input.reason,
        }
        payload.sign = signV2(payload, this.apiKey)
        const response = parseXml(await postXml(resolveHttpsUrl(this.baseUrl, '/secapi/pay/refund'), buildXml(payload), this.timeoutMs, { cert, key }))
        assertSuccessfulResponse(response)
        if (!verifyV2Signature(response, this.apiKey)) throw new Error('PAYMENT_PROVIDER_SIGNATURE_INVALID')
        this.assertMerchantResponse(response)
        return { providerRefundId: response.refund_id || input.refundNo, raw: response }
    }

    async queryRefund(refundNo: string): Promise<PaymentProviderRefundQueryResult> {
        const payload: Record<string, unknown> = {
            appid: this.appId,
            mch_id: this.merchantId,
            nonce_str: crypto.randomBytes(16).toString('hex'),
            out_refund_no: refundNo,
        }
        payload.sign = signV2(payload, this.apiKey)
        const response = parseXml(await postXml(resolveHttpsUrl(this.baseUrl, '/pay/refundquery'), buildXml(payload), this.timeoutMs))
        if (response.return_code !== 'SUCCESS') throw new Error('PAYMENT_PROVIDER_REQUEST_FAILED')
        if (!verifyV2Signature(response, this.apiKey)) throw new Error('PAYMENT_PROVIDER_SIGNATURE_INVALID')
        this.assertMerchantResponse(response)
        const state = String(response.refund_status_0 || '').toUpperCase()
        const status = state === 'SUCCESS' ? 'succeeded' : ['PROCESSING'].includes(state) ? 'processing' : 'failed'
        return { status, providerRefundId: response.refund_id_0 || refundNo, raw: response }
    }

    async verifyWebhook(input: { rawBody: string; body?: Record<string, unknown> }): Promise<PaymentProviderWebhookResult> {
        const response = parseXml(input.rawBody)
        if (response.out_refund_no || response.refund_id || response.refund_fee) {
            throw new Error('PAYMENT_WEBHOOK_EVENT_UNSUPPORTED')
        }
        if (response.return_code !== 'SUCCESS' || response.result_code !== 'SUCCESS' || !verifyV2Signature(response, this.apiKey)) {
            throw new Error('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
        }
        this.assertMerchantResponse(response)
        const tradeNo = required(response.out_trade_no, 'PAYMENT_WEBHOOK_TRADE_NOT_FOUND')
        const amountMinor = required(response.total_fee, 'PAYMENT_WEBHOOK_AMOUNT_MISSING')
        parsePositiveMinor(amountMinor, 'webhook total_fee')
        return {
            eventId: response.transaction_id || `${tradeNo}:${response.time_end || response.nonce_str || 'event'}`,
            eventType: 'payment.succeeded',
            tradeNo,
            amountMinor,
            providerOrderId: response.transaction_id || tradeNo,
            status: 'paid',
            raw: response,
        }
    }

    successWebhookResponse(): string {
        return '<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>'
    }

    private assertMerchantResponse(response: Record<string, string>): void {
        if (response.appid !== this.appId || response.mch_id !== this.merchantId) {
            throw new Error('PAYMENT_PROVIDER_MERCHANT_MISMATCH')
        }
    }
}

export class MockPaymentProvider implements PaymentProvider {
    readonly name = 'mock'

    async createPayment(input: PaymentProviderCreateInput): Promise<PaymentProviderCreateResult> {
        return {
            providerOrderId: `mock_${input.tradeNo}`,
            paymentUrl: `https://mock-pay.invalid/checkout/${encodeURIComponent(input.tradeNo)}`,
            raw: { tradeNo: input.tradeNo, amountMinor: input.amountMinor },
        }
    }

    async queryPayment(): Promise<PaymentProviderQueryResult> {
        return { status: 'pending', providerOrderId: '', amountMinor: '', raw: {} }
    }

    async closePayment(): Promise<void> {}

    async refundPayment(input: PaymentProviderRefundInput): Promise<PaymentProviderRefundResult> {
        return { providerRefundId: `mock_refund_${input.refundNo}`, raw: {} }
    }

    async queryRefund(refundNo: string): Promise<PaymentProviderRefundQueryResult> {
        return { status: 'processing', providerRefundId: `mock_refund_${refundNo}`, raw: {} }
    }

    async verifyWebhook(input: { rawBody: string; body?: Record<string, unknown> }): Promise<PaymentProviderWebhookResult> {
        const body = input.body && Object.keys(input.body).length > 0
            ? input.body
            : JSON.parse(input.rawBody || '{}') as Record<string, unknown>
        const status = String(body.status || '').trim().toLowerCase()
        if (status !== 'paid' && status !== 'failed') throw new Error('PAYMENT_WEBHOOK_STATUS_INVALID')
        return {
            eventId: required(body.eventId, 'PAYMENT_WEBHOOK_EVENT_ID_MISSING'),
            eventType: status === 'paid' ? 'payment.succeeded' : 'payment.failed',
            tradeNo: required(body.tradeNo, 'PAYMENT_WEBHOOK_TRADE_NOT_FOUND'),
            amountMinor: required(body.amountMinor, 'PAYMENT_WEBHOOK_AMOUNT_MISSING'),
            providerOrderId: String(body.providerOrderId || body.tradeNo),
            status,
            raw: body,
        }
    }

    successWebhookResponse(): string {
        return JSON.stringify({ ok: true })
    }
}

export function defaultPaymentProviderResolver(name: string): PaymentProvider {
    if (name === 'wechat') return new WechatPayV2Provider()
    if (name === 'mock') {
        const enabled = getConfig<boolean>('payment.allowMockProvider') === true
        const production = String(getConfig<string>('app.env') || '').toLowerCase() === 'production'
            || String(process.env.NODE_ENV || '').toLowerCase() === 'production'
        if (!enabled || production) throw new Error('PAYMENT_MOCK_PROVIDER_DISABLED')
        return new MockPaymentProvider()
    }
    throw new Error('PAYMENT_PROVIDER_UNSUPPORTED')
}
