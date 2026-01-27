import * as t from '../api/user/types'
import { Api } from '../models'
import { Logger } from 'winston'
import { SingletonLogger } from '../domain/facade/logger';
import { SupportService } from '../domain/service/support';
import { UserService } from '../domain/service/user';
import { User, UserState } from '../domain/model/user';
import { getCurrentUtcString } from '../common/date';
import { UserRoleEnum, UserStatusEnum } from '../yeying/api/user/user';

async function userAdd(request: Api.UserAddUserRequest): Promise<t.UserAddResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`supportCollect request=${JSON.stringify(request)}`);
	const userService = new UserService();
	try {
		// 可在函数开头添加参数验证
		if (!request.body?.user || !request.body?.user.did) {
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

		// 假设 save 方法返回保存后的应用数据
		const existing = await userService.getUser(request.body.user.did);
		if (existing) {
			return {
				status: 200,
				body: {
					header: {},
					body: {
						status: {
							code: Api.CommonResponseCodeEnum.OK,
							message: `current user already exists did=${request.body.user.did}`
						}
					}
				}
			};
		}
		const user = convertToUser(request.body.user)
		if (!user) {
			return {
				status: 'default',
				actualStatus: 400,
				body: {
					code: 400,
					message: 'user is null',
				}
			};
		}
		await userService.saveUser(user)
		await userService.saveState(convertUserStateTo(request.body.user))
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
		logger.error(`supportCollect failed ${error}`)
		// 返回错误响应
		return {
			status: 'default',
			actualStatus: 500,  // 从错误中获取状态码
			body: {
				code: -1,
				message: `supportCollect failed: ${error}`,
			}
		};
	}
}

export function convertUserStateTo(user: Api.UserUserMetadata): UserState {
    return {
		did: user.did === undefined ? "" : user.did,
		status: getUserStatusKey(UserStatusEnum.USER_STATUS_AUDIT),
		role: getUserRoleKey(UserRoleEnum.USER_ROLE_NORMAL),
		createdAt: getCurrentUtcString(),
		updatedAt: getCurrentUtcString(),
		signature: ""
    }
}
function getUserStatusKey(value: UserStatusEnum): string {
  return UserStatusEnum[value] || 'UNKNOWN';
}
function getUserRoleKey(value: UserRoleEnum): string {
  return UserRoleEnum[value] || 'UNKNOWN';
}
function convertToUser(metadata: Api.UserUserMetadata): User | null {
  // 检查必需字段是否存在
  if (!metadata.name || !metadata.did) {
    console.warn('Cannot convert to User: missing required fields (name or did)');
    return null; // 或抛出错误 throw new Error('Missing required fields')
  }

  return {
    name: metadata.name,
    did: metadata.did,
    avatar: metadata.avatar ?? '', // 提供默认值
    createdAt: metadata.createdAt ?? new Date().toISOString(),
    updatedAt: metadata.updatedAt ?? new Date().toISOString(),
    signature: metadata.signature ?? '',
  };
}

async function userDelete(request: Api.UserDeleteUserRequest): Promise<t.UserDeleteResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`userDelete request=${JSON.stringify(request)}`);
	const userService = new UserService();
	try {
		if (!request.header?.did) {
			return {
				status: 'default',
				actualStatus: 400,
				body: {
					code: 400,
					message: 'Missing did',
				}
			};
		}
		await userService.del(request.header.did);
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
		logger.error(`userDelete failed ${error}`)
		return {
			status: 'default',
			actualStatus: 500,
			body: {
				code: -1,
				message: `userDelete failed: ${error}`,
			}
		};
	}
}

async function userDetail(request: Api.UserUserDetailRequest): Promise<t.UserDetailResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`userDetail request=${JSON.stringify(request)}`);
	const userService = new UserService();
	try {
		if (!request.header?.did) {
			return {
				status: 'default',
				actualStatus: 400,
				body: {
					code: 400,
					message: 'Missing did',
				}
			};
		}
		const user = await userService.getUser(request.header.did);
		const state = await userService.getState(request.header.did);
		if (!user) {
			return {
				status: 'default',
				actualStatus: 404,
				body: {
					code: 404,
					message: 'User not found',
				}
			};
		}
		const role = state?.role && Object.values(Api.UserUserRoleEnum).includes(state.role as any)
			? (state.role as Api.UserUserRoleEnum)
			: undefined;
		const status = state?.status && Object.values(Api.UserUserStatusEnum).includes(state.status as any)
			? (state.status as Api.UserUserStatusEnum)
			: undefined;
		return {
			status: 200,
			body: {
				header: {},
				body: {
					status: {
						code: Api.CommonResponseCodeEnum.OK
					},
					detail: {
						user: {
							did: user.did,
							name: user.name,
							avatar: user.avatar,
							createdAt: user.createdAt,
							updatedAt: user.updatedAt,
							signature: user.signature,
						},
						state: state ? {
							did: state.did,
							role: role,
							status: status,
							createdAt: state.createdAt,
							updatedAt: state.updatedAt,
							signature: state.signature,
						} : undefined
					}
				}
			}
		};
	} catch (error) {
		logger.error(`userDetail failed ${error}`)
		return {
			status: 'default',
			actualStatus: 500,
			body: {
				code: -1,
				message: `userDetail failed: ${error}`,
			}
		};
	}
}

