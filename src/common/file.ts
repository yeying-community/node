import fs from "fs";
import * as os from 'os';
import * as path from 'path';
import { SingletonLogger } from '../domain/facade/logger';

const logger = SingletonLogger.get()

export function readFile(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf8')
    } catch (error) {
        logger.error('read file error', {
            filePath,
            error: error instanceof Error ? error.message : String(error)
        })
        return ''
    }
}

export function exists(filename: string) {
    try {
        fs.accessSync(filename, fs.constants.F_OK);
        return true
    } catch {
        return false
    }
}

export function writeStringToTempFileSync(content: string, prefix: string = 'sync-temp'): string {
  const tempDir = os.tmpdir();
  const fileName = `${prefix}-${Date.now()}.tmp`;
  const filePath = path.join(tempDir, fileName);

  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export function isFile(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile(); // 确保是文件而不是目录
  } catch (error) {
    // 文件不存在或无法访问
    return false;
  }
}
