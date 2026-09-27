import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, resetDatabase } from "../src/db.js";
import { MESSAGES } from "../src/domain/messages.js";
import { checkoutDevice, getDashboard, returnDevice } from "../src/services/loan-service.js";

const NOW = new Date("2026-09-27T03:00:00.000Z");
const setup = () => createDatabase(":memory:");
const available = (db, id = 1) => getDashboard(db).devices.find((device) => device.id === id);
const loanInput = (db, overrides = {}) => ({
  deviceId: 1,
  authenticatedUserId: 1,
  dueDate: "2026-09-28",
  purpose: "社外打ち合わせ",
  expectedUpdatedAt: available(db).updated_at,
  now: NOW,
  ...overrides,
});

test("貸出可能な端末を登録すると端末状態と貸出記録が同時に更新される", () => {
  const db = setup();
  const before = available(db);
  const result = checkoutDevice(db, loanInput(db, { expectedUpdatedAt: before.updated_at }));
  assert.equal(result.message, MESSAGES.loanCreated);
  assert.equal(available(db).status, "LOANED");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM loans WHERE device_id = 1 AND returned_at IS NULL").get().count, 1);
});

test("既に貸出中の端末の二重貸出を拒否し既存データを変えない", () => {
  const db = setup();
  const before = available(db, 2);
  assert.throws(() => checkoutDevice(db, loanInput(db, { deviceId: 2, dueDate: "2026-10-01", expectedUpdatedAt: before.updated_at })), { message: MESSAGES.alreadyLoaned });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM loans WHERE device_id = 2 AND returned_at IS NULL").get().count, 1);
});

test("DBの部分UNIQUEインデックスでも同一端末の有効貸出を二重登録できない", () => {
  const db = setup();
  assert.throws(() => db.prepare("INSERT INTO loans (device_id, borrower_id, due_date, purpose, loaned_at) VALUES (2, 1, '2026-10-02', '重複確認', ?)").run(NOW.toISOString()), /UNIQUE/);
});

test("返却予定日が過去日の場合は拒否し端末を更新しない", () => {
  const db = setup();
  const before = available(db);
  assert.throws(() => checkoutDevice(db, loanInput(db, { dueDate: "2026-09-26", expectedUpdatedAt: before.updated_at })), { message: MESSAGES.pastDueDate });
  assert.equal(available(db).status, "AVAILABLE");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM loans WHERE device_id = 1").get().count, 0);
});

test("存在しない日付は拒否する", () => {
  const db = setup();
  assert.throws(() => checkoutDevice(db, loanInput(db, { dueDate: "2026-02-30" })), { message: MESSAGES.invalidDueDate });
});

test("返却予定日が当日の場合も拒否する", () => {
  const db = setup();
  assert.throws(() => checkoutDevice(db, loanInput(db, { dueDate: "2026-09-27" })), { message: MESSAGES.pastDueDate });
});

test("整備中の端末は貸し出せない", () => {
  const db = setup();
  assert.throws(() => checkoutDevice(db, loanInput(db, { deviceId: 3, dueDate: "2026-10-01", expectedUpdatedAt: available(db, 3).updated_at })), { message: MESSAGES.unavailableDevice });
});

test("無効な利用者への貸出を拒否する", () => {
  const db = setup();
  db.prepare("INSERT INTO users (name, role, is_active) VALUES ('無効ユーザー', 'MEMBER', 0)").run();
  const id = db.prepare("SELECT id FROM users WHERE name = '無効ユーザー'").get().id;
  assert.throws(() => checkoutDevice(db, loanInput(db, { authenticatedUserId: id, dueDate: "2026-10-01" })), { message: MESSAGES.inactiveBorrower });
});

test("古い画面の更新日時による貸出を競合として拒否する", () => {
  const db = setup();
  assert.throws(() => checkoutDevice(db, loanInput(db, { dueDate: "2026-10-01", expectedUpdatedAt: "stale" })), { message: MESSAGES.conflict });
});

test("送信された他人の利用者IDを信用せず認証済み本人に貸出を記録する", () => {
  const db = setup();
  checkoutDevice(db, { ...loanInput(db), borrowerId: 2 });
  const loan = db.prepare("SELECT borrower_id, purpose FROM loans WHERE device_id = 1").get();
  assert.equal(loan.borrower_id, 1);
  assert.equal(loan.purpose, "社外打ち合わせ");
});

test("貸出中に端末更新が失敗した場合は貸出記録の作成もロールバックする", () => {
  const db = setup();
  db.exec("CREATE TRIGGER reject_loan_device_update BEFORE UPDATE ON devices BEGIN SELECT RAISE(ABORT, 'device update failure'); END;");
  assert.throws(() => checkoutDevice(db, loanInput(db)));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM loans WHERE device_id = 1").get().count, 0);
  assert.equal(available(db).status, "AVAILABLE");
});

test("返却では貸出記録終了と端末貸出可能化を同一トランザクションで行う", () => {
  const db = setup();
  const before = available(db, 2);
  returnDevice(db, { deviceId: 2, authenticatedUserId: 1, expectedUpdatedAt: before.updated_at, now: NOW });
  assert.equal(available(db, 2).status, "AVAILABLE");
  assert.ok(db.prepare("SELECT returned_at FROM loans WHERE device_id = 2").get().returned_at);
});

test("返却中に端末更新が失敗した場合は貸出記録の終了もロールバックする", () => {
  const db = setup();
  const before = available(db, 2);
  db.exec("CREATE TRIGGER reject_device_update BEFORE UPDATE ON devices BEGIN SELECT RAISE(ABORT, 'device update failure'); END;");
  assert.throws(() => returnDevice(db, { deviceId: 2, authenticatedUserId: 1, expectedUpdatedAt: before.updated_at, now: NOW }));
  assert.equal(db.prepare("SELECT returned_at FROM loans WHERE device_id = 2").get().returned_at, null);
  assert.equal(available(db, 2).status, "LOANED");
});

test("有効な貸出記録がない端末の返却を拒否する", () => {
  const db = setup();
  assert.throws(() => returnDevice(db, { deviceId: 1, authenticatedUserId: 1, expectedUpdatedAt: available(db).updated_at, now: NOW }), { message: MESSAGES.noActiveLoan });
});

test("他人の貸出を返却しようとしても更新しない", () => {
  const db = setup();
  const before = available(db, 2);
  assert.throws(() => returnDevice(db, { deviceId: 2, authenticatedUserId: 2, expectedUpdatedAt: before.updated_at, now: NOW }), { message: MESSAGES.unauthorized });
  assert.equal(db.prepare("SELECT returned_at FROM loans WHERE device_id = 2").get().returned_at, null);
  assert.equal(available(db, 2).status, "LOANED");
});

test("確認データのリセット後も初期状態を再作成できる", () => {
  const db = setup();
  checkoutDevice(db, loanInput(db));
  resetDatabase(db);
  const dashboard = getDashboard(db);
  assert.equal(dashboard.devices.length, 4);
  assert.equal(dashboard.devices.find((device) => device.asset_no === "PC-001").status, "AVAILABLE");
  assert.equal(dashboard.devices.find((device) => device.asset_no === "PC-002").status, "LOANED");
});
