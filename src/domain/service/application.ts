import { Logger } from 'winston'
import { SingletonLogger } from '../facade/logger'
import { ApplicationManager } from '../manager/application'
import {
    Application,
    convertApplicationFrom,
    convertApplicationTo,
    PageResult,
    SearchCondition
} from '../model/application'
import { ApplicationDO } from '../mapper/entity'
import { ApplicationReleaseService } from './applicationRelease'

export class ApplicationService {
    private logger: Logger = SingletonLogger.get()
    private applicationManager: ApplicationManager
    private applicationReleaseService: ApplicationReleaseService

    constructor() {
        this.applicationManager = new ApplicationManager()
        this.applicationReleaseService = new ApplicationReleaseService()
    }

    async save(application: Application) {
        await this.applicationManager.save(convertApplicationTo(application))
    }

    async saveVersion(application: Application, current?: Application) {
        return await this.applicationManager.saveWithRelease(
            convertApplicationTo(application),
            current ? convertApplicationTo(current) : undefined
        )
    }
    async query(did: string, version: number) {
        const r: ApplicationDO | null | undefined = await this.applicationManager.query(did, version)
        if (r) return convertApplicationFrom(r)
        const releases = await this.applicationReleaseService.findByDidVersion(did, version)
        return releases ? await this.applicationReleaseService.snapshotToApplication(releases) : null
    }

    async queryByUid(uid: string) {
        const r: ApplicationDO | null | undefined = await this.applicationManager.queryByUid(uid)
        return convertApplicationFrom(r)
    }

    async search(condition: SearchCondition, page: number, pageSize: number): Promise<PageResult> {
        const result = await this.applicationManager.queryByCondition(condition, page, pageSize)
        return {
            data: result.data.map((s: any) => convertApplicationFrom(s)),
            page: result.page
        }
    }

    async delete(did: string, version: number) {
        return await this.applicationManager.delete(did, version)
    }
}
