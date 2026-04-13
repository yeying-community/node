import { createLogger, format, transports } from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'  // 直接导入 DailyRotateFile
import { existsSync, mkdirSync } from 'fs'
import path from 'path'
import { TransformableInfo } from 'logform'
import { SingletonLogger } from '../../domain/facade/logger'

const { combine, timestamp, printf, align } = format

export interface FileConfig {
    filename?: string
    dirname?: string
    datePattern?: string
    maxSize?: string
    maxFiles?: string
    zippedArchive?: boolean
}

export interface LoggerConfig {
    level?: 'debug' | 'info' | 'warn' | 'error'
    file?: FileConfig
    console?: boolean
}

export class LoggerService {
    private config: Required<Omit<LoggerConfig, 'file'>> & { file: Required<FileConfig> }

    constructor(config?: LoggerConfig) {
        const defaultFileConfig: Required<FileConfig> = {
            filename: 'app-%DATE%.log',
            dirname: path.join(process.cwd(), 'logs'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d',
            zippedArchive: true
        }
        const fileConfig = {
            ...defaultFileConfig,
            ...(config?.file || {})
        }
        this.config = {
            level: config?.level || 'info',
            console: config?.console !== false,
            file: fileConfig
        }
    }

    private static serializeMeta(info: TransformableInfo): string {
        const meta: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(info)) {
            if (key === 'level' || key === 'message' || key === 'timestamp' || key === 'stack') {
                continue
            }
            meta[key] = value
        }
        if (Object.keys(meta).length === 0) {
            return ''
        }
        try {
            return ` ${JSON.stringify(meta)}`
        } catch {
            return ' {"meta":"[unserializable]"}'
        }
    }

    public initialize(): void {
        if (SingletonLogger.get()) {
            return
        }

        const transportList = []

        const fileConfig = { ...this.config.file }
        if (!existsSync(fileConfig.dirname)) {
            mkdirSync(fileConfig.dirname, { recursive: true })
        }
        // 默认启用文件落盘，并按天轮转
        transportList.push(new DailyRotateFile(fileConfig))

        if (this.config.console) {
            transportList.push(new transports.Console())
        }

        const templateFunction = (info: TransformableInfo) => {
            const baseMessage = `${info.timestamp} [${String(info.level).toUpperCase()}] - ${info.stack || info.message}`
            return `${baseMessage}${LoggerService.serializeMeta(info)}`
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
