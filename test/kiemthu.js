/* Kiểm thử tự động cho các phần không phụ thuộc trình duyệt.
   Chạy:  node test/kiem_thu.js   (từ thư mục gốc của dự án)
   Không sửa mã nguồn: tách khối toán 3D nằm giữa hai dấu MATH_START và MATH_END trong app.js rồi chạy. */
const fs = require("fs"), path = require("path"), cp = require("child_process"), os = require("os");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const out = {};

/* 1. Cú pháp */
out.syntax = ["app.js", "taskbar.js", "patch.js", "serve.js", "config.js"].map(f => {
    try { cp.execFileSync("node", ["--check", path.join(ROOT, f)], { stdio: "pipe" }); return f + " OK"; }
    catch (e) { return f + " LỖI"; }
});

/* 2. Đọc cấu hình + kiểm tra đích đến */
const TOUR_CONFIG = new Function(read("config.js") + "; return TOUR_CONFIG;")();
let rooms = 0, scenes = 0, arrows = 0, items = 0, badTarget = 0, badParent = 0, badStart = 0;
const itemIds = new Set();
TOUR_CONFIG.rooms.forEach(r => {
    rooms++;
    const ids = new Set(r.scenes.map(s => s.id));
    if (!ids.has(r.settings.startScene)) badStart++;
    r.scenes.forEach(s => {
        scenes++;
        if (s.parent && !ids.has(s.parent)) badParent++;
        (s.hotspots || []).forEach(h => {
            if (h.item) { items++; itemIds.add(h.item); }
            else { arrows++; if (!ids.has(h.to)) badTarget++; }
        });
    });
});
// mọi cảnh đều đến được từ cảnh khởi đầu bằng mũi tên (đi theo cạnh "to")?
let unreachable = 0;
TOUR_CONFIG.rooms.forEach(r => {
    const by = Object.fromEntries(r.scenes.map(s => [s.id, s])), seenS = new Set([r.settings.startScene]), q = [r.settings.startScene];
    while (q.length) { const c = q.shift(); (by[c].hotspots || []).forEach(h => { if (h.to && by[h.to] && !seenS.has(h.to)) { seenS.add(h.to); q.push(h.to); } }); }
    unreachable += r.scenes.filter(s => !seenS.has(s.id)).length;
});
out.config = { rooms, scenes, arrows, items, uniqueItemIds: itemIds.size, badTarget, badParent, badStart, unreachableByArrows: unreachable };

/* 3. Đọc items.csv bằng đúng hàm parseCSV trong app.js */
const appSrc = read("app.js");
const m = /function parseCSV\(text\) \{[\s\S]*?\n  \}\n/.exec(appSrc);
const parseCSV = new Function(m[0] + "; return parseCSV;")();
const rows = parseCSV(read("items.csv")), head = rows.shift();
const col = {}; head.forEach((h, i) => { if (h) col[h.trim()] = i; });
const seen = new Set(); let dupRows = 0, blank = 0, nImg = 0, longest = 0, maxImg = 0;
rows.forEach(r => {
    const id = (r[col.id] || "").trim();
    if (!id) { blank++; return; }
    if (seen.has(id)) { dupRows++; return; }
    seen.add(id);
    let n = 0;
    for (let k = 1; k <= 11; k++) {
        if ((r[col["img" + k + "_url"]] || "").trim()) { n++; longest = Math.max(longest, (r[col["img" + k + "_desc"]] || "").length); }
    }
    nImg += n; maxImg = Math.max(maxImg, n);
});
const missing = [...itemIds].filter(i => !seen.has(i));
out.csv = { cols: head.filter(Boolean).length, uniqueItems: seen.size, dupRows, blank, images: nImg, maxImagesPerItem: maxImg, longestDesc: longest, hotspotIdsMissingInCsv: missing.length };

