"use strict";

const storageKey = "rhythm-day-planner-v1";
const backupFormat = "rhythm-planner";
const backupVersion = 1;
const byId = id => document.getElementById(id);
const grid = byId("date-grid");
const timeline = byId("timeline");
const dialog = byId("task-dialog");
const titleInput = byId("task-title");
const dateInput = byId("task-date");
const timeInput = byId("task-time");
const repeatInput = byId("task-repeat");
const durationInput = byId("task-duration");
const importantInput = byId("task-important");
const importantFilter = byId("important-only");
const defaultDuration = 30;
const minutesPerDay = 24 * 60;
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const fullDate = new Intl.DateTimeFormat("ru-RU", {weekday: "long", day: "numeric", month: "long"});
const shortDate = new Intl.DateTimeFormat("ru-RU", {day: "numeric", month: "short"});
const monthYear = new Intl.DateTimeFormat("ru-RU", {month: "long", year: "numeric"});
const pad = number => String(number).padStart(2, "0");
const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1);

function timeInMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function durationOf(task) {
  return task.duration ?? defaultDuration;
}

function clockTime(minutes) {
  const withinDay = minutes % minutesPerDay;
  return pad(Math.floor(withinDay / 60)) + ":" + pad(withinDay % 60);
}

function timeRange(task) {
  const end = timeInMinutes(task.time) + durationOf(task);
  return task.time + "–" + clockTime(end) + (end >= minutesPerDay ? " (+1 день)" : "");
}

let tasks = [];
let selected = dateKey(new Date());
let view = "week";
let importantOnly = false;
let completedView = false;
let editingTask = null;

