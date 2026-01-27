import * as t from '../api/application/types'
import { Authenticate } from '../common/authenticate';
import { SingletonAuthenticate } from '../domain/facade/authenticate';
import { SingletonLogger } from '../domain/facade/logger';
import { Application, convertToApplication, SearchCondition } from '../domain/model/application';
import { ApplicationService } from '../domain/service/application'
import { Api } from '../models'
import { Logger } from 'winston'
import { MessageHeader } from '../yeying/api/common/message';
import { AuthenticateTypeEnum } from '../yeying/api/common/code';
import { getRequestUser } from '../common/requestContext';
import { ensureUserActive } from '../common/permission';

async function applicationCreate(request: Api.ApplicationCreateApplicationRequest): Promise<t.ApplicationCreateResponse> {
	const logger: Logger = SingletonLogger.get()
    logger.info(`applicationCreate request=${JSON.stringify(request)}`);
    const applicationService = new ApplicationService();
    try {
		// 可在函数开头添加参数验证
		if (request.body?.application === undefined) {
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

        const user = getRequestUser()
        if (user?.address) {
			try {
				await ensureUserActive(user.address)
			} catch (error) {
				return {
					status: 'default',
					actualStatus: 403,
					body: {
						code: 403,
						message: 'User status disabled',
					}
				};
			}
			const owner = request.body?.application?.owner
			if (!owner) {
				return {
					status: 'default',
					actualStatus: 400,
					body: {
						code: 400,
						message: 'Missing application owner',
					}
				};
			}
			if (owner !== user.address) {
				return {
					status: 'default',
					actualStatus: 403,
					body: {
						code: 403,
						message: 'Owner mismatch',
					}
				};
			}
        }

        // 假设 save 方法返回保存后的应用数据
        const savedApplication = await applicationService.save(convertToApplication(request.body?.application));
        
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
			}  // 确保类型匹配 Api.ApplicationCreateApplicationResponse
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

function convertCommonToMessageHeader(commonHeader: Api.CommonMessageHeader): MessageHeader {
  return MessageHeader.fromPartial({
    did: commonHeader.did,
    authType: commonHeader.authType as unknown as AuthenticateTypeEnum,
    authContent: commonHeader.authContent,
    nonce: commonHeader.nonce,
    timestamp: commonHeader.timestamp,
    version: commonHeader.version,
  });
}

async function applicationDelete(request: Api.ApplicationDeleteApplicationRequest): Promise<t.ApplicationDeleteResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`applicationDelete request=${JSON.stringify(request)}`);
    const applicationService = new ApplicationService();
    try {
		// 可在函数开头添加参数验证
		if (request.body?.did === undefined || request.body?.version === undefined) {
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

        const user = getRequestUser()
        if (user?.address) {
			try {
				await ensureUserActive(user.address)
			} catch (error) {
				return {
					status: 'default',
					actualStatus: 403,
					body: {
						code: 403,
						message: 'User status disabled',
					}
				};
			}
			const app = await applicationService.query(request.body?.did, request.body?.version);
			if (!app || !app.did) {
				return {
					status: 'default',
					actualStatus: 404,
					body: {
						code: 404,
						message: 'Application not found',
					}
				};
			}
			if (app.owner !== user.address) {
				return {
					status: 'default',
					actualStatus: 403,
					body: {
						code: 403,
						message: 'Owner mismatch',
					}
				};
			}
        }
        const deleteApplication = await applicationService.delete(request.body?.did, request.body?.version);
        
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

async function applicationDetail(request: Api.ApplicationApplicationDetailRequest): Promise<t.ApplicationDetailResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`applicationDetail request=${JSON.stringify(request)}`);
    const applicationService = new ApplicationService();
    try {
		console.log(`request.body?.did = ${request.body?.did}`)
		console.log(`request.body?.version = ${request.body?.version}`)
		// 可在函数开头添加参数验证
		if (request.body?.did === undefined || request.body?.version === undefined) {
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
					message: 'Missing header data',
				}
			};
		}

        const detailApplication = await applicationService.query(request.body?.did, request.body?.version);
        
        // 返回 200 响应
        return {
            status: 200,
            body: {
				header: {},
				body: {
					status: {
						code: Api.CommonResponseCodeEnum.OK
					},
					application: applicationToMetadata(detailApplication)
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

async function applicationSearch(request: Api.ApplicationSearchApplicationRequest): Promise<t.ApplicationSearchResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`applicationSearch request=${JSON.stringify(request)}`);
    const applicationService = new ApplicationService();
    try {
		const condition = request.body?.condition
		const page = request.body?.page
		if (condition === undefined) {
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

		let pageIndex = page?.page
		let pageSize = page?.pageSize
		if (pageIndex === undefined || pageIndex === 0) {
			pageIndex = 1
		}
		if (pageSize === undefined || pageSize === 0) {
			pageSize = 10
		}

        const searchApplication = await applicationService.search(convertToSearchCondition(condition), pageIndex, pageSize);
		const appList = searchApplication.data.map((data) => applicationToMetadata(data))
		console.log(`searchApplication=${JSON.stringify(appList)}`)
        
        // 返回 200 响应
        return {
            status: 200,
            body: {
				header: {},
				body: {
					status: {
						code: Api.CommonResponseCodeEnum.OK
					},
					applications: appList
				}
			}
        };
    } catch (error) {
		logger.error(`applicationSearch failed ${error}`)
        // 返回错误响应
        return {
            status: 'default',
            actualStatus: 500,  // 从错误中获取状态码
            body: {
                code: -1,
                message: `applicationSearch failed: ${error}`,
            }
        };
    }
}

async function applicationQueryByUid(request: Api.ApplicationQueryByUidApplicationRequest): Promise<t.ApplicationQueryByUidResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`applicationDetail request=${JSON.stringify(request)}`);
    const applicationService = new ApplicationService();
    try {
		console.log(`request.body?.did = ${request.body?.uid}`)
		// 可在函数开头添加参数验证
		if (request.body?.uid === undefined) {
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
					message: 'Missing header data',
				}
			};
		}

        const detailApplication = await applicationService.queryByUid(request.body?.uid);
        
        // 返回 200 响应
        return {
            status: 200,
            body: {
				header: {},
				body: {
					status: {
						code: Api.CommonResponseCodeEnum.OK
					},
					application: applicationToMetadata(detailApplication)
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

function applicationToMetadata(app: Application): Api.CommonApplicationMetadata {
  // 校验 code 是否是合法的 CommonApplicationCodeEnum 成员
  const isValidCode = (value: string): value is Api.CommonApplicationCodeEnum => {
    return Object.values(Api.CommonApplicationCodeEnum).includes(value as any);
  };

  // 校验 serviceCodes 字符串，分割并过滤出合法的枚举值
  const parseServiceCodes = (value: string): Api.CommonServiceCodeEnum[] => {
    if (!value) return [];
    return value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(code => Object.values(Api.CommonServiceCodeEnum).includes(code as any)) as Api.CommonServiceCodeEnum[];
  };

  return {
    owner: app.owner,
    network: app.network,
    address: app.address,
    did: app.did,
    version: app.version,
    name: app.name,
    // 字符串 → 枚举（安全转换）
    code: isValidCode(app.code) ? app.code : undefined,
    description: app.description,
    location: app.location,
    // 字符串（如 "SERVICE_A,SERVICE_B"） → 枚举数组
    serviceCodes: parseServiceCodes(app.serviceCodes),
    avatar: app.avatar,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    signature: app.signature,
    codePackagePath: app.codePackagePath,
	ownerName: app.ownerName,
	uid: app.uid,
    status: app.status as Api.CommonApplicationStatusEnum,
    isOnline: app.isOnline
  };
}

function convertToSearchCondition(
  condition: Api.ApplicationSearchApplicationCondition
): SearchCondition {
  const result: SearchCondition = {
    code: condition.code,
    owner: condition.owner,
    name: condition.name,
    keyword: condition.keyword,
    status: condition.status
  };

  // 映射 status -> isOnline
  if (condition.status !== undefined) {
    result.isOnline = condition.status === Api.CommonApplicationStatusEnum.BUSINESSSTATUSONLINE;
  }

  return result;
}


const api: t.ApplicationApi = {
	applicationCreate,
	applicationDelete,
	applicationDetail,
	applicationQueryByUid,
	applicationSearch,
}

export default api
