#!/usr/bin/env node
/* Chạy:  node serve.js   rồi mở  http://localhost:3000
   - Phục vụ file tĩnh
   - Nhận POST /__save từ GUI chỉnh sửa và tự ghi các "hotspots" vào config.js
     (chỉ thay đúng phần hotspots, giữ nguyên ghi chú; tự tạo config.js.bak) */
const http = require("http"), fs = require("fs"), path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const CONFIG = path.join(ROOT, "config.js");
const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".webm": "video/webm"
};

// patch.js được nạp lại mỗi lần lưu, nên sửa patch.js không cần khởi động lại server
const loadPatch = () => { delete require.cache[require.resolve("./patch.js")]; return require("./patch.js"); };
const { fmtHotspot } = loadPatch();

/* ---------- server ---------- */
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};
function send(res, code, obj) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...CORS });
    res.end(JSON.stringify(obj));
}

function handleSave(req, res) {
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || "")) return send(res, 403, { ok: false, error: "forbidden" });
    let data = "";
    req.on("data", c => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on("end", () => {
        try {
            const { edits = [], editMode } = JSON.parse(data);
            const src = fs.readFileSync(CONFIG, "utf8");
            const out = loadPatch().patchConfig(src, edits, editMode);
            if (out.saved === 0 && out.errors.length) return send(res, 400, { ok: false, error: out.errors.join("; ") });
            fs.writeFileSync(CONFIG + ".bak", src);
            fs.writeFileSync(CONFIG, out.text);
            send(res, 200, { ok: true, v: 3, saved: out.saved, errors: out.errors });
        } catch (e) { send(res, 500, { ok: false, error: String(e.message || e) }); }
    });
}

function handleStatic(req, res) {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); return res.end("Not found"); }
        const ext = path.extname(file).toLowerCase();
        const head = { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store", "Accept-Ranges": "bytes" };
        const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");   // trình duyệt cần Range để phát / lặp nhạc, video
        if (m && (m[1] || m[2])) {
            let start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
            if (start > end || start >= st.size) { res.writeHead(416, { "Content-Range": "bytes */" + st.size }); return res.end(); }
            res.writeHead(206, { ...head, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
            return fs.createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { ...head, "Content-Length": st.size });
        fs.createReadStream(file).pipe(res);
    });
}

if (require.main === module) {
    const server = http.createServer((req, res) => {
        if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
        if (req.method === "POST" && (req.url === "/__save2" || req.url === "/__save")) return handleSave(req, res);
        handleStatic(req, res);
    });
    // Cổng đang bận (thường do một cửa sổ node serve.js khác còn chạy) -> tự thử cổng kế tiếp
    let port = Number(PORT);
    server.on("error", e => {
        if (e.code === "EADDRINUSE" && port < Number(PORT) + 20) {
            console.log(`Cổng ${port} đang bận, thử cổng ${port + 1}...`);
            server.listen(++port, "127.0.0.1");
        } else throw e;
    });
    server.on("listening", () => console.log(`Mở http://localhost:${port}`));
    server.listen(port, "127.0.0.1");
}
module.exports = { patchConfig: (...a) => loadPatch().patchConfig(...a), fmtHotspot };