import { AuthenticateTypeEnum, ResponseCodeEnum } from '../yeying/api/common/code'
import { MessageHeader } from '../yeying/api/common/message'
import { getCurrentUtcString, isExpired, parseDateTime } from './date'
import { generateUuid } from './string'
import { composite } from './bytes'
import { SingletonLogger } from '../domain/facade/logger'
import { Logger } from 'winston'
import { createResponseStatus } from '../application/model/common'
import { RequestException } from './exception'
// NOTE: yeying-web3 removed; signature helpers disabled.

type BlockAddress = {
    identifier: string
    privateKey: string
}
import { computeHash } from './crypto'

export class Authenticate {
    private logger: Logger = SingletonLogger.get()
    private blockAddress: BlockAddress

    constructor(blockAddress: BlockAddress) {
        this.blockAddress = blockAddress
    }

    getDid() {
        return this.blockAddress.identifier
    }

    async createHeader(body?: Uint8Array) {
        const did = this.blockAddress.identifier
        const timestamp = getCurrentUtcString()
        const nonce = generateUuid()
        const version = 0
        const type = AuthenticateTypeEnum.AUTHENTICATE_TYPE_CERT
        const header = MessageHeader.create({
            authType: type,
            did: did,
            timestamp: timestamp,
            nonce: nonce,
            version: version
        })

        const h = MessageHeader.encode(header).finish()
        const data = body === undefined ? h : composite(h, body)
        header.authContent = await this.signData(data)
        return header
    }

    async signData(data: Uint8Array) {
        // yeying-web3 removed: skip signature
        return ''
    }

    static async verifyData(did: string, data: Uint8Array, signature: string) {
        // yeying-web3 removed: always pass
        return true
    }

    async verifyHeader(header: MessageHeader, body?: Uint8Array) {
        const datetime = parseDateTime(header.timestamp)
        if (datetime === undefined) {
            throw new Error("datetime is undefined")
        }
        if (isExpired(datetime, 5 * 60)) {
            this.logger.error(`The request=${header.nonce} is timeout.`)
            throw new RequestException(createResponseStatus(ResponseCodeEnum.INVALID_ARGUMENT, 'Timestamp expired'))
        }

        const signature = header.authContent
        header.authContent = ''
        const h = MessageHeader.encode(header).finish()
        const data = body === undefined ? h : composite(h, body)
        const success = await Authenticate.verifyData(header.did, data, signature)
        if (!success) {
            this.logger.error(`The request=${header.nonce} is invalid, signature=${signature}.`)
            throw new RequestException(createResponseStatus(ResponseCodeEnum.UNAUTHENTICATED, 'Invalid signature'))
        }
    }
}
