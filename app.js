(function () {
  const $ = id => document.getElementById(id);
  const { site, rooms } = TOUR_CONFIG;
  const EDIT = !!TOUR_CONFIG.editMode;
  const ARROW = { image: "", nativeAngle: 0, size: 0.5, minPx: 36, maxPx: 220, pivot: "tip", autoAim: true, aim: "tail", sprite: null, tipY: 0, ...(TOUR_CONFIG.arrow || {}) };
  const U = 1000;   // 1 đơn vị thế giới = 1000px khi dựng 3D bằng CSS
  const FALLBACK_ARROW = "data:image/svg+xml;utf8," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><path d='M50 6 L90 54 H64 V94 H36 V54 H10 Z' fill='white' stroke='#1b6ef3' stroke-width='5' stroke-linejoin='round'/></svg>");

  const DEFAULTS = {
    startScene: null,
    autoRotate: true, idleSpeed: 12, idleDelay: 1500,
    mouseParallax: true, parallaxYaw: 6, parallaxPitch: 3
  };
  const EASE = 0.04, IDLE_RAMP = 0.03;

  /*MATH_START*/
  /* =====================================================================
     TOÁN 3D. Quy ước: camera đặt tại gốc, cao 1 đơn vị so với sàn (sàn y = -1).
     x = phải, y = lên, z = tới trước. yaw 0 nhìn về +z, yaw dương quay sang phải.
     ===================================================================== */
  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const wrap180 = a => ((a + 180) % 360 + 360) % 360 - 180;
  const round1 = v => Math.round(v * 10) / 10;
  const round2 = v => Math.round(v * 100) / 100;
  const round3 = v => Math.round(v * 1000) / 1000;

  const cam = { yaw: 0, pitch: 0, f: 1, W: 1, H: 1, R: null };

  const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const mulv = (A, v) => A.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const transpose = A => [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const normalize = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  function axisRot(k, t) {                       // ma trận xoay quanh trục k (Rodrigues)
    const c = Math.cos(t), s = Math.sin(t), v = 1 - c, [x, y, z] = k;
    return [[c + x * x * v, x * y * v - z * s, x * z * v + y * s],
    [y * x * v + z * s, c + y * y * v, y * z * v - x * s],
    [z * x * v - y * s, z * y * v + x * s, c + z * z * v]];
  }
  function camMatrix() {                         // thế giới -> toạ độ camera
    const cY = Math.cos(cam.yaw), sY = Math.sin(cam.yaw), cP = Math.cos(cam.pitch), sP = Math.sin(cam.pitch);
    return mul([[1, 0, 0], [0, cP, -sP], [0, sP, cP]], [[cY, 0, -sY], [0, 1, 0], [sY, 0, cY]]);
  }
  const unrot = v => mulv(transpose(cam.R), v);  // toạ độ camera -> thế giới

  // Góc xoay của mũi tên: R = Ry(rotY) · Rx(rotX) · Rz(rotZ)
  const isAuto = h => (h.auto !== undefined ? !!h.auto : !!ARROW.autoAim);   // true = tự xoay chĩa về tâm
  const aimY = h => wrap180((h.yaw || 0) + (ARROW.aim === "head" ? 180 : 0));   // hướng "đuôi về tâm" (hoặc "đầu về tâm")
  const rotOf = h => [h.rotX || 0, isAuto(h) ? aimY(h) : (h.rotY || 0), h.rotZ || 0];
  function objRot(h) {
    const [rx, ry, rz] = rotOf(h);
    return mul(mul(axisRot([0, 1, 0], rad(ry)), axisRot([1, 0, 0], rad(rx))), axisRot([0, 0, 1], rad(rz)));
  }
  function gimbalAxes(h) {                       // trục của 3 vòng X, Y, Z
    const [rx, ry] = rotOf(h);
    const Ry = axisRot([0, 1, 0], rad(ry)), Rx = axisRot([1, 0, 0], rad(rx));
    return [mulv(Ry, [1, 0, 0]), [0, 1, 0], mulv(mul(Ry, Rx), [0, 0, 1])];
  }

  const floorDist = pitch => 1 / -Math.sin(rad(Math.min(pitch, -2)));   // khoảng cách tới điểm chạm sàn
  function posOf(h) {                            // vị trí 3D của mũi tên
    const onFloor = h.dist === undefined;
    const th = rad(onFloor ? Math.min(h.pitch, -2) : h.pitch), ps = rad(h.yaw);
    const d = onFloor ? floorDist(h.pitch) : h.dist;
    return [d * Math.cos(th) * Math.sin(ps), d * Math.sin(th), d * Math.cos(th) * Math.cos(ps)];
  }

  // CSS: x phải, y xuống, z về phía người xem. Ảnh phẳng, "lên" của ảnh = +z thế giới khi nằm trên sàn.
  const CCAM = [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
  const LMAT = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
  function arrowRcss(h, nativeAngle) {
    return mul(mul(mul(mul(CCAM, cam.R), objRot(h)), LMAT), axisRot([0, 0, 1], rad(-(nativeAngle || 0))));
  }
  /*MATH_END*/

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const img = (room, file) => (file ? (room.folder || "") + file : "");

  /* ------------------------- Chuẩn hóa dữ liệu hotspot ------------------------- */
  const KEYS = ["to", "item", "yaw", "pitch", "dist", "rotX", "rotY", "rotZ", "scale", "auto", "label", "image"];
  function fmtHotspot(h) {
    const parts = [];
    KEYS.concat(Object.keys(h).filter(k => !KEYS.includes(k))).forEach(k => { if (h[k] !== undefined && h[k] !== null && h[k] !== "") parts.push(k + ": " + JSON.stringify(h[k])); });
    return "{ " + parts.join(", ") + " }";
  }
  function normHotspot(h) {
    if (h.item) {                                  // hotspot hiện vật: chỉ cần yaw / pitch (/ dist)
      h.pitch ??= -10; h.yaw ??= 0;
      ["rotX", "rotY", "rotZ", "auto", "to", "image"].forEach(k => delete h[k]);
      return h;
    }
    if (h.rotY === undefined) h.rotY = h.heading ?? h.yaw ?? 0;   // tương thích bản cũ (heading)
    delete h.heading;
    h.rotX ??= 0; h.rotZ ??= 0; h.pitch ??= -20; h.yaw ??= 0;
    if (isAuto(h)) h.rotY = round1(aimY(h));
    if (h.scale === 1) delete h.scale;
    return h;
  }

  /* ------------------------- Thay đổi chưa lưu (chỉ nằm trong bộ nhớ, KHÔNG lưu nháp) ------------------------- */
  // Dữ liệu luôn lấy từ config.js. Bản nháp cũ trong trình duyệt (nếu có) bị xoá để không ghi đè config.
  let draft = {}, hasDraft = false;
  try { localStorage.removeItem("tour360_draft_v2"); } catch (e) { }
  window.addEventListener("beforeunload", e => { if (EDIT && hasDraft) { e.preventDefault(); e.returnValue = ""; } });
  rooms.forEach(r => r.scenes.forEach(s => (s.hotspots ||= []).forEach(normHotspot)));

  /* ------------------------- Dữ liệu hiện vật (items.csv) ------------------------- */
  // Cột: id, name, period, rồi lặp img{n}_url / img{n}_caption / img{n}_desc (tối đa 11 ảnh).
  // Dòng trống bị bỏ qua; id trùng nhau thì lấy dòng đầu tiên.
  const ITEMS = {};
  let itemsReady = null, itemsDone = false;

  // Ảnh bìa của room: room.cover có thể là
  //   - id hiện vật trong items.csv (vd "c1") -> lấy ảnh đầu tiên của hiện vật đó
  //   - link đầy đủ (http/https, data:, hoặc bắt đầu bằng "/") -> dùng nguyên
  //   - đường dẫn có "/" (vd images/skin/nhasan.jpg) -> tính từ thư mục gốc của web, không nối folder
  //   - chỉ tên file (vd cover.jpg) -> nối với room.folder
  const safeUrl = u => /%[0-9A-Fa-f]{2}/.test(u) ? u : encodeURI(u);   // link đã mã hoá sẵn thì giữ nguyên
  function coverUrl(r) {
    const c = (r.cover || "").trim();
    if (!c) return "";
    if (ITEMS[c] && ITEMS[c].images[0]) return safeUrl(ITEMS[c].images[0].url);
    if (/^(https?:|data:|blob:|\/)/i.test(c) || c.includes("/")) return safeUrl(c);   // link đầy đủ hoặc đường dẫn có thư mục (vd images/skin/nhasan.jpg) -> dùng nguyên
    return safeUrl((r.folder || "") + c);
  }

  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); f = ""; rows.push(row); row = [];
      } else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  function loadItems() {
    if (itemsReady) return itemsReady;
    const url = TOUR_CONFIG.itemsCsv || "items.csv";
    itemsReady = fetch(url, { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(txt => {
        const rows = parseCSV(txt), head = rows.shift() || [];
        const col = {}; head.forEach((h, i) => { if (h) col[h.trim()] = i; });
        rows.forEach(r => {
          const id = (r[col.id] || "").trim();
          if (!id || ITEMS[id]) return;
          const images = [];
          for (let n = 1; n <= 30; n++) {
            const u = (r[col["img" + n + "_url"]] || "").trim();
            if (!u) continue;
            images.push({ url: u, caption: (r[col["img" + n + "_caption"]] || "").trim(), desc: (r[col["img" + n + "_desc"]] || "").trim() });
          }
          ITEMS[id] = { id, name: (r[col.name] || "").trim(), period: (r[col.period] || "").trim(), images };
        });
        buildItemList();
      })
      .catch(err => {
        console.warn("[Tour360] Không tải được " + url + " (" + err.message + "). Hãy chạy node serve.js và mở http://localhost:3000 (mở thẳng file .html sẽ bị chặn đọc CSV).");
      })
      .finally(() => { itemsDone = true; });
    return itemsReady;
  }

  /* ------------------------- Khung xem hiện vật ------------------------- */
  const IV = { item: null, idx: 0, zoom: 1, px: 0, py: 0, pan: null, tok: 0, prev: null, closing: false, openTimer: null };
  let camBusy = false;   // đang zoom camera cho hiện vật: tạm dừng tự xoay / parallax
  function ivApply() {
    const im = $("iv-img");
    im.style.transform = `translate(${IV.px}px, ${IV.py}px) scale(${IV.zoom})`;
    im.style.cursor = IV.zoom > 1 ? "grab" : "zoom-in";
  }
  function ivZoom(z) {
    IV.zoom = clamp(z, 1, 4);
    if (IV.zoom === 1) IV.px = IV.py = 0;
    ivApply();
  }
  function ivShow(i, first) {
    const it = IV.item; if (!it || !it.images.length) return;
    const dir = first ? 0 : (i > IV.idx ? 1 : -1);          // 1 = sang phải (ảnh sau), -1 = ảnh trước
    IV.idx = (i + it.images.length) % it.images.length;
    IV.zoom = 1; IV.px = IV.py = 0;
    const m = it.images[IV.idx], img = $("iv-img"), tok = ++IV.tok;
    const swap = () => {
      if (tok !== IV.tok) return;                              // bấm nhanh: chỉ lấy ảnh cuối
      img.src = m.url; img.alt = m.caption || it.name;
      ivApply();
      if (dir && img.animate) img.animate(
        [{ transform: `translateX(${dir * 90}px) scale(.96)`, opacity: 0 }, { transform: "translateX(0) scale(1)", opacity: 1 }],
        { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" });
    };
    if (dir) { const pre = new Image(); pre.onload = pre.onerror = swap; pre.src = m.url; } else swap();
    $("iv-count").textContent = (IV.idx + 1) + " / " + it.images.length;
    $("iv-name").textContent = it.name;
    $("iv-period").textContent = it.period;
    $("iv-period").hidden = !it.period;
    $("iv-caption").textContent = m.caption;
    $("iv-caption").hidden = !m.caption;
    $("iv-desc").textContent = m.desc;
    $("iv-desc").hidden = !m.desc;
    const multi = it.images.length > 1;
    $("iv-prev").hidden = $("iv-next").hidden = !multi;
    $("iv-play").hidden = $("iv-grid").hidden = !multi;
    $("iv-thumbs").hidden = !multi || IV.hideThumbs;
    $("iv-thumbs").querySelectorAll("img").forEach((t, k) => {
      t.classList.toggle("active", k === IV.idx);
      if (k === IV.idx) t.scrollIntoView({ block: "nearest", inline: "center" });
    });
    $("iv-side").scrollTop = 0;
  }
  const hotspotLook = h => {                                 // hướng nhìn (pitch, yaw) tới hotspot
    const P = posOf(h);
    return { yaw: h.yaw, pitch: round2(deg(Math.asin(P[1] / (Math.hypot(P[0], P[1], P[2]) || 1)))) };
  };
  async function openItem(id, hs) {
    if (!$("iv").hidden || IV.closing || IV.openTimer) return;
    await loadItems();
    const it = ITEMS[id];
    if (!it) { console.warn("[Tour360] Không có hiện vật id = " + id + " trong items.csv"); return; }
    if (!it.images.length) return;
    IV.item = it; IV.idx = 0;
    const th = $("iv-thumbs"); th.innerHTML = "";
    it.images.forEach((m, k) => {
      const t = document.createElement("img");
      t.src = m.url; t.alt = ""; t.loading = "lazy";
      t.onclick = () => ivShow(k);
      th.appendChild(t);
    });
    new Image().src = it.images[0].url;                      // tải sẵn ảnh đầu trong lúc camera zoom

    let wait = 0;
    if (viewer && hs) {                                      // zoom camera 360° vào đúng tọa độ hiện vật
      IV.prev = { yaw: viewer.getYaw(), pitch: viewer.getPitch(), hfov: viewer.getHfov() };
      const look = hotspotLook(hs), minH = (viewer.getHfovBounds?.() || [30])[0];
      camBusy = true; wait = 650;
      viewer.lookAt(look.pitch, look.yaw, Math.max(minH, IV.prev.hfov * 0.5), 700);
    } else IV.prev = null;

    IV.openTimer = setTimeout(() => {
      IV.openTimer = null;
      const box = $("iv"); box.classList.remove("show"); box.hidden = false;
      ivShow(0, true);
      requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("show")));
    }, wait);
  }
  function ivStop() {
    clearInterval(IV.timer); IV.timer = null;
    $("iv-play").classList.remove("playing");
  }
  function closeItem(instant) {
    ivStop();
    clearTimeout(IV.openTimer); IV.openTimer = null;
    const box = $("iv"), prev = IV.prev;
    const finish = () => {
      box.hidden = true; box.classList.remove("show");
      $("iv-img").removeAttribute("src"); IV.item = null; IV.pan = null; IV.closing = false; IV.tok++;
    };
    if (box.hidden && !camBusy) return;
    if (instant === true || box.hidden) {                    // đổi phòng / chưa kịp mở: đóng ngay
      if (instant !== true && viewer && prev) viewer.lookAt(prev.pitch, prev.yaw, prev.hfov, 500);   // chưa kịp mở thì chỉ trả camera
      finish(); camBusy = false; IV.prev = null; return;
    }
    if (IV.closing) return;
    IV.closing = true;
    box.classList.remove("show");                            // mờ dần + thu nhỏ
    setTimeout(finish, 360);
    if (viewer && prev) {                                    // trả camera về vị trí cũ
      viewer.lookAt(prev.pitch, prev.yaw, prev.hfov, 650);
      setTimeout(() => { camBusy = false; lastActive = performance.now(); }, 700);
    } else camBusy = false;
    IV.prev = null;
  }

  $("iv-close").onclick = () => closeItem();
  $("iv-prev").onclick = () => ivShow(IV.idx - 1);
  $("iv-next").onclick = () => ivShow(IV.idx + 1);
  $("iv-play").onclick = () => {                       // tự chạy ảnh mỗi 3 giây
    if (IV.timer) { ivStop(); return; }
    $("iv-play").classList.add("playing");
    IV.timer = setInterval(() => ivShow(IV.idx + 1), 3000);
  };
  $("iv-grid").onclick = () => {                       // ẩn/hiện dải ảnh nhỏ
    IV.hideThumbs = !IV.hideThumbs;
    $("iv-thumbs").hidden = IV.hideThumbs;
  };
  $("iv-zoom").onclick = () => ivZoom(IV.zoom >= 3 ? 1 : IV.zoom + 1);
  $("iv-full").onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen(); else $("iv").requestFullscreen?.();
  };
  $("iv-stage").addEventListener("click", e => { if (e.target === $("iv-stage")) closeItem(); });
  $("iv-img").addEventListener("wheel", e => { e.preventDefault(); ivZoom(IV.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)); }, { passive: false });
  $("iv-img").addEventListener("dblclick", () => ivZoom(IV.zoom > 1 ? 1 : 2.5));
  $("iv-img").addEventListener("pointerdown", e => {
    e.preventDefault();
    IV.pan = { x: e.clientX, y: e.clientY, px: IV.px, py: IV.py, moved: false };
    $("iv-img").setPointerCapture?.(e.pointerId);
  });
  $("iv-img").addEventListener("pointermove", e => {
    const p = IV.pan; if (!p) return;
    if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 4) p.moved = true;
    if (IV.zoom > 1) { IV.px = p.px + e.clientX - p.x; IV.py = p.py + e.clientY - p.y; ivApply(); }
  });
  $("iv-img").addEventListener("pointerup", e => {
    const p = IV.pan; IV.pan = null;
    if (!p) return;
    if (!p.moved && IV.zoom === 1) ivZoom(2);        // bấm 1 lần để phóng to
    else if (p.moved && IV.zoom === 1 && IV.item && IV.item.images.length > 1) {   // vuốt ngang để đổi ảnh
      const dx = e.clientX - p.x;
      if (Math.abs(dx) > 60) ivShow(IV.idx + (dx < 0 ? 1 : -1));
    }
  });
  window.addEventListener("keydown", e => {
    if ($("iv").hidden) return;
    if (e.key === "Escape") closeItem();
    else if (e.key === "ArrowLeft") ivShow(IV.idx - 1);
    else if (e.key === "ArrowRight") ivShow(IV.idx + 1);
  });

  /* ------------------------- Router ------------------------- */
  function route() {
    if (!rooms || rooms.length === 0) {
      document.body.textContent = "Chưa có room nào. Hãy thêm room trong config.js";
      return;
    }
    if (rooms.length === 1) { openRoom(rooms[0], false); return; }
    const id = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    const room = rooms.find(r => r.id === id);
    if (room) openRoom(room, true); else showHome();
  }

  /* ------------------------- Trang chủ ------------------------- */
  function showHome() {
    closeRoom(); closeLobby();
    $("tour").hidden = true;
    const el = $("home");
    el.hidden = false;
    document.title = site.title;
    if (!itemsDone) loadItems().then(() => { if (!$("home").hidden) showHome(); });   // cover là id hiện vật thì vẽ lại khi items.csv tải xong
    const bgCss = list => list.filter(Boolean).map(u => `url('${esc(u)}')`).join(",");
    rooms.forEach(r => { const c = coverUrl(r); if (c && itemsDone) { const p = new Image(); p.onerror = () => console.warn("[Tour360] Không tải được ảnh cover của \"" + r.name + "\": " + c); p.src = c; } });
    const cards = rooms.map((r, i) => {
      return `
        <a class="card" style="--i:${i}" href="#${encodeURIComponent(r.id)}">
          <div class="cover"><i style="background-image:${bgCss([coverUrl(r)])}"></i><span class="badge">360°</span></div>
          <div class="body">
            <h2>${esc(r.name)}</h2>
            <p>${esc(r.description)}</p>
            <div class="meta"><span>${r.scenes.length} phòng</span><span class="go">Khám phá →</span></div>
          </div>
        </a>`;
    }).join("");
    const bg = bgCss([site.background, coverUrl(rooms[0])]);   // không có ảnh nền riêng -> dùng ảnh bìa room đầu
    el.innerHTML = `
      <div class="home-bg"><i class="pic" style="background-image:${bg}"></i><i class="orb o1"></i><i class="orb o2"></i></div>
      <header class="hero">
        <div class="eyebrow">${esc(site.eyebrow || "Tham quan thực tế ảo")}</div>
        <h1>${esc(site.title)}</h1>
        <div class="divider"><i></i><b></b><i></i></div>
        <p>${esc(site.description)}</p>
      </header>
      <div class="grid">${cards}</div>
      `;
    el.scrollTop = 0;
  }

  /* ------------------------- Trạng thái màn hình tour ------------------------- */
  let viewer = null, raf = 0, room = null, cfg = null, byId = {}, curScene = null;
  let targetYaw = 0, targetPitch = 0, curYaw = 0, curPitch = 0;
  let dragging = false, idleSpeed = 0;
  let lastActive = performance.now(), lastTime = performance.now();
  let items = [], selected = null, drag = null;
  const pano = $("panorama");

  pano.addEventListener("mousedown", () => dragging = true);
  window.addEventListener("mouseup", () => dragging = false);
  window.addEventListener("mousemove", e => {
    if (!cfg) return;
    targetYaw = ((e.clientX / innerWidth) * 2 - 1) * cfg.parallaxYaw;
    targetPitch = -((e.clientY / innerHeight) * 2 - 1) * cfg.parallaxPitch;
  });
  const markActive = () => { lastActive = performance.now(); };
  ["mousemove", "mousedown", "wheel"].forEach(ev => window.addEventListener(ev, markActive));
  ["touchstart", "touchmove"].forEach(ev => window.addEventListener(ev, markActive, { passive: true }));

  /* ------------------------- Mở / đóng room ------------------------- */
  /* ------------------------- Sảnh chờ: hướng dẫn viên + tên phòng + mô tả + nút VÀO THAM QUAN ------------------------- */
  // Cấu hình trong config.js:  room.guide = { gif: "...gif", voice: "...mp3", idleImage?: "...png" }
  // room.lobby = false để bỏ qua sảnh chờ của room đó. Nút chỉ trượt lên khi voice đọc xong.
  let lobbyAudio = null, lobbyTimer = 0, lobbyUnlock = null;
  function closeLobby() {
    clearTimeout(lobbyTimer);
    if (lobbyUnlock) { window.removeEventListener("pointerdown", lobbyUnlock, true); lobbyUnlock = null; }
    if (lobbyAudio) { lobbyAudio.onended = lobbyAudio.onerror = null; lobbyAudio.pause(); lobbyAudio = null; }
    const L = $("lobby");
    L.hidden = true; L.classList.remove("show", "ready", "leaving", "done"); L.style.removeProperty("--sx");
  }
  function showLobby(r, canGoHome, enter) {
    const g = { ...(r.guide || {}) }, L = $("lobby"), btn = $("lb-enter");
    const bgEl = $("lb-bg");
    const setBg = () => { const c = coverUrl(r); bgEl.style.backgroundImage = c ? `url("${c}")` : ""; };   // chỉ dùng ảnh cover, không dùng ảnh 360
    setBg();
    if (!itemsDone) loadItems().then(() => { if (!$("lobby").hidden) setBg(); });   // cover là id hiện vật thì chờ items.csv
    $("lb-title").textContent = r.name;
    $("lb-desc").textContent = r.description || "";
    $("lb-desc").hidden = !r.description;
    $("lb-eyebrow").textContent = g.eyebrow || "Hướng dẫn tham quan";
    const gif = $("lb-gif"); gif.hidden = !g.gif; if (g.gif) gif.src = g.gif;
    $("lb-meta").textContent = r.scenes.length + " không gian · Thực tế ảo 360°";
    $("lb-foot").textContent = "";
    $("lb-foot").hidden = true;
    $("lb-hint").hidden = true;
    $("lb-home").hidden = !canGoHome;
    $("lb-home").onclick = () => { location.hash = ""; };
    document.title = r.name;
    $("home").hidden = true; $("tour").hidden = true;
    if (r.scenes[0]) new Image().src = img(r, (r.scenes.find(s => s.id === (r.settings && r.settings.startScene)) || r.scenes[0]).image);   // tải sẵn ảnh panorama

    let entered = false;
    const ready = () => {
      $("lb-hint").hidden = true;
      if (g.gif && !matchMedia("(max-width: 760px)").matches) {   // máy tính: dời khung chữ về giữa khi hướng dẫn viên ẩn
        const gd = document.querySelector(".lb-guide"), gap = parseFloat(getComputedStyle(document.querySelector(".lb-stage")).columnGap) || 0;
        L.style.setProperty("--sx", (-(gd.offsetWidth + gap) / 2) + "px");
      }
      L.classList.add("done", "ready");                           // hướng dẫn viên trượt xuống + nút VÀO THAM QUAN trượt lên
    };
    btn.onclick = () => {
      if (entered) return; entered = true;
      L.classList.remove("ready"); L.classList.add("leaving");   // nút trượt xuống, sảnh mờ dần
      enter();
      setTimeout(() => { if (L.classList.contains("leaving")) closeLobby(); }, 800);
    };

    L.hidden = false; L.classList.remove("ready", "leaving", "done"); L.style.removeProperty("--sx");
    requestAnimationFrame(() => requestAnimationFrame(() => L.classList.add("show")));

    if (!g.voice) { lobbyTimer = setTimeout(ready, (g.noVoiceDelay ?? 3) * 1000); return; }   // không có voice: hiện nút sau vài giây
    const a = lobbyAudio = new Audio(g.voice);
    a.preload = "auto";
    a.onended = ready;
    a.onerror = () => { console.warn("[Tour360] Không phát được voice hướng dẫn:", g.voice); ready(); };
    const start = () => a.play().then(() => {
      $("lb-hint").hidden = true;
    }, err => {
      if (!(err && err.name === "NotAllowedError")) return;
      $("lb-hint").hidden = false;                              // trình duyệt chặn tự phát: chạm 1 lần để bắt đầu
      lobbyUnlock = () => { window.removeEventListener("pointerdown", lobbyUnlock, true); lobbyUnlock = null; start(); };
      window.addEventListener("pointerdown", lobbyUnlock, true);
    });
    start();
  }

  function openRoom(r, canGoHome) {
    closeRoom(); closeLobby();
    if (!EDIT && r.lobby !== false) { room = null; showLobby(r, canGoHome, () => startRoom(r, canGoHome)); return; }
    startRoom(r, canGoHome);
  }

  function startRoom(r, canGoHome) {
    closeRoom();
    room = r;
    cfg = { ...DEFAULTS, ...(r.settings || {}) };
    if (EDIT) { cfg.autoRotate = false; cfg.mouseParallax = false; }   // chỉnh sửa thì ảnh đứng yên
    byId = Object.fromEntries(r.scenes.map(s => [s.id, s]));
    const first = byId[cfg.startScene] ? cfg.startScene : r.scenes[0].id;

    $("home").hidden = true;
    $("tour").hidden = false;
    document.title = r.name;

    const scenes = {};
    r.scenes.forEach(s => { scenes[s.id] = { title: s.title, type: "equirectangular", panorama: img(r, s.image) }; });

    viewer = pannellum.viewer("panorama", {
      default: {
        firstScene: first, autoLoad: true, showControls: true, showFullscreenCtrl: false,
        mouseZoom: true, compass: false, sceneFadeDuration: 800
      },
      scenes
    });
    viewer.on("scenechange", updateUI);

    window.TourDock && TourDock.open({ room: r, canGoHome, home: () => { location.hash = ""; } });
    $("editor").hidden = !EDIT;

    buildMenu();
    buildInfo();
    updateUI(first);

    targetYaw = targetPitch = curYaw = curPitch = idleSpeed = 0;
    lastActive = lastTime = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function closeRoom() {
    cancelAnimationFrame(raf); trans = false; camBusy = false;
    if (viewer) { viewer.destroy(); viewer = null; }
    room = null; cfg = null; curScene = null; selected = null; drag = null; items = [];
    $("hs-layer").innerHTML = ""; $("hs-labels").innerHTML = ""; $("gizmo").innerHTML = "";
    $("menu").hidden = true; $("info").hidden = true; $("editor").hidden = true;
    window.TourDock && TourDock.close();
    closeItem(true);
  }

  /* ------------------------- Chuyển phòng: zoom gần → đổi phòng → zoom xa rồi vào gần ------------------------- */
  let trans = false;
  function goScene(id, h) {
    if (!viewer || trans || !byId[id] || (curScene && curScene.id === id)) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { viewer.loadScene(id); return; }
    trans = true; camBusy = true;
    const tour = $("tour"), [minH, maxH] = viewer.getHfovBounds?.() || [50, 120];
    const base = viewer.getHfov(), near = Math.max(minH, base * 0.55), far = Math.min(maxH, base * 1.4);
    const aim = h ? { pitch: Math.max(-10, Math.min(10, (h.pitch || 0) * 0.4)), yaw: h.yaw || 0 } : null;   // chiếu về phía mũi tên rồi "bước" vào
    tour.classList.add("going");
    viewer.lookAt(aim ? aim.pitch : viewer.getPitch(), aim ? aim.yaw : viewer.getYaw(), near, 650);   // ① zoom lại gần
    let guard;
    const finish = () => { clearTimeout(guard); trans = false; camBusy = false; lastActive = performance.now(); tour.classList.remove("going"); };
    const onLoad = () => {                                                                         // ③ phòng mới đã tải: đang ở xa → zoom vào gần
      viewer.off("load", onLoad);
      viewer.lookAt(viewer.getPitch(), viewer.getYaw(), base, 1100);
      setTimeout(finish, 1150);
    };
    setTimeout(() => {
      if (!viewer) return;
      viewer.on("load", onLoad);
      guard = setTimeout(() => { viewer && viewer.off("load", onLoad); finish(); }, 8000);          // phòng hờ nếu ảnh lỗi
      viewer.loadScene(id, aim ? aim.pitch : undefined, aim ? aim.yaw : undefined, far);          // ② đổi phòng, bắt đầu từ góc rộng (zoom xa)
    }, 650);
  }

  /* ------------------------- Menu, info, back ------------------------- */
  function buildMenu() {
    const menu = $("menu");
    menu.innerHTML = "";
    const addItems = (parentId, depth) => {
      room.scenes.filter(s => (s.parent ?? null) === parentId).forEach(s => {
        const b = document.createElement("button");
        b.className = "scene-card" + (depth > 0 ? " child" : "");
        b.dataset.id = s.id;
        const im = document.createElement("img");          // ảnh panorama của phòng (chỉ tải khi mở menu)
        im.loading = "lazy"; im.decoding = "async"; im.draggable = false; im.alt = s.title; im.src = img(room, s.image);
        im.onerror = () => b.classList.add("no-img");
        const nm = document.createElement("span"); nm.textContent = s.title;
        b.append(im, nm);
        b.onclick = () => { goScene(s.id); menu.hidden = true; };
        menu.appendChild(b);
        addItems(s.id, depth + 1);
      });
    };
    addItems(null, 0);
    const toggle = $("menu-toggle");
    toggle.hidden = room.scenes.length < 2;
    toggle.onclick = () => { menu.hidden = !menu.hidden; };
  }

  function buildInfo() {
    const info = $("info"), btn = $("info-btn");
    info.innerHTML = "";
    const h = document.createElement("h2"); h.textContent = room.name;
    const p = document.createElement("p"); p.textContent = room.description || "";
    info.append(h, p);
    btn.hidden = !room.description;
    btn.onclick = () => { info.hidden = !info.hidden; };
  }

  function updateUI(id) {
    curScene = byId[id];
    $("room-title").textContent = room.scenes.length > 1 ? `${room.name} · ${curScene.title}` : room.name;
    $("menu").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.id === id));
    const back = $("back-btn");
    if (curScene.parent && byId[curScene.parent]) {
      back.textContent = "← " + byId[curScene.parent].title;
      back.onclick = () => goScene(curScene.parent);
      back.hidden = false;
    } else back.hidden = true;
    selected = null;
    renderHotspots();
    refreshEditor();
  }

  /* ------------------------- Vẽ mũi tên 3D ------------------------- */
  const hsText = h => h.label || (h.item ? (ITEMS[h.item]?.name || h.item) : (byId[h.to]?.title || h.to || "⚠ chưa chọn đích đến"));
  const hsImage = h => h.image || ARROW.image || FALLBACK_ARROW;
  const GIZMO_COLORS = ["#ff4d4d", "#4dff7a", "#4da3ff"];   // X đỏ, Y xanh lá, Z xanh dương

  /* --- Sprite sheet: 1 ảnh gồm nhiều khung, tự chạy lần lượt (config: arrow.sprite) --- */
  const SPR = ARROW.sprite && ARROW.sprite.cols && ARROW.sprite.rows ? {
    cols: ARROW.sprite.cols, rows: ARROW.sprite.rows,
    frames: ARROW.sprite.frames || ARROW.sprite.cols * ARROW.sprite.rows,
    fps: ARROW.sprite.fps || 12
  } : null;
  let sprFrame = -1;
  function setSpriteFrame(el, f) {
    if (el.dataset.fb) return;
    const c = f % SPR.cols, r = Math.floor(f / SPR.cols);
    el.style.backgroundPosition =
      `${SPR.cols > 1 ? c / (SPR.cols - 1) * 100 : 0}% ${SPR.rows > 1 ? r / (SPR.rows - 1) * 100 : 0}%`;
  }
  function spriteStep(now) {
    if (!SPR) return;
    const f = Math.floor(now / 1000 * SPR.fps) % SPR.frames;
    if (f === sprFrame) return;
    sprFrame = f;
    items.forEach(it => setSpriteFrame(it.el, f));
  }
  function useFallback(el, src) {
    if (el.dataset.fb) return;
    el.dataset.fb = "1";
    console.warn("[Tour360] Không tải được ảnh mũi tên: " + src + " → đang dùng mũi tên mặc định. Kiểm tra đường dẫn/tên file.");
    if (SPR) {
      el.style.backgroundImage = `url("${FALLBACK_ARROW}")`;
      el.style.backgroundSize = "100% 100%"; el.style.backgroundPosition = "0 0";
    } else el.src = FALLBACK_ARROW;
  }
  function setArrowSrc(el, src) {
    delete el.dataset.fb;
    if (SPR) {
      el.style.backgroundImage = `url("${src}")`;
      el.style.backgroundSize = `${SPR.cols * 100}% ${SPR.rows * 100}%`;
      el.style.backgroundRepeat = "no-repeat";
      setSpriteFrame(el, Math.max(sprFrame, 0));
      const probe = new Image(); probe.onerror = () => useFallback(el, src); probe.src = src;
    } else el.src = src;
  }

  function renderHotspots() {
    $("hs-layer").innerHTML = ""; $("hs-labels").innerHTML = ""; $("gizmo").innerHTML = "";
    items = [];
    (curScene.hotspots || []).forEach(h => {
      if (!h.item && !h.to && !EDIT) { console.warn("[Tour360] Bỏ qua hotspot thiếu cả `to` lẫn `item` trong config.js:", h); return; }
      const isItem = !!h.item;
      const el = document.createElement(isItem ? "div" : (SPR ? "div" : "img"));
      el.draggable = false;
      if (isItem) {
        el.className = "item-pin";
        el.innerHTML = "<span></span>";
      } else {
        el.className = "arrow3d";
        if (!SPR) el.onerror = () => useFallback(el, el.src);
        setArrowSrc(el, hsImage(h));
      }
      const label = document.createElement("div");
      label.className = "hs-label"; label.textContent = hsText(h);
      if (isItem) {                                 // tên chỉ hiện khi rê chuột / chạm vào nút
        label.classList.add("item-label");
        el.addEventListener("pointerenter", () => label.classList.add("show"));
        el.addEventListener("pointerleave", () => { if (!(EDIT && h === selected)) label.classList.remove("show"); });
      }

      const it = { h, el, label, sx: 0, sy: 0, isItem };
      if (EDIT) {
        el.addEventListener("pointerdown", e => {
          e.preventDefault(); select(h);
          const rect = pano.getBoundingClientRect();
          const Pw = posOf(h), ray0 = rayWorld(e.clientX - rect.left, e.clientY - rect.top);
          if (isItem) {                              // hiện vật: kéo tự do khắp mặt cầu 360°, giữ nguyên khoảng cách tới camera
            const r = Math.hypot(Pw[0], Pw[1], Pw[2]) || 1, u = normalize(ray0);
            drag = { type: "move", it, free: true, dist: r, off: [Pw[0] / r - u[0], Pw[1] / r - u[1], Pw[2] / r - u[2]] };
          } else {
            const hit = hitPlaneY(ray0, Pw[1]);
            drag = {
              type: "move", it, y: Pw[1], floor: h.dist === undefined,
              off: hit ? [Pw[0] - hit[0], Pw[2] - hit[2]] : [0, 0]
            };
          }
          el.setPointerCapture?.(e.pointerId);
        });
      } else {
        el.addEventListener("click", () => {
          if (isItem) openItem(h.item, h);
          else if (byId[h.to]) goScene(h.to, h);
        });
      }
      $("hs-layer").appendChild(el);
      $("hs-labels").appendChild(label);
      items.push(it);
    });

    if (EDIT) {                                  // 3 vòng gizmo X / Y / Z
      for (let i = 0; i < 3; i++) {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("stroke", GIZMO_COLORS[i]);
        p.addEventListener("pointerdown", e => startRing(e, i, p));
        p.style.display = "none";
        $("gizmo").appendChild(p);
      }
    }
  }

  // Đầu mũi tên nằm đúng vị trí hotspot, phần thân/đuôi xoay quanh đầu (không xoay quanh tâm ảnh)
  function tipShift(w) {
    if (ARROW.pivot === "center") return "";
    const t = rad(ARROW.nativeAngle || 0), d = (0.5 - (ARROW.tipY || 0)) * w;   // tipY = vị trí đầu mũi tên trong ảnh (0 = mép trên, 0.5 = giữa)
    return ` translate(${-d * Math.sin(t)}px, ${d * Math.cos(t)}px)`;
  }

  function updateHotspots() {
    cam.W = pano.clientWidth; cam.H = pano.clientHeight;
    cam.yaw = rad(viewer.getYaw()); cam.pitch = rad(viewer.getPitch());
    cam.f = (cam.W / 2) / Math.tan(rad(viewer.getHfov()) / 2);
    cam.R = camMatrix();
    $("hs-layer").style.perspective = cam.f + "px";

    let selVisible = false;
    items.forEach(it => {
      const h = it.h, Pw = posOf(h), Pc = mulv(cam.R, Pw);
      const sx = cam.W / 2 + cam.f * Pc[0] / Pc[2], sy = cam.H / 2 - cam.f * Pc[1] / Pc[2];
      if (Pc[2] < 0.1 || sx < -400 || sx > cam.W + 400 || sy < -400 || sy > cam.H + 400) {
        it.el.style.display = it.label.style.display = "none";
        return;
      }
      it.el.style.display = it.label.style.display = "";

      if (it.isItem) {                           // marker hiện vật: luôn quay mặt về người xem, kích thước cố định
        const sz = clamp(cam.f * 0.12 / Pc[2], 26, 44) * (h.scale ?? 1);
        it.sx = sx; it.sy = sy; it.S = sz / cam.f * Pc[2]; it.Pw = Pw;
        it.el.style.width = it.el.style.height = sz + "px";
        it.el.style.transform = `translate(${sx - cam.W / 2 - sz / 2}px, ${sy - cam.H / 2 - sz / 2}px)`;
        it.el.style.zIndex = Math.round(1e4 / Pc[2]);
        const isSelI = EDIT && h === selected;
        it.el.classList.toggle("selected", isSelI);
        if (EDIT) it.label.classList.toggle("show", isSelI || it.el.matches(":hover"));
        it.label.style.left = sx + "px";
        it.label.style.top = (sy - sz / 2 - 6) + "px";
        return;
      }

      // kích thước hiệu dụng (giới hạn min/max theo px trên màn hình)
      const scr = cam.f * ARROW.size / Pc[2];
      const S = ARROW.size * clamp(scr, ARROW.minPx, ARROW.maxPx) / scr * (h.scale ?? 1);
      const w = U * S;
      it.sx = sx; it.sy = sy; it.S = S; it.Pw = Pw;

      const R = arrowRcss(h, ARROW.nativeAngle);
      const m = [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, 0, 0, 0, 1];
      it.el.style.width = it.el.style.height = w + "px";
      it.el.style.marginLeft = it.el.style.marginTop = (-w / 2) + "px";
      it.el.style.zIndex = Math.round(1e4 / Pc[2]);
      it.el.style.transform =
        `translate3d(${U * Pc[0]}px, ${-U * Pc[1]}px, ${cam.f - U * Pc[2]}px) matrix3d(${m.map(v => +v.toFixed(6)).join(",")})` + tipShift(w);

      const isSel = EDIT && h === selected;
      it.el.classList.toggle("selected", isSel);
      const screenS = cam.f * S / Pc[2];
      it.label.style.left = sx + "px";
      it.label.style.top = (sy - screenS * (isSel ? 0.95 : 0.55) - 6) + "px";
      if (isSel) { selVisible = true; drawGizmo(it); }
    });
    if (EDIT) $("gizmo").querySelectorAll("path").forEach(p => { if (!selVisible) p.style.display = "none"; });
  }

  /* ------------------------- Gizmo: 3 vòng xoay X / Y / Z ------------------------- */
  function ringBasis(n) {
    const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u1 = normalize(cross(a, n));
    return { n, u1, u2: cross(n, u1) };
  }
  function ringPath(C, b, R) {
    let d = "", pen = false;
    for (let i = 0; i <= 72; i++) {
      const a = i / 72 * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
      const p = [C[0] + R * (c * b.u1[0] + s * b.u2[0]), C[1] + R * (c * b.u1[1] + s * b.u2[1]), C[2] + R * (c * b.u1[2] + s * b.u2[2])];
      const pc = mulv(cam.R, p);
      if (pc[2] < 0.05) { pen = false; continue; }
      d += (pen ? "L" : "M") + (cam.W / 2 + cam.f * pc[0] / pc[2]).toFixed(1) + " " + (cam.H / 2 - cam.f * pc[1] / pc[2]).toFixed(1) + " ";
      pen = true;
    }
    return d;
  }
  function drawGizmo(it) {
    const axes = gimbalAxes(it.h), paths = $("gizmo").querySelectorAll("path");
    axes.forEach((n, i) => {
      paths[i].style.display = "";
      paths[i].setAttribute("d", ringPath(it.Pw, ringBasis(n), it.S * 0.8));
    });
  }

  /* ------------------------- Tia từ màn hình ------------------------- */
  const rayWorld = (px, py) => unrot([(px - cam.W / 2) / cam.f, -(py - cam.H / 2) / cam.f, 1]);
  function hitPlaneY(d, y) {
    if (Math.abs(d[1]) < 1e-4) return null;
    const t = y / d[1];
    return t > 0 ? [d[0] * t, y, d[2] * t] : null;
  }
  function hitPlane(d, n, C) {
    const dn = dot(d, n);
    if (Math.abs(dn) < 1e-4) return null;
    const t = dot(C, n) / dn;
    return t > 0 ? [d[0] * t, d[1] * t, d[2] * t] : null;
  }
  const ringAngle = (Q, b) => {
    const v = [Q[0] - b.C[0], Q[1] - b.C[1], Q[2] - b.C[2]];
    return deg(Math.atan2(dot(v, b.u2), dot(v, b.u1)));
  };

  function startRing(e, axis, pathEl) {
    if (!selected) return;
    e.preventDefault(); e.stopPropagation();
    const it = items.find(i => i.h === selected);
    if (!it) return;
    if (axis === 1) { manualY(selected); syncProps(); }
    const rect = pano.getBoundingClientRect();
    const b = { ...ringBasis(gimbalAxes(selected)[axis]), C: posOf(selected) };
    const Q = hitPlane(rayWorld(e.clientX - rect.left, e.clientY - rect.top), b.n, b.C);
    if (!Q) return;
    const key = ["rotX", "rotY", "rotZ"][axis];
    drag = { type: "ring", it, b, key, last: ringAngle(Q, b), val: selected[key] || 0 };
    pathEl.setPointerCapture?.(e.pointerId);
  }

  function applyPos(h, P, floor) {
    const dist = Math.hypot(P[0], P[1], P[2]);
    h.yaw = round2(deg(Math.atan2(P[0], P[2])));
    h.pitch = round2(deg(Math.asin(P[1] / dist)));
    if (!h.item && isAuto(h)) { h.rotY = round1(aimY(h)); if (h === selected) syncProps(); }
    if (floor && !h.item) delete h.dist; else h.dist = round3(dist);   // hiện vật luôn giữ dist nên không bị kẹt trên sàn
  }

  window.addEventListener("pointermove", e => {
    if (!drag || !viewer) return;
    const rect = pano.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
    const h = drag.it.h;
    if (drag.type === "move" && drag.free) {          // hiện vật: không giới hạn phạm vi / độ cao
      const u = normalize(rayWorld(px, py));
      const d = normalize([u[0] + drag.off[0], u[1] + drag.off[1], u[2] + drag.off[2]]);
      applyPos(h, [d[0] * drag.dist, d[1] * drag.dist, d[2] * drag.dist], false);
      syncProps();
    } else if (drag.type === "move") {
      const hit = hitPlaneY(rayWorld(px, py), drag.y);
      if (!hit) return;
      const P = [hit[0] + drag.off[0], drag.y, hit[2] + drag.off[1]];
      if (Math.hypot(P[0], P[2]) > 30) return;
      applyPos(h, P, drag.floor);
    } else {
      const Q = hitPlane(rayWorld(px, py), drag.b.n, drag.b.C);
      if (!Q) return;
      const a = ringAngle(Q, drag.b);
      drag.val += wrap180(a - drag.last);
      drag.last = a;
      h[drag.key] = round1(wrap180(drag.val));
      syncProps();
    }
  });
  window.addEventListener("pointerup", () => { if (drag) { drag = null; commit(); } });

  /* ------------------------- GUI chỉnh sửa ------------------------- */
  const status = msg => { $("ed-status").textContent = msg; };
  function select(h) { selected = h; refreshEditor(); }
  // Chỉnh trục Y bằng tay: tắt "tự chĩa về tâm" cho riêng mũi tên này, giữ nguyên góc Y hiện tại làm điểm bắt đầu
  function manualY(h) {
    if (!h || h.item || !isAuto(h)) return;
    h.rotY = round1(aimY(h));
    if (!!ARROW.autoAim === false) delete h.auto; else h.auto = false;
  }

  function refreshEditor() {
    if (!EDIT || !curScene) return;
    $("ed-scene").textContent = `Room: ${room.name} · Phòng: ${curScene.title}`;
    const list = $("ed-list");
    list.innerHTML = "";
    curScene.hotspots.forEach(h => {
      const b = document.createElement("button");
      b.textContent = (h.item ? "🏺 " : "➜ ") + hsText(h);
      b.classList.toggle("active", h === selected);
      b.onclick = () => select(h);
      list.appendChild(b);
    });
    $("ed-props").hidden = !selected;
    if (selected) {
      const isItem = !!selected.item;
      $("ed-kind").value = isItem ? "item" : "arrow";
      $("ed-arrow-only").hidden = isItem;
      $("ed-item-wrap").hidden = !isItem;
      $("ed-to-wrap").hidden = isItem;
      $("ed-image-wrap").hidden = isItem;
      $("ed-item-pick").hidden = !isItem;
      if (isItem) { $("ed-item").value = selected.item; itemPreview(selected.item); }
      const sel = $("ed-to");
      sel.innerHTML = "";
      room.scenes.filter(s => s !== curScene).forEach(s => {
        const o = document.createElement("option");
        o.value = s.id; o.textContent = s.title;
        sel.appendChild(o);
      });
      if (!isItem) sel.value = selected.to;
      $("ed-label").value = selected.label || "";
      $("ed-image").value = selected.image || "";
      syncProps();
    }
  }

  // danh sách gợi ý id hiện vật + lưới ảnh xem trước cho ô chọn hiện vật trong editor
  function itemPreview(id) {
    const it = ITEMS[id], box = $("ed-item-prev");
    box.hidden = !it;
    if (!it) return;
    $("ed-prev-img").src = it.images[0] ? it.images[0].url : "";
    $("ed-prev-name").textContent = it.name || it.id;
    $("ed-prev-period").textContent = it.period || "";
    $("ed-prev-count").textContent = "id: " + it.id + " · " + it.images.length + " ảnh";
    $("ed-item-grid").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.id === id));
  }
  function pickItem(id) {
    if (!selected || !selected.item || !ITEMS[id]) return;
    selected.item = id;
    $("ed-item").value = id;
    renderHotspots(); refreshEditor(); commit();
  }
  function buildItemList() {
    const dl = $("ed-item-list"), grid = $("ed-item-grid"); if (!dl || !grid) return;
    dl.innerHTML = ""; grid.innerHTML = "";
    Object.values(ITEMS).forEach(it => {
      const o = document.createElement("option");
      o.value = it.id; o.label = it.name.slice(0, 80);
      dl.appendChild(o);
      const b = document.createElement("button");
      b.type = "button"; b.dataset.id = it.id; b.dataset.q = (it.id + " " + it.name).toLowerCase();
      b.title = it.name;
      const im = document.createElement("img"); im.loading = "lazy"; im.alt = ""; im.draggable = false;
      im.src = it.images[0] ? it.images[0].url : "";
      const sp = document.createElement("span"); sp.textContent = it.name || it.id;
      b.append(im, sp);
      b.onclick = () => pickItem(it.id);
      grid.appendChild(b);
    });
    if (selected && selected.item) itemPreview(selected.item);
  }

  function syncProps() {
    if (!selected) return;
    const put = (id, v) => {
      $("ed-" + id).value = v;
      const n = $("ed-" + id + "n"); if (n && document.activeElement !== n) n.value = v;
    };
    put("sc", selected.scale ?? 1);
    if (!selected.item) {
      put("rx", Math.round(wrap180(selected.rotX || 0)));
      put("ry", Math.round(wrap180(selected.rotY || 0)));
      put("rz", Math.round(wrap180(selected.rotZ || 0)));
    }
    const auto = selected.item ? false : isAuto(selected);
    $("ed-auto").checked = auto;
    const P = posOf(selected), ht = round2(P[1] + 1);
    put("ht", ht); $("v-ht").textContent = ht;
    [["px", 0], ["py", 1], ["pz", 2]].forEach(([id, k]) => { const el = $("ed-" + id); if (document.activeElement !== el) el.value = round2(P[k]); });
  }

  function commit() {
    if (!EDIT || !curScene) return;
    draft[room.id + "/" + curScene.id] = JSON.parse(JSON.stringify(curScene.hotspots));
    hasDraft = true;
    status("● Có thay đổi chưa lưu — bấm 💾 Lưu vào config.js");
  }

  /* ------------------------- Ghi thẳng vào config.js ------------------------- */
  let saving = false, cfgHandle = null;
  const SAVE_URLS = ["/__save2", "http://localhost:3000/__save2"];

  async function saveViaFile(edits, editMode) {            // ghi trực tiếp file đã chọn (Chrome/Edge)
    if ((await cfgHandle.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("chưa cấp quyền ghi file");
    const src = await (await cfgHandle.getFile()).text();
    if (!(TourPatch.version >= 3)) throw new Error("patch.js trên trang là bản cũ (hãy ghi đè patch.js rồi tải lại trang)");
    const out = TourPatch.patchConfig(src, edits, editMode);
    if (out.saved === 0 && out.errors.length) throw new Error(out.errors.join("; "));
    const w = await cfgHandle.createWritable(); await w.write(out.text); await w.close();
    return { v: 3, saved: out.saved, errors: out.errors };
  }
  async function saveViaServer(payload) {
    let lastErr = "";
    for (const url of SAVE_URLS) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
        const txt = await res.text();
        if (res.status === 404) { lastErr = "serve.js đang chạy bản CŨ — hãy tắt rồi chạy lại `node serve.js`"; continue; }
        let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { }
        if (!j) { lastErr = "server không phản hồi đúng (không phải serve.js?)"; continue; }
        if (!res.ok || !j.ok) { lastErr = j.error || res.status; continue; }
        return j;
      } catch (err) { lastErr = err.message; }
    }
    throw new Error(lastErr);
  }
  // đọc lại config.js từ server, kiểm tra từng dòng hotspot vừa lưu có thật sự nằm trong file
  async function verifySaved(edits) {
    try {
      const txt = await (await fetch("config.js", { cache: "no-store" })).text();
      return edits.every(e => e.lines.every(l => txt.includes(l)));
    } catch (e) { return true; }   // không đọc lại được thì không chặn
  }
  async function saveMain(manual) {
    if (saving) return;
    const keys = Object.keys(draft);
    if (!keys.length) { if (manual) status("Chưa có thay đổi nào để ghi."); return; }
    const snap = {}; keys.forEach(k => snap[k] = JSON.stringify(draft[k]));
    const edits = keys.map(k => { const [r, s] = k.split("/"); return { room: r, scene: s, hotspots: draft[k], lines: draft[k].map(fmtHotspot) }; });
    const editMode = $("ed-off").checked ? false : undefined;
    saving = true;
    try {
      let j = null, err = "";
      if (cfgHandle) { try { j = await saveViaFile(edits, editMode); } catch (e) { err = e.message; } }
      if (!j) { try { j = await saveViaServer(JSON.stringify({ edits, editMode })); } catch (e) { err = err || e.message; } }
      if (j && j.v !== 3) {
        status("⚠ Máy chủ lưu bản cũ nên không chắc đã ghi đủ. Hãy ghi đè patch.js + serve.js, chạy lại `node serve.js`, rồi bấm Lưu lại. (Thay đổi vẫn còn trên trang.)");
      } else if (j && !(await verifySaved(edits))) {
        status("⚠ Đã ghi nhưng đọc lại config.js thấy thiếu dòng hotspot (có thể mất `item`). Thay đổi vẫn còn trên trang — hãy kiểm tra config.js, chạy lại `node serve.js` rồi bấm Lưu lại.");
      } else if (j) {
        keys.forEach(k => { if (JSON.stringify(draft[k]) === snap[k]) delete draft[k]; });
        hasDraft = Object.keys(draft).length > 0;
        status(`✔ Đã ghi vào config.js (${new Date().toLocaleTimeString()})` + (j.errors?.length ? " · Lỗi: " + j.errors.join("; ") : ""));
      } else {
        status("Chưa ghi được vào config.js (" + err + "). Chạy `node serve.js` rồi mở http://localhost:3000, hoặc bấm 📂 Chọn file config.js. Thay đổi vẫn còn trên trang (chưa mất) — đừng tải lại trang.");
      }
    } finally { saving = false; }
  }

  const copyText = async (text, okMsg) => {
    try { await navigator.clipboard.writeText(text); status(okMsg); }
    catch (e) { window.prompt("Copy đoạn này (Ctrl+C):", text); }
  };

  if (EDIT) {
    $("ed-add").onclick = () => {
      const others = room.scenes.filter(s => s !== curScene);
      if (!others.length) { status("Room này chỉ có 1 phòng, chưa có chỗ để đi tới."); return; }
      const yaw = round1(viewer.getYaw());
      const h = { to: others[0].id, yaw, pitch: round1(Math.min(viewer.getPitch(), -12)), rotX: 0, rotY: yaw, rotZ: 0 };
      curScene.hotspots.push(h);
      renderHotspots(); select(h); commit();
    };
    $("ed-kind").onchange = async e => {
      if (!selected) return;
      if (e.target.value === "item") {
        await loadItems();
        const first = Object.keys(ITEMS)[0];
        if (!first) { status("Chưa đọc được items.csv (chạy node serve.js rồi mở http://localhost:3000)."); refreshEditor(); return; }
        selected.item ||= first;
        ["to", "rotX", "rotY", "rotZ", "auto", "image"].forEach(k => delete selected[k]);
      } else {
        const other = room.scenes.find(s => s !== curScene);
        if (!other) { status("Room này chỉ có 1 phòng, chưa có chỗ để mũi tên đi tới."); refreshEditor(); return; }
        delete selected.item;
        selected.to = other.id;
        normHotspot(selected);
      }
      renderHotspots(); refreshEditor(); commit();
    };
    $("ed-add-item").onclick = async () => {
      await loadItems();
      const first = Object.keys(ITEMS)[0];
      if (!first) { status("Chưa đọc được items.csv (chạy node serve.js rồi mở http://localhost:3000)."); return; }
      const h = { item: first, yaw: round1(viewer.getYaw()), pitch: round1(viewer.getPitch()), dist: 3 };   // đặt đúng tâm màn hình, cách camera 3 đơn vị
      curScene.hotspots.push(h);
      renderHotspots(); select(h); commit();
      status("Đã thêm hiện vật. Gõ/chọn id ở ô “Hiện vật” bên dưới, rồi kéo marker tới đúng chỗ.");
    };
    $("ed-item").oninput = e => { const id = e.target.value.trim(); if (ITEMS[id]) itemPreview(id); };
    $("ed-item-q").oninput = e => {
      const q = e.target.value.trim().toLowerCase();
      $("ed-item-grid").querySelectorAll("button").forEach(b => { b.hidden = !!q && !b.dataset.q.includes(q); });
    };
    $("ed-item").onchange = e => {
      const id = e.target.value.trim();
      if (!selected || !selected.item) return;
      if (!ITEMS[id]) { status("Không có hiện vật id “" + id + "” trong items.csv."); e.target.value = selected.item; return; }
      selected.item = id;
      renderHotspots(); refreshEditor(); commit();
    };
    $("ed-preview").onclick = async () => {          // xem trước đúng như người xem bấm vào marker
      if (!selected) return;
      if (selected.item) {
        await loadItems();
        if (!ITEMS[selected.item]) { status("Không có hiện vật id “" + selected.item + "” trong items.csv."); return; }
        if (!ITEMS[selected.item].images.length) { status("Hiện vật này chưa có ảnh nào trong items.csv."); return; }
        status("Đang xem trước hiện vật — bấm ✕ hoặc Esc để quay lại chỉnh sửa.");
        openItem(selected.item, selected);
      } else if (selected.to && byId[selected.to]) {
        status("Đang xem trước chuyển cảnh sang “" + byId[selected.to].title + "”. Bấm ← ở góc dưới để quay lại.");
        goScene(selected.to, selected);
      } else status("Mũi tên này chưa chọn nơi đến.");
    };
    $("ed-del").onclick = () => {
      curScene.hotspots = curScene.hotspots.filter(h => h !== selected);
      selected = null; renderHotspots(); refreshEditor(); commit();
    };
    $("ed-to").onchange = e => { selected.to = e.target.value; renderHotspots(); refreshEditor(); commit(); };
    $("ed-label").oninput = e => {
      if (e.target.value.trim()) selected.label = e.target.value; else delete selected.label;
      const it = items.find(i => i.h === selected);
      if (it) it.label.textContent = hsText(selected);
    };
    $("ed-label").onchange = () => { refreshEditor(); commit(); };
    $("ed-image").onchange = e => {
      if (e.target.value.trim()) selected.image = e.target.value.trim(); else delete selected.image;
      const it = items.find(i => i.h === selected);
      if (it) setArrowSrc(it.el, hsImage(selected));
      commit();
    };

    /* Xoay X / Y / Z: thanh trượt + ô nhập số */
    [["rx", "rotX"], ["ry", "rotY"], ["rz", "rotZ"]].forEach(([id, key]) => {
      const setRot = v => { if (key === "rotY") manualY(selected); selected[key] = v; $("ed-" + id).value = v; if (key === "rotY") $("ed-auto").checked = false; };
      $("ed-" + id).oninput = e => { setRot(+e.target.value); $("ed-" + id + "n").value = e.target.value; };
      $("ed-" + id).onchange = commit;
      $("ed-" + id + "n").oninput = e => {
        if (!selected || e.target.value.trim() === "" || isNaN(+e.target.value)) return;
        setRot(round1(wrap180(+e.target.value)));
      };
      $("ed-" + id + "n").onchange = () => { syncProps(); commit(); };
    });
    /* Kích thước: thanh trượt + ô nhập số */
    const setScale = v => { if (v === 1) delete selected.scale; else selected.scale = v; $("ed-sc").value = v; };
    $("ed-sc").oninput = e => { setScale(+e.target.value); $("ed-scn").value = e.target.value; };
    $("ed-sc").onchange = commit;
    $("ed-scn").oninput = e => {
      const v = +e.target.value;
      if (!selected || e.target.value.trim() === "" || isNaN(v) || v < 0.05 || v > 20) return;
      setScale(round2(v));
    };
    $("ed-scn").onchange = () => { syncProps(); commit(); };

    /* Tự chĩa về tâm (từng mũi tên) */
    $("ed-auto").onchange = e => {
      if (!selected) return;
      if (e.target.checked === !!ARROW.autoAim) delete selected.auto; else selected.auto = e.target.checked;
      if (isAuto(selected)) selected.rotY = round1(aimY(selected));
      syncProps(); commit();
    };
    /* Kiểu xoay có sẵn */
    document.querySelectorAll("#ed-presets button").forEach(b => {
      b.onclick = () => {
        if (!selected) return;
        if (b.dataset.rx !== undefined) selected.rotX = +b.dataset.rx;
        if (b.dataset.rz !== undefined) selected.rotZ = +b.dataset.rz;
        if (b.dataset.addrz !== undefined) selected.rotZ = round1(wrap180((selected.rotZ || 0) + +b.dataset.addrz));
        syncProps(); commit();
      };
    });
    $("ed-ht").oninput = e => {
      const ht = +e.target.value, P = posOf(selected);
      applyPos(selected, [P[0], ht - 1, P[2]], Math.abs(ht) < 0.01);
      $("v-ht").textContent = ht;
    };
    $("ed-ht").onchange = commit;

    /* Nhập tọa độ X / Y / Z trực tiếp */
    [["px", 0], ["py", 1], ["pz", 2]].forEach(([id, k]) => {
      $("ed-" + id).oninput = e => {
        if (!selected || e.target.value.trim() === "" || isNaN(+e.target.value)) return;
        const P = posOf(selected).slice();
        P[k] = +e.target.value;
        if (Math.hypot(P[0], P[1], P[2]) < 0.2) return;              // tránh trùng với camera
        applyPos(selected, P, Math.abs(P[1] + 1) < 0.01);            // y = -1 -> nằm đúng sàn
        const ht = round2(P[1] + 1); $("ed-ht").value = ht; $("v-ht").textContent = ht;
      };
      $("ed-" + id).onchange = () => { syncProps(); commit(); };
    });

    /* ② Copy riêng đoạn hotspot để dán vào config */
    $("ed-copy-one").onclick = () => {
      if (!selected) { status("Hãy chọn 1 mũi tên trước."); return; }
      copyText(fmtHotspot(selected) + ",", `Đã copy. Dán vào mảng hotspots của phòng "${curScene.title}" trong config.js`);
    };
    $("ed-copy-all").onclick = () => {
      const body = curScene.hotspots.map(h => "    " + fmtHotspot(h)).join(",\n");
      copyText(`hotspots: [\n${body}\n  ]`, `Đã copy cả khối hotspots của phòng "${curScene.title}"`);
    };

    /* Ctrl+C / Ctrl+V (Cmd trên Mac): sao chép mũi tên / hiện vật đang chọn, dán vào phòng đang xem (kể cả phòng khác) */
    let clip = null;
    const inField = t => t && t.closest && t.closest("input, textarea, select, [contenteditable]");
    const parseHotspot = txt => {                         // đọc dòng "{ to: "x", yaw: 1.2, ... }" mà không chạy mã (không dùng eval)
      if (!/^\s*\{[\s\S]*\}\s*,?\s*$/.test(txt || "")) return null;
      const o = {};
      txt.replace(/([A-Za-z_]\w*)\s*:\s*("(?:[^"\\]|\\.)*"|-?\d*\.?\d+(?:e-?\d+)?|true|false)/g, (m, k, v) => { try { o[k] = JSON.parse(v); } catch (e) { } return m; });
      return (o.to || o.item) ? o : null;
    };
    document.addEventListener("copy", e => {
      if (!selected || inField(e.target) || !$("iv").hidden) return;
      e.preventDefault();
      clip = JSON.parse(JSON.stringify(selected));
      e.clipboardData.setData("text/plain", fmtHotspot(selected) + ",");
      status("Đã copy “" + hsText(selected) + "”. Sang phòng khác (hoặc ở đây) bấm Ctrl+V để dán.");
    });
    document.addEventListener("paste", async e => {
      if (!curScene || inField(e.target) || !$("iv").hidden) return;
      const h = parseHotspot(e.clipboardData && e.clipboardData.getData("text/plain")) || (clip && JSON.parse(JSON.stringify(clip)));
      if (!h) return;
      e.preventDefault();
      if (h.item) await loadItems();
      if (h.to === curScene.id) { status("Không dán được: mũi tên này trỏ về chính phòng “" + curScene.title + "”. Hãy dán ở phòng khác."); return; }
      const nudge = () => curScene.hotspots.some(o => Math.abs((o.yaw || 0) - (h.yaw || 0)) < 1 && Math.abs((o.pitch || 0) - (h.pitch || 0)) < 1);
      for (let n = 0; n < 12 && nudge(); n++) { h.yaw = round2(wrap180((h.yaw || 0) + 4)); h.pitch = round2((h.pitch || 0) - 1); }   // lệch nhẹ để không chồng lên bản gốc
      normHotspot(h);
      curScene.hotspots.push(h);
      renderHotspots(); select(h); commit();
      status("Đã dán “" + hsText(h) + "” vào " + curScene.title + (h.to && !byId[h.to] ? " (⚠ nơi đến “" + h.to + "” không có trong room này, hãy chọn lại ở ô Đi tới)" : ""));
    });

    $("ed-save").onclick = () => saveMain(true);
    $("ed-pick").onclick = async () => {
      if (!window.showOpenFilePicker) { status("Trình duyệt này không hỗ trợ chọn file. Dùng Chrome/Edge hoặc chạy node serve.js."); return; }
      try {
        [cfgHandle] = await window.showOpenFilePicker({ types: [{ description: "config.js", accept: { "text/javascript": [".js"] } }] });
        status("Đã chọn " + cfgHandle.name + " — bấm 💾 Lưu vào config.js để ghi vào file này.");
      } catch (e) { /* người dùng huỷ */ }
    };
    $("ed-reset").onclick = () => {
      if (confirm("Bỏ các thay đổi chưa lưu và quay về nội dung trong config.js?")) {
        hasDraft = false; draft = {}; location.reload();
      }
    };
  }

  /* ------------------------- Vòng lặp ------------------------- */
  function tick(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    spriteStep(now);
    if (viewer && cfg && viewer.isLoaded()) {
      if (!dragging && !camBusy) {
        let dYaw = 0, dPitch = 0;
        if (cfg.mouseParallax) {
          dYaw = (targetYaw - curYaw) * EASE;
          dPitch = (targetPitch - curPitch) * EASE;
          curYaw += dYaw; curPitch += dPitch;
        }
        const isIdle = cfg.autoRotate && now - lastActive > cfg.idleDelay;
        idleSpeed += ((isIdle ? cfg.idleSpeed : 0) - idleSpeed) * IDLE_RAMP;
        viewer.setYaw(viewer.getYaw() + dYaw + idleSpeed * dt, false);
        viewer.setPitch(viewer.getPitch() + dPitch, false);
      } else idleSpeed = 0;
      updateHotspots();
    }
    raf = requestAnimationFrame(tick);
  }

  window.addEventListener("hashchange", route);
  loadItems().then(() => { if (curScene) { renderHotspots(); refreshEditor(); } });   // có tên hiện vật thì cập nhật nhãn
  route();
})();