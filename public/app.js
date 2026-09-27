const labels = { AVAILABLE: "貸出可能", LOANED: "貸出中", MAINTENANCE: "整備中" };
let dashboard;
const $ = (selector) => document.querySelector(selector);
const elements = {
  form: $("#loan-form"), device: $("#device"), currentUser: $("#current-user"), dueDate: $("#due-date"), purpose: $("#purpose"),
  list: $("#device-list"), message: $("#message"), reset: $("#reset"),
  availableCount: $("#available-count"), loanedCount: $("#loaned-count"),
  maintenanceCount: $("#maintenance-count"), totalCount: $("#total-count"), deviceTotal: $("#device-total"),
};

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message);
  return body;
}
function showMessage(message, type = "error") {
  elements.message.textContent = message;
  elements.message.className = `message ${type}`;
  elements.message.hidden = false;
  elements.message.scrollIntoView({ behavior: "smooth", block: "center" });
}
function render() {
  elements.device.replaceChildren(...dashboard.devices.map((device) => {
    const option = new Option(`${device.asset_no} / ${device.name}（${labels[device.status]}）`, device.id);
    return option;
  }));
  elements.currentUser.textContent = dashboard.currentUser
    ? `${dashboard.currentUser.name}${dashboard.currentUser.is_active ? "" : "（利用停止中）"}`
    : "社員情報なし";
  if (!elements.dueDate.value) elements.dueDate.value = dashboard.minDueDate;
  const count = (status) => dashboard.devices.filter((device) => device.status === status).length;
  elements.availableCount.textContent = count("AVAILABLE");
  elements.loanedCount.textContent = count("LOANED");
  elements.maintenanceCount.textContent = count("MAINTENANCE");
  elements.totalCount.textContent = dashboard.devices.length;
  elements.deviceTotal.textContent = `${dashboard.devices.length} 台`;
  elements.list.replaceChildren(...dashboard.devices.map((device) => {
    const row = document.createElement("tr");
    for (const value of [device.asset_no, device.name]) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
    const status = document.createElement("td");
    const badge = document.createElement("span"); badge.className = `status ${device.status.toLowerCase()}`; badge.textContent = labels[device.status];
    status.append(badge); row.append(status);
    for (const value of [device.borrower_name ?? "—", device.due_date ?? "—"]) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
    const action = document.createElement("td");
    if (device.status === "LOANED" && device.borrower_id === dashboard.currentUser?.id) {
      const button = document.createElement("button"); button.type = "button"; button.className = "return"; button.textContent = "返却";
      button.addEventListener("click", () => returnDevice(device)); action.append(button);
    }
    row.append(action); return row;
  }));
}
async function load() { dashboard = await request("/api/dashboard"); render(); }
async function submitLoan() {
  const device = dashboard.devices.find((item) => item.id === Number(elements.device.value));
  try {
    const result = await request("/api/loans", { method: "POST", body: JSON.stringify({ deviceId: device.id, dueDate: elements.dueDate.value, purpose: elements.purpose.value, expectedUpdatedAt: device.updated_at }) });
    await load(); showMessage(result.message, "success");
  } catch (error) { showMessage(error.message); }
}
async function returnDevice(device) {
  try {
    const result = await request(`/api/devices/${device.id}/return`, { method: "POST", body: JSON.stringify({ expectedUpdatedAt: device.updated_at }) });
    await load(); showMessage(result.message, "success");
  } catch (error) { showMessage(error.message); }
}
elements.form.addEventListener("submit", async (event) => { event.preventDefault(); await submitLoan(); });
elements.reset.addEventListener("click", async () => {
  try { const result = await request("/api/reset", { method: "POST", body: "{}" }); elements.dueDate.value = ""; await load(); showMessage(result.message, "success"); }
  catch (error) { showMessage(error.message); }
});
load().catch((error) => showMessage(error.message));
