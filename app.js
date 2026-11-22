"use strict";

const storageKey = "rhythm-day-planner-v1";
const backupFormat = "rhythm-planner";
const backupVersion = 2;
const defaultCategories = [
  {id: "work", name: "Работа"},
  {id: "health", name: "Здоровье"},
  {id: "home", name: "Дом"}
];
const byId = id => document.getElementById(id);
const grid = byId("date-grid");
const timeline = byId("timeline");
const dialog = byId("task-dialog");
const titleInput = byId("task-title");
const noteInput = byId("task-note");
const dateInput = byId("task-date");
const timeInput = byId("task-time");
const repeatInput = byId("task-repeat");
const durationInput = byId("task-duration");
const importantInput = byId("task-important");
const importantFilter = byId("important-only");
const defaultDuration = 30;
let settings = {defaultDuration};
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
let categories = defaultCategories;
let trainingGrouped = false;
const savedDate = localStorage.getItem("rhythm-selected-date");
let selected = savedDate && validDate(savedDate) ? savedDate : dateKey(new Date());
let view = localStorage.getItem("rhythm-calendar-view") === "month" ? "month" : "week";
let importantOnly = false;
let activeSection = "calendar";
const overduePageSize = 50;
let overdueLimit = overduePageSize;
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

function readData() {
  const data = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (Array.isArray(data)) return {tasks: data, categories: defaultCategories};
  if (!Array.isArray(data?.tasks) || !Array.isArray(data?.categories)) {
    throw new Error("Сохранённые данные имеют неизвестный формат.");
  }
  return {...data, settings: readSettings(data.settings)};
}

function announce(message, error = false) {
  const notice = byId("notice");
  notice.textContent = message;
  notice.classList.toggle("visible", error);
}

function save(change) {
  return saveData(previous => ({...previous, tasks: change(previous.tasks)}));
}

