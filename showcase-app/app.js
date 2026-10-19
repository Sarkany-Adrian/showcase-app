(() => {
  "use strict";

  const RUN_DURATION_S = 20;
  const TICK_MS = 100;
  const STEP_S = 5;

  const state = {
    status: "idle",
    progress: 0,
    logIndex: 0,
    raf: null,
    lastTs: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const els = {
    body: document.body,
    runPanel: $("#run-panel"),
    cardRun: $("#card-run"),
    cardResults: $("#card-results"),
    runProgressCard: $("#run-progress-card"),
    runStatusCard: $("#run-status-card"),
    controlFill: $("#control-fill"),
    controlTrack: $("#control-track"),
    controlStatus: $("#control-status"),
    statusDot: $("#status-dot"),
    playBtn: $('[data-control="play"]'),
    logView: $("#log-view"),
    logEmpty: $("#log-empty"),
    logViewFull: $("#log-view-full"),
    videoPlayer: $("#video-player"),
    videoFill: $("#video-fill"),
    videoTime: $("#video-time"),
    statTotal: $("#stat-total"),
    statPass: $("#stat-pass"),
    statFail: $("#stat-fail"),
    reportNote: $("#report-note"),
    openReportBtn: $("#btn-open-report"),
    modalRoot: $("#modal-root"),
  };

  const LOG_LINES = [
    ["09:30:01", "info", "Bootstrapping robotic runner v3.2.1…"],
    ["09:30:02", "info", "Loading KI model: test-prioritizer@2.4"],
    ["09:30:03", "info", "Ablageort mounted: /test-runs/run_2026-10-18_09-30"],
    ["09:30:04", "info", "Executing TC-001 · Login with valid credentials"],
    ["09:30:06", "ok", "TC-001 passed (2.1s)"],
    ["09:30:07", "info", "Executing TC-002 · Login with invalid password"],
    ["09:30:09", "ok", "TC-002 passed (1.8s)"],
    ["09:30:10", "info", "Executing TC-014 · Add item to cart"],
    ["09:30:13", "ok", "TC-014 passed (3.0s)"],
    ["09:30:14", "warn", "Slow selector detected on /cart (412ms)"],
    ["09:30:15", "info", "Executing TC-021 · Checkout with credit card"],
    ["09:30:18", "err", "TC-021 failed: payment iframe not found"],
    ["09:30:19", "info", "KI suggestion: retry with updated locator (confidence 0.86)"],
    ["09:30:21", "info", "Retry TC-021 (attempt 2)"],
    ["09:30:24", "ok", "TC-021 passed on retry (5.4s)"],
    ["09:30:25", "info", "Generating test_report.xls…"],
    ["09:30:26", "ok", "Run finished: 7 passed · 1 failed · 14 skipped"],
  ];

  const TEST_CASES = [
    { id: "TC-001", name: "Login with valid credentials", result: "pass", dur: "2.1s", at: 25 },
    { id: "TC-002", name: "Login with invalid password", result: "pass", dur: "1.8s", at: 35 },
    { id: "TC-005", name: "Password reset via e-mail", result: "pass", dur: "3.2s", at: 45 },
    { id: "TC-014", name: "Add item to cart", result: "pass", dur: "3.0s", at: 55 },
    { id: "TC-017", name: "Apply discount code", result: "pass", dur: "1.4s", at: 65 },
    { id: "TC-021", name: "Checkout with credit card", result: "fail", dur: "8.4s", at: 75 },
    { id: "TC-022", name: "Order confirmation e-mail", result: "pass", dur: "2.6s", at: 85 },
    { id: "TC-030", name: "Logout clears session", result: "pass", dur: "1.1s", at: 95 },
  ];

  const PDF_DOCS = {
    requirement: {
      title: "System Requirement Document v2.3",
      letter: "SR",
      pages: [
        ["1 · Scope & Objectives", "This document defines the system requirements for the shop-platform checkout pipeline, including functional targets, performance budgets and regulatory constraints used as the baseline for automated verification."],
        ["2 · Functional Requirements", "FR-01 shall support guest and registered checkout. FR-04 shall process credit-card payments via embedded iframe. FR-09 shall send an order confirmation within 60 seconds."],
        ["3 · Quality Gates", "Every release must pass the automated regression suite (84 cases). Critical paths TC-001 … TC-030 are executed robotically on each build; results are human-reviewed before sign-off."],
      ],
    },
    spec: {
      title: "System Test Specification v1.8",
      letter: "TS",
      pages: [
        ["1 · Test Strategy", "Risk-based test selection with KI-assisted prioritisation. Robot executes the end-to-end journey; the AI model ranks flaky candidates and proposes locator retries."],
        ["2 · Test Cases", "TC-001 Login (valid), TC-002 Login (invalid), TC-014 Cart, TC-021 Checkout credit card, TC-030 Logout. Each case defines preconditions, steps, and expected results."],
        ["3 · Evaluation", "Pass/fail per case, duration, screenshot and video evidence per step. Failures trigger one automated KI-assisted retry before the case is marked failed for human review."],
      ],
    },
  };

  const SHOTS = [
    { caption: "step_01_login · 09:30:06", url: "app.example.com/login", at: 25 },
    { caption: "step_02_cart · 09:30:13", url: "app.example.com/cart", at: 55 },
    { caption: "step_03_checkout · 09:30:24", url: "app.example.com/checkout", at: 85 },
  ];

  /* ---------- Modal system ---------- */

  let lastFocus = null;

  function openModal(id) {
    lastFocus = document.activeElement;
    els.modalRoot.hidden = false;
    $$(".modal", els.modalRoot).forEach((m) => (m.hidden = m.id !== id));
    document.body.style.overflow = "hidden";
    const modal = $("#" + id);
    const closeBtn = $(".modal__close", modal);
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    els.modalRoot.hidden = true;
    $$(".modal", els.modalRoot).forEach((m) => (m.hidden = true));
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  els.modalRoot.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.modalRoot.hidden) closeModal();
  });

  /* ---------- PDF viewer ---------- */

  const pdf = { doc: "requirement", page: 0 };

  function openPdf(docKey) {
    pdf.doc = docKey;
    pdf.page = 0;
    renderPdf();
    openModal("modal-pdf");
  }

  function renderPdf() {
    const doc = PDF_DOCS[pdf.doc];
    const [heading, text] = doc.pages[pdf.page];
    $("#pdf-title").textContent = doc.title;
    $("#pdf-letter").textContent = doc.letter;
    $("#pdf-page-heading").textContent = heading;
    $("#pdf-page-text").textContent = text;
    $("#pdf-page-indicator").textContent = `Page ${pdf.page + 1} / ${doc.pages.length}`;
    $("#pdf-prev").disabled = pdf.page === 0;
    $("#pdf-next").disabled = pdf.page === doc.pages.length - 1;
  }

  $("#pdf-prev").addEventListener("click", () => {
    if (pdf.page > 0) { pdf.page -= 1; renderPdf(); }
  });

  $("#pdf-next").addEventListener("click", () => {
    if (pdf.page < PDF_DOCS[pdf.doc].pages.length - 1) { pdf.page += 1; renderPdf(); }
  });

  /* ---------- XLS report ---------- */

  function renderXls() {
    const tbody = $("#xls-rows");
    tbody.innerHTML = "";
    TEST_CASES.forEach((tc, i) => {
      const unlocked = state.progress >= tc.at || state.status === "done";
      const tr = document.createElement("tr");
      const chip = unlocked
        ? `<span class="result-chip result-chip--${tc.result}">${tc.result.toUpperCase()}</span>`
        : `<span class="result-chip" style="background:#f1f5f9;color:#94a3b8">PENDING</span>`;
      tr.innerHTML = `
        <td>${String(i + 1).padStart(2, "0")}</td>
        <td>${tc.id} · ${tc.name}</td>
        <td>${chip}</td>
        <td>${unlocked ? tc.dur : "—"}</td>`;
      tbody.appendChild(tr);
    });
  }

  /* ---------- Logs ---------- */

  function logLineHtml([ts, level, msg]) {
    const cls = { info: "log-line--info", ok: "log-line--ok", warn: "log-line--warn", err: "log-line--err" }[level] || "";
    const tag = { info: "INFO ", ok: "OK   ", warn: "WARN ", err: "ERROR" }[level] || "INFO ";
    return `<p class="log-line ${cls}"><span class="ts">[${ts}]</span> ${tag} ${msg}</p>`;
  }

  function appendLogEntry(entry) {
    const empty = $("#log-empty");
    if (empty) empty.remove();
    [els.logView, els.logViewFull].forEach((view) => {
      if (!view) return;
      const p = document.createElement("div");
      p.innerHTML = logLineHtml(entry);
      view.appendChild(p.firstChild);
      view.scrollTop = view.scrollHeight;
    });
  }

  function syncLogsToProgress() {
    const target = Math.min(LOG_LINES.length, Math.floor((state.progress / 100) * LOG_LINES.length));
    if (target < state.logIndex) {
      state.logIndex = target;
      [els.logView, els.logViewFull].forEach((v) => v && (v.innerHTML = ""));
      if (state.logIndex === 0 && els.logView && !$("#log-empty")) {
        els.logView.innerHTML = `<p class="log-empty" id="log-empty">Press <strong>Play</strong> to start the run and stream log output…</p>`;
      }
      for (let i = 0; i < state.logIndex; i++) appendLogEntry(LOG_LINES[i]);
      return;
    }
    while (state.logIndex < target) {
      appendLogEntry(LOG_LINES[state.logIndex]);
      state.logIndex += 1;
    }
  }

  /* ---------- Screenshots & video ---------- */

  function syncScreenshots() {
    $$(".shot").forEach((shot, i) => {
      const unlocked = state.progress >= SHOTS[i].at || state.status === "done";
      shot.classList.toggle("is-unlocked", unlocked);
      shot.classList.toggle("shot--locked", !unlocked);
      shot.dataset.caption = SHOTS[i].caption;
      shot.setAttribute("aria-label", unlocked ? `Screenshot: ${SHOTS[i].caption}` : `Screenshot ${i + 1} (locked)`);
    });
  }

  function openLightbox(index) {
    const shot = SHOTS[index];
    const unlocked = state.progress >= shot.at || state.status === "done";
    if (!unlocked) {
      focusRunPanel();
      return;
    }
    $("#lightbox-title").textContent = `Screenshot — ${shot.caption}`;
    $("#lightbox-url").textContent = shot.url;
    const screen = $("#lightbox-screen");
    screen.className = "lightbox-frame__screen" + (index ? ` lightbox-frame__screen--${index + 1}` : "");
    openModal("modal-lightbox");
  }

  function setVideoPlaying(playing) {
    els.videoPlayer.classList.toggle("is-playing", playing);
    els.videoPlayer.setAttribute("aria-label", playing ? "Pause run recording" : "Play run recording");
  }

  function syncVideo() {
    const pct = state.progress;
    els.videoFill.style.width = pct + "%";
    const cur = Math.round((pct / 100) * RUN_DURATION_S);
    els.videoTime.textContent = `00:${String(cur).padStart(2, "0")} / 00:${RUN_DURATION_S}`;
    setVideoPlaying(state.status === "running");
  }

  /* ---------- Report stats ---------- */

  function syncReport() {
    if (state.status === "done" || state.progress >= 100) {
      els.statTotal.textContent = "8";
      els.statTotal.className = "stat__value";
      els.statPass.textContent = "7";
      els.statPass.className = "stat__value stat__value--ok";
      els.statFail.textContent = "1";
      els.statFail.className = "stat__value stat__value--bad";
      els.reportNote.textContent = "Ready for human review · 18 Oct 2026";
      els.openReportBtn.disabled = false;
    } else if (state.progress > 0) {
      els.statTotal.textContent = "8";
      els.statTotal.className = "stat__value";
      els.statPass.textContent = "…";
      els.statPass.className = "stat__value stat__value--pending";
      els.statFail.textContent = "…";
      els.statFail.className = "stat__value stat__value--pending";
      els.reportNote.textContent = "Report is generated at the end of the run.";
      els.openReportBtn.disabled = true;
    } else {
      els.statTotal.textContent = "–";
      els.statTotal.className = "stat__value stat__value--pending";
      els.statPass.textContent = "–";
      els.statPass.className = "stat__value stat__value--pending";
      els.statFail.textContent = "–";
      els.statFail.className = "stat__value stat__value--pending";
      els.reportNote.textContent = "Report is generated at the end of the run.";
      els.openReportBtn.disabled = true;
    }
  }

  /* ---------- Playback engine ---------- */

  const STATUS_LABEL = { idle: "Idle", running: "Running", paused: "Paused", done: "Finished" };

  function render() {
    const pct = Math.min(100, Math.max(0, state.progress));
    els.controlFill.style.width = pct + "%";
    els.runProgressCard.style.width = pct + "%";
    els.controlTrack.setAttribute("aria-valuenow", Math.round(pct));

    const label =
      state.status === "running" ? `Running · ${Math.round(pct)}%` :
      state.status === "paused" ? `Paused · ${Math.round(pct)}%` :
      state.status === "done" ? "Finished · 7/8 passed" :
      "Idle · ready to start";

    els.controlStatus.textContent = STATUS_LABEL[state.status];
    els.runStatusCard.textContent = label;
    els.statusDot.dataset.state = state.status;
    els.body.classList.toggle("is-running", state.status === "running");

    const playing = state.status === "running";
    els.playBtn.classList.toggle("is-playing", playing);
    els.playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    els.playBtn.title = playing ? "Pause" : "Play";

    syncLogsToProgress();
    syncScreenshots();
    syncVideo();
    syncReport();
  }

  function tick(ts) {
    if (state.status !== "running") return;
    if (state.lastTs == null) state.lastTs = ts;
    const dt = (ts - state.lastTs) / 1000;
    state.lastTs = ts;
    state.progress += (dt / RUN_DURATION_S) * 100;

    if (state.progress >= 100) {
      state.progress = 100;
      state.status = "done";
      render();
      flash(els.cardResults);
      return;
    }
    render();
    state.raf = requestAnimationFrame(tick);
  }

  function play() {
    if (state.status === "done") {
      stop();
    }
    state.status = "running";
    state.lastTs = null;
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(tick);
    render();
  }

  function pause() {
    if (state.status !== "running") return;
    state.status = "paused";
    cancelAnimationFrame(state.raf);
    render();
  }

  function stop() {
    cancelAnimationFrame(state.raf);
    state.status = "idle";
    state.progress = 0;
    state.logIndex = 0;
    state.lastTs = null;
    [els.logView, els.logViewFull].forEach((v) => v && (v.innerHTML = ""));
    els.logView.innerHTML = `<p class="log-empty" id="log-empty">Press <strong>Play</strong> to start the run and stream log output…</p>`;
    render();
  }

  function seekBy(seconds) {
    const delta = (seconds / RUN_DURATION_S) * 100;
    state.progress = Math.min(100, Math.max(0, state.progress + delta));
    if (state.progress >= 100 && state.status === "running") {
      state.status = "done";
      cancelAnimationFrame(state.raf);
    } else if (state.progress >= 100) {
      state.status = "done";
    } else if (state.status === "done") {
      state.status = "paused";
    }
    state.lastTs = null;
    render();
  }

  function seekToRatio(ratio) {
    state.progress = Math.min(100, Math.max(0, ratio * 100));
    if (state.progress >= 100) {
      state.status = "done";
      cancelAnimationFrame(state.raf);
    } else if (state.status === "done") {
      state.status = "paused";
    } else if (state.status === "idle" && state.progress > 0) {
      state.status = "paused";
    }
    state.lastTs = null;
    render();
  }

  /* ---------- Control bar wiring ---------- */

  $('[data-control="play"]').addEventListener("click", () => {
    state.status === "running" ? pause() : play();
  });
  $('[data-control="stop"]').addEventListener("click", stop);
  $('[data-control="forward"]').addEventListener("click", () => seekBy(STEP_S));
  $('[data-control="rewind"]').addEventListener("click", () => seekBy(-STEP_S));

  function trackRatio(e) {
    const rect = els.controlTrack.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return Math.min(1, Math.max(0, x / rect.width));
  }

  els.controlTrack.addEventListener("pointerdown", (e) => {
    els.controlTrack.setPointerCapture(e.pointerId);
    seekToRatio(trackRatio(e));
  });
  els.controlTrack.addEventListener("pointermove", (e) => {
    if (els.controlTrack.hasPointerCapture(e.pointerId)) seekToRatio(trackRatio(e));
  });
  els.controlTrack.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { seekBy(1); e.preventDefault(); }
    if (e.key === "ArrowLeft") { seekBy(-1); e.preventDefault(); }
    if (e.key === " " || e.key === "Enter") {
      state.status === "running" ? pause() : play();
      e.preventDefault();
    }
  });

  els.videoPlayer.addEventListener("click", () => {
    state.status === "running" ? pause() : play();
  });

  /* ---------- Helpers & global delegation ---------- */

  function flash(el) {
    if (!el) return;
    el.classList.remove("is-flashing");
    void el.offsetWidth;
    el.classList.add("is-flashing");
  }

  function focusRunPanel() {
    els.runPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    els.runPanel.classList.remove("is-focused");
    void els.runPanel.offsetWidth;
    els.runPanel.classList.add("is-focused");
  }

  const ACTIONS = {
    pdf(btn) { openPdf(btn.dataset.doc || "requirement"); },
    xls() { renderXls(); openModal("modal-xls"); },
    value() { openModal("modal-value"); },
    "open-logs"() {
      els.logViewFull.innerHTML = els.logView.innerHTML;
      openModal("modal-logs");
      els.logViewFull.scrollTop = els.logViewFull.scrollHeight;
    },
    "open-files"() { openModal("modal-files"); },
    "open-lightbox"(btn) { openLightbox(Number(btn.dataset.shot || 0)); },
    "toggle-video"() {
      state.status === "running" ? pause() : play();
    },
    "focus-run"() { focusRunPanel(); },
  };

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-action]");
    if (!trigger || trigger.matches("[data-close]")) return;
    const action = ACTIONS[trigger.dataset.action];
    if (action) action(trigger);
  });

  $$(".shot").forEach((shot) => {
    shot.addEventListener("click", () => openLightbox(Number(shot.dataset.shot)));
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  render();
})();
