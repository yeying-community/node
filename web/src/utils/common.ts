import { DateTime } from 'luxon'

export const setLocalStorage = (key: string, value: any) => {
    localStorage.setItem(key, (value && JSON.stringify(value)) || '')
}
export const getLocalStorage = (key: string) => {
    const str = localStorage.getItem(key)
    if (str) {
        return JSON.parse(str)
    }
    return null
}
export const generateUuid = () => {
    // 创建一个 16 字节的随机数组缓冲区
    const buffer = new Uint8Array(16)
    crypto.getRandomValues(buffer)

    // 将缓冲区转换为 UUID 的格式
    buffer[6] &= 0x0f
    buffer[6] |= 0x40
    buffer[8] &= 0x3f
    buffer[8] |= 0x80

    const hex = Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function getCurrentUtcString(): string {
    const current = formatDateTime(getCurrentUtcDateTime())
    return current === null ? '' : current
}

export function formatDateTime(datetime: DateTime) {
    return datetime.toISO()
}

export function getCurrentUtcDateTime() {
    return DateTime.utc()
}

