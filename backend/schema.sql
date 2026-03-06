-- Procura Backend Database Schema
-- Usage: mysql -u root < schema.sql

CREATE DATABASE IF NOT EXISTS procura
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE procura;

CREATE TABLE IF NOT EXISTS sync_objects (
    key_id        CHAR(64)      NOT NULL,
    object_id     VARCHAR(255)  NOT NULL,
    encrypted_blob LONGBLOB     NOT NULL,
    last_modified BIGINT        NOT NULL,

    PRIMARY KEY (key_id, object_id),
    INDEX idx_key_modified (key_id, last_modified DESC)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_tokens (
    key_id         CHAR(64)      NOT NULL,
    provider       VARCHAR(64)   NOT NULL,
    session_token  VARCHAR(36)   NOT NULL,
    refresh_token  TEXT          NOT NULL,
    created_at     BIGINT        NOT NULL,
    updated_at     BIGINT        NOT NULL,
    PRIMARY KEY (key_id, provider),
    UNIQUE INDEX idx_session_token (session_token)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vault_secrets (
    key_id      CHAR(64)        NOT NULL,
    name        VARCHAR(128)    NOT NULL,
    salt        BINARY(16)      NOT NULL,
    iv          BINARY(12)      NOT NULL,
    tag         BINARY(16)      NOT NULL,
    ciphertext  VARBINARY(4096) NOT NULL,
    created_at  BIGINT          NOT NULL,
    updated_at  BIGINT          NOT NULL,

    PRIMARY KEY (key_id, name)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
