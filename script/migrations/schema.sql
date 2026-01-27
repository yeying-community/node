-- Single-file Postgres schema for yeying-node.
-- Destructive by design: drops the schema and recreates everything.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DROP SCHEMA IF EXISTS node CASCADE;
CREATE SCHEMA node;
SET search_path TO node;

CREATE TABLE users (
  did varchar(128) PRIMARY KEY,
  name varchar(128) NOT NULL,
  avatar text NOT NULL DEFAULT '',
  created_at varchar(64) NOT NULL DEFAULT '',
  updated_at varchar(64) NOT NULL DEFAULT '',
  signature varchar(192) NOT NULL DEFAULT ''
);

CREATE TABLE user_state (
  did varchar(128) PRIMARY KEY,
  role varchar(64) NOT NULL DEFAULT '',
  status varchar(64) NOT NULL DEFAULT '',
  created_at varchar(64) NOT NULL DEFAULT '',
  updated_at varchar(64) NOT NULL DEFAULT '',
  signature varchar(192) NOT NULL DEFAULT ''
);

CREATE TABLE services (
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
);

CREATE TABLE applications (
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
);

CREATE TABLE comments (
  uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id text NOT NULL,
  text text NOT NULL,
  status text NOT NULL,
  created_at varchar(64) NOT NULL DEFAULT '',
  updated_at varchar(64) NOT NULL DEFAULT '',
  signature varchar(192) NOT NULL DEFAULT ''
);

CREATE TABLE events (
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
);

CREATE TABLE invitations (
  code varchar(64) PRIMARY KEY,
  scene varchar(64) NOT NULL,
  inviter varchar(128) NOT NULL,
  invitee varchar(128),
  expired_at varchar(64) NOT NULL DEFAULT '',
  created_at varchar(64) NOT NULL DEFAULT '',
  signature varchar(192) NOT NULL DEFAULT ''
);

CREATE TABLE certificates (
  domain varchar(256) PRIMARY KEY,
  service_did varchar(128) NOT NULL,
  cert text NOT NULL,
  csr text NOT NULL,
  expired varchar(64) NOT NULL DEFAULT '',
  created_at varchar(64) NOT NULL DEFAULT '',
  updated_at varchar(64) NOT NULL DEFAULT ''
);

CREATE TABLE supports (
  id serial PRIMARY KEY,
  did varchar(128) NOT NULL,
  email varchar(256) NOT NULL,
  type varchar(64) NOT NULL,
  description text NOT NULL,
  created_at varchar(64) NOT NULL DEFAULT '',
  signature varchar(192) NOT NULL DEFAULT '',
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE solutions (
  uid varchar(64) PRIMARY KEY,
  publisher varchar(128) NOT NULL,
  name varchar(128) NOT NULL,
  language varchar(64) NOT NULL,
  description text NOT NULL,
  signature varchar(192) NOT NULL DEFAULT '',
  created_at varchar(64) NOT NULL DEFAULT ''
);

CREATE TABLE cards (
  id serial PRIMARY KEY,
  name varchar(128) NOT NULL,
  price varchar(64) NOT NULL,
  variables text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  solution_id varchar(64) NOT NULL REFERENCES solutions(uid) ON DELETE CASCADE
);

CREATE TABLE audits (
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
);

CREATE INDEX idx_audit_target ON audits (target_type, target_did, target_version);

COMMIT;
