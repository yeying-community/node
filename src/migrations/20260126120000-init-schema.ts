import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class InitSchema20260126120000 implements MigrationInterface {
  name = 'InitSchema20260126120000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`InitSchema20260126120000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`)
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS ${schemaRef}`)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."users" (
        did varchar(128) PRIMARY KEY,
        name varchar(128) NOT NULL,
        avatar text NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT '',
        signature varchar(192) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."user_state" (
        did varchar(128) PRIMARY KEY,
        role varchar(64) NOT NULL DEFAULT '',
        status varchar(64) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT '',
        signature varchar(192) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."services" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        did varchar(128) NOT NULL,
        version int NOT NULL,
        owner varchar(128) NOT NULL,
        owner_name varchar(128) NOT NULL,
        network varchar(64) NOT NULL,
        address varchar(128) NOT NULL,
        name varchar(64) NOT NULL,
        description text NOT NULL,
        code varchar(64) NOT NULL,
        api_codes text NOT NULL DEFAULT '',
        proxy varchar(256) NOT NULL,
        grpc varchar(256) NOT NULL,
        avatar text NOT NULL,
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT '',
        signature varchar(192) NOT NULL DEFAULT '',
        code_package_path text NOT NULL DEFAULT '',
        status varchar(64) NOT NULL DEFAULT 'BUSINESS_STATUS_PENDING',
        is_online boolean NOT NULL DEFAULT false
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."applications" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        did varchar(128) NOT NULL,
        version int NOT NULL,
        owner varchar(128) NOT NULL,
        owner_name varchar(128) NOT NULL,
        network varchar(64) NOT NULL,
        address varchar(128) NOT NULL,
        name varchar(64) NOT NULL,
        description text NOT NULL,
        code varchar(64) NOT NULL,
        location text NOT NULL,
        service_codes text NOT NULL,
        avatar text NOT NULL,
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT '',
        signature varchar(192) NOT NULL DEFAULT '',
        code_package_path text NOT NULL DEFAULT '',
        status varchar(64) NOT NULL DEFAULT 'BUSINESS_STATUS_PENDING',
        is_online boolean NOT NULL DEFAULT false
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."comments" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        audit_id text NOT NULL,
        text text NOT NULL,
        status text NOT NULL,
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT '',
        signature varchar(192) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."events" (
        uid varchar(128) PRIMARY KEY,
        type varchar(64) NOT NULL,
        producers text NOT NULL,
        consumers text NOT NULL,
        signatures text NOT NULL,
        content text NOT NULL,
        opinions text NOT NULL,
        extend text NOT NULL,
        created_at varchar(64) NOT NULL DEFAULT '',
        processed_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."invitations" (
        code varchar(64) PRIMARY KEY,
        scene varchar(64) NOT NULL,
        inviter varchar(128) NOT NULL,
        invitee varchar(128),
        expired_at varchar(64) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        signature varchar(192) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."certificates" (
        domain varchar(256) PRIMARY KEY,
        service_did varchar(128) NOT NULL,
        cert text NOT NULL,
        csr text NOT NULL,
        expired varchar(64) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."supports" (
        id serial PRIMARY KEY,
        did varchar(128) NOT NULL,
        email varchar(256) NOT NULL,
        type varchar(64) NOT NULL,
        description text NOT NULL,
        created_at varchar(64) NOT NULL DEFAULT '',
        signature varchar(192) NOT NULL DEFAULT '',
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."solutions" (
        uid varchar(64) PRIMARY KEY,
        publisher varchar(128) NOT NULL,
        name varchar(128) NOT NULL,
        language varchar(64) NOT NULL,
        description text NOT NULL,
        signature varchar(192) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."cards" (
        id serial PRIMARY KEY,
        name varchar(128) NOT NULL,
        price varchar(64) NOT NULL,
        variables text NOT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        solution_id varchar(64) NOT NULL REFERENCES ${schemaRef}."solutions"("uid") ON DELETE CASCADE
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."audits" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        app_or_service_metadata text,
        audit_type text,
        applicant text NOT NULL DEFAULT '',
        approver text NOT NULL DEFAULT '',
        reason text NOT NULL DEFAULT '',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        signature varchar(192),
        target_type varchar(32) NOT NULL DEFAULT '',
        target_did varchar(128) NOT NULL DEFAULT '',
        target_version int NOT NULL DEFAULT 0,
        target_name varchar(128) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ${schemaRef}."idx_audit_target"
      ON ${schemaRef}."audits" (target_type, target_did, target_version)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`InitSchema20260126120000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_audit_target"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."audits"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."cards"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."solutions"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."supports"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."certificates"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."invitations"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."events"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."comments"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."applications"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."services"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."user_state"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."users"`)
  }
}
