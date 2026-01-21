import { createLogger, format, transports } from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'  // 直接导入 DailyRotateFile
import { existsSync, mkdirSync } from 'fs'
import path from 'path'
import { TransformableInfo } from 'logform'
import { SingletonLogger } from '../../domain/facade/logger'

const { combine, timestamp, printf, align } = format

export interface FileConfig {
    filename: string
    dirname: string
    datePattern: string
    maxSize: string
    maxFiles: string
}

export interface LoggerConfig {
    level: 'debug' | 'info' | 'warn' | 'error'
    file?: FileConfig
}

export class LoggerService {
    private config: LoggerConfig

    constructor(config: LoggerConfig) {
        this.config = config
    }

    public initialize(): void {
        if (SingletonLogger.get()) {
            return
        }

        const transportList = []

        if (this.config.file) {
            const fileConfig = { ...this.config.file }
            if (!fileConfig.dirname) {
                fileConfig.dirname = path.join(process.cwd(), 'logs')
            }
            if (!existsSync(fileConfig.dirname)) {
                mkdirSync(fileConfig.dirname, { recursive: true })
            }
            // 使用直接导入的 DailyRotateFile
            transportList.push(new DailyRotateFile(fileConfig))
        } else {
            transportList.push(new transports.Console())
        }

        const templateFunction = (info: TransformableInfo) => {
            return `${info.timestamp} [${info.level.toUpperCase()}] - ${info.stack || info.message}`
        }

        SingletonLogger.set(
            createLogger({
                level: this.config.level,
                format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), align(), printf(templateFunction)),
                transports: transportList
            })
        )
    }
}
