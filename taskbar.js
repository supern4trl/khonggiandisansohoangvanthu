/* Taskbar liquid glass: nhạc nền, âm lượng, hướng dẫn viên, địa điểm, toàn màn hình, ẩn thanh.
   app.js gọi TourDock.open({room, canGoHome, home}) khi mở room và TourDock.close() khi rời room. */
(function () {
    const $ = id => document.getElementById(id), C = (typeof TOUR_CONFIG !== "undefined" ? TOUR_CONFIG : {}), KEY = "tour360_dock";
    let S = {};
    try { S = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } };
    let audio = null, srcNow = "", want = false, userChoice, blocked = false, guideOn = false, toastT = 0;
    const wrap = $("dock-wrap"), dock = $("dock");

    function toast(msg) {
        const t = $("dock-toast"); t.textContent = msg; t.hidden = false;
        requestAnimationFrame(() => t.classList.add("show"));
        clearTimeout(toastT);
        toastT = setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.hidden = true, 300); }, 2200);
    }

    /* ----- Nhạc nền ----- */
    const syncMusic = () => {
        const on = !!audio && !audio.paused, b = $("dk-music");
        b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); if (on) b.classList.remove("nudge");
        b.dataset.tip = on ? "Tắt nhạc nền" : "Bật nhạc nền";
    };
    const tryPlay = () => audio && audio.play().then(() => { blocked = false; syncMusic(); }, err => {
        syncMusic();
        if (err && err.name === "NotAllowedError" && !blocked) {   // trình duyệt chặn autoplay -> chờ tương tác đầu tiên
            blocked = true; toast("Chạm vào màn hình để bật nhạc nền"); $("dk-music").classList.add("nudge");
        }
    });
    function setVol(v) {
        v = Math.min(1, Math.max(0, v));
        if (audio) audio.volume = v;
        S.vol = v; save();
        $("dk-range").value = Math.round(v * 100);
        $("dk-range").style.setProperty("--v", Math.round(v * 100) + "%");
        $("dk-pct").textContent = Math.round(v * 100);
        document.querySelectorAll(".vico").forEach(b => b.dataset.lv = v === 0 ? 0 : v < .5 ? 1 : 2);
    }
    function setupMusic(room) {
        const m = room.music || C.music, b = $("dk-music"), vw = document.querySelector(".vol-wrap");
        b.hidden = vw.hidden = !(m && m.src);
        if (b.hidden) togglePop(false);
        if (b.hidden) { if (audio) audio.pause(); audio = null; srcNow = ""; return; }
        if (srcNow !== m.src) {
            if (audio) audio.pause();
            audio = new Audio(m.src); srcNow = m.src;
            audio.loop = m.loop !== false;
            audio.onplay = audio.onpause = syncMusic;
            audio.preload = "auto";
            audio.onerror = () => {
                const code = audio.error && audio.error.code;    // 4 = không đọc được file / sai định dạng, 3 = file hỏng, 2 = lỗi mạng
                console.warn("[Tour360] Lỗi nhạc, mã", code, m.src, audio.error && audio.error.message);
                toast(code === 3 || code === 4 ? "Không phát được file nhạc (sai tên, sai định dạng hoặc file lỗi)" : "Không tải được file nhạc: " + m.src);
                syncMusic();
            };
            audio.onplaying = () => { console.log("[Tour360] Nhạc đang phát, âm lượng", audio.volume); if (audio.volume === 0) toast("Nhạc đang chạy nhưng âm lượng = 0, hãy kéo thanh loa lên"); };
        }
        setVol(S.vol > 0 ? S.vol : (m.volume ?? 0.5));   // bỏ qua âm lượng 0 đã lưu từ lần thử trước (tránh im lặng khó hiểu)
        want = userChoice ?? (m.autoplay !== false);   // theo config (autoplay) trừ khi người xem tự tắt/bật trong phiên này
        if (want) tryPlay(); else syncMusic();
    }
    $("dk-music").onclick = () => {
        if (!audio) return;
        if (audio.paused) { want = true; tryPlay(); } else { want = false; audio.pause(); }
        userChoice = want; $("dk-music").classList.remove("nudge");
    };
    ["pointerdown", "pointerup", "touchend", "click", "keydown"].forEach(ev => window.addEventListener(ev, e => {
        if (want && audio && audio.paused && !audio.error && !(e.target.closest && e.target.closest("#dk-music"))) tryPlay();
    }, true));

    /* ----- Âm lượng: bấm nút loa -> mở bảng chỉnh (− / thanh trượt / +, bấm icon loa trong bảng để tắt/bật tiếng) ----- */
    const pop = $("vol-pop"); let lastVol = 0.5, popT = 0;
    const curVol = () => (S.vol ?? 0.5);
    function placePop() {
        const b = $("dk-vol").getBoundingClientRect(), w = wrap.getBoundingClientRect(), pw = pop.offsetWidth;
        const cx = Math.min(Math.max(b.left + b.width / 2, 8 + pw / 2), innerWidth - 8 - pw / 2);
        pop.style.left = (cx - w.left) + "px";
    }
    function togglePop(open) {
        open = open ?? !pop.classList.contains("open");
        clearTimeout(popT);
        $("dk-vol").classList.toggle("on", open); $("dk-vol").setAttribute("aria-expanded", open);
        if (open) { pop.hidden = false; placePop(); requestAnimationFrame(() => pop.classList.add("open")); }
        else { pop.classList.remove("open"); popT = setTimeout(() => pop.hidden = true, 350); }
    }
    $("dk-vol").onclick = e => { e.stopPropagation(); togglePop(); };
    $("dk-range").oninput = e => setVol(e.target.value / 100);
    $("vp-dn").onclick = () => setVol(Math.round(curVol() * 10) / 10 - 0.1);
    $("vp-up").onclick = () => setVol(Math.round(curVol() * 10) / 10 + 0.1);
    $("vp-mute").onclick = () => { if (curVol() > 0) { lastVol = curVol(); setVol(0); } else setVol(lastVol || 0.5); };
    document.addEventListener("pointerdown", e => { if (!e.target.closest("#vol-pop, #dk-vol")) togglePop(false); });
    window.addEventListener("resize", () => { if (pop.classList.contains("open")) placePop(); });
    window.addEventListener("keydown", e => { if (e.key === "Escape") togglePop(false); });

    /* ----- Hướng dẫn viên (làm sau) ----- */
    $("dk-guide").onclick = () => {
        if (!(C.guide && C.guide.enabled)) { toast("Hướng dẫn viên sẽ sớm ra mắt"); return; }
        guideOn = !guideOn;
        $("dk-guide").classList.toggle("on", guideOn); $("dk-guide").setAttribute("aria-pressed", guideOn);
        document.dispatchEvent(new CustomEvent("tour:guide", { detail: { on: guideOn } }));   // hook cho tính năng sau
    };

    /* ----- Toàn màn hình ----- */
    const de = document.documentElement, fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const fsReq = de.requestFullscreen || de.webkitRequestFullscreen;
    $("dk-full").hidden = !fsReq;   // iPhone Safari không hỗ trợ
    $("dk-full").onclick = () => {
        if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else fsReq.call(de);
    };
    const syncFs = () => {
        const f = !!fsEl(); $("dk-full").classList.toggle("is-full", f);
        $("dk-full").dataset.tip = f ? "Thoát toàn màn hình" : "Toàn màn hình";
    };
    ["fullscreenchange", "webkitfullscreenchange"].forEach(ev => document.addEventListener(ev, syncFs));

    /* ----- Ẩn / hiện thanh ----- */
    const setHidden = h => { if (h) togglePop(false); wrap.classList.toggle("collapsed", h); S.hidden = h; save(); };
    $("dk-hide").onclick = () => setHidden(true);
    $("dock-reveal").onclick = () => setHidden(false);

    /* ----- Ánh sáng kính chạy theo con trỏ ----- */
    dock.addEventListener("pointermove", e => {
        const r = dock.getBoundingClientRect();
        dock.style.setProperty("--mx", (e.clientX - r.left) + "px");
        dock.style.setProperty("--my", (e.clientY - r.top) + "px");
    });

    /* ----- Logo trường (góc trái trên, hiện cả ở trang chủ lẫn khi xem tour) ----- */
    (function () {
        const L = C.logo, a = $("school-logo"), im = a.firstElementChild;
        if (!L || !L.image) return;
        im.alt = L.alt || "Logo";
        a.style.setProperty("--logo-h", (L.height || 56) + "px");
        if (L.href) { a.href = L.href; a.target = "_blank"; a.rel = "noopener"; } else a.classList.add("static");
        im.onload = () => { a.hidden = false; document.body.classList.add("has-logo"); };
        im.onerror = () => console.warn("[Tour360] Không tải được logo: " + L.image);
        im.src = L.image;
    })();

    window.TourDock = {
        open({ room, canGoHome, home }) {
            wrap.hidden = false;
            wrap.classList.toggle("collapsed", !!S.hidden);
            $("dk-loc").hidden = !canGoHome;            // chỉ có khi có 2+ địa điểm
            $("dk-loc").onclick = home;
            setupMusic(room); syncFs();
        },
        close() { wrap.hidden = true; if (audio) audio.pause(); }   // về trang chủ: dừng nhạc, vào lại sẽ chạy tiếp
    };
})();