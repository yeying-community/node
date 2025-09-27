import * as t from '../api/service/types'
import { ServiceService } from '../domain/service/service'
import { Api } from '../models'
import { SingletonLogger } from '../domain/facade/logger';
import { Logger } from 'winston'
import { Service, SearchCondition } from '../domain/model/service';

async function serviceCreate(request: Api.ServiceCreateServiceRequest): Promise<t.ServiceCreateResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`serviceCreate request=${JSON.stringify(request)}`);
	try {
		// 可在函数开头添加参数验证
		if (request.body?.service === undefined) {
			return {
				status: 'default',
				actualStatus: 400,
				body: {
					code: 400,
					message: 'Missing service data',
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
					message: 'Missing header data',
				}
			};
		}
		const serviceService = new ServiceService()
		await serviceService.add(convertToService(request.body?.service))

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
		logger.error(`Save failed ${error}`)
        // 返回错误响应
        return {
            status: 'default',
            actualStatus: 500,  // 从错误中获取状态码
            body: {
                code: -1,
                message: `Save failed: ${error}`,
            }
        };
	}
}

function convertToService(metadata: Api.CommonServiceMetadata): Service {
  return {
    did: metadata.did || '',
    version: metadata.version || 0,
    owner: metadata.owner || '',
	ownerName: metadata.ownerName || '',
    network: metadata.network || '',
    address: metadata.address || '',
    name: metadata.name || '',
    description: metadata.description || '',
    code: metadata.code || 'SERVICE_CODE_UNKNOWN', // 默认未知编码
    apiCodes: (metadata.apiCodes || []).join(','), // 数组转为逗号分隔字符串
    proxy: metadata.proxy || '',
    grpc: metadata.grpc || '',
    avatar: metadata.avatar || '',
    createdAt: metadata.createdAt || '',
    updatedAt: metadata.updatedAt || '',
    signature: metadata.signature || '',
    codePackagePath: metadata.codePackagePath || '',
  };
}

async function serviceDelete(request: Api.ServiceDeleteServiceRequest): Promise<t.ServiceDeleteResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`serviceDelete request=${JSON.stringify(request)}`);
	try {
		// 可在函数开头添加参数验证
		if (request.body?.did === undefined || request.body?.version === undefined) {
			return {
				status: 'default',
				actualStatus: 400,
				body: {
					code: 400,
					message: 'Missing service data',
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
					message: 'Missing header data',
				}
			};
		}
		const serviceService = new ServiceService()
		await serviceService.delete(request.body?.did, request.body?.version)

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
		logger.error(`Delete failed ${error}`)
        // 返回错误响应
        return {
            status: 'default',
            actualStatus: 500,  // 从错误中获取状态码
            body: {
                code: -1,
                message: `Delete failed: ${error}`,
            }
        };
	}
}

async function serviceDetail(request: Api.ServiceDetailServiceRequest): Promise<t.ServiceDetailResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`serviceDetail request=${JSON.stringify(request)}`);
	try {
		// 可在函数开头添加参数验证
		if (request.body?.did === undefined || request.body?.version === undefined) {
			return {
				status: 'default',
				actualStatus: 400,
				body: {
					code: 400,
					message: 'Missing service data',
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
					message: 'Missing header data',
				}
			};
		}
		const serviceService = new ServiceService()
		const service = await serviceService.get(request.body?.did, request.body?.version)

		// 返回 200 响应
		return {
			status: 200,
			body: {
				header: {},
				body: {
					status: {
						code: Api.CommonResponseCodeEnum.OK
					},
					service: serviceToCommonServiceMetadata(service)
				}
			}
		};
	} catch (error) {
		logger.error(`Detail failed ${error}`)
        // 返回错误响应
        return {
            status: 'default',
            actualStatus: 500,  // 从错误中获取状态码
            body: {
                code: -1,
                message: `Detail failed: ${error}`,
            }
        };
	}
}

async function serviceSearch(request: Api.ServiceSearchServiceRequest): Promise<t.ServiceSearchResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`serviceSearch request=${JSON.stringify(request)}`);
	try {
		// 可在函数开头添加参数验证
		if (request.body?.condition === undefined) {
			return {
				status: 'default',
				actualStatus: 400,
				body: {
					code: 400,
					message: 'Missing service data',
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
					message: 'Missing header data',
				}
			};
		}
		const page = request.body.page
		let pageIndex = page?.page
		let pageSize = page?.pageSize
		if (pageIndex === undefined || pageIndex === 0) {
			pageIndex = 1
		}
		if (pageSize === undefined || pageSize === 0) {
			pageSize = 10
		}
		const serviceService = new ServiceService()
		const result = await serviceService.search(convertToSearchCondition(request.body?.condition), pageIndex, pageSize)
		const serviceList = result.data?.map((data) => serviceToCommonServiceMetadata(data))
		console.log(`serviceList=${JSON.stringify(serviceList)}`)
		// 返回 200 响应
		return {
			status: 200,
			body: {
				header: {},
				body: {
					status: {
						code: Api.CommonResponseCodeEnum.OK
					},
					services: serviceList,
					page: result.page
				}
			}
		};
	} catch (error) {
		logger.error(`Search failed ${error}`)
        // 返回错误响应
        return {
            status: 'default',
            actualStatus: 500,  // 从错误中获取状态码
            body: {
                code: -1,
                message: `Search failed: ${error}`,
            }
        };
	}
}

function serviceToCommonServiceMetadata(service: Service): Api.CommonServiceMetadata {
  // 校验 code 是否是合法的 CommonServiceCodeEnum 成员
  const isValidServiceCode = (value: string): value is Api.CommonServiceCodeEnum => {
    return Object.values(Api.CommonServiceCodeEnum).includes(value as any);
  };

  // 解析 apiCodes 字符串为枚举数组
  const parseApiCodes = (value: string): Api.CommonApiCodeEnum[] => {
    if (!value) return [];
    return value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(code => Object.values(Api.CommonApiCodeEnum).includes(code as any)) as Api.CommonApiCodeEnum[];
  };

  return {
    did: service.did,
    version: service.version,
    owner: service.owner,
    network: service.network,
    address: service.address,
    name: service.name,
    description: service.description,
    // 字符串 → 枚举（安全转换）
    code: isValidServiceCode(service.code) ? service.code : undefined,
    // 字符串（如 "API_A,API_B"）→ 枚举数组
    apiCodes: parseApiCodes(service.apiCodes),
    proxy: service.proxy,
    grpc: service.grpc,
    avatar: service.avatar,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
    signature: service.signature,
    codePackagePath: service.codePackagePath,
	ownerName: service.ownerName,
  };
}

function convertToSearchCondition(
  condition: Api.ServiceSearchServiceCondition
): SearchCondition {
  return {
    owner: condition.owner,
    code: condition.code, // 枚举值本身就是字符串，可以直接赋值
    name: condition.name,
    keyword: condition.keyword,
    // 注意：isOnline 不在 ServiceSearchServiceCondition 中，无法映射
  };
}

const api: t.ServiceApi = {
	serviceCreate,
	serviceDelete,
	serviceDetail,
	serviceSearch,
}

export default api
