import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddIdentityRegistrations20261007100000 implements MigrationInterface {
  name = 'AddIdentityRegistrations20261007100000'

  async up(q: QueryRunner) {
    if (q.connection.options.type !== 'postgres') throw new Error('AddIdentityRegistrations20261007100000 only supports postgres')
    const schema = `"${String(q.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await q.query(`CREATE TABLE IF NOT EXISTS ${schema}."identity_registrations" (registration_id varchar(128) PRIMARY KEY, identity_did varchar(128) NOT NULL, identity_document_hash varchar(128) NOT NULL, status varchar(32) NOT NULL DEFAULT 'pending', created_at varchar(64) NOT NULL, expires_at varchar(64) NOT NULL, activated_at varchar(64) NOT NULL DEFAULT '')`)
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_identity_registration_identity_status" ON ${schema}."identity_registrations" (identity_did, status)`)
  }

  async down() { /* Retain registration history during rollback; removal is an explicit operational action. */ }
}
