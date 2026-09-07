#!/usr/bin/env node
/** tools/serve.mjs — FDE 编辑器本地伴生服务(零依赖,Node 内置模块)
 * 功能:
 *   1. 静态托管项目根目录(http://127.0.0.1:8137/)
 *   2. GET  /__ping  服务探测(编辑器据此自动切换"直写模式")
 *   3. POST /__save 直写 data/config.js —— 服务端路径固定,页面无需选文件
 *      覆盖前自动备份旧文件到 data/config.backup.js
 * 用法: node tools/serve.mjs   (或双击项目根目录 start-editor.bat)
 * 停止: Ctrl+C(或关闭服务窗口)
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8137);
const HOST = "127.0.0.1";
const MAX_BODY = 32 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon"
};

function json(res, code, obj){
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req){
  return new Promise((ok, no) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { no(new Error("body too large")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", no);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");

    /* 服务探测 */
    if (u.pathname === "/__ping") {
      return json(res, 200, { ok: true, service: "fde-serve", root: path.basename(ROOT) });
    }

    /* 直写配置 */
    if (u.pathname === "/__save" && req.method === "POST") {
      const text = await readBody(req);
      if (!text.includes("window.FDE_CONFIG")) {
        return json(res, 400, { ok: false, error: "body must be config.js content (window.FDE_CONFIG not found)" });
      }
      const target = path.join(ROOT, "data", "config.js");
      const tmp = target + ".tmp";
      try { await fsp.copyFile(target, path.join(ROOT, "data", "config.backup.js")); } catch {}
      await fsp.writeFile(tmp, text, "utf8");
      /* Windows 下目标文件可能被其他进程短暂占用,rename 会 EPERM —— 三级回退 */
      try {
        await fsp.rename(tmp, target);                 /* 首选:原子替换 */
      } catch (e1) {
        try {
          await fsp.rm(target, { force: true });       /* 回退:删目标后再改名 */
          await fsp.rename(tmp, target);
        } catch (e2) {
          try {
            await fsp.writeFile(target, text, "utf8"); /* 兜底:直接覆写(有备份) */
            await fsp.rm(tmp, { force: true });
          } catch (e3) {
            return json(res, 500, { ok: false, error: "写入失败:" + e3.message });
          }
        }
      }
      return json(res, 200, { ok: true, path: "data/config.js", size: Buffer.byteLength(text), backup: "data/config.backup.js" });
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { ok: false, error: "method not allowed" });
    }

    /* 静态托管(仅限项目内、拒绝点开头目录) */
    let p = decodeURIComponent(u.pathname);
    if (p === "/") p = "/app.html";
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) return json(res, 403, { ok: false, error: "forbidden" });
    const rel = path.relative(ROOT, file);
    if (rel.split(path.sep).some((seg) => seg.startsWith("."))) {
      return json(res, 403, { ok: false, error: "forbidden" });
    }
    let st;
    try { st = await fsp.stat(file); } catch { return json(res, 404, { ok: false, error: "not found" }); }
    if (!st.isFile()) return json(res, 404, { ok: false, error: "not found" });

    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    try { json(res, 500, { ok: false, error: e.message }); } catch {}
  }
});

server.listen(PORT, HOST, () => {
  console.log("FDE Editor 伴生服务已启动:");
  console.log("  编辑页   http://" + HOST + ":" + PORT + "/editor.html");
  console.log("  查看页   http://" + HOST + ":" + PORT + "/app.html");
  console.log("  保存     页面「💾 保存到文件」= 直写 data/config.js(路径全自动)");
  console.log("  备份     每次覆盖前自动备份到 data/config.backup.js");
  console.log("  停止服务: Ctrl + C");
});
