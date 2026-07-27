import { In } from 'typeorm'
import { SingletonDataSource } from '../facade/datasource'
import { AppRuntimeTaskDO, ProjectAppInstallationDO } from '../mapper/entity'
import { ProjectAppManifest } from '../../appstore/manifests'

const REPORT_TRANSITIONS: Record<string, string[]> = {
  claimed: ['applying', 'failed'],
  applying: ['verifying', 'rolling_back', 'failed'],
  verifying: ['succeeded', 'rolling_back', 'failed'],
  rolling_back: ['rolled_back', 'rollback_failed'],
}

type TaskPayload = { menuItems?: unknown[]; previousVersion?: string; previousReleaseDigest?: string; previousRuntimeConfigJson?: string }
type TaskResult = { release_digest?: unknown; healthcheck?: { ok?: unknown }; uninstalled?: unknown; rollback?: { succeeded?: unknown } }

export function canReportRuntimeTask(current: string, target: string) {
  return (REPORT_TRANSITIONS[current] || []).includes(target)
}

function leaseTime(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

function terminal(status: string) {
  return ['succeeded', 'failed', 'rolled_back', 'rollback_failed'].includes(status)
}

export class AppRuntimeTaskService {
  async requestOperation(input: {
    instanceId: string
    operation: 'install' | 'upgrade' | 'uninstall'
    appId?: string
    manifest?: ProjectAppManifest
    releaseDigest?: string
  }) {
    return await SingletonDataSource.get().transaction(async (manager) => {
      const installationRepo = manager.getRepository(ProjectAppInstallationDO)
      const taskRepo = manager.getRepository(AppRuntimeTaskDO)
      const appId = input.manifest?.id || input.appId || ''
      if (!appId) throw new Error('APP_ID_REQUIRED')
      const installation = await installationRepo.findOneBy({ instanceId: input.instanceId, appId })
      if (input.operation === 'install' && installation?.status === 'installed') throw new Error('APPLICATION_ALREADY_INSTALLED')
      if (input.operation !== 'install' && (!installation || installation.status !== 'installed')) throw new Error('APPLICATION_NOT_INSTALLED')

      const active = await taskRepo.findOne({
        where: { instanceId: input.instanceId, appId, status: In(['pending', 'claimed', 'applying', 'verifying', 'rolling_back']) },
        order: { createdAt: 'DESC' },
      })
      if (active) return active

      const manifest = input.manifest
      const payload: TaskPayload = {
        menuItems: manifest?.menuItems,
        previousVersion: installation?.installVersion || '',
        previousReleaseDigest: parseJson<Record<string, string>>(installation?.runtimeConfigJson || '{}', {}).release_digest || '',
        previousRuntimeConfigJson: installation?.runtimeConfigJson || '{}',
      }
      const task = new AppRuntimeTaskDO()
      task.instanceId = input.instanceId
      task.appId = appId
      task.operation = input.operation
      task.targetVersion = manifest?.version || installation?.installVersion || ''
      task.releaseDigest = input.releaseDigest || payload.previousReleaseDigest || ''
      if (!task.releaseDigest) throw new Error('RELEASE_DIGEST_REQUIRED')
      task.status = 'pending'
      task.claimedBy = ''
      task.leaseExpiresAt = ''
      task.revision = 1
      task.payloadJson = JSON.stringify(payload)
      task.resultJson = '{}'
      task.createdAt = new Date().toISOString()
      task.updatedAt = task.createdAt

      if (!installation) {
        const created = new ProjectAppInstallationDO()
        created.instanceId = input.instanceId
        created.appId = appId
        created.installVersion = ''
        created.status = 'pending'
        created.menuItemsJson = '[]'
        created.runtimeConfigJson = '{}'
        created.installAt = ''
        created.updatedAt = task.createdAt
        await installationRepo.save(created)
      } else if (input.operation === 'install') {
        installation.status = 'pending'
        installation.updatedAt = task.createdAt
        await installationRepo.save(installation)
      } else if (input.operation === 'upgrade') {
        installation.status = 'upgrading'
        installation.updatedAt = task.createdAt
        await installationRepo.save(installation)
      } else {
        installation.status = 'uninstalling'
        installation.updatedAt = task.createdAt
        await installationRepo.save(installation)
      }
      return await taskRepo.save(task)
    })
  }

  async claim(instanceId: string, agentId: string, leaseSeconds: number) {
    return await SingletonDataSource.get().transaction(async (manager) => {
      const repo = manager.getRepository(AppRuntimeTaskDO)
      const task = await repo.createQueryBuilder('task')
        .setLock('pessimistic_write')
        .where('task.instance_id = :instanceId', { instanceId })
        .andWhere('(task.status = :pending OR (task.status IN (:...active) AND task.lease_expires_at < :now))', {
          pending: 'pending', active: ['claimed', 'applying', 'verifying', 'rolling_back'], now: new Date().toISOString(),
        })
        .orderBy('task.created_at', 'ASC')
        .getOne()
      if (!task) return null
      task.status = 'claimed'
      task.claimedBy = agentId
      task.leaseExpiresAt = leaseTime(leaseSeconds)
      task.revision += 1
      task.updatedAt = new Date().toISOString()
      return await repo.save(task)
    })
  }

  async heartbeat(instanceId: string, agentId: string, taskId: string, revision: number, leaseSeconds: number) {
    const repo = SingletonDataSource.get().getRepository(AppRuntimeTaskDO)
    const task = await repo.findOneBy({ uid: taskId, instanceId })
    if (!task) throw new Error('TASK_NOT_FOUND')
    if (task.claimedBy !== agentId || task.revision !== revision) throw new Error('TASK_LEASE_CONFLICT')
    if (!['claimed', 'applying', 'verifying', 'rolling_back'].includes(task.status)) throw new Error('TASK_NOT_ACTIVE')
    task.leaseExpiresAt = leaseTime(leaseSeconds)
    task.revision += 1
    task.updatedAt = new Date().toISOString()
    return await repo.save(task)
  }

  async release(instanceId: string, agentId: string, taskId: string, revision: number) {
    const repo = SingletonDataSource.get().getRepository(AppRuntimeTaskDO)
    const task = await repo.findOneBy({ uid: taskId, instanceId })
    if (!task) throw new Error('TASK_NOT_FOUND')
    if (task.claimedBy !== agentId || task.revision !== revision) throw new Error('TASK_LEASE_CONFLICT')
    if (task.status !== 'claimed') throw new Error('TASK_NOT_ACTIVE')
    task.status = 'pending'
    task.claimedBy = ''
    task.leaseExpiresAt = ''
    task.revision += 1
    task.updatedAt = new Date().toISOString()
    return await repo.save(task)
  }

  async report(input: { instanceId: string; agentId: string; taskId: string; revision: number; status: string; result: unknown }) {
    return await SingletonDataSource.get().transaction(async (manager) => {
      const taskRepo = manager.getRepository(AppRuntimeTaskDO)
      const task = await taskRepo.findOneBy({ uid: input.taskId, instanceId: input.instanceId })
      if (!task) throw new Error('TASK_NOT_FOUND')
      if (task.claimedBy !== input.agentId || task.revision !== input.revision) throw new Error('TASK_LEASE_CONFLICT')
      if (!canReportRuntimeTask(task.status, input.status)) throw new Error('INVALID_TASK_TRANSITION')
      const result = (input.result || {}) as TaskResult
      if (input.status === 'succeeded') {
        const verified = task.operation === 'uninstall'
          ? result.release_digest === task.releaseDigest && result.uninstalled === true
          : result.release_digest === task.releaseDigest && result.healthcheck?.ok === true
        if (!verified) throw new Error('TASK_SUCCESS_UNVERIFIED')
      }
      if (input.status === 'rolled_back') {
        const payload = parseJson<TaskPayload>(task.payloadJson, {})
        if (result.rollback?.succeeded !== true || result.release_digest !== payload.previousReleaseDigest) {
          throw new Error('TASK_ROLLBACK_UNVERIFIED')
        }
      }
      task.status = input.status
      task.resultJson = JSON.stringify(result)
      task.revision += 1
      task.updatedAt = new Date().toISOString()
      if (terminal(input.status)) task.leaseExpiresAt = ''

      if (terminal(input.status)) {
        const installationRepo = manager.getRepository(ProjectAppInstallationDO)
        const installation = await installationRepo.findOneBy({ instanceId: task.instanceId, appId: task.appId })
        if (!installation) throw new Error('INSTALLATION_NOT_FOUND')
        const payload = parseJson<TaskPayload>(task.payloadJson, {})
        if (input.status === 'succeeded' && task.operation === 'uninstall') {
          installation.status = 'uninstalled'
          installation.installVersion = ''
          installation.installAt = ''
          installation.menuItemsJson = '[]'
          installation.runtimeConfigJson = '{}'
        } else if (input.status === 'succeeded') {
          installation.status = 'installed'
          installation.installVersion = task.targetVersion
          installation.installAt = new Date().toISOString()
          installation.menuItemsJson = JSON.stringify(payload.menuItems || [])
          installation.runtimeConfigJson = JSON.stringify(result)
        } else if (input.status === 'rolled_back') {
          installation.status = 'installed'
          installation.installVersion = payload.previousVersion || installation.installVersion
          installation.runtimeConfigJson = payload.previousRuntimeConfigJson || installation.runtimeConfigJson
        } else if (task.operation === 'uninstall') {
          installation.status = 'installed'
        } else if (task.operation === 'upgrade' && result.rollback?.succeeded === true) {
          installation.status = 'installed'
        } else {
          installation.status = 'failed'
        }
        installation.updatedAt = task.updatedAt
        await installationRepo.save(installation)
      }
      return await taskRepo.save(task)
    })
  }
}