function dateKey(date) {
  return String(date.getFullYear()).padStart(4, "0") + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

function atDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

function plusDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function monday(date) {
  return plusDays(date, -((date.getDay() + 6) % 7));
}

function readTasks() {
  const data = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (!Array.isArray(data)) throw new Error("Сохранённые данные имеют неизвестный формат.");
  return data;
}

function announce(message, error = false) {
  const notice = byId("notice");
  notice.textContent = message;
  notice.classList.toggle("visible", error);
}

function save(change) {
  try {
    const updated = change(readTasks());
    localStorage.setItem(storageKey, JSON.stringify(updated));
    tasks = updated;
    return true;
  } catch {
    const message = "Не удалось сохранить дело. Проверь, разрешено ли браузеру хранить данные.";
    if (dialog.open) {
      const error = byId("form-error");
      error.textContent = message;
      error.hidden = false;
    } else {
      announce(message, true);
    }
    return false;
  }
}

function repeatsOn(task, key) {
  return key >= task.date && (!task.until || key <= task.until) &&
    (task.repeat === "daily" || atDate(key).getDay() === atDate(task.date).getDay());
}

function occurrence(task, key, patch = {}) {
  return {...task, date: key, done: false, ...patch, id: task.id + "@" + key, seriesId: task.id, seriesDate: key};
}

function tasksFor(key) {
  const entries = [];
  for (const task of tasks) {
    if (!task.repeat) {
      if (task.date === key) entries.push(task);
      continue;
    }
    const patches = task.occurrences || {};
    const todayPatch = patches[key];
    if (repeatsOn(task, key) && !todayPatch?.deleted && (!todayPatch?.date || todayPatch.date === key)) {
      entries.push(occurrence(task, key, todayPatch));
    }

    // A rescheduled occurrence keeps its original date as its identifier.
    for (const [original, patch] of Object.entries(patches)) {
      if (original !== key && patch.date === key && !patch.deleted && repeatsOn(task, original)) {
        entries.push(occurrence(task, original, patch));
      }
    }
  }
  return entries.sort((a, b) => a.time.localeCompare(b.time));
}

function recordedTasks() {
  const entries = [];
  for (const task of tasks) {
    if (!task.repeat) {
      entries.push(task);
      continue;
    }
    for (const [date, patch] of Object.entries(task.occurrences || {})) {
      if (repeatsOn(task, date) && !patch.deleted) entries.push(occurrence(task, date, patch));
    }
  }
  return entries;
}

// A repeating series can be open-ended. Find one nearby, unmodified occurrence.
function nearbyOccurrence(task, today) {
  const step = task.repeat === "daily" ? 1 : 7;
  const weekday = atDate(task.date).getDay();
  const start = atDate(today > task.date ? today : task.date);
  const forward = step === 1 ? 0 : (weekday - start.getDay() + 7) % 7;
  let date = plusDays(start, forward);
  while (!task.until || dateKey(date) <= task.until) {
    const key = dateKey(date);
    if (!Object.hasOwn(task.occurrences || {}, key)) return occurrence(task, key);
    date = plusDays(date, step);
  }
  const last = atDate(task.until && task.until < today ? task.until : today);
  const back = step === 1 ? 0 : (last.getDay() - weekday + 7) % 7;
  date = plusDays(last, -back);
  while (dateKey(date) >= task.date) {
    const key = dateKey(date);
    if (!Object.hasOwn(task.occurrences || {}, key)) return occurrence(task, key);
    date = plusDays(date, -step);
  }
  return null;
}

function visibleTasksFor(key) {
  const entries = tasksFor(key);
  return importantOnly ? entries.filter(task => task.important) : entries;
}

function showConflicts() {
  const warning = byId("task-conflict");
  const date = dateInput.value;
  const time = timeInput.value;
  const duration = durationInput.valueAsNumber;
  if (!date || !time || !durationInput.validity.valid || !Number.isInteger(duration)) {
    warning.hidden = true;
    warning.textContent = "";
    return;
  }

  const start = timeInMinutes(time);
  const end = start + duration;
  const day = atDate(date);
  const overlapping = new Set();
  for (const offset of [-1, 0, 1]) {
    for (const task of tasksFor(dateKey(plusDays(day, offset)))) {
      if (task.id === editingTask?.id) continue;
      const otherStart = offset * minutesPerDay + timeInMinutes(task.time);
      const otherEnd = otherStart + durationOf(task);
      if (start < otherEnd && otherStart < end) overlapping.add(task.title);
    }
  }
  warning.hidden = overlapping.size === 0;
  warning.textContent = overlapping.size
    ? "Пересекается с делами: " + [...overlapping].map(title => "«" + title + "»").join(", ") + ". Можно сохранить."
    : "";
}

for (const input of [dateInput, timeInput, durationInput]) {
  input.addEventListener("input", showConflicts);
}

function patchOccurrence(tasks, instance, changes) {
  return tasks.map(task => {
    if (task.id !== instance.seriesId) return task;
    const occurrences = task.occurrences || {};
    return {...task, occurrences: {
      ...occurrences,
      [instance.seriesDate]: {...occurrences[instance.seriesDate], ...changes}
    }};
  });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderCalendar() {
  const date = atDate(selected);
  const week = monday(date);
  const lastDay = plusDays(week, 6);
  const firstOfMonth = new Date(date);
  firstOfMonth.setDate(1);
  const isWeek = view === "week";
  const start = isWeek ? week : monday(firstOfMonth);
  const lastOfMonth = new Date(firstOfMonth);
  lastOfMonth.setMonth(lastOfMonth.getMonth() + 1, 0);
  const end = isWeek ? lastDay : plusDays(monday(lastOfMonth), 6);
  const today = dateKey(new Date());

  byId("week-view").setAttribute("aria-pressed", isWeek);
  byId("month-view").setAttribute("aria-pressed", !isWeek);
  byId("calendar-title").textContent = isWeek ? "План на неделю" : "План на месяц";
  byId("calendar-range").textContent = isWeek
    ? shortDate.format(week) + " — " + shortDate.format(lastDay) + " " + lastDay.getFullYear() + " г."
    : capitalize(monthYear.format(date));

  grid.className = isWeek ? "week-grid" : "month-grid";
  grid.replaceChildren(...weekdays.map(day => element("div", "weekday", day)));
  for (let day = start; day <= end; day = plusDays(day, 1)) {
    const key = dateKey(day);
    const entries = visibleTasksFor(key);
    const button = element("button", "calendar-day");
    button.type = "button";
    button.dataset.date = key;
    button.classList.toggle("selected", key === selected);
    button.classList.toggle("current", key === today);
    button.classList.toggle("outside", !isWeek && day.getMonth() !== date.getMonth());
    button.setAttribute("aria-pressed", key === selected);
    if (key === today) button.setAttribute("aria-current", "date");
    button.setAttribute("aria-label", fullDate.format(day) + ", дел: " + entries.length);
    const content = element("span", "day-button-content");
    content.append(element("span", "day-number", day.getDate()));
    const previewLimit = isWeek ? 6 : 1;
    for (const task of entries.slice(0, previewLimit)) {
      const preview = element("span", "day-preview");
      preview.classList.toggle("important", Boolean(task.important));
      if (task.important) preview.append(element("span", "important-star", "★ "));
      preview.append(task.time + " " + task.title);
      preview.classList.toggle("done", task.done);
      content.append(preview);
    }
    if (entries.length > previewLimit) {
      content.append(element("span", "day-more", (isWeek ? "Ещё " : "+") + (entries.length - previewLimit)));
    }
    button.append(content);
    button.addEventListener("click", () => {
      selected = key;
      render(true);
      grid.querySelector("[aria-pressed=true]").focus({preventScroll: true});
    });
    grid.append(button);
  }
}

function taskRow(task) {
  const row = element("div", task.done ? "task done" : "task");
  row.classList.toggle("important", Boolean(task.important));
  const check = element("input");
  check.type = "checkbox";
  check.checked = task.done;
  check.dataset.check = task.id;
  check.setAttribute("aria-label", "Выполнено: " + task.title);
  check.addEventListener("change", () => {
    const done = check.checked;
    if (!save(previous => task.seriesId
      ? patchOccurrence(previous, task, {done})
      : previous.map(entry => entry.id === task.id ? {...entry, done} : entry))) {
      check.checked = !done;
      return;
    }
    render();
    [...timeline.querySelectorAll("[data-check]")].find(input => input.dataset.check === task.id)?.focus({preventScroll: true});
    announce(done ? "Дело выполнено." : "Дело снова в плане.");
  });
  const edit = element("button");
  edit.type = "button";
  edit.dataset.taskId = task.id;
  edit.title = "Изменить или перенести";
  edit.setAttribute("aria-label", (task.important ? "Важное дело. " : "") + "Изменить или перенести «" + task.title + "»");
  const recurrence = task.seriesId ? " · " + (task.repeat === "daily" ? "Ежедневно" : "Еженедельно") : "";
  const time = timeRange(task) + recurrence;
  edit.append(element("time", "", time));
  if (task.important) {
    const star = element("span", "important-star", "★ ");
    star.setAttribute("aria-hidden", "true");
    edit.append(star);
  }
  edit.append(element("span", "task-name", task.title));
  edit.addEventListener("click", () => openTask(task));
  row.append(check, edit);
  return row;
}

function renderAgenda(scroll, targetHour) {
  const entries = visibleTasksFor(selected);
  const previousDay = dateKey(plusDays(atDate(selected), -1));
  const earlier = visibleTasksFor(previousDay).filter(task => timeInMinutes(task.time) + durationOf(task) > minutesPerDay);
  const intervals = [
    ...earlier.map(task => ({task, start: timeInMinutes(task.time) - minutesPerDay})),
    ...entries.map(task => ({task, start: timeInMinutes(task.time)}))
  ];
  const done = entries.filter(task => task.done).length;
  byId("day-title").textContent = capitalize(fullDate.format(atDate(selected)));
  byId("day-summary").textContent = entries.length ? "Выполнено " + done + " из " + entries.length
    : earlier.length ? "Есть дела с прошлого дня" : importantOnly ? "Важных дел на этот день нет" : "Пока нет дел";

  const previousScroll = timeline.scrollTop;
  timeline.replaceChildren();
  for (let hour = 0; hour < 24; hour++) {
    const time = pad(hour) + ":00";
    const hourRow = element("div", "hour-row");
    hourRow.dataset.hour = hour;
    const content = element("div", "hour-content");
    const hourStart = hour * 60;
    for (const {task, start} of intervals) {
      const end = start + durationOf(task);
      if (start >= hourStart + 60 || end <= hourStart) continue;
      hourRow.classList.add("occupied");
      if (start >= hourStart) {
        content.append(taskRow(task));
      } else {
        const endLabel = end >= minutesPerDay ? "до полуночи" : "до " + clockTime(end);
        content.append(element("p", "hour-continuation", task.title + " · " + endLabel));
      }
    }
    const add = element("button", "hour-add", "+");
    add.type = "button";
    add.setAttribute("aria-label", "Добавить дело на " + time);
    add.addEventListener("click", () => openTask(null, time));
    content.append(add);
    hourRow.append(element("span", "hour-label", time), content);
    timeline.append(hourRow);
  }
  if (scroll) {
    const hour = targetHour ?? (earlier.length ? 0 : entries.length ? Number(entries[0].time.slice(0, 2)) : 8);
    const row = timeline.children[hour];
    timeline.scrollTop = row.offsetTop - timeline.children[0].offsetTop;
  } else {
    timeline.scrollTop = previousScroll;
  }
}

const searchInput = byId("task-search");
const searchPanel = byId("search-panel");

function showOnCalendar(task) {
  clearSearch();
  completedView = false;
  if (importantOnly && !task.important) {
    importantOnly = false;
    importantFilter.setAttribute("aria-pressed", "false");
  }
  selected = task.date;
  render(true, Math.floor(timeInMinutes(task.time) / 60));
  const button = [...timeline.querySelectorAll("[data-task-id]")].find(item => item.dataset.taskId === task.id);
  button?.focus({preventScroll: true});
}

function resultRow(task) {
  const row = element("li");
  const button = element("button", "result-row");
  button.type = "button";
  button.addEventListener("click", () => showOnCalendar(task));
  const text = element("span", "result-text");
  const title = element("strong", "", task.title);
  if (task.important) title.prepend(element("span", "important-star", "★ "));
  const date = atDate(task.date);
  const detail = capitalize(fullDate.format(date)) + " " + date.getFullYear() + " · " + timeRange(task);
  const period = task.repeat ? task.repeat === "daily" ? " · Ежедневно" : " · Еженедельно" : "";
  text.append(title, element("span", "result-detail", detail + period));
  const badge = element("span", task.done ? "result-badge done" : "result-badge", task.done ? "Выполнено" : "В плане");
  button.append(text, badge);
  row.append(button);
  return row;
}

function compareByDate(a, b) {
  return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title, "ru");
}

function renderCompleted() {
  const completed = recordedTasks().filter(task => task.done).sort((a, b) => compareByDate(b, a));
  byId("completed-results").replaceChildren(...completed.map(resultRow));
  byId("completed-empty").hidden = completed.length > 0;
}

function queryText(text) {
  return text.toLocaleLowerCase("ru").replaceAll("ё", "е");
}

function renderSearch() {
  const query = queryText(searchInput.value.trim());
  searchPanel.hidden = !query;
  const list = byId("search-results");
  if (!query) {
    list.replaceChildren();
    return;
  }
  const today = dateKey(new Date());
  const matches = task => queryText(task.title).includes(query);
  const found = recordedTasks().filter(matches);
  for (const series of tasks) {
    if (!series.repeat || !matches(series)) continue;
    const next = nearbyOccurrence(series, today);
    if (next) found.push(next);
  }
  found.sort((a, b) => {
    const pastA = a.date < today;
    const pastB = b.date < today;
    if (pastA !== pastB) return Number(pastA) - Number(pastB);
    return pastA ? compareByDate(b, a) : compareByDate(a, b);
  });
  list.replaceChildren(...found.map(resultRow));
  byId("search-empty").hidden = found.length !== 0;
}

function clearSearch() {
  searchInput.value = "";
  renderSearch();
}

searchInput.addEventListener("input", renderSearch);
byId("search-area").addEventListener("keydown", event => {
  if (event.key === "Escape" && !searchPanel.hidden) {
    clearSearch();
    searchInput.focus();
  }
});

function setCompletedView(value) {
  completedView = value;
  clearSearch();
  render(!value);
}

byId("show-calendar").addEventListener("click", () => setCompletedView(false));
byId("show-completed").addEventListener("click", () => setCompletedView(true));

function render(scroll = false, targetHour) {
  byId("show-calendar").setAttribute("aria-pressed", !completedView);
  byId("show-completed").setAttribute("aria-pressed", completedView);
  byId("page-title").textContent = completedView ? "Выполненные дела" : "Мой календарь";
  byId("calendar-range").hidden = completedView;
  byId("calendar-controls").hidden = completedView;
  byId("calendar-layout").hidden = completedView;
  byId("completed-panel").hidden = !completedView;
  renderSearch();
  if (completedView) {
    renderCompleted();
    return;
  }
  renderCalendar();
  renderAgenda(scroll, targetHour);
  if (scroll) {
    const container = grid.parentElement;
    const active = grid.querySelector("[aria-pressed=true]");
    if (active && grid.scrollWidth > container.clientWidth) {
      container.scrollLeft += active.getBoundingClientRect().left - container.getBoundingClientRect().left
        - (container.clientWidth - active.offsetWidth) / 2;
    }
  }
}

function movePeriod(direction) {
  const date = atDate(selected);
  if (view === "week") {
    selected = dateKey(plusDays(date, direction * 7));
  } else {
    const day = date.getDate();
    date.setMonth(date.getMonth() + direction, 1);
    const last = new Date(date);
    last.setMonth(last.getMonth() + 1, 0);
    date.setDate(Math.min(day, last.getDate()));
    selected = dateKey(date);
  }
  render(true);
}

function openTask(task, time = "09:00") {
  editingTask = task;
  byId("repeat-field").hidden = Boolean(task);
  repeatInput.value = "";
  byId("series-controls").hidden = !task?.seriesId;
  const endSeries = byId("end-series");
  endSeries.hidden = !task?.seriesId || Boolean(task.until && task.seriesDate >= task.until);
  byId("delete-task").textContent = task?.seriesId ? "Удалить это дело" : "Удалить";
  byId("dialog-title").textContent = task ? "Изменить или перенести дело" : "Новое дело";
  byId("delete-task").hidden = !task;
  byId("form-error").hidden = true;
  titleInput.value = task?.title || "";
  dateInput.value = task?.date || selected;
  timeInput.value = task?.time || time;
  durationInput.value = task ? durationOf(task) : defaultDuration;
  importantInput.checked = task ? Boolean(task.important) : importantOnly;
  showConflicts();
  dialog.showModal();
  titleInput.focus();
}

byId("task-form").addEventListener("submit", event => {
  event.preventDefault();
  const title = titleInput.value.trim();
  if (!title) {
    const error = byId("form-error");
    error.hidden = false;
    error.textContent = "Введи название дела.";
    titleInput.focus();
    return;
  }
  const date = dateInput.value;
  const time = timeInput.value;
  const fields = {title, date, time, duration: durationInput.valueAsNumber, important: importantInput.checked};
  const task = editingTask;
  const moved = task && (task.date !== date || task.time !== time);
  if (!save(previous => {
    if (task?.seriesId) return patchOccurrence(previous, task, fields);
    if (task) return previous.map(entry => entry.id === task.id ? {...entry, ...fields} : entry);
    const newTask = {id: crypto.randomUUID(), ...fields, done: false};
    if (repeatInput.value) newTask.repeat = repeatInput.value;
    return [...previous, newTask];
  })) return;
  dialog.close();
  selected = date;
  completedView = false;
  render(true, Number(time.slice(0, 2)));
  byId("add-day-task").focus({preventScroll: true});
  announce(moved ? "Дело перенесено." : "Дело сохранено.");
});

byId("delete-task").addEventListener("click", () => {
  if (!editingTask) return;
  const task = editingTask;
  if (!save(previous => task.seriesId
    ? patchOccurrence(previous, task, {deleted: true})
    : previous.filter(entry => entry.id !== task.id))) return;
  dialog.close();
  render();
  byId("add-day-task").focus({preventScroll: true});
  announce("Дело удалено.");
});

byId("end-series").addEventListener("click", () => {
  const task = editingTask;
  if (!task?.seriesId || !confirm("Прекратить повтор после этого дела?")) return;
  if (!save(previous => previous.map(entry => entry.id === task.seriesId
    ? {...entry, until: entry.until && entry.until < task.seriesDate ? entry.until : task.seriesDate}
    : entry))) return;
  dialog.close();
  render();
  byId("add-day-task").focus({preventScroll: true});
  announce("Повтор завершён.");
});

for (const id of ["close-dialog", "cancel-dialog"]) {
  byId(id).addEventListener("click", () => dialog.close());
}
for (const id of ["add-task", "add-day-task"]) {
  byId(id).addEventListener("click", () => openTask(null));
}
byId("previous").addEventListener("click", () => movePeriod(-1));
byId("next").addEventListener("click", () => movePeriod(1));
byId("today").addEventListener("click", () => {
  selected = dateKey(new Date());
  render(true);
});
for (const mode of ["week", "month"]) {
  byId(mode + "-view").addEventListener("click", () => {
    view = mode;
    render(true);
  });
}
importantFilter.addEventListener("click", () => {
  importantOnly = !importantOnly;
  importantFilter.setAttribute("aria-pressed", importantOnly);
  render(true);
});

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(atDate(value)) === value;
}

