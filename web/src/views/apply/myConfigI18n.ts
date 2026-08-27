import { getStoredLocale, type Locale } from '@/lang/locale'

const messages = {
  'zh-CN': {
    breadcrumb: '安全配置',
    walletIdentityCardTitle: '钱包身份',
    walletIdentityHint: '当前 Node 登录态对应的服务端已验证钱包身份。',
    walletAddress: '钱包地址',
    authMethod: '认证方式',
    authSource: '授权来源',
    issuer: '签发方',
    verified: '已验证',
    notVerified: '未验证',
    passkeyCardTitle: '通行证',
    authenticatorCardTitle: '认证器',
    serviceStatus: '当前状态',
    serviceConfig: '服务配置',
    totpIssuer: '服务名称',
    rpId: '站点标识',
    origin: '来源地址',
    statusAvailable: '可用',
    statusDisabled: '未启用',
    statusConfigError: '配置异常',
    configComplete: '配置完整',
    configIncomplete: '配置不完整',
    configNotEnabled: '未启用',
    errorPrefix: '错误：',
    periodDigits: '周期 / 位数',
    passkeyManageHint: '通行证已收口到钱包身份，注册、查看和撤销请在夜莺钱包插件中完成。',
    passkeyManagedInWallet: '通行证已收口到钱包身份，请在夜莺钱包插件中完成通行证注册、查看和撤销。',
    authenticatorManageHint: '认证器是钱包身份的二次确认能力，密钥由 Node 加密保存，添加和撤销请在夜莺钱包插件中完成。',
    authenticatorManagedInWallet: '认证器已收口到钱包身份，请在夜莺钱包插件中完成添加、查看和撤销。',
    manageInWallet: '钱包插件中管理',
    loadPasskeyStatusFailed: '查询通行证状态失败',
    loadProfileFailed: '查询钱包身份失败',
  },
  'en-US': {
    breadcrumb: 'Security Config',
    walletIdentityCardTitle: 'Wallet Identity',
    walletIdentityHint: 'Server-verified wallet identity for the current Node session.',
    walletAddress: 'Wallet Address',
    authMethod: 'Auth Method',
    authSource: 'Auth Source',
    issuer: 'Issuer',
    verified: 'Verified',
    notVerified: 'Not Verified',
    passkeyCardTitle: 'Passkey',
    authenticatorCardTitle: 'Authenticator',
    serviceStatus: 'Current Status',
    serviceConfig: 'Service Config',
    totpIssuer: 'Service Name',
    rpId: 'RP ID',
    origin: 'Origin',
    statusAvailable: 'Available',
    statusDisabled: 'Disabled',
    statusConfigError: 'Config Error',
    configComplete: 'Complete',
    configIncomplete: 'Incomplete',
    configNotEnabled: 'Disabled',
    errorPrefix: 'Error: ',
    periodDigits: 'Period / Digits',
    passkeyManageHint: 'Passkeys are managed by wallet identity. Register, inspect, and revoke them in the YeYing Wallet extension.',
    passkeyManagedInWallet: 'Passkeys are managed by wallet identity. Register, inspect, or revoke them in the YeYing Wallet extension.',
    authenticatorManageHint: 'Authenticators are wallet identity second-factor credentials. Node encrypts the secret; add and revoke authenticators in the YeYing Wallet extension.',
    authenticatorManagedInWallet: 'Authenticators are managed by wallet identity. Add, inspect, or revoke them in the YeYing Wallet extension.',
    manageInWallet: 'Manage in Wallet',
    loadPasskeyStatusFailed: 'Failed to load Passkey status',
    loadProfileFailed: 'Failed to load wallet identity',
  },
} as const

export type MyConfigMessageKey = keyof typeof messages['zh-CN']

export function getMyConfigLocale(): Locale {
  return getStoredLocale()
}

export function getMyConfigMessage(locale: Locale, key: MyConfigMessageKey): string {
  return messages[locale][key] || messages['zh-CN'][key]
}
