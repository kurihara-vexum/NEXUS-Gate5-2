import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(50) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_no VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'
    CHECK (status IN ('AVAILABLE', 'LOANED', 'MAINTENANCE')),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id),
  borrower_id INTEGER NOT NULL REFERENCES users(id),
  due_date TEXT NOT NULL CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  loaned_at TEXT NOT NULL,
  returned_at TEXT NULL,
  CHECK (returned_at IS NULL OR returned_at >= loaned_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_loan_per_device
  ON loans(device_id) WHERE returned_at IS NULL;
`;

export function createDatabase(filename = "data/nexus.sqlite", { seed = true } = {}) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(SCHEMA);
  if (seed) seedDatabase(db);
  return db;
}

export function seedDatabase(db) {
  if (db.prepare("SELECT COUNT(*) AS count FROM devices").get().count > 0) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("SELECT COUNT(*) AS count FROM users").get().count === 0) {
      const insertUser = db.prepare("INSERT INTO users (name, role, is_active) VALUES (?, 'MEMBER', ?)");
      insertUser.run("佐藤 花子", 1);
      insertUser.run("鈴木 一郎", 1);
      insertUser.run("退職済み 利用者", 0);
    }
    const now = "2026-09-27T00:00:00.000Z";
    const insertDevice = db.prepare("INSERT INTO devices (asset_no, name, status, updated_at) VALUES (?, ?, ?, ?)");
    insertDevice.run("PC-001", "MacBook Air 13インチ", "AVAILABLE", now);
    insertDevice.run("PC-002", "ThinkPad X1 Carbon", "LOANED", now);
    insertDevice.run("TB-001", "iPad Air", "MAINTENANCE", now);
    insertDevice.run("PC-003", "Dell Latitude", "AVAILABLE", now);
    const borrower = db.prepare("SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1").get();
    db.prepare("INSERT INTO loans (device_id, borrower_id, due_date, loaned_at, returned_at) VALUES (2, ?, '2026-10-10', ?, NULL)")
      .run(borrower.id, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function resetDatabase(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM loans; DELETE FROM devices;");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  seedDatabase(db);
}
