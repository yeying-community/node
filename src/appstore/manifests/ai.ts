import { ProjectAppManifest } from '.'

export const aiManifest: ProjectAppManifest = {
  id: 'ai',
  name: 'YeYing AI Assistant',
  version: '0.1.0',
  status: 'published',
  image: 'ghcr.io/yeying-community/ai:0.1.0',
  minimumProjectVersion: '1.0.0',
  menuItems: [
    {
      location: 'application',
      label: 'YeYing AI Assistant',
      url: 'apps/ai/',
      visible_to: 'all',
    },
  ],
}
