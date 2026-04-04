-- Initial schema for PeanutCafe (lobster database).
-- Matches: src/database/migrations/1708272000000-InitialSchema.ts
-- Safe to re-run: uses IF NOT EXISTS.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS "users" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "username" VARCHAR(50) UNIQUE NOT NULL,
  "email" VARCHAR(100) UNIQUE NOT NULL,
  "password" VARCHAR(255) NOT NULL,
  "role" VARCHAR(20) DEFAULT 'user',
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "title" VARCHAR(200) NOT NULL,
  "owner_id" UUID REFERENCES "users"("id"),
  "participants" TEXT[] DEFAULT '{}',
  "status" VARCHAR(20) DEFAULT 'active',
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "last_message_at" TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "messages" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "session_id" UUID REFERENCES "sessions"("id") ON DELETE CASCADE,
  "user_id" UUID REFERENCES "users"("id"),
  "agent_id" VARCHAR(50),
  "agent_name" VARCHAR(50),
  "role" VARCHAR(20) NOT NULL,
  "content" TEXT NOT NULL,
  "mentioned_agents" TEXT[] DEFAULT '{}',
  "metadata" JSONB,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_messages_session_id" ON "messages"("session_id");
CREATE INDEX IF NOT EXISTS "idx_messages_created_at" ON "messages"("created_at");
CREATE INDEX IF NOT EXISTS "idx_sessions_owner_id" ON "sessions"("owner_id");
