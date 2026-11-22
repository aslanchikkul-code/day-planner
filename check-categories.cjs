const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

function makeElement() {
  return {
    value: "",
    dataset: {},
    children: [],
    listeners: {},
    scrollTop: 0,
    parentElement: {},
    classList: {add() {}, remove() {}, toggle() {}},
    addEventListener(name, run) { this.listeners[name] = run; },
    append(...items) { this.children.push(...items); },
    prepend(...items) { this.children.unshift(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute() {},
    querySelector() { return null; },
    focus() {}
  };
}

function openPlanner(storage) {
  const elements = new Map(
    [...html.matchAll(/ id="([^"]+)"/g)].map(match => [match[1], makeElement()])
  );
  const context = vm.createContext({
    document: {createElement: makeElement, getElementById: id => elements.get(id), addEventListener() {}},
    window: {addEventListener() {}},
    localStorage: {getItem: () => storage.value, setItem: (_, value) => { storage.value = value; }},
    Option: function(label, value) { this.label = label; this.value = value; },
    confirm: () => true,
    setTimeout: () => 1,
    clearTimeout() {}
  });
  vm.runInContext(script, context);
  return {elements, run: source => vm.runInContext(source, context)};
}

const today = "2026-11-22";
const storage = { value: JSON.stringify([
  {id: "gym", title: "Тренировка", date: today, time: "09:00", done: true},
  {id: "weekly", title: "Силовая тренировка", date: today, time: "15:00", repeat: "weekly", occurrences: {
    [today]: {time: "16:30", done: true}
  }},
  {id: "work", title: "Работа", date: today, time: "18:00", category: "work", done: false}
]) };

let planner = openPlanner(storage);
assert.deepEqual(JSON.parse(storage.value).tasks.map(task => task.category), ["health", "health", "work"]);
assert.equal(planner.run('tasksFor("2026-11-22").find(task => task.seriesId === "weekly").category'), "health");

const manual = {value: storage.value};
let manualPlanner = openPlanner(manual);
manualPlanner.run('save(previous => previous.map(task => task.id === "gym" ? {...task, category: ""} : task))');
manualPlanner = openPlanner(manual);
assert.equal(manualPlanner.run('tasks.find(task => task.id === "gym").category'), "");

planner.run("renderCategoryList()");
const healthRow = planner.elements.get("category-list").children.find(row => row.children[0].textContent === "Здоровье");
healthRow.children[1].listeners.click();

const saved = JSON.parse(storage.value);
assert.equal(saved.categories.some(category => category.name === "Здоровье"), false);
assert.deepEqual(saved.tasks.map(task => task.category), ["", "", "work"]);
assert.equal(saved.tasks[0].done, true);
assert.equal(saved.tasks[1].occurrences[today].time, "16:30");
assert.equal(saved.tasks[1].occurrences[today].done, true);
assert.equal(saved.tasks[1].occurrences[today].category, "");

planner = openPlanner(storage);
planner.elements.get("category-filter").value = "none";
const uncategorized = planner.run('JSON.stringify(visibleTasksFor("2026-11-22").map(task => task.title))');
assert.deepEqual(JSON.parse(uncategorized), ["Тренировка", "Силовая тренировка"]);
assert.equal(JSON.parse(storage.value).categories.some(category => category.id === "health"), false);
console.log("OK: тренировки добавлены в «Здоровье», после удаления категории сохранены и видны в «Без категории».");
