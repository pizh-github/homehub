(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);

  const state = {
    loaded: false,
    overview: null,
    exercises: [],
    settings: null,
    calendar: { month: "", today: "", days: {} },
    calendarMonth: "",
    history: []
  };

  const els = {
    remind: $("#fitnessRemind"),
    exerciseCount: $("#fitnessExerciseCount"),
    todayState: $("#fitnessTodayState"),
    todayHint: $("#fitnessTodayHint"),
    today: $("#fitnessToday"),
    exercises: $("#fitnessExercises"),
    addExercise: $("#fitnessAddExercise"),
    calendarMonth: $("#fitnessCalendarMonth"),
    calendarGrid: $("#fitnessCalendarGrid"),
    calendarPrev: $("#fitnessCalendarPrev"),
    calendarNext: $("#fitnessCalendarNext"),
    history: $("#fitnessHistory"),
    historySummary: $("#fitnessHistorySummary"),
    settingsForm: $("#fitnessSettingsForm"),
    targetValue: $("#fitnessTargetValue"),
    targetMinus: $("#fitnessTargetMinus"),
    targetPlus: $("#fitnessTargetPlus"),
    remindDays: $("#fitnessRemindDays"),
    exerciseOverlay: $("#fitnessExerciseOverlay"),
    exerciseTitle: $("#fitnessExerciseTitle"),
    exerciseForm: $("#fitnessExerciseForm"),
    exerciseCancel: $("#fitnessExerciseCancel"),
    dayOverlay: $("#fitnessDayOverlay"),
    dayTitle: $("#fitnessDayTitle"),
    dayBody: $("#fitnessDayBody"),
    dayClose: $("#fitnessDayClose"),
    confirmOverlay: $("#fitnessConfirmOverlay"),
    confirmEyebrow: $("#fitnessConfirmEyebrow"),
    confirmTitle: $("#fitnessConfirmTitle"),
    confirmBody: $("#fitnessConfirmBody"),
    confirmCancel: $("#fitnessConfirmCancel"),
    confirmConfirm: $("#fitnessConfirmConfirm"),
    aerobicOverlay: $("#fitnessAerobicOverlay"),
    aerobicTitle: $("#fitnessAerobicTitle"),
    aerobicHint: $("#fitnessAerobicHint"),
    aerobicForm: $("#fitnessAerobicForm"),
    aerobicUncheck: $("#fitnessAerobicUncheck"),
    aerobicCancel: $("#fitnessAerobicCancel"),
    aerobicPace: $("#fitnessAerobicPace"),
    aerobicSpeed: $("#fitnessAerobicSpeed")
  };

  const STATUS_LABELS = { none: "未开始", planned: "已预约", active: "进行中", completed: "已完成" };
  const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

  let closeExerciseOverlay = null;
  let closeDayOverlay = null;
  let closeConfirmOverlay = null;
  let closeAerobicOverlay = null;
  let currentAerobic = null;

  function formatMetric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : "0";
  }

  function paceParts(durationMin, distanceKm) {
    const duration = Number(durationMin);
    const distance = Number(distanceKm);
    if (!Number.isFinite(duration) || !Number.isFinite(distance) || duration <= 0 || distance <= 0) {
      return null;
    }
    const pace = duration / distance;
    const speed = distance / (duration / 60);
    let minutes = Math.floor(pace);
    let seconds = Math.round((pace - minutes) * 60);
    if (seconds >= 60) {
      minutes += 1;
      seconds = 0;
    }
    return { pace: `${minutes}'${String(seconds).padStart(2, "0")}"`, speed: speed.toFixed(1) };
  }

  function updateAerobicPacePreview() {
    const parts = paceParts(els.aerobicForm.elements.durationMin.value, els.aerobicForm.elements.distanceKm.value);
    els.aerobicPace.textContent = parts ? `${parts.pace} /km` : "—";
    els.aerobicSpeed.textContent = parts ? `${parts.speed} km/h` : "填写时间和距离后自动计算";
  }

  function escapeHtml(text) {
    return String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const body = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(body?.error || `请求失败 (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function toast(text) {
    const message = $("#message");
    if (!message) return;
    message.textContent = text;
    message.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => message.classList.remove("show"), 2500);
  }

  function todayKey() {
    return state.overview?.today?.date || "";
  }

  function dateFromKey(key) {
    const [year, month, day] = String(key || "").split("-").map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day, 12);
  }

  function offsetKey(key, days) {
    const date = dateFromKey(key);
    if (!date) return "";
    date.setDate(date.getDate() + Number(days));
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function formatDayTitle(key) {
    const date = dateFromKey(key);
    if (!date) return String(key || "");
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${WEEKDAY_LABELS[date.getDay()]}`;
  }

  function formatTimestamp(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  function weightText(item) {
    const value = Number(item.weightKg || 0).toFixed(1);
    const mode = item.weightMode === "single" ? "单边" : "全部";
    return `${value} kg(${mode})`;
  }

  function openOverlay(overlay) {
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
  }

  function closeOverlay(overlay) {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }

  function confirmAction({ eyebrow = "需要确认", title = "确认操作", body = "", confirmText = "确定", danger = false } = {}) {
    return new Promise((resolve) => {
      closeConfirmOverlay?.(false);
      const previousFocus = document.activeElement;
      const close = (confirmed) => {
        closeOverlay(els.confirmOverlay);
        document.removeEventListener("keydown", handleKeyDown);
        closeConfirmOverlay = null;
        previousFocus?.focus?.({ preventScroll: true });
        resolve(confirmed);
      };
      const handleKeyDown = (event) => {
        if (event.key === "Escape") close(false);
      };
      closeConfirmOverlay = close;
      els.confirmEyebrow.textContent = eyebrow;
      els.confirmTitle.textContent = title;
      els.confirmBody.textContent = body;
      els.confirmConfirm.textContent = confirmText;
      els.confirmConfirm.classList.toggle("danger", danger);
      openOverlay(els.confirmOverlay);
      document.addEventListener("keydown", handleKeyDown);
      els.confirmCancel.focus({ preventScroll: true });
    });
  }

  function renderRemind(overview) {
    if (!overview.shouldRemind) {
      els.remind.classList.add("hidden");
      els.remind.textContent = "";
      return;
    }
    els.remind.innerHTML = `<strong>你已经 ${overview.daysSinceLastCompleted} 天没练了</strong><span>该动一动了，开始今天的训练吧。</span>`;
    els.remind.classList.remove("hidden");
  }

  function renderSetBlocks(exercise, interactive) {
    return exercise.results.map((result) => `
      <button type="button" class="fitness-set${result.completed ? " done" : ""}"
        ${interactive ? "" : " disabled"}
        data-toggle-set="${exercise.exerciseId}"
        data-set-index="${result.setIndex}"
        aria-pressed="${result.completed}"
        aria-label="第 ${result.setIndex + 1} 组${result.completed ? "，已完成" : ""}">
        ${result.completed ? "✓" : result.setIndex + 1}
      </button>
    `).join("");
  }

  function aerobicText(item) {
    const source = item.aerobic ?? item;
    const duration = formatMetric(source.durationMin ?? source.defaultDurationMin);
    const distance = formatMetric(source.distanceKm ?? source.defaultDistanceKm);
    const incline = formatMetric(source.incline ?? source.defaultIncline);
    const parts = item.aerobic?.completed ? paceParts(source.durationMin, source.distanceKm) : null;
    const pace = parts ? ` · 配速 ${parts.pace}/km` : "";
    return `${duration} 分钟 · ${distance} km · 坡度 ${incline}%${pace}`;
  }

  function renderTodayExercise(item, interactive) {
    if (item.type === "aerobic") {
      const done = Boolean(item.aerobic?.completed);
      const state = done ? "✓ 已完成" : "待打卡";
      return `
        <article class="fitness-today-exercise is-aerobic${done ? " done" : ""}">
          <header>
            <strong>${escapeHtml(item.name)}</strong>
            <span class="muted">有氧</span>
            <em class="fitness-set-count">${state}</em>
          </header>
          <div class="fitness-aerobic-row">
            <button type="button" class="fitness-set fitness-aerobic-toggle${done ? " done" : ""}"
              ${interactive ? "" : " disabled"}
              data-aerobic-confirm="${item.exerciseId}"
              aria-pressed="${done}"
              aria-label="${done ? "已完成，点击修改或取消打卡" : "完成后点击打钩"}">
              ${done ? "✓" : "▷"}
            </button>
            <span class="muted fitness-aerobic-text">${aerobicText(item)}</span>
          </div>
        </article>
      `;
    }
    const doneCount = item.results.filter((result) => result.completed).length;
    return `
      <article class="fitness-today-exercise">
        <header>
          <strong>${escapeHtml(item.name)}</strong>
          <span class="muted">${weightText(item)} × ${item.reps} 次 × ${item.sets} 组</span>
          <em class="fitness-set-count">${doneCount}/${item.sets}</em>
        </header>
        <div class="fitness-sets">${renderSetBlocks(item, interactive)}</div>
      </article>
    `;
  }

  function renderToday(day) {
    const label = STATUS_LABELS[day.status] || "";
    els.todayState.textContent = label;
    els.todayState.className = `pill fitness-status-${day.status}`;
    if (day.status === "none" || day.status === "planned") {
      els.todayHint.textContent = day.status === "planned"
        ? "今天是预约训练日，准备好就开始吧。"
        : "点击开始训练，按你的权重目标随机抽取今天的项目。";
      els.today.innerHTML = `
        <button type="button" class="primary fitness-start" data-fitness-action="start">开始训练</button>
      `;
      return;
    }
    const percent = day.totalSets ? Math.round((day.completedSets / day.totalSets) * 100) : 0;
    const progress = `
      <div class="fitness-progress">
        <div class="fitness-progress-track" aria-hidden="true"><span style="width:${percent}%"></span></div>
        <span class="fitness-progress-label">已完成 ${day.completedSets} / ${day.totalSets} 组</span>
      </div>
    `;
    if (day.status === "active") {
      els.todayHint.textContent = "完成一组点一下打卡，点错了再点一下取消。";
      els.today.innerHTML = `
        ${progress}
        <div class="fitness-today-list">${day.exercises.map((item) => renderTodayExercise(item, true)).join("")}</div>
        <div class="fitness-today-actions">
          <button type="button" class="primary" data-fitness-action="finish">结束训练</button>
          <button type="button" class="quiet" data-fitness-action="regenerate">重新生成</button>
        </div>
      `;
      return;
    }
    els.todayHint.textContent = day.completedAt ? `训练结束于 ${formatTimestamp(day.completedAt)}` : "今天训练已结束。";
    els.today.innerHTML = `
      ${progress}
      <div class="fitness-today-list">${day.exercises.map((item) => renderTodayExercise(item, false)).join("")}</div>
      <div class="fitness-today-actions">
        <button type="button" class="quiet" data-fitness-action="reopen">撤回结束</button>
      </div>
    `;
  }

  function renderExercises(exercises) {
    els.exerciseCount.textContent = `${exercises.length} 个项目`;
    els.exerciseCount.classList.remove("hidden");
    if (!exercises.length) {
      els.exercises.innerHTML = `<p class="muted fitness-empty">还没有训练项目，点击「新增项目」创建第一个。</p>`;
      return;
    }
    els.exercises.innerHTML = exercises.map((item) => {
      const summary = item.type === "aerobic"
        ? `有氧 · 默认 ${formatMetric(item.defaultDurationMin)} 分钟 · ${formatMetric(item.defaultDistanceKm)} km · 坡度 ${formatMetric(item.defaultIncline)}%　权重 ${Number(item.priorityWeight).toFixed(1)}`
        : `${weightText(item)} × ${item.reps} 次 × ${item.sets} 组　权重 ${Number(item.priorityWeight).toFixed(1)}`;
      return `
      <article class="fitness-exercise-row">
        <div class="fitness-exercise-main">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="muted">${summary}</span>
        </div>
        <div class="fitness-exercise-actions">
          <button type="button" class="link" data-edit-exercise="${item.id}">编辑</button>
          <button type="button" class="link fitness-danger-link" data-delete-exercise="${item.id}">删除</button>
        </div>
      </article>
    `; }).join("");
  }

  function renderCalendar() {
    const [year, month] = state.calendarMonth.split("-").map(Number);
    els.calendarMonth.textContent = `${year} 年 ${month} 月`;
    const firstDate = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const today = todayKey();
    const cells = [];
    for (let index = 0; index < firstDate.getDay(); index += 1) {
      cells.push(`<span class="fitness-calendar-cell empty" aria-hidden="true"></span>`);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${state.calendarMonth}-${String(day).padStart(2, "0")}`;
      const status = state.calendar.days[key];
      const classes = ["fitness-calendar-cell"];
      if (status) classes.push(`is-${status}`);
      if (key === today) classes.push("is-today");
      if (key > today) classes.push("is-future");
      else if (key < today && !status) classes.push("is-muted");
      const label = [`${month} 月 ${day} 日`, status ? STATUS_LABELS[status] : "", key === today ? "今天" : ""].filter(Boolean).join("，");
      cells.push(`
        <button type="button" class="${classes.join(" ")}" data-calendar-date="${key}" aria-label="${label}">
          <span>${day}</span>
        </button>
      `);
    }
    els.calendarGrid.innerHTML = cells.join("");
  }

  function renderHistory() {
    const completed = state.history.filter((item) => item.status === "completed").length;
    els.historySummary.textContent = `最近 30 天完成 ${completed} 次`;
    if (!state.history.length) {
      els.history.innerHTML = `<p class="muted fitness-empty">最近 30 天还没有训练记录。</p>`;
      return;
    }
    els.history.innerHTML = state.history.map((item) => `
      <button type="button" class="fitness-history-item is-${item.status}" data-history-date="${item.date}">
        <span class="fitness-history-date">${escapeHtml(formatDayTitle(item.date))}</span>
        <span class="fitness-history-status">${STATUS_LABELS[item.status] || item.status}</span>
        <span class="fitness-history-sets">${item.completedSets}/${item.totalSets} 组</span>
      </button>
    `).join("");
  }

  function renderSettings(settings) {
    els.targetValue.textContent = Number(settings.dailyWeightTarget).toFixed(1);
    els.remindDays.value = settings.remindAfterDays;
  }

  function renderAll() {
    if (!state.overview) return;
    renderRemind(state.overview);
    renderToday(state.overview.today);
    renderExercises(state.exercises);
    renderCalendar();
    renderHistory();
    renderSettings(state.settings);
  }

  function shiftTarget(delta) {
    const current = Number(els.targetValue.textContent) || 5;
    const next = Math.min(50, Math.max(0.5, Math.round((current + delta) * 2) / 2));
    els.targetValue.textContent = next.toFixed(1);
  }

  function setExerciseType(type) {
    const value = type === "aerobic" ? "aerobic" : "anaerobic";
    els.exerciseForm.elements.type.value = value;
    els.exerciseForm.querySelectorAll("[data-exercise-type]").forEach((button) => {
      button.classList.toggle("selected", button.dataset.exerciseType === value);
    });
    els.exerciseForm.querySelector(".fitness-anaerobic-fields").classList.toggle("hidden", value === "aerobic");
    els.exerciseForm.querySelector(".fitness-aerobic-fields").classList.toggle("hidden", value !== "aerobic");
  }

  function openExerciseEditor(exercise) {
    els.exerciseForm.elements.id.value = exercise?.id || "";
    els.exerciseForm.elements.name.value = exercise?.name || "";
    setExerciseType(exercise?.type || "anaerobic");
    els.exerciseForm.elements.sets.value = exercise?.sets ?? 3;
    els.exerciseForm.elements.reps.value = exercise?.reps ?? 12;
    els.exerciseForm.elements.weightKg.value = exercise?.weightKg ?? 0;
    els.exerciseForm.elements.weightMode.value = exercise?.weightMode || "total";
    els.exerciseForm.elements.defaultDurationMin.value = exercise?.defaultDurationMin ?? 30;
    els.exerciseForm.elements.defaultDistanceKm.value = exercise?.defaultDistanceKm ?? 5;
    els.exerciseForm.elements.defaultIncline.value = exercise?.defaultIncline ?? 0;
    setPriorityWeight(exercise?.priorityWeight ?? 1);
    els.exerciseTitle.textContent = exercise ? "编辑项目" : "新增项目";
    closeExerciseOverlay = (saved) => {
      closeExerciseOverlay = null;
      closeOverlay(els.exerciseOverlay);
      document.removeEventListener("keydown", handleKeyDown);
      if (saved) return;
      els.addExercise.focus({ preventScroll: true });
    };
    function handleKeyDown(event) {
      if (event.key === "Escape") closeExerciseOverlay?.(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    openOverlay(els.exerciseOverlay);
    els.exerciseForm.elements.name.focus({ preventScroll: true });
  }

  function setPriorityWeight(value) {
    els.exerciseForm.elements.priorityWeight.value = String(value);
    els.exerciseForm.querySelectorAll("[data-priority-weight]").forEach((button) => {
      button.classList.toggle("selected", Number(button.dataset.priorityWeight) === Number(value));
    });
  }

  async function saveExercise(event) {
    event.preventDefault();
    const form = els.exerciseForm;
    const id = form.elements.id.value;
    const payload = {
      name: form.elements.name.value,
      type: form.elements.type.value,
      sets: Number(form.elements.sets.value),
      reps: Number(form.elements.reps.value),
      weightKg: form.elements.weightKg.value === "" ? 0 : Number(form.elements.weightKg.value),
      weightMode: form.elements.weightMode.value,
      defaultDurationMin: form.elements.defaultDurationMin.value === "" ? 0 : Number(form.elements.defaultDurationMin.value),
      defaultDistanceKm: form.elements.defaultDistanceKm.value === "" ? 0 : Number(form.elements.defaultDistanceKm.value),
      defaultIncline: form.elements.defaultIncline.value === "" ? 0 : Number(form.elements.defaultIncline.value),
      priorityWeight: Number(form.elements.priorityWeight.value)
    };
    try {
      if (id) await api(`/api/fitness/exercises/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/api/fitness/exercises", { method: "POST", body: JSON.stringify(payload) });
      closeExerciseOverlay?.(true);
      toast(id ? "项目已更新" : "项目已添加");
      await refresh();
    } catch (error) {
      toast(error.message);
    }
  }

  async function loadCalendar(month) {
    state.calendar = await api(`/api/fitness/calendar?month=${encodeURIComponent(month)}`);
    state.calendarMonth = state.calendar.month;
  }

  async function loadHistory() {
    const today = todayKey();
    if (!today) return;
    const from = offsetKey(today, -29);
    const result = await api(`/api/fitness/history?from=${from}&to=${today}`);
    state.history = result.items;
  }

  async function refresh() {
    const [overview, exercisesResult, settings] = await Promise.all([
      api("/api/fitness/overview"),
      api("/api/fitness/exercises"),
      api("/api/fitness/settings")
    ]);
    state.overview = overview;
    state.exercises = exercisesResult.exercises;
    state.settings = settings;
    state.loaded = true;
    if (!state.calendarMonth) state.calendarMonth = todayKey().slice(0, 7);
    await Promise.all([loadCalendar(state.calendarMonth), loadHistory()]);
    renderAll();
  }

  async function refreshTodayPart() {
    const overview = await api("/api/fitness/overview");
    state.overview = overview;
    renderRemind(overview);
    renderToday(overview.today);
    await Promise.all([loadCalendar(state.calendarMonth), loadHistory()]);
    renderCalendar();
    renderHistory();
  }

  async function handleTodayAction(action) {
    const date = todayKey();
    try {
      if (action === "start") {
        const day = await api(`/api/fitness/days/${date}/start`, { method: "POST" });
        if (day.targetShort) toast("当前目标权重小于最小项目权重，先安排最小的练起来");
        else toast("已生成今天的训练，加油！");
      } else if (action === "regenerate") {
        const confirmed = await confirmAction({
          eyebrow: "重新生成",
          title: "重新抽取今天的项目？",
          body: "当天的打卡结果会被清空，并按权重目标重新抽取项目。",
          confirmText: "重新生成"
        });
        if (!confirmed) return;
        const day = await api(`/api/fitness/days/${date}/regenerate`, { method: "POST" });
        if (day.targetShort) toast("当前目标权重小于最小项目权重");
        else toast("已重新生成今天的项目");
      } else if (action === "finish") {
        await api(`/api/fitness/days/${date}/finish`, { method: "POST" });
        toast("训练已结束，做得好！");
      } else if (action === "reopen") {
        await api(`/api/fitness/days/${date}/reopen`, { method: "POST" });
        toast("已撤回结束，继续训练");
      }
      await refreshTodayPart();
    } catch (error) {
      toast(error.message);
    }
  }

  async function handleToggleSet(exerciseId, setIndex) {
    const date = todayKey();
    try {
      await api(`/api/fitness/days/${date}/sets/${exerciseId}/${setIndex}/toggle`, { method: "POST" });
      await refreshTodayPart();
    } catch (error) {
      toast(error.message);
    }
  }

  async function handleDeleteExercise(id) {
    const exercise = state.exercises.find((item) => String(item.id) === String(id));
    const confirmed = await confirmAction({
      eyebrow: "删除项目",
      title: `删除「${exercise?.name || "训练项目"}」？`,
      body: "项目会被直接删除；已完成的训练历史保存的是当时的数据快照，不受影响。",
      confirmText: "删除",
      danger: true
    });
    if (!confirmed) return;
    try {
      await api(`/api/fitness/exercises/${id}`, { method: "DELETE" });
      toast("项目已删除");
      await refresh();
    } catch (error) {
      toast(error.message);
    }
  }

  async function handleCalendarClick(date) {
    const today = todayKey();
    try {
      if (date > today) {
        const status = state.calendar.days[date];
        if (status === "planned") {
          await api(`/api/fitness/days/${date}/plan`, { method: "DELETE" });
          toast("已取消预约");
        } else {
          await api(`/api/fitness/days/${date}/plan`, { method: "POST" });
          toast("已预约，当天点击「开始训练」即可");
        }
      } else {
        await showDayDetail(date);
        return;
      }
      await Promise.all([loadCalendar(state.calendarMonth), loadHistory()]);
      renderCalendar();
      renderHistory();
    } catch (error) {
      toast(error.message);
    }
  }

  async function showDayDetail(date) {
    try {
      const day = await api(`/api/fitness/days/${date}`);
      els.dayTitle.textContent = formatDayTitle(date);
      if (day.status === "none") {
        els.dayBody.innerHTML = `<p>这一天没有训练记录。</p>`;
      } else {
        const sets = day.exercises.length
          ? day.exercises.map((item) => {
              if (item.type === "aerobic") {
                const done = Boolean(item.aerobic?.completed);
                const extras = [];
                if (item.aerobic?.avgHeartRate) extras.push(`心率 ${item.aerobic.avgHeartRate}`);
                if (item.aerobic?.note) extras.push(escapeHtml(item.aerobic.note));
                return `
                  <div class="fitness-detail-exercise">
                    <strong>${escapeHtml(item.name)}</strong>
                    <span class="muted">有氧 · ${aerobicText(item)}${done ? " · ✓ 已完成" : " · 未打卡"}${extras.length ? ` · ${extras.join(" · ")}` : ""}</span>
                  </div>
                `;
              }
              return `
                  <div class="fitness-detail-exercise">
                    <strong>${escapeHtml(item.name)}</strong>
                    <span class="muted">${weightText(item)} × ${item.reps} 次 × ${item.sets} 组</span>
                    <div class="fitness-detail-sets">
                      ${item.results.map((result) => `<i class="${result.completed ? "done" : ""}">${result.completed ? "✓" : "·"}</i>`).join("")}
                    </div>
                  </div>
                `;
            }).join("")
          : `<p class="muted">没有项目快照。</p>`;
        els.dayBody.innerHTML = `
          <p class="fitness-detail-status">${STATUS_LABELS[day.status] || day.status} · 完成 ${day.completedSets}/${day.totalSets} 组${day.completedAt ? ` · 结束于 ${formatTimestamp(day.completedAt)}` : ""}</p>
          ${sets}
        `;
      }
      closeDayOverlay = () => {
        closeDayOverlay = null;
        closeOverlay(els.dayOverlay);
        document.removeEventListener("keydown", handleKeyDown);
      };
      function handleKeyDown(event) {
        if (event.key === "Escape") closeDayOverlay?.();
      }
      document.addEventListener("keydown", handleKeyDown);
      openOverlay(els.dayOverlay);
    } catch (error) {
      toast(error.message);
    }
  }

  function monthCursorShift(delta) {
    const [year, month] = state.calendarMonth.split("-").map(Number);
    const date = new Date(year, month - 1 + delta, 1);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }

  function openAerobicConfirm(day, exerciseId) {
    const item = day.exercises.find((entry) => String(entry.exerciseId) === String(exerciseId));
    if (!item || item.type !== "aerobic") return;
    currentAerobic = { date: day.date, item };
    els.aerobicTitle.textContent = item.name;
    els.aerobicHint.textContent = item.aerobic?.completed
      ? "已打卡，下面是存入历史的实际数据，可以直接修改后重新保存。"
      : "确认本次有氧的实际数据，保存后会打钩并作为最终历史记录。";
    els.aerobicForm.elements.durationMin.value = formatMetric(item.aerobic?.durationMin ?? item.defaultDurationMin);
    els.aerobicForm.elements.distanceKm.value = formatMetric(item.aerobic?.distanceKm ?? item.defaultDistanceKm);
    els.aerobicForm.elements.incline.value = formatMetric(item.aerobic?.incline ?? item.defaultIncline);
    els.aerobicForm.elements.avgHeartRate.value = item.aerobic?.avgHeartRate ? String(item.aerobic.avgHeartRate) : "";
    els.aerobicForm.elements.note.value = item.aerobic?.note || "";
    els.aerobicUncheck.classList.toggle("hidden", !item.aerobic?.completed);
    updateAerobicPacePreview();
    closeAerobicOverlay = () => {
      closeAerobicOverlay = null;
      currentAerobic = null;
      closeOverlay(els.aerobicOverlay);
      document.removeEventListener("keydown", handleKeyDown);
    };
    function handleKeyDown(event) {
      if (event.key === "Escape") closeAerobicOverlay?.();
    }
    document.addEventListener("keydown", handleKeyDown);
    openOverlay(els.aerobicOverlay);
    els.aerobicForm.elements.durationMin.focus({ preventScroll: true });
  }

  async function saveAerobicResult({ completed }) {
    if (!currentAerobic) return;
    const form = els.aerobicForm;
    const payload = {
      completed,
      durationMin: form.elements.durationMin.value === "" ? 0 : Number(form.elements.durationMin.value),
      distanceKm: form.elements.distanceKm.value === "" ? 0 : Number(form.elements.distanceKm.value),
      incline: form.elements.incline.value === "" ? 0 : Number(form.elements.incline.value),
      avgHeartRate: form.elements.avgHeartRate.value === "" ? 0 : Number(form.elements.avgHeartRate.value),
      note: form.elements.note.value
    };
    try {
      await api(`/api/fitness/days/${currentAerobic.date}/aerobic/${currentAerobic.item.exerciseId}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      closeAerobicOverlay?.();
      toast(completed ? "有氧打卡完成" : "已取消打卡");
      await refreshTodayPart();
    } catch (error) {
      toast(error.message);
    }
  }

  els.today.addEventListener("click", (event) => {
    const setButton = event.target.closest("[data-toggle-set]");
    if (setButton && !setButton.disabled) {
      handleToggleSet(setButton.dataset.toggleSet, Number(setButton.dataset.setIndex));
      return;
    }
    const aerobicButton = event.target.closest("[data-aerobic-confirm]");
    if (aerobicButton && !aerobicButton.disabled) {
      openAerobicConfirm(state.overview.today, aerobicButton.dataset.aerobicConfirm);
      return;
    }
    const action = event.target.closest("[data-fitness-action]");
    if (action) handleTodayAction(action.dataset.fitnessAction);
  });

  els.exercises.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-exercise]");
    if (editButton) {
      const exercise = state.exercises.find((item) => String(item.id) === editButton.dataset.editExercise);
      openExerciseEditor(exercise);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-exercise]");
    if (deleteButton) handleDeleteExercise(deleteButton.dataset.deleteExercise);
  });

  els.addExercise.addEventListener("click", () => openExerciseEditor(null));
  els.exerciseForm.addEventListener("submit", saveExercise);
  els.exerciseCancel.addEventListener("click", () => closeExerciseOverlay?.(false));
  els.exerciseOverlay.addEventListener("click", (event) => {
    if (event.target === els.exerciseOverlay) closeExerciseOverlay?.(false);
  });
  els.exerciseForm.addEventListener("click", (event) => {
    const option = event.target.closest("[data-priority-weight]");
    if (option) setPriorityWeight(option.dataset.priorityWeight);
    const typeButton = event.target.closest("[data-exercise-type]");
    if (typeButton) setExerciseType(typeButton.dataset.exerciseType);
  });

  els.calendarGrid.addEventListener("click", (event) => {
    const cell = event.target.closest("[data-calendar-date]");
    if (cell) handleCalendarClick(cell.dataset.calendarDate);
  });
  els.calendarPrev.addEventListener("click", async () => {
    state.calendarMonth = monthCursorShift(-1);
    try {
      await loadCalendar(state.calendarMonth);
      renderCalendar();
    } catch (error) {
      toast(error.message);
    }
  });
  els.calendarNext.addEventListener("click", async () => {
    state.calendarMonth = monthCursorShift(1);
    try {
      await loadCalendar(state.calendarMonth);
      renderCalendar();
    } catch (error) {
      toast(error.message);
    }
  });

  els.history.addEventListener("click", (event) => {
    const item = event.target.closest("[data-history-date]");
    if (item) showDayDetail(item.dataset.historyDate);
  });

  els.dayClose.addEventListener("click", () => closeDayOverlay?.());
  els.dayOverlay.addEventListener("click", (event) => {
    if (event.target === els.dayOverlay) closeDayOverlay?.();
  });

  els.targetMinus.addEventListener("click", () => shiftTarget(-0.5));
  els.targetPlus.addEventListener("click", () => shiftTarget(0.5));
  els.settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      state.settings = await api("/api/fitness/settings", {
        method: "PUT",
        body: JSON.stringify({
          dailyWeightTarget: Number(els.targetValue.textContent),
          remindAfterDays: Number(els.remindDays.value)
        })
      });
      renderSettings(state.settings);
      toast("设置已保存");
      await refreshTodayPart();
    } catch (error) {
      toast(error.message);
    }
  });

  els.confirmCancel.addEventListener("click", () => closeConfirmOverlay?.(false));
  els.confirmConfirm.addEventListener("click", () => closeConfirmOverlay?.(true));
  els.confirmOverlay.addEventListener("click", (event) => {
    if (event.target === els.confirmOverlay) closeConfirmOverlay?.(false);
  });

  els.aerobicForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveAerobicResult({ completed: true });
  });
  els.aerobicForm.elements.durationMin.addEventListener("input", updateAerobicPacePreview);
  els.aerobicForm.elements.distanceKm.addEventListener("input", updateAerobicPacePreview);
  els.aerobicUncheck.addEventListener("click", () => saveAerobicResult({ completed: false }));
  els.aerobicCancel.addEventListener("click", () => closeAerobicOverlay?.());
  els.aerobicOverlay.addEventListener("click", (event) => {
    if (event.target === els.aerobicOverlay) closeAerobicOverlay?.();
  });

  window.FitnessUI = { refresh };

  if (document.querySelector('[data-view-panel="fitness"]')?.classList.contains("active")) {
    refresh().catch(() => {});
  }
})();
