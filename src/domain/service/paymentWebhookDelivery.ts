import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import ipaddr = require('ipaddr.js')
import { getConfig } from '../../config/runtime'
import { buildMerchantPaymentSignature } from './paymentCrypto'

function isPublicIp(value: string): boolean {
    if (!net.isIP(value)) return false
    try {
        return ipaddr.process(value).range() === 'unicast'
    } catch {
        return false
    }
}
function normalizeHostname(value: string): string {
    return String(value || '').trim().replace(/^\[|\]$/g, '').toLowerCase()
}

export function validatePaymentCallbackUrl(value: string): string {
    let url: URL
    try { url = new URL(value) } catch { throw new Error('PAYMENT_CALLBACK_URL_INVALID') }
    const protocolAllowed = url.protocol === 'https:' || url.protocol === 'http:'
    const hostname = normalizeHostname(url.hostname)
    if (!protocolAllowed || url.username || url.password || url.hash || !hostname) throw new Error('PAYMENT_CALLBACK_URL_INVALID')
    const production = String(getConfig<string>('app.env') || '').toLowerCase() === 'production'
        || String(process.env.NODE_ENV || '').toLowerCase() === 'production'
    if (production && (url.protocol !== 'https:' || ['localhost', 'localhost.localdomain'].includes(hostname))) {
        throw new Error('PAYMENT_CALLBACK_URL_INVALID')
    }
    if (net.isIP(hostname) && !isPublicIp(hostname) && !(url.protocol === 'http:' && !production && ['127.0.0.1', '::1'].includes(hostname))) {
        throw new Error('PAYMENT_CALLBACK_URL_INVALID')
    }
    return url.toString()
}

function localDevelopmentHostname(hostname: string): boolean {
    return ['localhost', 'localhost.localdomain', '127.0.0.1', '::1'].includes(normalizeHostname(hostname))
}

async function resolveTarget(url: URL): Promise<{ address: string; family: number }> {
    const hostname = normalizeHostname(url.hostname)
    const family = net.isIP(hostname)
    const addresses = family
        ? [{ address: hostname, family }]
        : await dns.lookup(hostname, { all: true, verbatim: true })
    if (!addresses.length) throw new Error('PAYMENT_CALLBACK_DNS_FAILED')
    const production = String(getConfig<string>('app.env') || '').toLowerCase() === 'production'
        || String(process.env.NODE_ENV || '').toLowerCase() === 'production'
    const localDevelopment = !production && localDevelopmentHostname(hostname)
    if (addresses.some(item => !isPublicIp(item.address)) && !localDevelopment) throw new Error('PAYMENT_CALLBACK_TARGET_BLOCKED')
    return addresses[crypto.randomInt(addresses.length)]
}

export async function validatePaymentCallbackTarget(value: string): Promise<string> {
    const normalized = validatePaymentCallbackUrl(value)
    try {
        await resolveTarget(new URL(normalized))
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('PAYMENT_')) throw error
        throw new Error('PAYMENT_CALLBACK_DNS_FAILED')
    }
    return normalized
}

export async function deliverPaymentWebhook(input: {
    url: string
    payload: string
    secret: string
    eventId: string
    merchantId: string
    timeoutMs: number
}): Promise<{ status: number }> {
    const target = new URL(validatePaymentCallbackUrl(input.url))
    let resolved: { address: string; family: number }
    try {
        resolved = await resolveTarget(target)
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('PAYMENT_')) throw error
        throw new Error('PAYMENT_CALLBACK_DNS_FAILED')
    }
    const timestamp = String(Date.now())
    const body = input.payload
    const signature = buildMerchantPaymentSignature({
        merchantId: input.merchantId,
        timestamp,
        nonce: input.eventId,
        body: JSON.parse(body) as Record<string, unknown>,
        secret: input.secret,
    })
    const transport = target.protocol === 'https:' ? https : http
    const options: https.RequestOptions = {
        hostname: resolved.address,
        family: resolved.family,
        port: target.port ? Number(target.port) : target.protocol === 'https:' ? 443 : 80,
        method: 'POST',
        path: `${target.pathname}${target.search}`,
        servername: target.protocol === 'https:' && !net.isIP(normalizeHostname(target.hostname))
            ? normalizeHostname(target.hostname) : undefined,
        timeout: input.timeoutMs,
        headers: {
            host: target.host,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            'x-yeying-payment-event': input.eventId,
            'x-yeying-payment-timestamp': timestamp,
            'x-yeying-payment-nonce': input.eventId,
            'x-yeying-payment-signature': signature,
        },
    }
    return await new Promise((resolve, reject) => {
        const request = transport.request(options, response => {
            let received = 0
            let settled = false
            response.on('data', chunk => {
                received += Buffer.byteLength(chunk)
                if (received > 4096 && !settled) {
                    settled = true
                    request.destroy(new Error('PAYMENT_CALLBACK_RESPONSE_TOO_LARGE'))
                    reject(new Error('PAYMENT_CALLBACK_RESPONSE_TOO_LARGE'))
                }
            })
            response.on('end', () => {
                if (settled) return
                const status = Number(response.statusCode || 500)
                if (status < 200 || status >= 300) reject(new Error(`PAYMENT_CALLBACK_HTTP_${status}`))
                else resolve({ status })
            })
        })
        request.on('error', error => reject(error instanceof Error && error.message.startsWith('PAYMENT_') ? error : new Error('PAYMENT_CALLBACK_REQUEST_FAILED')))
        request.on('timeout', () => request.destroy(new Error('PAYMENT_CALLBACK_TIMEOUT')))
        request.write(body)
        request.end()
    })
}
