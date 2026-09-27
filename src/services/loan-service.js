import { BusinessError, MESSAGES } from "../domain/messages.js";

function inTransaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function todayInJapan(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextTimestamp(previous, now = new Date()) {
  return new Date(Math.max(now.valueOf(), Date.parse(previous) + 1)).toISOString();
}

export function getDashboard(db, { authenticatedUserId = 1 } = {}) {
  const devices = db.prepare(`
    SELECT d.*, l.id AS active_loan_id, l.borrower_id, l.due_date, l.loaned_at, u.name AS borrower_name
    FROM devices d
    LEFT JOIN loans l ON l.device_id = d.id AND l.returned_at IS NULL
    LEFT JOIN users u ON u.id = l.borrower_id
    ORDER BY d.asset_no
  `).all();
  const currentUser = db.prepare("SELECT id, name, is_active FROM users WHERE id = ?").get(Number(authenticatedUserId));
  const today = todayInJapan();
  return { devices, currentUser: currentUser ?? null, today, minDueDate: addDays(today, 1) };
}

export function checkoutDevice(db, { deviceId, authenticatedUserId = 1, dueDate, purpose, expectedUpdatedAt, now = new Date() }) {
  const normalizedDueDate = String(dueDate ?? "");
  const normalizedPurpose = String(purpose ?? "").trim();
  if (!validDateOnly(normalizedDueDate)) throw new BusinessError(MESSAGES.invalidDueDate);
  if (normalizedDueDate <= todayInJapan(now)) throw new BusinessError(MESSAGES.pastDueDate);
  if (!normalizedPurpose) throw new BusinessError(MESSAGES.purposeRequired);
  if ([...normalizedPurpose].length > 100) throw new BusinessError(MESSAGES.purposeTooLong);

  return inTransaction(db, () => {
    const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(Number(deviceId));
    const borrower = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(authenticatedUserId));
    if (!device || !borrower) throw new BusinessError(MESSAGES.notFound, 404);
    if (!borrower.is_active) throw new BusinessError(MESSAGES.inactiveBorrower);
    if (expectedUpdatedAt && device.updated_at !== expectedUpdatedAt) throw new BusinessError(MESSAGES.conflict, 409);
    const activeLoan = db.prepare("SELECT id FROM loans WHERE device_id = ? AND returned_at IS NULL").get(device.id);
    if (activeLoan || device.status === "LOANED") throw new BusinessError(MESSAGES.alreadyLoaned, 409);
    if (device.status !== "AVAILABLE") throw new BusinessError(MESSAGES.unavailableDevice);

    const changedAt = nextTimestamp(device.updated_at, now);
    db.prepare("INSERT INTO loans (device_id, borrower_id, due_date, purpose, loaned_at, returned_at) VALUES (?, ?, ?, ?, ?, NULL)")
      .run(device.id, borrower.id, normalizedDueDate, normalizedPurpose, changedAt);
    db.prepare("UPDATE devices SET status = 'LOANED', updated_at = ? WHERE id = ?").run(changedAt, device.id);
    return { message: MESSAGES.loanCreated };
  });
}

export function returnDevice(db, { deviceId, authenticatedUserId = 1, expectedUpdatedAt, now = new Date() }) {
  return inTransaction(db, () => {
    const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(Number(deviceId));
    if (!device) throw new BusinessError(MESSAGES.notFound, 404);
    if (expectedUpdatedAt && device.updated_at !== expectedUpdatedAt) throw new BusinessError(MESSAGES.conflict, 409);
    const loan = db.prepare("SELECT * FROM loans WHERE device_id = ? AND returned_at IS NULL").get(device.id);
    if (!loan || device.status !== "LOANED") throw new BusinessError(MESSAGES.noActiveLoan);
    if (loan.borrower_id !== Number(authenticatedUserId)) throw new BusinessError(MESSAGES.unauthorized, 403);

    const changedAt = nextTimestamp(device.updated_at, now);
    db.prepare("UPDATE loans SET returned_at = ? WHERE id = ? AND returned_at IS NULL").run(changedAt, loan.id);
    db.prepare("UPDATE devices SET status = 'AVAILABLE', updated_at = ? WHERE id = ?").run(changedAt, device.id);
    return { message: MESSAGES.returned };
  });
}