function validTaskFields(task, partial = false) {
  return (partial && task.title === undefined || typeof task.title === "string" && task.title.trim() && task.title.length <= 120)
    && (partial && task.date === undefined || validDate(task.date))
    && (partial && task.time === undefined || typeof task.time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.time))
    && (task.duration === undefined || Number.isInteger(task.duration) && task.duration >= 1 && task.duration <= minutesPerDay)
    && (task.done === undefined || typeof task.done === "boolean")
    && (task.important === undefined || typeof task.important === "boolean");
}

function restoreBackup(text) {
  const backup = JSON.parse(text);
  if (backup?.format !== backupFormat || backup.version !== backupVersion || !Array.isArray(backup.tasks)) {
    throw new Error("Неизвестный формат резервной копии.");
  }
  return backup.tasks.map(task => {
    if (!task || typeof task.id !== "string" || !/^[a-z0-9_-]{1,100}$/i.test(task.id) || !validTaskFields(task)) {
      throw new Error("В копии есть некорректное дело.");
    }
    const result = {id: task.id, title: task.title, date: task.date, time: task.time, done: task.done ?? false};
    if (task.duration !== undefined) result.duration = task.duration;
    if (task.important !== undefined) result.important = task.important;
    if (task.repeat === undefined) return result;
    if (!["daily", "weekly"].includes(task.repeat)) throw new Error("Некорректный повтор.");
    result.repeat = task.repeat;
    if (task.until !== undefined) {
      if (!validDate(task.until) || task.until < task.date) throw new Error("Некорректная дата окончания повтора.");
      result.until = task.until;
    }
    if (task.occurrences === undefined) return result;
    if (!task.occurrences || typeof task.occurrences !== "object" || Array.isArray(task.occurrences)) {
      throw new Error("Некорректное расписание повторов.");
    }
    result.occurrences = {};
    for (const [date, patch] of Object.entries(task.occurrences)) {
      if (!validDate(date) || !patch || typeof patch !== "object" || Array.isArray(patch)
          || !validTaskFields(patch, true) || (patch.deleted !== undefined && typeof patch.deleted !== "boolean")) {
        throw new Error("В копии есть некорректный перенос или отметка.");
      }
      result.occurrences[date] = {};
      for (const key of ["title", "date", "time", "duration", "important", "done", "deleted"]) {
        if (patch[key] !== undefined) result.occurrences[date][key] = patch[key];
      }
    }
    return result;
  });
}

