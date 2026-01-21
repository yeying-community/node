import { existsSync, readFileSync, writeFileSync } from 'fs'

import multiavatar from '@multiavatar/multiavatar'
import { SingletonLogger } from '../facade/logger'
import { Logger } from 'winston'
// NOTE: yeying-web3 removed; identity helpers are disabled/stubbed.

type BlockAddress = {
    identifier: string
    privateKey: string
}

type SecurityAlgorithm = {
    name: string
    iv: string
}

type SecurityConfig = {
    algorithm?: SecurityAlgorithm
}

type IdentityTemplate = Record<string, any> & {
    name?: string
    avatar?: string
    securityConfig?: SecurityConfig
}

type Identity = {
    metadata?: Record<string, any>
    blockAddress?: string
    securityConfig?: SecurityConfig
}
import { CipherTypeEnum } from '../../yeying/api/common/code'
import { decodeBase64, encodeBase64 } from '../../common/string'
import {
    convertCipherTypeFrom,
    convertCipherTypeTo,
    convertToAlgorithmName,
    decrypt,
    deriveRawKeyFromString,
    encrypt,
    generateIv
} from '../../common/crypto'

export class IdentityService {
    private logger: Logger = SingletonLogger.get()

    constructor() {}

    async load(identityPath: string) {
        if (!existsSync(identityPath)) {
            throw new Error(`There is no ${identityPath} identity for loading.`)
        }

        // yeying-web3 removed: skip identity verification
        const identity: Identity = JSON.parse(readFileSync(identityPath, 'utf8'))
        return identity
    }

    save(identityPath: string, identity: Identity) {
        // 如果文件已经存在则覆盖写
        writeFileSync(identityPath, JSON.stringify(identity))
        console.log(`Save identity file=${identityPath}`)
    }

    async encryptBlockAddress(_blockAddress: BlockAddress, _securityAlgorithm: SecurityAlgorithm, _password: string) {
        // yeying-web3 removed: skip encryption and return serialized payload
        const payload = JSON.stringify(_blockAddress)
        return Buffer.from(payload).toString('base64')
    }

    async decryptBlockAddress(blockAddress: string, _securityAlgorithm: SecurityAlgorithm, _password: string) {
        // yeying-web3 removed: best-effort decode
        try {
            const raw = decodeBase64(blockAddress).toString('utf-8')
            return JSON.parse(raw) as BlockAddress
        } catch {
            return { identifier: '', privateKey: '' }
        }
    }

    async update(password: string, template: IdentityTemplate, identity: Identity) {
        // yeying-web3 removed: skip update and return input
        return identity
 
    }

    async create(password: string, template: IdentityTemplate) {
        if (template.avatar === undefined) {
            template.avatar = this.createAvatar(template.name || '')
        }

        if (template.securityConfig === undefined) {
            template.securityConfig = {
                algorithm: {
                    name: convertCipherTypeTo(CipherTypeEnum.CIPHER_TYPE_AES_GCM_256),
                    iv: encodeBase64(generateIv().buffer)
                }
            }
        }

        const blockAddress: BlockAddress = { identifier: 'did:disabled', privateKey: '' }
        if (template.securityConfig.algorithm === undefined) {
            throw new Error("template.securityConfig.algorithm is undefined")
        }
        const encryptedBlockAddress = await this.encryptBlockAddress(
            blockAddress,
            template.securityConfig.algorithm,
            password
        )

        // yeying-web3 removed: return minimal identity
        return {
            metadata: template,
            blockAddress: encryptedBlockAddress,
            securityConfig: template.securityConfig
        }
    }

    private createAvatar(name: string) {
        return `data:image/svg+xml;base64,${Buffer.from(decodeURIComponent(encodeURIComponent(multiavatar(name))), 'utf-8').toString('base64')}`
    }

    private readAvatarFile(filePath: string) {
        if (!existsSync(filePath)) {
            return undefined
        }

        const data = readFileSync(filePath, 'base64')
        return 'data:image/webp;base64,' + data
    }
}