async function userList(request: Api.UserUserListRequest): Promise<t.UserListResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`userList request=${JSON.stringify(request)}`);
	const userService = new UserService();
	try {
		const pageIndex = request.body?.pageIndex && request.body.pageIndex > 0 ? request.body.pageIndex : 1;
		const pageSize = request.body?.pageSize && request.body.pageSize > 0 ? request.body.pageSize : 10;
		const result = await userService.listUsers(pageIndex, pageSize);
		const list = await Promise.all(
			(result.users || []).map(async (user) => {
				if (!user) return undefined;
				const state = await userService.getState(user.did);
				const role = state?.role && Object.values(Api.UserUserRoleEnum).includes(state.role as any)
					? (state.role as Api.UserUserRoleEnum)
					: undefined;
				const status = state?.status && Object.values(Api.UserUserStatusEnum).includes(state.status as any)
					? (state.status as Api.UserUserStatusEnum)
					: undefined;
				return {
					user: {
						did: user.did,
						name: user.name,
						avatar: user.avatar,
						createdAt: user.createdAt,
						updatedAt: user.updatedAt,
						signature: user.signature,
					},
					state: state ? {
						did: state.did,
						role: role,
						status: status,
						createdAt: state.createdAt,
						updatedAt: state.updatedAt,
						signature: state.signature,
					} : undefined
				};
			})
		);

		return {
			status: 200,
			body: {
				header: {},
				body: {
					status: {
						code: Api.CommonResponseCodeEnum.OK
					},
					list: list.filter(Boolean) as any,
					total: String(result.total || 0)
				}
			}
		};
	} catch (error) {
		logger.error(`userList failed ${error}`)
		return {
			status: 'default',
			actualStatus: 500,
			body: {
				code: -1,
				message: `userList failed: ${error}`,
			}
		};
	}
}

async function userUpdate(request: Api.UserUpdateUserRequest): Promise<t.UserUpdateResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`userUpdate request=${JSON.stringify(request)}`);
	const userService = new UserService();
	try {
		const metadata = request.body?.user;
		if (!metadata?.did) {
			return {
				status: 'default',
				actualStatus: 400,
				body: {
					code: 400,
					message: 'Missing user did',
				}
			};
		}
		const existing = await userService.getUser(metadata.did);
		if (!existing) {
			return {
				status: 'default',
				actualStatus: 404,
				body: {
					code: 404,
					message: 'User not found',
				}
			};
		}
		const updated = {
			...existing,
			name: metadata.name ?? existing.name,
			avatar: metadata.avatar ?? existing.avatar,
			signature: metadata.signature ?? existing.signature,
			updatedAt: getCurrentUtcString(),
		} as User;
		await userService.saveUser(updated);

		return {
			status: 200,
			body: {
				header: {},
				body: {
					status: {
						code: Api.CommonResponseCodeEnum.OK
					},
					user: {
						did: updated.did,
						name: updated.name,
						avatar: updated.avatar,
						createdAt: updated.createdAt,
						updatedAt: updated.updatedAt,
						signature: updated.signature,
					}
				}
			}
		};
	} catch (error) {
		logger.error(`userUpdate failed ${error}`)
		return {
			status: 'default',
			actualStatus: 500,
			body: {
				code: -1,
				message: `userUpdate failed: ${error}`,
			}
		};
	}
}

async function userUpdateStatus(request: Api.UserUpdateStatusRequest): Promise<t.UserUpdateStatusResponse> {
	const logger: Logger = SingletonLogger.get()
	logger.info(`userUpdateStatus request=${JSON.stringify(request)}`);
	const userService = new UserService();
	try {
		if (!request.body?.did || !request.body?.status) {
			return {
				status: 'default',
				actualStatus: 400,
				body: {
					code: 400,
					message: 'Missing user status data',
				}
			};
		}
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

		const state = await userService.getState(request.body.did);
		if (!state) {
			return {
				status: 'default',
				actualStatus: 404,
				body: {
					code: 404,
					message: 'User state not found',
				}
			};
		}

		state.status = request.body.status as string;
		state.updatedAt = getCurrentUtcString();
		await userService.saveState(state);

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
		logger.error(`userUpdateStatus failed ${error}`)
		return {
			status: 'default',
			actualStatus: 500,
			body: {
				code: -1,
				message: `userUpdateStatus failed: ${error}`,
			}
		};
	}
}


const api: t.UserApi = {
	userAdd,
	userDelete,
	userDetail,
	userList,
	userUpdate,
	userUpdateStatus,
}

export default api