const backupDialog = byId("backup-dialog");
const backupFile = byId("backup-file");

function showBackupStatus(message, error = false) {
  const status = byId("backup-status");
  status.textContent = message;
  status.classList.toggle("error", error);
  status.hidden = !message;
}

byId("open-backup").addEventListener("click", () => {
  showBackupStatus("");
  backupDialog.showModal();
});
byId("close-backup").addEventListener("click", () => backupDialog.close());
byId("export-backup").addEventListener("click", () => {
  try {
    const backup = {format: backupFormat, version: backupVersion, tasks: readTasks()};
    const file = new Blob([JSON.stringify(backup, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rhythm-" + dateKey(new Date()) + ".json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showBackupStatus("Копия скачивается. Дел в файле: " + backup.tasks.length + ".");
  } catch {
    showBackupStatus("Не удалось прочитать планы для копии.", true);
  }
});
byId("import-backup").addEventListener("click", () => backupFile.click());
backupFile.addEventListener("change", async () => {
  const [file] = backupFile.files;
  backupFile.value = "";
  if (!file) return;
  let imported;
  try {
    imported = restoreBackup(await file.text());
  } catch {
    showBackupStatus("Не удалось загрузить файл. Выбери JSON-копию, скачанную из «Ритма».", true);
    return;
  }
  let added = 0;
  if (!save(previous => {
    const knownIds = new Set(previous.map(task => task.id));
    const additions = imported.filter(task => {
      if (knownIds.has(task.id)) return false;
      knownIds.add(task.id);
      return true;
    });
    added = additions.length;
    return previous.concat(additions);
  })) {
    showBackupStatus("Не удалось сохранить дела в этом браузере.", true);
    return;
  }
  render();
  showBackupStatus("Добавлено дел: " + added + ". Уже были в календаре: " + (imported.length - added) + ".");
});

function load() {
  try {
    tasks = readTasks();
  } catch {
    announce("Не удалось загрузить сохранённые дела в этом браузере.", true);
  }
}
window.addEventListener("storage", event => {
  if (event.key === storageKey || event.key === null) {
    load();
    render();
    if (dialog.open) showConflicts();
  }
});
load();
render(true);
