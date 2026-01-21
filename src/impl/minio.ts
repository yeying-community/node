import * as t from '../api/minio/types'
import { Api } from '../models'
import { SingletonLogger } from '../domain/facade/logger';
import { Logger } from 'winston'
// Minio 已弃用，前端直接通过 WebDAV 存储

async function minioPresignedUploadUrl(request: Api.MiniosdkPresignedUploadUrlRequest): Promise<t.MinioPresignedUploadUrlResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`minioPresignedUploadUrl request=${JSON.stringify(request)}`);
	try {
		// 可在函数开头添加参数验证
		if (request.body?.filename === undefined) {
			return {
				status: 'default',
				actualStatus: 400,
				body: {
					code: 400,
					message: 'Missing application data',
				}
			};
		}

		// 请求身份认证，检查 header 
		// const authenticate: Authenticate = SingletonAuthenticate.get()
		// 转换
		if (request.header === undefined) {
			return {
				status: 'default',
				actualStatus: 400,
				body: {
					code: 400,
					message: 'Missing application data',
				}
			};
		}
		// const messageHeader: MessageHeader = convertCommonToMessageHeader(request.header);
		// const body = new TextEncoder().encode(JSON.stringify(request.body, null, 0));
		// authenticate.verifyHeader(messageHeader, body)

		return {
			status: 'default',
			actualStatus: 501,
			body: {
				code: 501,
				message: 'Storage moved to WebDAV (client-side). Minio endpoint is deprecated.',
			},
		};
	} catch (error) {
		logger.error(`minioPresignedUploadUrl failed ${error}`)
		// 返回错误响应
		return {
			status: 'default',
			actualStatus: 500,  // 从错误中获取状态码
			body: {
				code: -1,
				message: `minioPresignedUploadUrl failed: ${error}`,
			}
		};
	}
}


const api: t.MinioApi = {
	minioPresignedUploadUrl,
}

export default api
