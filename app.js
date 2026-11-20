"use strict";

const storageKey = "rhythm-day-planner-v1";
const byId = id => document.getElementById(id);
const grid = byId("date-grid");
const timeline = byId("timeline");
const dialog = byId("task-dialog");
const titleInput = byId("task-title");
const dateInput = byId("task-date");
const timeInput = byId("task-time");
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const fullDate = new Intl.DateTimeFormat("ru-RU", {weekday: "long", day: "numeric", month: "long"});
const shortDate = new Intl.DateTimeFormat("ru-RU", {day: "numeric", month: "short"});
const monthYear = new Intl.DateTimeFormat("ru-RU", {month: "long", year: "numeric"});
const pad = number => String(number).padStart(2, "0");
const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1);

let tasks = [];
let selected = dateKey(new Date());
let view = "week";
let editingId = null;

function dateKey(date) {
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
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

function tasksFor(key) {
  return tasks.filter(task => task.date === key).sort((a, b) => a.time.localeCompare(b.time));
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
    const entries = tasksFor(key);
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
    const previewLimit = isWeek ? 6 : 2;
    for (const task of entries.slice(0, previewLimit)) {
      const preview = element("span", "day-preview", task.time + " " + task.title);
      preview.classList.toggle("done", task.done);
      content.append(preview);
    }
    if (entries.length > previewLimit) {
      content.append(element("span", "day-more", "Ещё " + (entries.length - previewLimit)));
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
  const check = element("input");
  check.type = "checkbox";
  check.checked = task.done;
  check.dataset.check = task.id;
  check.setAttribute("aria-label", "Выполнено: " + task.title);
  check.addEventListener("change", () => {
    const done = check.checked;
    if (!save(previous => previous.map(entry => entry.id === task.id ? {...entry, done} : entry))) {
      check.checked = !done;
      return;
    }
    render();
    [...timeline.querySelectorAll("[data-check]")].find(input => input.dataset.check === task.id)?.focus({preventScroll: true});
    announce(done ? "Дело выполнено." : "Дело снова в плане.");
  });
  const edit = element("button");
  edit.type = "button";
  edit.title = "Изменить или перенести";
  edit.setAttribute("aria-label", "Изменить или перенести «" + task.title + "»");
  edit.append(element("time", "", task.time), element("span", "task-name", task.title));
  edit.addEventListener("click", () => openTask(task));
  row.append(check, edit);
  return row;
}

function renderAgenda(scroll, targetHour) {
  const entries = tasksFor(selected);
  const done = entries.filter(task => task.done).length;
  byId("day-title").textContent = capitalize(fullDate.format(atDate(selected)));
  byId("day-summary").textContent = entries.length ? "Выполнено " + done + " из " + entries.length : "Пока нет дел";

  const previousScroll = timeline.scrollTop;
  timeline.replaceChildren();
  for (let hour = 0; hour < 24; hour++) {
    const time = pad(hour) + ":00";
    const hourRow = element("div", "hour-row");
    hourRow.dataset.hour = hour;
    const content = element("div", "hour-content");
    for (const task of entries.filter(task => Number(task.time.slice(0, 2)) === hour)) {
      content.append(taskRow(task));
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
    const hour = targetHour ?? (entries.length ? Number(entries[0].time.slice(0, 2)) : 8);
    const row = timeline.children[hour];
    timeline.scrollTop = row.offsetTop - timeline.children[0].offsetTop;
  } else {
    timeline.scrollTop = previousScroll;
  }
}

function render(scroll = false, targetHour) {
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
  editingId = task?.id || null;
  byId("dialog-title").textContent = task ? "Изменить или перенести дело" : "Новое дело";
  byId("delete-task").hidden = !task;
  byId("form-error").hidden = true;
  titleInput.value = task?.title || "";
  dateInput.value = task?.date || selected;
  timeInput.value = task?.time || time;
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
  const fields = {title, date, time};
  const id = editingId;
  const moved = id && tasks.some(task => task.id === id && (task.date !== date || task.time !== time));
  if (!save(previous => id
    ? previous.map(task => task.id === id ? {...task, ...fields} : task)
    : [...previous, {id: crypto.randomUUID(), ...fields, done: false}])) return;
  dialog.close();
  selected = date;
  render(true, Number(time.slice(0, 2)));
  byId("add-day-task").focus({preventScroll: true});
  announce(moved ? "Дело перенесено." : "Дело сохранено.");
});

byId("delete-task").addEventListener("click", () => {
  if (!editingId || !save(previous => previous.filter(task => task.id !== editingId))) return;
  dialog.close();
  render();
  byId("add-day-task").focus({preventScroll: true});
  announce("Дело удалено.");
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
  }
});
load();
render(true);
