import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, resetDatabase } from "./db.js";
import { BusinessError } from "./domain/messages.js";
import { checkoutDevice, getDashboard, returnDevice } from "./services/loan-service.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const AUTHENTICATED_USER_ID = Number(process.env.CURRENT_USER_ID ?? 1);
const db = createDatabase(process.env.DB_FILE ?? "data/nexus.sqlite");
const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const mimeTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new BusinessError("リクエストの形式が正しくありません。"); }
}

async function serveStatic(pathname, response) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = join(publicDir, relative);
  if (!filePath.startsWith(publicDir)) return false;
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
    response.end(content);
    return true;
  } catch { return false; }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/dashboard") return sendJson(response, 200, getDashboard(db, { authenticatedUserId: AUTHENTICATED_USER_ID }));
    if (request.method === "POST" && url.pathname === "/api/loans") {
      return sendJson(response, 201, checkoutDevice(db, { ...(await readJson(request)), authenticatedUserId: AUTHENTICATED_USER_ID }));
    }
    const returnMatch = url.pathname.match(/^\/api\/devices\/(\d+)\/return$/);
    if (request.method === "POST" && returnMatch) {
      return sendJson(response, 200, returnDevice(db, { ...(await readJson(request)), deviceId: Number(returnMatch[1]), authenticatedUserId: AUTHENTICATED_USER_ID }));
    }
    if (request.method === "POST" && url.pathname === "/api/reset") {
      resetDatabase(db);
      return sendJson(response, 200, { message: "確認用データを初期状態に戻しました。" });
    }
    if (request.method === "GET" && await serveStatic(url.pathname, response)) return;
    sendJson(response, 404, { message: "Not Found" });
  } catch (error) {
    if (error instanceof BusinessError) return sendJson(response, error.statusCode, { message: error.message });
    console.error(error);
    sendJson(response, 500, { message: "データの更新に失敗しました。もう一度入力してください。" });
  }
});

server.listen(PORT, HOST, () => console.log(`NEXUS device lending: http://${HOST}:${PORT}`));
export { server };