/* 4. Ghi hotspots bằng patch.js trên bản sao */
const P = require(path.join(ROOT, "patch.js"));
const src = read("config.js");
const ed = [{
    room: "nha-a", scene: "phong1", hotspots: [
        { to: "phong2", yaw: 10, pitch: -10, rotX: 0, rotY: 10, rotZ: 0 },
        { item: "c1", yaw: 5, pitch: 1, dist: 3 },
        { to: "phong3", yaw: 20, pitch: -12, rotX: 0, rotY: 20, rotZ: 0 }]
}];
const r1 = P.patchConfig(src, ed, undefined);
const r2 = P.patchConfig(r1.text, ed, undefined);
const bad = P.patchConfig(src, [{ room: "nha-a", scene: "khong-co", hotspots: [] }], undefined);
const cfg2 = new Function(r1.text + "; return TOUR_CONFIG;")();
const sceneAfter = cfg2.rooms[0].scenes[0].hotspots.length;
const otherSame = JSON.stringify(cfg2.rooms.slice(1)) === JSON.stringify(TOUR_CONFIG.rooms.slice(1));
const cm = t => (t.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g) || []).length;
const off = P.patchConfig(src.replace(/editMode:\s*false/, "editMode: true"), [], false);
out.patch = { saved: r1.saved, errors: r1.errors.length, hotspotsAfter: sceneAfter, commentsBefore: cm(src), commentsAfter: cm(r1.text), otherRoomsUnchanged: otherSame, repeatIdentical: r1.text === r2.text, missingSceneError: bad.errors.length === 1 && bad.saved === 0, editModeOff: /editMode:\s*false/.test(off.text) };

/* 5. Toán 3D: tách khối MATH_START..MATH_END */
const mathSrc = /\/\*MATH_START\*\/([\s\S]*?)\/\*MATH_END\*\//.exec(appSrc)[1];
const ARROW = { nativeAngle: 0, autoAim: true, aim: "tail" };
const M = new Function("ARROW", mathSrc + `; return { cam, mul, mulv, transpose, objRot, posOf, camMatrix, rad, deg, rotOf, floorDist, unrot };`)(ARROW);
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const det = A => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
let eOrth = 0, eDet = 0, eFloor = 0, eCam = 0;
const N = 2000;
for (let i = 0; i < N; i++) {
    const h = { yaw: rnd() * 360 - 180, pitch: -(2 + rnd() * 60), rotX: rnd() * 360 - 180, rotY: rnd() * 360 - 180, rotZ: rnd() * 360 - 180, auto: false };
    const R = M.objRot(h), RtR = M.mul(M.transpose(R), R);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) eOrth = Math.max(eOrth, Math.abs(RtR[a][b] - (a === b ? 1 : 0)));
    eDet = Math.max(eDet, Math.abs(det(R) - 1));
    eFloor = Math.max(eFloor, Math.abs(M.posOf({ yaw: h.yaw, pitch: h.pitch })[1] + 1));
}
for (let i = 0; i < 1000; i++) {
    M.cam.yaw = M.rad(rnd() * 360 - 180); M.cam.pitch = M.rad(rnd() * 120 - 60); M.cam.R = M.camMatrix();
    const v = [rnd() * 4 - 2, rnd() * 4 - 2, rnd() * 4 - 2], back = M.unrot(M.mulv(M.cam.R, v));
    eCam = Math.max(eCam, Math.hypot(back[0] - v[0], back[1] - v[1], back[2] - v[2]));
}
const yaw0 = M.posOf({ yaw: 0, pitch: -30 }); // yaw 0 phải nhìn về +z, x = 0
const e = x => x.toExponential(1);
out.math = { samples: N, orthogonal: e(eOrth), determinant: e(eDet), floorHeight: e(eFloor), cameraRoundTrip: e(eCam), yaw0_x: e(Math.abs(yaw0[0])), yaw0_zPositive: yaw0[2] > 0 };

/* 6. Tốc độ */
const h0 = { yaw: 30, pitch: -20, rotX: -40, rotY: 30, rotZ: 5, auto: false };
let t0 = process.hrtime.bigint(); let s = 0;
for (let i = 0; i < 200000; i++) { s += M.posOf({ ...h0, yaw: i % 360 - 180 })[0]; }
const t1 = Number(process.hrtime.bigint() - t0) / 1e6;
t0 = process.hrtime.bigint();
for (let i = 0; i < 20000; i++) { s += M.objRot({ ...h0, rotY: i % 360 })[0][0]; }
const t2 = Number(process.hrtime.bigint() - t0) / 1e6;
out.speed = { posOf_200000_ms: Math.round(t1), objRot_20000_ms: Math.round(t2), us_per_posOf: (t1 * 1000 / 200000).toFixed(2), us_per_objRot: (t2 * 1000 / 20000).toFixed(2) };
// Phòng nhiều hotspot nhất: 1 khung hình = posOf + objRot cho mọi hotspot
let maxH = 0; TOUR_CONFIG.rooms.forEach(r => r.scenes.forEach(sc => maxH = Math.max(maxH, sc.hotspots.length)));
out.speed.maxHotspotsInOneScene = maxH;
console.log(JSON.stringify(out, null, 1));