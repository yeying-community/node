import { ProjectAppInstallationDO, ProjectInstanceDO } from '../mapper/entity'

export type ProjectInstance = {
  instanceId: string
  projectApiUrl: string
  status: string
  createdAt: string
  updatedAt: string
}

export type ProjectAppMenuItem = {
  location: string
  label: string
  url: string
  visible_to?: string
  icon?: string
}

export type ProjectAppInstallation = {
  uid: string
  instanceId: string
  appId: string
  installVersion: string
  status: string
  menuItems: ProjectAppMenuItem[]
  runtimeConfig: Record<string, unknown>
  installAt: string
  updatedAt: string
}

export function projectInstanceFrom(record: ProjectInstanceDO): ProjectInstance {
  return {
    instanceId: record.instanceId,
    projectApiUrl: record.projectApiUrl,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export function projectInstallationFrom(record: ProjectAppInstallationDO): ProjectAppInstallation {
  let menuItems: ProjectAppMenuItem[] = []
  let runtimeConfig: Record<string, unknown> = {}
  try {
    const value = JSON.parse(record.menuItemsJson || '[]')
    if (Array.isArray(value)) menuItems = value
  } catch {}
  try {
    const value = JSON.parse(record.runtimeConfigJson || '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) runtimeConfig = value
  } catch {}
  return {
    uid: record.uid,
    instanceId: record.instanceId,
    appId: record.appId,
    installVersion: record.installVersion,
    status: record.status,
    menuItems,
    runtimeConfig,
    installAt: record.installAt,
    updatedAt: record.updatedAt,
  }
}
