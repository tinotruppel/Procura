-- Procura Backend Database Schema
-- Usage: mysql -u root < schema.sql

CREATE DATABASE IF NOT EXISTS procura
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE procura;

CREATE TABLE IF NOT EXISTS sync_objects (
    user_id       VARCHAR(255)  NOT NULL,
    object_id     VARCHAR(255)  NOT NULL,
    encrypted_blob LONGBLOB     NOT NULL,
    last_modified BIGINT        NOT NULL,

    PRIMARY KEY (user_id, object_id),
    INDEX idx_user_modified (user_id, last_modified DESC)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
