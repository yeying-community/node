import * as t from '../api/node/types'
import { Api } from '../models'
import { Logger } from 'winston'
import { SingletonLogger } from '../domain/facade/logger';

async function nodeHealthCheck(request: Api.NodeHealthCheckRequest): Promise<t.NodeHealthCheckResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`nodeHealthCheck request=${JSON.stringify(request)}`);
	try {
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
		// 返回 200 响应
		return {
			status: 200,
			body: {
				header: {},
				body: {
					status: {
						code: Api.CommonResponseCodeEnum.OK
					}
				}
			}
		};
	} catch (error) {
		logger.error(`nodeHealthCheck failed ${error}`)
		// 返回错误响应
		return {
			status: 'default',
			actualStatus: 500,  // 从错误中获取状态码
			body: {
				code: -1,
				message: `nodeHealthCheck failed: ${error}`,
			}
		};
	}
}

const api: t.NodeApi = {
	nodeHealthCheck,
}

export default api
