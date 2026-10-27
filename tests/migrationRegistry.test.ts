import fs from 'fs'
import os from 'os'
import path from 'path'
import { checkMigrationRegistry } from '../scripts/check-migration-registry.cjs'

function createFixture(rootDir: string, serverSource: string) {
  const migrationsDir = path.join(rootDir, 'src', 'migrations')
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, '20261027100000-example.ts'),
    "import { MigrationInterface } from 'typeorm'\nexport class ExampleMigration implements MigrationInterface { async up() {} async down() {} }\n",
  )
  fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(rootDir, 'src', 'server.ts'), serverSource)
}

describe('migration registry check', () => {
  it('accepts migrations imported and registered in server.ts', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-migration-registry-'))
    try {
      createFixture(rootDir, [
        "import { ExampleMigration } from './migrations/20261027100000-example'",
        'builder.migrations([ExampleMigration])',
      ].join('\n'))

      expect(checkMigrationRegistry(rootDir)).toEqual([])
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it('rejects migrations missing an import', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-migration-registry-'))
    try {
      createFixture(rootDir, 'builder.migrations([ExampleMigration])')

      expect(checkMigrationRegistry(rootDir)).toEqual(expect.arrayContaining([
        "ExampleMigration is not imported from ./migrations/20261027100000-example",
      ]))
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it('rejects migrations missing an execution-list entry', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-migration-registry-'))
    try {
      createFixture(rootDir, [
        "import { ExampleMigration } from './migrations/20261027100000-example'",
        'builder.migrations([])',
      ].join('\n'))

      expect(checkMigrationRegistry(rootDir)).toEqual(expect.arrayContaining([
        'ExampleMigration is not included in builder.migrations([...])',
      ]))
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
