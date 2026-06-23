import { readonly, ref } from 'vue'

export type Locale = 'zh-CN' | 'en-US'

export const DEFAULT_LOCALE: Locale = 'zh-CN'

function readPersistedLocale(): Locale {
    if (typeof window === 'undefined') {
        return DEFAULT_LOCALE
    }
    try {
        return resolveLocale(window.localStorage.getItem('i18nextLng'))
    } catch {
        return DEFAULT_LOCALE
    }
}

function syncDocumentLang(locale: Locale) {
    if (typeof document !== 'undefined') {
        document.documentElement.lang = locale
    }
}

const currentLocale = ref<Locale>(readPersistedLocale())

export function resolveLocale(value: unknown): Locale {
    return String(value || '').trim() === 'en-US' ? 'en-US' : DEFAULT_LOCALE
}

export function getStoredLocale(): Locale {
    return currentLocale.value
}

export function getLocaleRef() {
    return readonly(currentLocale)
}

export function setLocale(value: unknown): Locale {
    const locale = resolveLocale(value)
    currentLocale.value = locale
    if (typeof window !== 'undefined') {
        try {
            window.localStorage.setItem('i18nextLng', locale)
        } catch {
            // ignore storage failure
        }
    }
    syncDocumentLang(locale)
    return locale
}

export function ensureDefaultLocale() {
    return setLocale(currentLocale.value)
}
