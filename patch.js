/* Logic ghi hotspots vào config.js — dùng chung cho serve.js (node) và trình duyệt (ghi trực tiếp file). */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.TourPatch = factory();
})(typeof self !== "undefined" ? self : this, function () {
    /* ---------- định dạng hotspot (giống bên trình duyệt) ---------- */
    const KEYS = ["to", "item", "yaw", "pitch", "dist", "rotX", "rotY", "rotZ", "scale", "auto", "label", "image"];
    function fmtHotspot(h) {
        const parts = [];
        const keys = KEYS.concat(Object.keys(h).filter(k => !KEYS.includes(k)));   // trường lạ vẫn được giữ, không bị mất
        keys.forEach(k => {
            if (h[k] === undefined || h[k] === null || h[k] === "") return;
            parts.push(k + ": " + JSON.stringify(h[k]));
        });
        return "{ " + parts.join(", ") + " }";
    }

    /* ---------- tìm dấu đóng ngoặc, bỏ qua chuỗi và comment ---------- */
    function findMatching(t, i) {
        let depth = 0;
        for (let p = i; p < t.length; p++) {
            const c = t[p];
            if (c === '"' || c === "'" || c === "`") {
                p++;
                while (p < t.length && t[p] !== c) { if (t[p] === "\\") p++; p++; }
                continue;
            }
            if (c === "/" && t[p + 1] === "/") { while (p < t.length && t[p] !== "\n") p++; continue; }
            if (c === "/" && t[p + 1] === "*") { p = t.indexOf("*/", p + 2); if (p < 0) return -1; p++; continue; }
            if (c === "[" || c === "{") depth++;
            else if (c === "]" || c === "}") { depth--; if (depth === 0) return p; }
        }
        return -1;
    }
    const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lineIndent = (t, idx) => /^[ \t]*/.exec(t.slice(t.lastIndexOf("\n", idx) + 1))[0];

    function patchScene(text, { room, scene, hotspots, lines }) {
        lines = lines || (hotspots || []).map(fmtHotspot);   // trình duyệt gửi sẵn từng dòng; bản cũ thì tự định dạng
        const rm = new RegExp(`\\bid\\s*:\\s*(["'])${escRe(room)}\\1`).exec(text);
        if (!rm) return { error: `Không thấy room "${room}" trong config.js` };
        const sre = new RegExp(`\\bid\\s*:\\s*(["'])${escRe(scene)}\\1`, "g");
        sre.lastIndex = rm.index;
        const sm = sre.exec(text);
        if (!sm) return { error: `Không thấy phòng "${scene}" trong room "${room}"` };

        const open = text.lastIndexOf("{", sm.index);
        const close = findMatching(text, open);
        if (open < 0 || close < 0) return { error: `Không đọc được khối của phòng "${scene}"` };

        const body = text.slice(open, close + 1);
        const hm = /\bhotspots\s*:\s*\[/.exec(body);
        const build = indent => lines.length
            ? "[\n" + lines.map(l => indent + "  " + l).join(",\n") + "\n" + indent + "]"
            : "[]";

        if (hm) {
            const arrOpen = open + hm.index + hm[0].length - 1;
            const arrClose = findMatching(text, arrOpen);
            if (arrClose < 0) return { error: `Mảng hotspots của "${scene}" bị lỗi ngoặc` };
            const indent = lineIndent(text, open + hm.index);
            return { text: text.slice(0, arrOpen) + build(indent) + text.slice(arrClose + 1) };
        }
        // chưa có hotspots -> chèn thêm trước dấu } đóng
        const indent = lineIndent(text, sm.index) + "  ";
        let j = close - 1;
        while (j > open && /\s/.test(text[j])) j--;
        const comma = text[j] === "," || text[j] === "{" ? "" : ",";
        return { text: text.slice(0, j + 1) + comma + "\n" + indent + "hotspots: " + build(indent) + "\n" + lineIndent(text, open) + text.slice(close) };
    }

    function patchConfig(src, edits, editMode) {
        let text = src, saved = 0;
        const errors = [];
        for (const e of edits) {
            const r = patchScene(text, e);
            if (r.error) errors.push(r.error); else { text = r.text; saved++; }
        }
        if (editMode === false) text = text.replace(/(\beditMode\s*:\s*)true/, "$1false");
        return { text, saved, errors };
    }

    return { patchConfig, fmtHotspot, version: 3 };
});