function saveData(change) {
  try {
    const previous = readData();
    const updated = {...previous, ...change(previous)};
    localStorage.setItem(storageKey, JSON.stringify(updated));
    ({tasks, categories, trainingGrouped = false} = updated);
    settings = readSettings(updated.settings);
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

const categoryFilter = byId("category-filter");
const taskCategory = byId("task-category");
const categoryDialog = byId("category-dialog");

function categoryOf(task) {
  return categories.find(category => category.id === task.category);
}

function fillCategories(select, firstOptions) {
  const previous = select.value;
  const options = firstOptions.concat(categories.map(({id, name}) => [id, name]));
  select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
  if (options.some(([value]) => value === previous)) select.value = previous;
}

const groupCategory = byId("group-category");
const groupQuery = byId("group-query");
let groupMatches = new Set();

function renderGroupPreview() {
  groupMatches = new Set();
  const query = queryText(groupQuery.value.trim());
  const found = query ? tasks.filter(task => queryText(task.title).includes(query)) : [];
  const list = byId("group-preview");
  list.replaceChildren();
  for (const task of found) {
    const row = element("li");
    const label = element("label", "group-choice");
    const check = element("input");
    check.type = "checkbox";
    check.checked = true;
    groupMatches.add(task.id);
    check.addEventListener("change", () => {
      if (check.checked) groupMatches.add(task.id);
      else groupMatches.delete(task.id);
      byId("apply-group-category").disabled = !groupMatches.size || !groupCategory.value;
    });
    const text = element("span", "", task.title + (task.repeat ? " · Вся серия" : " · " + task.date + " " + task.time)
      + " · " + (categoryOf(task)?.name || "Без категории"));
    label.append(check, text);
    row.append(label);
    list.append(row);
  }
  byId("group-count").textContent = query ? "Найдено дел или серий: " + found.length : "Введи часть названия дела.";
  byId("apply-group-category").disabled = !found.length || !groupCategory.value;
}

groupQuery.addEventListener("input", renderGroupPreview);
groupCategory.addEventListener("change", () => {
  byId("apply-group-category").disabled = !groupMatches.size || !groupCategory.value;
});
byId("apply-group-category").addEventListener("click", () => {
  const id = groupCategory.value;
  if (!id || !groupMatches.size) return;
  let changed = 0;
  let categoryExists = true;
  if (!saveData(data => {
    if (!data.categories.some(category => category.id === id)) {
      categoryExists = false;
      return data;
    }
    const grouped = data.tasks.map(task => {
      if (!groupMatches.has(task.id)) return task;
      changed++;
      const result = {...task, category: id};
      if (task.occurrences) {
        result.occurrences = Object.fromEntries(Object.entries(task.occurrences)
          .map(([date, patch]) => [date, {...patch, category: id}]));
      }
      return result;
    });
    return {...data, tasks: grouped};
  })) return;
  render();
  byId("category-status").textContent = categoryExists
    ? "Категория назначена. Дел или серий: " + changed + "."
    : "Категория уже удалена. Выбери другую.";
});

function renderCategoryControls() {
  fillCategories(categoryFilter, [["", "Все категории"], ["none", "Без категории"]]);
  fillCategories(taskCategory, [["", "Без категории"]]);
  fillCategories(groupCategory, [["", "Выбери категорию"]]);
}

function matchesCategory(task) {
  const id = categoryOf(task)?.id;
  return !categoryFilter.value || (categoryFilter.value === "none" ? !id : id === categoryFilter.value);
}

function replaceCategoryReferences(task, replace) {
  const result = {...task};
  if (task.category !== undefined) result.category = replace(task.category);
  if (task.occurrences) {
    result.occurrences = Object.fromEntries(Object.entries(task.occurrences).map(([key, patch]) => [
      key, patch.category === undefined ? patch : {...patch, category: replace(patch.category)}
    ]));
  }
  return result;
}

function renderCategoryList() {
  renderGroupPreview();
  const list = byId("category-list");
  list.replaceChildren();
  for (const category of categories) {
    const row = element("li", "category-row");
    const button = element("button", "secondary", "Удалить");
    button.type = "button";
    button.setAttribute("aria-label", "Удалить категорию «" + category.name + "»");
    button.addEventListener("click", () => {
      if (!confirm("Удалить категорию «" + category.name + "»? Дела останутся в календаре.")) return;
      if (!saveData(previous => ({
        categories: previous.categories.filter(entry => entry.id !== category.id),
        tasks: previous.tasks.map(task => replaceCategoryReferences(task, id => id === category.id ? "" : id))
      }))) {
        byId("category-status").textContent = "Не удалось удалить категорию.";
        return;
      }
      byId("category-status").textContent = "Категория удалена. Дела сохранены.";
      render();
      byId("category-name").focus();
    });
    row.append(element("span", "", category.name), button);
    list.append(row);
  }
}

byId("manage-categories").addEventListener("click", () => {
  byId("category-status").textContent = "";
  renderCategoryList();
  categoryDialog.showModal();
  byId("category-name").focus();
});
byId("close-categories").addEventListener("click", () => categoryDialog.close());
categoryFilter.addEventListener("change", () => render(true));
byId("category-form").addEventListener("submit", event => {
  event.preventDefault();
  const input = byId("category-name");
  const name = input.value.trim();
  const status = byId("category-status");
  if (!name || queryText(name) === queryText("Без категории")) {
    status.textContent = "Введи другое название категории.";
    return;
  }
  let exists = false;
  const added = saveData(previous => {
    exists = previous.categories.some(category => queryText(category.name) === queryText(name));
    if (exists) return previous;
    return {...previous, categories: [...previous.categories, {id: crypto.randomUUID(), name}]};
  });
  if (!added || exists) {
    status.textContent = exists ? "Категория с таким названием уже есть." : "Не удалось сохранить категорию.";
    return;
  }
  input.value = "";
  status.textContent = "Категория добавлена.";
  render();
});

function visibleTasksFor(key) {
  return tasksFor(key).filter(task => matchesCategory(task) && (!importantOnly || task.important));
}

function conflictingTitles(date, time, duration, editedId) {
  const start = timeInMinutes(time);
  const end = start + duration;
  const day = atDate(date);
  const overlapping = new Set();
  for (const offset of [-1, 0, 1]) {
    for (const task of tasksFor(dateKey(plusDays(day, offset)))) {
      if (task.id === editedId) continue;
      const otherStart = offset * minutesPerDay + timeInMinutes(task.time);
      const otherEnd = otherStart + durationOf(task);
      if (start < otherEnd && otherStart < end) overlapping.add(task.title);
    }
  }
  return overlapping;
}

function conflictMessage(titles) {
  return "Пересекается с делами: " + [...titles].map(title => "«" + title + "»").join(", ") + ".";
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

  const overlapping = conflictingTitles(date, time, duration, editingTask?.id);
  warning.hidden = overlapping.size === 0;
  warning.textContent = overlapping.size
    ? conflictMessage(overlapping) + " Можно сохранить."
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

let draggedTask;
let highlightedDay;

function highlightDropDay(day) {
  if (day === highlightedDay) return;
  highlightedDay?.classList.remove("drag-target");
  highlightedDay = day;
  highlightedDay?.classList.add("drag-target");
}

function endDrag() {
  draggedTask = undefined;
  highlightDropDay(undefined);
}

grid.addEventListener("dragstart", event => {
  const source = event.target.closest("[data-drag-task]");
  if (!source || !event.dataTransfer) return;
  draggedTask = {id: source.dataset.dragTask, date: source.closest(".calendar-day").dataset.date};
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedTask.id);
});

grid.addEventListener("dragover", event => {
  const day = event.target.closest(".calendar-day");
  if (!draggedTask || !day || day.dataset.date === draggedTask.date) {
    highlightDropDay(undefined);
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  highlightDropDay(day);
});

grid.addEventListener("dragleave", event => {
  if (highlightedDay && !highlightedDay.contains(event.relatedTarget)) highlightDropDay(undefined);
});
grid.addEventListener("dragend", endDrag);

grid.addEventListener("drop", event => {
  const target = event.target.closest(".calendar-day");
  if (!draggedTask) return;
  event.preventDefault();
  const {id, date} = draggedTask;
  const destination = target?.dataset.date;
  endDrag();
  if (!destination || destination === date) return;

  const task = tasksFor(date).find(entry => entry.id === id);
  if (!task) return;
  const overlapping = conflictingTitles(destination, task.time, durationOf(task), task.id);
  if (overlapping.size && !confirm(conflictMessage(overlapping) + " Всё равно перенести?")) return;

  if (!save(previous => updateTaskFields(previous, task, {date: destination}))) return;
  showOnCalendar({...task, date: destination});
  announce("Дело перенесено на " + fullDate.format(atDate(destination)) + " в " + task.time + ".");
});

function renderCalendar() {
  localStorage.setItem("rhythm-selected-date", selected);
  localStorage.setItem("rhythm-calendar-view", view);
  const date = atDate(selected);
  const week = monday(date);
  const lastDay = plusDays(week, 6);
  const firstOfMonth = new Date(date);
  firstOfMonth.setDate(1);
  const isWeek = view === "week";
  byId("jump-month").value = String(date.getMonth() + 1);
  byId("jump-year").value = date.getFullYear();
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
      preview.draggable = true;
      preview.dataset.dragTask = task.id;
      preview.title = "Перетащить на другой день: " + task.title;
      preview.classList.toggle("important", Boolean(task.important));
      if (task.important) preview.append(element("span", "important-star", "★ "));
      preview.append(task.time + " " + task.title);
      if (task.note) preview.append(element("span", "calendar-note", task.note));
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

function setTaskDone(task, done) {
  return save(previous => task.seriesId
    ? patchOccurrence(previous, task, {done})
    : previous.map(entry => entry.id === task.id ? {...entry, done} : entry));
}

function updateTaskFields(previous, task, fields) {
  return task.seriesId
    ? patchOccurrence(previous, task, fields)
    : previous.map(entry => entry.id === task.id ? {...entry, ...fields} : entry);
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
    if (!setTaskDone(task, done)) {
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
  const category = categoryOf(task);
  if (category) edit.append(element("span", "task-category", category.name));
  edit.addEventListener("click", () => openTask(task));
  if (task.note) edit.append(element("span", "task-note", task.note));
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
  setActiveSection("calendar");
  if (!matchesCategory(task)) categoryFilter.value = "";
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
  button.dataset.taskId = task.id;
  button.addEventListener("click", () => showOnCalendar(task));
  const text = element("span", "result-text");
  const title = element("strong", "", task.title);
  if (task.important) title.prepend(element("span", "important-star", "★ "));
  const date = atDate(task.date);
  const detail = capitalize(fullDate.format(date)) + " " + date.getFullYear() + " · " + timeRange(task);
  const period = task.repeat ? task.repeat === "daily" ? " · Ежедневно" : " · Еженедельно" : "";
  text.append(title, element("span", "result-detail", detail + period));
  if (task.note) text.append(element("span", "result-note", task.note));
  const overdue = !task.done && task.date < dateKey(new Date());
  const badge = element("span", task.done ? "result-badge done" : overdue ? "result-badge overdue" : "result-badge",
    task.done ? "Выполнено" : overdue ? "Просрочено" : "В плане");
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

function overdueTasks(today) {
  const entries = recordedTasks().filter(task => !task.done && task.date < today);
  for (const series of tasks) {
    if (!series.repeat || series.date >= today) continue;
    const step = series.repeat === "daily" ? 1 : 7;
    const patches = series.occurrences || {};
    let day = series.until && series.until < today ? atDate(series.until) : plusDays(atDate(today), -1);
    if (step === 7) {
      day = plusDays(day, -((day.getDay() - atDate(series.date).getDay() + 7) % 7));
    }
    // The newest entries from each series are enough to fill the visible list.
    let count = 0;
    while (dateKey(day) >= series.date && count <= overdueLimit) {
      const key = dateKey(day);
      if (!Object.hasOwn(patches, key)) {
        entries.push(occurrence(series, key));
        count++;
      }
      day = plusDays(day, -step);
    }
  }
  return entries.sort((a, b) => compareByDate(b, a));
}

function overdueRow(task) {
  const row = resultRow(task);
  const controls = element("div", "overdue-actions");
  const done = element("button", "secondary", "Отметить выполненным");
  done.type = "button";
  done.setAttribute("aria-label", "Отметить выполненным: " + task.title);
  done.addEventListener("click", () => {
    if (!setTaskDone(task, true)) return;
    const next = row.nextElementSibling?.querySelector(".result-row");
    const nextTitle = next?.dataset.taskId;
    render();
    const rows = byId("overdue-results").querySelectorAll("[data-task-id]");
    const focus = [...rows].find(button => button.dataset.taskId === nextTitle) || rows[0] || byId("show-overdue");
    focus.focus({preventScroll: true});
    announce("Дело перемещено в раздел «Выполнено».");
  });
  const move = element("button", "secondary", "Перенести");
  move.type = "button";
  move.setAttribute("aria-label", "Перенести: " + task.title);
  move.addEventListener("click", () => openTask(task));
  controls.append(done, move);
  row.append(controls);
  return row;
}

function renderOverdue() {
  const entries = overdueTasks(dateKey(new Date()));
  byId("overdue-results").replaceChildren(...entries.slice(0, overdueLimit).map(overdueRow));
  byId("overdue-empty").hidden = entries.length > 0;
  byId("more-overdue").hidden = entries.length <= overdueLimit;
}

byId("more-overdue").addEventListener("click", () => {
  const firstNew = overdueLimit;
  overdueLimit += overduePageSize;
  renderOverdue();
  byId("overdue-results").children[firstNew]?.querySelector(".result-row").focus();
});

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
  const matches = task => queryText(task.title + " " + (task.note || "")).includes(query);
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

const sections = {
  calendar: "Мой календарь",
  completed: "Выполненные дела",
  overdue: "Просроченные дела",
  summary: "Итоги недели"
};

for (const section of Object.keys(sections)) {
  byId("show-" + section).addEventListener("click", () => {
    setActiveSection(section);
    if (section === "overdue") overdueLimit = overduePageSize;
    clearSearch();
    render(section === "calendar");
  });
}

function setActiveSection(section) {
  if (!Object.hasOwn(sections, section)) return;
  activeSection = section;
  try {
    const data = readData();
    localStorage.setItem(storageKey, JSON.stringify({...data, activeSection: section}));
  } catch {}
}

function tasksForWeek(start) {
  const entries = [];
  for (let offset = 0; offset < 7; offset++) {
    entries.push(...tasksFor(dateKey(plusDays(start, offset))));
  }
  return entries;
}

function calendarText(value) {
  return value.replaceAll("\\", "\\\\").replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(",", "\\,").replaceAll(";", "\\;");
}

function foldCalendarLine(line) {
  const encoder = new TextEncoder();
  let result = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      result += "\r\n ";
      bytes = 1;
    }
    result += character;
    bytes += size;
  }
  return result;
}

function calendarDateTime(date, time) {
  return date.replaceAll("-", "") + "T" + time.replace(":", "") + "00";
}

function calendarFile(entries) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Rhythm//Personal Planner//RU", "CALSCALE:GREGORIAN"];
  for (const task of entries) {
    const end = timeInMinutes(task.time) + durationOf(task);
    const endDate = dateKey(plusDays(atDate(task.date), Math.floor(end / minutesPerDay)));
    const title = task.done ? "✓ " + task.title : task.title;
    lines.push("BEGIN:VEVENT", "UID:" + encodeURIComponent(task.id) + "@rhythm.local", "DTSTAMP:" + stamp,
      "DTSTART:" + calendarDateTime(task.date, task.time),
      "DTEND:" + calendarDateTime(endDate, clockTime(end)),
      "SUMMARY:" + calendarText(title));
    const description = [task.done ? "Выполнено в Ритме" : "", task.note || ""].filter(Boolean).join("\n");
    if (description) lines.push("DESCRIPTION:" + calendarText(description));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldCalendarLine).join("\r\n") + "\r\n";
}

byId("export-week").addEventListener("click", () => {
  const start = monday(atDate(selected));
  const entries = tasksForWeek(start);
  if (!entries.length) return;
  downloadFile(calendarFile(entries), "text/calendar;charset=utf-8", "rhythm-week-" + dateKey(start) + ".ics");
  announce("Неделя скачивается в файл календаря.");
});

function csvCell(value) {
  return '"' + String(value ?? "").replaceAll('"', '""') + '"';
}

function weekCsv(entries) {
  const rows = [["Название", "Дата", "Время", "Длительность (мин)", "Категория", "Важное", "Статус", "Заметка"]];
  for (const task of entries) {
    const status = task.done ? "Выполнено" : task.date < dateKey(new Date()) ? "Просрочено" : "Запланировано";
    rows.push([
      task.title,
      task.date,
      task.time,
      durationOf(task),
      categoryOf(task)?.name || "Без категории",
      task.important ? "Да" : "Нет",
      status,
      task.note || ""
    ]);
  }
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

byId("export-week-csv").addEventListener("click", () => {
  const start = monday(atDate(selected));
  const entries = tasksForWeek(start);
  if (!entries.length) return;
  downloadFile(weekCsv(entries), "text/csv;charset=utf-8", "rhythm-week-" + dateKey(start) + ".csv");
  announce("Неделя скачивается в таблицу CSV.");
});

function formatMinutes(total) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return minutes + " мин";
  return hours + " ч" + (minutes ? " " + minutes + " мин" : "");
}

function renderCategorySummary(entries) {
  const totals = new Map();
  for (const task of entries) {
    const category = categoryOf(task);
    const id = category?.id || "";
    if (!totals.has(id)) totals.set(id, {name: category?.name || "Без категории", planned: 0, done: 0});
    const total = totals.get(id);
    const duration = durationOf(task);
    total.planned += duration;
    if (task.done) total.done += duration;
  }

  const sorted = [...totals.values()].sort((a, b) => b.planned - a.planned || a.name.localeCompare(b.name, "ru"));
  const rows = sorted.map(total => {
    const row = element("li", "summary-category-row");
    const label = element("div", "summary-category-label");
    label.append(element("strong", "", total.name),
      element("span", "", formatMinutes(total.done) + " из " + formatMinutes(total.planned)));
    const progress = element("progress");
    progress.max = total.planned;
    progress.value = total.done;
    progress.setAttribute("aria-label", "Время выполненных дел в категории «" + total.name + "»");
    row.append(label, progress);
    return row;
  });
  byId("summary-category-list").replaceChildren(...rows);
  byId("summary-categories").hidden = rows.length === 0;
}

function renderSummary() {
  const start = monday(atDate(selected));
  const end = plusDays(start, 6);
  const today = dateKey(new Date());
  const range = start.getFullYear() === end.getFullYear()
    ? shortDate.format(start)
    : shortDate.format(start) + " " + start.getFullYear();
  byId("summary-range").textContent = range + " — " + shortDate.format(end) + " " + end.getFullYear() + " г.";

  const entries = tasksForWeek(start);
  renderCategorySummary(entries);
  const planned = entries.length;
  const done = entries.filter(task => task.done).length;
  const overdue = entries.filter(task => !task.done && task.date < today).length;
  byId("export-week").disabled = planned === 0;
  byId("export-week-csv").disabled = planned === 0;
  byId("summary-planned").textContent = planned;
  byId("summary-done").textContent = done;
  byId("summary-overdue").textContent = overdue;
  byId("summary-empty").hidden = planned > 0;
  byId("summary-progress-row").hidden = planned === 0;
  const progress = byId("summary-progress");
  progress.max = planned || 1;
  progress.value = done;
  byId("summary-progress-label").textContent = "Выполнено " + done + " из " + planned;
}

for (const [id, days] of [["summary-previous", -7], ["summary-next", 7]]) {
  byId(id).addEventListener("click", () => {
    selected = dateKey(plusDays(atDate(selected), days));
    renderSummary();
  });
}
byId("summary-today").addEventListener("click", () => {
  selected = dateKey(new Date());
  renderSummary();
});

function render(scroll = false, targetHour) {
  renderCategoryControls();
  if (categoryDialog.open) renderCategoryList();
  for (const section of Object.keys(sections)) {
    byId("show-" + section).setAttribute("aria-pressed", section === activeSection);
  }
  const calendarActive = activeSection === "calendar";
  byId("page-title").textContent = sections[activeSection];
  byId("calendar-range").hidden = !calendarActive;
  byId("calendar-controls").hidden = !calendarActive;
  byId("calendar-layout").hidden = !calendarActive;
  byId("completed-panel").hidden = activeSection !== "completed";
  byId("overdue-panel").hidden = activeSection !== "overdue";
  byId("summary-panel").hidden = activeSection !== "summary";
  renderSearch();
  if (!calendarActive) {
    if (activeSection === "completed") renderCompleted();
    else if (activeSection === "overdue") renderOverdue();
    else renderSummary();
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


function parseQuickTask(text, now = new Date()) {
  let remaining = text.trim();
  let date = "";
  let time = "";
  const relative = new Map([["сегодня", 0], ["завтра", 1], ["послезавтра", 2]]);
  const first = remaining.split(/\s+/, 1)[0].toLocaleLowerCase("ru");
  const numeric = first.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
  if (relative.has(first)) {
    date = dateKey(plusDays(now, relative.get(first)));
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(first)) {
    date = first;
  } else if (numeric) {
    const [, day, month, year = String(now.getFullYear())] = numeric;
    date = year + "-" + pad(month) + "-" + pad(day);
  }
  if (date) {
    if (!validDate(date)) throw new Error("Такой даты нет. Проверь день и месяц.");
    remaining = remaining.slice(first.length).trimStart();
  }

  const clock = remaining.match(/^(\d{1,2}):(\d{1,2})(?=\s|$)/);
  if (clock) {
    const [, hours, minutes] = clock;
    if (Number(hours) > 23 || Number(minutes) > 59) throw new Error("Укажи время от 00:00 до 23:59.");
    time = pad(hours) + ":" + pad(minutes);
    remaining = remaining.slice(clock[0].length).trimStart();
  } else if (/^\d+:/u.test(remaining)) {
    throw new Error("Проверь время. Например, 19:00.");
  }
  if (!remaining || remaining.length > 120) throw new Error("Добавь название дела длиной до 120 символов.");
  return {title: remaining, date, time};
}

const batchDialog = byId("batch-dialog");
const batchInput = byId("batch-input");
const batchSave = byId("save-batch");
let previewedBatch = [];

function clearBatchPreview() {
  previewedBatch = [];
  byId("batch-preview").replaceChildren();
  byId("batch-status").textContent = "";
  batchSave.disabled = true;
}

byId("open-batch").addEventListener("click", () => {
  batchDialog.showModal();
  batchInput.focus();
});
byId("close-batch").addEventListener("click", () => batchDialog.close());
batchInput.addEventListener("input", clearBatchPreview);

byId("preview-batch").addEventListener("click", () => {
  clearBatchPreview();
  const now = new Date();
  const lines = batchInput.value.split(/\r?\n/);
  for (const [index, text] of lines.entries()) {
    if (!text.trim()) continue;
    const entry = {line: index + 1, text};
    try {
      const plan = parseQuickTask(text, now);
      if (!plan.date || !plan.time) throw new Error("Укажи дату и время.");
      entry.plan = plan;
    } catch (error) {
      entry.error = error.message;
    }
    previewedBatch.push(entry);
  }

  const valid = previewedBatch.filter(entry => entry.plan);
  const starts = valid.map(({plan}) => Date.parse(plan.date + "T" + plan.time + ":00Z") / 60000);
  const rows = previewedBatch.map(entry => {
    const row = element("li", entry.error ? "batch-row batch-error" : "batch-row");
    row.append(element("strong", "", "Строка " + entry.line));
    if (entry.error) {
      row.append(element("span", "", entry.error + " «" + entry.text.trim() + "»"));
      return row;
    }
    const {plan} = entry;
    row.append(element("span", "", dateInputLabel(plan.date) + " · " + plan.time + " · " + plan.title));
    const conflicts = conflictingTitles(plan.date, plan.time, settings.defaultDuration);
    const index = valid.indexOf(entry);
    for (const [otherIndex, start] of starts.entries()) {
      if (otherIndex !== index && Math.abs(start - starts[index]) < settings.defaultDuration) {
        conflicts.add(valid[otherIndex].plan.title);
      }
    }
    if (conflicts.size) row.append(element("span", "batch-warning", conflictMessage(conflicts)));
    return row;
  });
  byId("batch-preview").replaceChildren(...rows);
  const errors = previewedBatch.length - valid.length;
  byId("batch-status").textContent = previewedBatch.length
    ? "Можно сохранить: " + valid.length + ". Строк с ошибками: " + errors + "."
    : "Вставь хотя бы одну строку с делом.";
  batchSave.disabled = valid.length === 0;
  batchSave.textContent = errors ? "Сохранить без строк с ошибками" : "Сохранить дела";
});

function dateInputLabel(key) {
  const date = atDate(key);
  return capitalize(fullDate.format(date)) + " " + date.getFullYear();
}

batchSave.addEventListener("click", () => {
  const valid = previewedBatch.filter(entry => entry.plan);
  if (!valid.length) return;
  const additions = valid.map(({plan}) => ({...plan, id: crypto.randomUUID(), duration: settings.defaultDuration, done: false}));
  if (!save(previous => previous.concat(additions))) {
    byId("batch-status").textContent = "Не удалось сохранить дела. Попробуй ещё раз.";
    return;
  }

  const remaining = previewedBatch.filter(entry => entry.error);
  batchInput.value = remaining.map(entry => entry.text).join("\n");
  clearBatchPreview();
  if (remaining.length) {
    render();
    byId("batch-status").textContent = "Добавлено дел: " + additions.length + ". Исправь оставшиеся строки и снова нажми «Предпросмотр».";
    batchInput.focus();
  } else {
    batchDialog.close();
    showOnCalendar(additions.sort(compareByDate)[0]);
    announce("Добавлено дел: " + additions.length + ".");
  }
});

function openTask(task, time = "09:00") {
  editingTask = task;
  taskCategory.value = task ? categoryOf(task)?.id || "" : categoryFilter.value === "none" ? "" : categoryFilter.value;
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
  noteInput.value = task?.note || "";
  dateInput.value = task?.date || selected;
  timeInput.value = task?.time || time;
  durationInput.value = task ? durationOf(task) : settings.defaultDuration;
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
  const fields = {title, date, time, note: noteInput.value.trim(), duration: durationInput.valueAsNumber, important: importantInput.checked, category: taskCategory.value};
  const task = editingTask;
  const moved = task && (task.date !== date || task.time !== time);
  if (!save(previous => {
    if (task) return updateTaskFields(previous, task, fields);
    const newTask = {id: crypto.randomUUID(), ...fields, done: false};
    if (repeatInput.value) newTask.repeat = repeatInput.value;
    return [...previous, newTask];
  })) return;
  dialog.close();
  selected = date;
  if (!task || activeSection !== "overdue") setActiveSection("calendar");
  render(true, Number(time.slice(0, 2)));
  byId(activeSection === "overdue" ? "show-overdue" : "add-day-task").focus({preventScroll: true});
  announce(moved ? "Дело перенесено." : "Дело сохранено.");
});

const undoToast = byId("undo-delete");
const restoreButton = byId("restore-task");
const undoWindow = 10000;
let pendingUndo;
let undoTimer;

function focusCurrentSection() {
  byId(activeSection === "calendar" ? "add-day-task" : "show-" + activeSection).focus({preventScroll: true});
}

function dismissUndo() {
  clearTimeout(undoTimer);
  pendingUndo = undefined;
  if (document.activeElement === restoreButton) focusCurrentSection();
  undoToast.hidden = true;
}

function offerUndo(restore) {
  clearTimeout(undoTimer);
  pendingUndo = {restore, expiresAt: Date.now() + undoWindow};
  undoToast.hidden = false;
  undoTimer = setTimeout(dismissUndo, undoWindow);
  announce("Дело удалено. В течение десяти секунд его можно вернуть.");
}

function restoreOccurrence(previous, task) {
  const series = previous.find(entry => entry.id === task.seriesId);
  const patch = series?.occurrences?.[task.seriesDate];
  if (!patch?.deleted || !repeatsOn(series, task.seriesDate)) return previous;
  const occurrences = {...series.occurrences};
  const {deleted, ...fields} = patch;
  if (Object.keys(fields).length) occurrences[task.seriesDate] = fields;
  else delete occurrences[task.seriesDate];
  return previous.map(entry => entry.id === series.id ? {...entry, occurrences} : entry);
}

restoreButton.addEventListener("click", () => {
  if (!pendingUndo || Date.now() >= pendingUndo.expiresAt) {
    dismissUndo();
    return;
  }
  let restored = false;
  if (!save(previous => {
    const updated = pendingUndo.restore(previous);
    restored = updated !== previous;
    return updated;
  })) return;
  dismissUndo();
  render();
  announce(restored ? "Дело возвращено." : "Это дело уже восстановлено или недоступно.");
});

byId("delete-task").addEventListener("click", () => {
  if (!editingTask) return;
  const task = editingTask;
  let restore;
  if (!save(previous => {
    if (task.seriesId) {
      const series = previous.find(entry => entry.id === task.seriesId);
      if (!series || !repeatsOn(series, task.seriesDate) || series.occurrences?.[task.seriesDate]?.deleted) return previous;
      restore = entries => restoreOccurrence(entries, task);
      return patchOccurrence(previous, task, {deleted: true});
    }
    const index = previous.findIndex(entry => entry.id === task.id);
    if (index === -1) return previous;
    const removed = previous[index];
    restore = entries => entries.some(entry => entry.id === removed.id)
      ? entries
      : [...entries.slice(0, index), removed, ...entries.slice(index)];
    return previous.filter(entry => entry.id !== task.id);
  })) return;
  dialog.close();
  render();
  if (restore) {
    offerUndo(restore);
    restoreButton.focus({preventScroll: true});
  } else {
    focusCurrentSection();
  }
});

byId("end-series").addEventListener("click", () => {
  const task = editingTask;
  if (!task?.seriesId || !confirm("Прекратить повтор после этого дела?")) return;
  if (!save(previous => previous.map(entry => entry.id === task.seriesId
    ? {...entry, until: entry.until && entry.until < task.seriesDate ? entry.until : task.seriesDate}
    : entry))) return;
  dialog.close();
  render();
  byId(activeSection === "overdue" ? "show-overdue" : "add-day-task").focus({preventScroll: true});
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
byId("print-calendar").addEventListener("click", () => window.print());
byId("today").addEventListener("click", () => {
  selected = dateKey(new Date());
  render(true);
});
const jumpMonth = byId("jump-month");
for (let month = 0; month < 12; month++) {
  jumpMonth.add(new Option(new Intl.DateTimeFormat("ru-RU", {month: "long"}).format(new Date(2020, month, 1)), String(month + 1)));
}
byId("month-jump-form").addEventListener("submit", event => {
  event.preventDefault();
  const year = byId("jump-year").valueAsNumber;
  const month = Number(jumpMonth.value);
  const day = atDate(selected).getDate();
  const lastDay = new Date(year, month, 0).getDate();
  selected = dateKey(new Date(year, month - 1, Math.min(day, lastDay)));
  view = "month";
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

const settingsDialog = byId("settings-dialog");
const settingsHours = byId("settings-hours");
const settingsMinutes = byId("settings-minutes");

byId("open-settings").addEventListener("click", () => {
  settingsHours.value = Math.floor(settings.defaultDuration / 60);
  settingsMinutes.value = settings.defaultDuration % 60;
  byId("settings-status").textContent = "";
  settingsDialog.showModal();
  settingsHours.focus();
});
byId("close-settings").addEventListener("click", () => settingsDialog.close());
byId("settings-form").addEventListener("submit", event => {
  event.preventDefault();
  const hours = settingsHours.valueAsNumber;
  const minutes = settingsMinutes.valueAsNumber;
  const duration = hours * 60 + minutes;
  if (!Number.isInteger(duration) || duration < 1 || duration > minutesPerDay) {
    byId("settings-status").textContent = "Укажи длительность от 1 минуты до 24 часов.";
    return;
  }
  if (!saveData(previous => ({...previous, settings: {defaultDuration: duration}}))) {
    byId("settings-status").textContent = "Не удалось сохранить настройки.";
    return;
  }
  clearBatchPreview();
  settingsDialog.close();
  announce("Настройки сохранены.");
});

function readSettings(value) {
  if (value === undefined) return {defaultDuration};
  if (!value || !Number.isInteger(value.defaultDuration) ||
      value.defaultDuration < 1 || value.defaultDuration > minutesPerDay) {
    throw new Error("Некорректные настройки.");
  }
  return {defaultDuration: value.defaultDuration};
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(atDate(value)) === value;
}

function validTaskFields(task, partial = false) {
  return (partial && task.title === undefined || typeof task.title === "string" && task.title.trim() && task.title.length <= 120)
    && (partial && task.date === undefined || validDate(task.date))
    && (partial && task.time === undefined || typeof task.time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.time))
    && (task.duration === undefined || Number.isInteger(task.duration) && task.duration >= 1 && task.duration <= minutesPerDay)
    && (task.done === undefined || typeof task.done === "boolean")
    && (task.important === undefined || typeof task.important === "boolean")
    && (task.note === undefined || typeof task.note === "string" && task.note.length <= 2000)
    && (task.category === undefined || typeof task.category === "string");
}

function restoreBackup(text) {
  const backup = JSON.parse(text);
  if (backup?.format !== backupFormat || ![1, backupVersion].includes(backup.version) || !Array.isArray(backup.tasks)) {
    throw new Error("Неизвестный формат резервной копии.");
  }
  const categories = backup.version === 1 ? [] : backup.categories;
  if (!Array.isArray(categories) || categories.some(category => !category ||
      typeof category.id !== "string" || !/^[a-z0-9_-]{1,100}$/i.test(category.id) || category.id === "none" ||
      typeof category.name !== "string" || !category.name.trim() || category.name.length > 35 ||
      queryText(category.name.trim()) === queryText("Без категории"))) {
    throw new Error("Некорректные категории.");
  }
  if (new Set(categories.map(category => category.id)).size !== categories.length) throw new Error("Повтор идентификатора категории.");
  const settings = backup.settings === undefined ? undefined : readSettings(backup.settings);
  const tasks = backup.tasks.map(task => {
    if (!task || typeof task.id !== "string" || !/^[a-z0-9_-]{1,100}$/i.test(task.id) || !validTaskFields(task)) {
      throw new Error("В копии есть некорректное дело.");
    }
    const result = {id: task.id, title: task.title, date: task.date, time: task.time, done: task.done ?? false};
    if (task.note !== undefined) result.note = task.note;
    if (task.duration !== undefined) result.duration = task.duration;
    if (task.important !== undefined) result.important = task.important;
    if (task.category !== undefined) result.category = task.category;
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
      for (const key of ["title", "date", "time", "duration", "important", "done", "deleted", "category", "note"]) {
        if (patch[key] !== undefined) result.occurrences[date][key] = patch[key];
      }
    }
    return result;
  });
  return {tasks, categories: categories.map(({id, name}) => ({id, name: name.trim()})), settings};
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
function downloadFile(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

byId("export-backup").addEventListener("click", () => {
  try {
    const data = readData();
    const backup = {format: backupFormat, version: backupVersion, tasks: data.tasks, categories: data.categories, settings: readSettings(data.settings)};
    downloadFile(JSON.stringify(backup, null, 2), "application/json", "rhythm-" + dateKey(new Date()) + ".json");
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
  if (!saveData(previous => {
    const mergedCategories = [...previous.categories];
    const categoryIds = new Map();
    for (const incoming of imported.categories) {
      const existing = mergedCategories.find(category => queryText(category.name) === queryText(incoming.name));
      const id = existing?.id || (mergedCategories.some(category => category.id === incoming.id) ? crypto.randomUUID() : incoming.id);
      categoryIds.set(incoming.id, id);
      if (!existing) mergedCategories.push({...incoming, id});
    }
    const knownIds = new Set(previous.tasks.map(task => task.id));
    const additions = imported.tasks.filter(task => {
      if (knownIds.has(task.id)) return false;
      knownIds.add(task.id);
      return true;
    });
    added = additions.length;
    const remapped = additions.map(task => replaceCategoryReferences(task, id => categoryIds.get(id) || ""));
    return {tasks: previous.tasks.concat(remapped), categories: mergedCategories, settings: imported.settings || readSettings(previous.settings)};
  })) {
    showBackupStatus("Не удалось сохранить дела в этом браузере.", true);
    return;
  }
  render();
  showBackupStatus("Добавлено дел: " + added + ". Уже были в календаре: " + (imported.tasks.length - added) + ".");
});

function isTraining(title) {
  return /(?:^|[^\p{L}])тренировк(?:а|и|у|е|ой|ою|ам|ами|ах)(?=$|[^\p{L}])/iu.test(title);
}

function groupExistingTraining(data) {
  const health = data.categories.find(category => queryText(category.name) === "здоровье");
  if (!health) return data.tasks;
  return data.tasks.map(task => {
    const isTrainingTask = isTraining(task.title);
    const grouped = isTrainingTask ? {...task, category: health.id} : {...task};
    if (task.occurrences) {
      grouped.occurrences = Object.fromEntries(Object.entries(task.occurrences).map(([date, patch]) => {
        if (isTraining(patch.title ?? task.title)) {
          return [date, {...patch, category: health.id}];
        }
        if (isTrainingTask && patch.category === undefined) {
          return [date, {...patch, category: task.category || ""}];
        }
        return [date, patch];
      }));
    }
    return grouped;
  });
}

function groupTrainingOnce() {
  if (trainingGrouped) return;
  saveData(data => data.trainingGrouped ? data : {
    ...data, tasks: groupExistingTraining(data), trainingGrouped: true
  });
}

function load() {
  try {
    const data = readData();
    ({tasks, categories, trainingGrouped = false} = data);
    settings = readSettings(data.settings);
    if (Object.hasOwn(sections, data.activeSection)) activeSection = data.activeSection;
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
let midnightTimer;
function scheduleDayChange() {
  clearTimeout(midnightTimer);
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  midnightTimer = setTimeout(() => {
    render();
    scheduleDayChange();
  }, midnight - now);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    render();
    scheduleDayChange();
  }
});

load();
groupTrainingOnce();
render(true);
scheduleDayChange();
