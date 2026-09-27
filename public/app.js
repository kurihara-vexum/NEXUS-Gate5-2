const labels = { AVAILABLE: "貸出可能", LOANED: "貸出中", MAINTENANCE: "整備中" };
let dashboard;
const $ = (selector) => document.querySelector(selector);
const elements = { form: $("#loan-form"), device: $("#device"), borrower: $("#borrower"), dueDate: $("#due-date"), list: $("#device-list"), message: $("#message"), reset: $("#reset"), demoLoaned: $("#demo-loaned"), demoPast: $("#demo-past") };

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
  elements.borrower.replaceChildren(...dashboard.users.map((user) => new Option(user.name, user.id)));
  if (!elements.dueDate.value) elements.dueDate.value = dashboard.today;
  elements.list.replaceChildren(...dashboard.devices.map((device) => {
    const row = document.createElement("tr");
    for (const value of [device.asset_no, device.name]) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
    const status = document.createElement("td");
    const badge = document.createElement("span"); badge.className = `status ${device.status.toLowerCase()}`; badge.textContent = labels[device.status];
    status.append(badge); row.append(status);
    for (const value of [device.borrower_name ?? "—", device.due_date ?? "—"]) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
    const action = document.createElement("td");
    if (device.status === "LOANED") {
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
    const result = await request("/api/loans", { method: "POST", body: JSON.stringify({ deviceId: device.id, borrowerId: Number(elements.borrower.value), dueDate: elements.dueDate.value, expectedUpdatedAt: device.updated_at }) });
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
elements.demoLoaned.addEventListener("click", async () => {
  const loaned = dashboard.devices.find((device) => device.status === "LOANED");
  elements.device.value = String(loaned.id); elements.dueDate.value = dashboard.today; await submitLoan();
});
elements.demoPast.addEventListener("click", async () => {
  const available = dashboard.devices.find((device) => device.status === "AVAILABLE");
  elements.device.value = String(available.id); elements.dueDate.value = "2020-01-01"; await submitLoan();
});
elements.reset.addEventListener("click", async () => {
  try { const result = await request("/api/reset", { method: "POST", body: "{}" }); elements.dueDate.value = ""; await load(); showMessage(result.message, "success"); }
  catch (error) { showMessage(error.message); }
});
load().catch((error) => showMessage(error.message));
