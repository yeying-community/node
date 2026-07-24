import { In } from 'typeorm'
import { SingletonDataSource } from '../facade/datasource'
import { AppRuntimeTaskDO, ProjectAppInstallationDO } from '../mapper/entity'
import { ProjectAppManifest } from '../../appstore/manifests'

const REPORT_TRANSITIONS: Record<string, string[]> = {
  claimed: ['applying', 'failed'],
  applying: ['verifying', 'failed'],
  verifying: ['succeeded', 'failed'],
}

export function canReportRuntimeTask(current: string, target: string) {
  return (REPORT_TRANSITIONS[current] || []).includes(target)
}

function leaseTime(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

export class AppRuntimeTaskService {
  async requestInstall(instanceId: string, manifest: ProjectAppManifest, releaseDigest: string) {
    return await SingletonDataSource.get().transaction(async (manager) => {
      const installationRepo = manager.getRepository(ProjectAppInstallationDO)
      const taskRepo = manager.getRepository(AppRuntimeTaskDO)
      let installation = await installationRepo.findOneBy({ instanceId, appId: manifest.id })
      if (!installation) installation = new ProjectAppInstallationDO()
      installation.instanceId = instanceId
      installation.appId = manifest.id
      installation.installVersion = manifest.version
      installation.status = 'pending'
      installation.menuItemsJson = JSON.stringify(manifest.menuItems)
      installation.runtimeConfigJson = JSON.stringify({})
      installation.installAt = installation.installAt || ''
      installation.updatedAt = new Date().toISOString()
      await installationRepo.save(installation)

      const active = await taskRepo.findOne({
        where: { instanceId, appId: manifest.id, operation: 'install', status: In(['pending', 'claimed', 'applying', 'verifying']) },
        order: { createdAt: 'DESC' },
      })
      if (active) return active
      const task = new AppRuntimeTaskDO()
      task.instanceId = instanceId
      task.appId = manifest.id
      task.operation = 'install'
      task.targetVersion = manifest.version
      task.releaseDigest = releaseDigest
      task.status = 'pending'
      task.claimedBy = ''
      task.leaseExpiresAt = ''
      task.revision = 1
      task.resultJson = '{}'
      task.createdAt = new Date().toISOString()
      task.updatedAt = task.createdAt
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
          pending: 'pending', active: ['claimed', 'applying', 'verifying'], now: new Date().toISOString(),
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
    if (!['claimed', 'applying', 'verifying'].includes(task.status)) throw new Error('TASK_NOT_ACTIVE')
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
      if (input.status === 'succeeded') {
        const result = input.result as { release_digest?: unknown; healthcheck?: { ok?: unknown } } | null
        if (!result || typeof result !== 'object' || result.release_digest !== task.releaseDigest || result.healthcheck?.ok !== true) {
          throw new Error('TASK_SUCCESS_UNVERIFIED')
        }
      }
      task.status = input.status
      task.resultJson = JSON.stringify(input.result || {})
      task.revision += 1
      task.updatedAt = new Date().toISOString()
      if (input.status === 'succeeded') {
        task.leaseExpiresAt = ''
        const installationRepo = manager.getRepository(ProjectAppInstallationDO)
        const installation = await installationRepo.findOneBy({ instanceId: task.instanceId, appId: task.appId })
        if (!installation) throw new Error('INSTALLATION_NOT_FOUND')
        installation.status = 'installed'
        installation.installVersion = task.targetVersion
        installation.installAt = new Date().toISOString()
        installation.updatedAt = installation.installAt
        await installationRepo.save(installation)
      } else if (input.status === 'failed') {
        task.leaseExpiresAt = ''
        const installationRepo = manager.getRepository(ProjectAppInstallationDO)
        const installation = await installationRepo.findOneBy({ instanceId: task.instanceId, appId: task.appId })
        if (installation) {
          installation.status = 'failed'
          installation.updatedAt = task.updatedAt
          await installationRepo.save(installation)
        }
      }
      return await taskRepo.save(task)
    })
  }
}
