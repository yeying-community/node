import * as t from '../api/audit/types'
import { Api } from '../models'
import { Logger } from 'winston'
import { SingletonLogger } from '../domain/facade/logger';
import { AuditService } from '../domain/service/audit';
import { CommentDO } from '../domain/mapper/entity';
import { generateUuid } from '../application/model/audit';
import { AuditMetadata } from '../yeying/api/audit/audit';
import { QueryCondition } from '../domain/model/audit';

async function auditApprove(request: Api.AuditAuditApproveRequest): Promise<t.AuditApproveResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`auditApprove request=${JSON.stringify(request)}`);
	const auditService = new AuditService();
	try {
		// 可在函数开头添加参数验证
		if (!request.body?.metadata) {
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

		const savedApprove = await auditService.approve(auditCommentMetadataToCommentDO(request.body?.metadata));
		
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
		logger.error(`auditApprove failed ${error}`)
		// 返回错误响应
		return {
			status: 'default',
			actualStatus: 500,  // 从错误中获取状态码
			body: {
				code: -1,
				message: `auditApprove failed: ${error}`,
			}
		};
	}
}

function auditCommentMetadataToCommentDO(
  metadata: Api.AuditCommentMetadata
): CommentDO {
  const comment = new CommentDO();

  // 处理 uid，如果不存在则可以生成一个新的 UUID（可选）
  comment.uid = metadata.uid || generateUuid(); // 需要 Node.js 14.17+ 或使用其他 UUID 库

  // 必需字段，假设 auditId 和 text 在业务上不应为空
  comment.auditId = metadata.auditId || '';
  comment.text = metadata.text || '';
  comment.status = metadata.status || 'PENDING'; // 假设有一个默认状态，如 'PENDING'

  // 时间字段处理
  comment.createdAt = metadata.createdAt || new Date().toISOString();
  comment.updatedAt = metadata.updatedAt || new Date().toISOString();

  // 签名字段
  comment.signature = metadata.signature || '';

  return comment;
}

async function auditCancel(request: Api.AuditAuditCancelRequest): Promise<t.AuditCancelResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`auditCancel request=${JSON.stringify(request)}`);
	const auditService = new AuditService();
	try {
		// 可在函数开头添加参数验证
		if (!request.body?.uid) {
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

		const auditCancel = await auditService.cancel(request.body?.uid);
		
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
		logger.error(`auditCancel failed ${error}`)
		// 返回错误响应
		return {
			status: 'default',
			actualStatus: 500,  // 从错误中获取状态码
			body: {
				code: -1,
				message: `auditCancel failed: ${error}`,
			}
		};
	}
}

async function auditCreate(request: Api.AuditAuditCreateRequest): Promise<t.AuditCreateResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`auditCreate request=${JSON.stringify(request)}`);
	const auditService = new AuditService();
	try {
		// 可在函数开头添加参数验证
		if (!request.body?.meta) {
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

		const auditCreate = await auditService.create(convertToAuditMetadata(request.body?.meta));
		
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
		logger.error(`auditCreate failed ${error}`)
		// 返回错误响应
		return {
			status: 'default',
			actualStatus: 500,  // 从错误中获取状态码
			body: {
				code: -1,
				message: `auditCreate failed: ${error}`,
			}
		};
	}
}

function convertToAuditMetadata(
  input: Api.AuditAuditMetadata
): AuditMetadata {
  if (!input.uid) throw new Error('uid is required');
  if (!input.appOrServiceMetadata) throw new Error('appOrServiceMetadata is required');
  if (!input.applicant) throw new Error('applicant is required');
  if (!input.approver) throw new Error('approver is required');
  if (!input.reason) throw new Error('reason is required');
  if (!input.createdAt) throw new Error('createdAt is required');
  if (!input.updatedAt) throw new Error('updatedAt is required');
  if (!input.signature) throw new Error('signature is required');

  return {
    uid: input.uid,
    appOrServiceMetadata: input.appOrServiceMetadata,
    applicant: input.applicant,
    approver: input.approver,
    reason: input.reason,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    signature: input.signature,
  };
}

async function auditDetail(request: Api.AuditAuditDetailRequest): Promise<t.AuditDetailResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`auditDetail request=${JSON.stringify(request)}`);
	const auditService = new AuditService();
	try {
		// 可在函数开头添加参数验证
		if (!request.body?.uid) {
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

		const auditDetail = await auditService.detail(request.body?.uid);
		
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
		logger.error(`auditDetail failed ${error}`)
		// 返回错误响应
		return {
			status: 'default',
			actualStatus: 500,  // 从错误中获取状态码
			body: {
				code: -1,
				message: `auditDetail failed: ${error}`,
			}
		};
	}
}

async function auditReject(request: Api.AuditAuditRejectRequest): Promise<t.AuditRejectResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`auditReject request=${JSON.stringify(request)}`);
	const auditService = new AuditService();
	try {
		// 可在函数开头添加参数验证
		if (!request.body?.metadata) {
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

		const auditReject = await auditService.reject(auditCommentMetadataToCommentDO(request.body?.metadata));
		
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
		logger.error(`auditReject failed ${error}`)
		// 返回错误响应
		return {
			status: 'default',
			actualStatus: 500,  // 从错误中获取状态码
			body: {
				code: -1,
				message: `auditReject failed: ${error}`,
			}
		};
	}
}

async function auditSearch(request: Api.AuditAuditSearchRequest): Promise<t.AuditSearchResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`auditSearch request=${JSON.stringify(request)}`);
	const auditService = new AuditService();
	try {
		// 可在函数开头添加参数验证
		if (!request.body?.condition) {
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
		const condition = request.body?.condition
		const page = request.body.page
		let pageIndex = page?.page
		let pageSize = page?.pageSize
		if (pageIndex === undefined) {
			pageIndex = 1
		}
		if (pageSize === undefined) {
			pageSize = 10
		}
		const queryCondition: QueryCondition = {
			approver: condition.approver,
			applicant: condition.applicant, 
			name: condition.name, 
			startTime: condition.startTime, 
			endTime: condition.endTime, 
			page: pageIndex, 
			pageSize: pageSize
		}
		const savedApprove = await auditService.queryByCondition(queryCondition);
		
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
		logger.error(`auditSearch failed ${error}`)
		// 返回错误响应
		return {
			status: 'default',
			actualStatus: 500,  // 从错误中获取状态码
			body: {
				code: -1,
				message: `auditSearch failed: ${error}`,
			}
		};
	}
}


const api: t.AuditApi = {
	auditApprove,
	auditCancel,
	auditCreate,
	auditDetail,
	auditReject,
	auditSearch,
}

export default api
