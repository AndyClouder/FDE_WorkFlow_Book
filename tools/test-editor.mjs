/** tools/test-editor.mjs — editor.html 运行时冒烟测试(vm 沙箱) */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function makeEl(id) {
  return {
    id, innerHTML: "", textContent: "", value: "", dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, fn) { (this._h ??= {})[type] = fn; },
    appendChild() {}, remove() {}, click() {},
    querySelectorAll() { return { forEach() {} }; }, querySelector() { return null; },
    scrollIntoView() {}, closest() { return null; }, files: []
  };
}
const els = {};
const document = {
  getElementById: (id) => els[id] || (els[id] = makeEl(id)),
  querySelectorAll: () => ({ forEach() {} }), querySelector: () => null,
  createElement: () => makeEl("tmp"), addEventListener() {},
  body: { style: {}, insertBefore() {}, innerHTML: "" }, documentElement: { style: {} }
};
const window = { FDE_CONFIG: null, innerWidth: 1400, addEventListener() {}, open() {} };
const ctx = {
  window, document, console, location: { search: "" },
  localStorage: { getItem: () => null, setItem() {} },
  alert() {}, confirm() { return true; }, prompt(m, def) { return def; },
  setTimeout, clearTimeout,
  URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
  Blob: function (parts) { this.parts = parts; },
  navigator: {}, getComputedStyle: () => ({ getPropertyValue: () => "#2563eb" }),
  fetch: () => Promise.reject(new Error("offline stub")) /* 服务探测桩:file:// 下视为无服务 */
};
ctx.window = window;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "data/config.js"), "utf8"), ctx);
window.FDE_CONFIG = ctx.window.FDE_CONFIG;

const scripts = [...fs.readFileSync(path.join(root, "editor.html"), "utf8")
  .matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
scripts.forEach((s) => vm.runInContext(s, ctx));

const R = vm.runInContext(`(
function(){
  var R = [];
  var $ = function(id){ return document.getElementById(id); };
  // 1 方法库树
  state.tab = "methods"; renderTree();
  R.push([($("treeScroll").innerHTML.match(/data-nav="method:/g) || []).length === 42, "方法库树 42 项"]);
  R.push([($("treeScroll").innerHTML.match(/data-nav="pitfall:/g) || []).length === 0, "坑位不混入方法树"]);
  // 2 坑位库
  state.tab = "pitfalls"; renderTree();
  R.push([($("treeScroll").innerHTML.match(/data-nav="pitfall:/g) || []).length === 8, "坑位库 8 项"]);
  // 3 校验:干净 0 错
  var res = validate();
  R.push([res.errs.length === 0, "干净配置 0 错误" + (res.errs.length ? "(" + res.errs[0] + ")" : "")]);
  // 4 悬空引用
  state.cfg.stages[2].steps[0].activities[0].ref = "nonexist";
  res = validate();
  R.push([res.errs.some(function (e) { return e.indexOf("nonexist") >= 0; }), "悬空方法引用被捕获"]);
  state.cfg.stages[2].steps[0].activities[0].ref = "sx";
  state.cfg.stages[0].pitfalls.push("nope");
  res = validate();
  R.push([res.errs.some(function (e) { return e.indexOf("nope") >= 0; }), "悬空坑位引用被捕获"]);
  state.cfg.stages[0].pitfalls.pop();
  // 5 阶段表单
  state.tab = "flow"; state.sel = { type: "stage", i: 2 }; renderAll();
  R.push([$("formPane").innerHTML.indexOf("出门禁") >= 0, "阶段表单含门禁区块"]);
  R.push([$("formPane").innerHTML.indexOf("检查清单") >= 0, "表单含检查清单"]);
  // 6 步骤表单(活动分组)
  state.sel = { type: "step", si: 2, pi: 3 }; renderAll();
  R.push([$("formPane").innerHTML.indexOf("关联方法") >= 0, "步骤表单含活动编辑"]);
  // 7 方法表单
  state.sel = { type: "method", k: "mvd" }; renderAll();
  R.push([$("formPane").innerHTML.indexOf("怎么用") >= 0, "方法表单渲染"]);
  // 8 坑位表单
  state.sel = { type: "pitfall", k: "k1" }; renderAll();
  R.push([$("formPane").innerHTML.indexOf("怎么堵") >= 0, "坑位表单渲染"]);
  // 9 导出回环
  var out = configJsContent(state.cfg);
  var m = out.match(/window\\.FDE_CONFIG\\s*=\\s*([\\s\\S]+?);\\s*$/);
  var back = JSON.parse(m[1]);
  R.push([back.stages.length === 7 && !!back.methods.mvd && !!back.pitfalls.k1, "导出 config.js 回环解析"]);
  // 10 新增阶段 → 校验仍 0 错、树多一项
  state.cfg.stages.push({ id: "s8new", color: "c7", title: "测试阶段", shortName: "8 · 测试", alias: "", goal: "", gate: { id: "G8", label: "测", short: "", text: "测试门禁", checklist: [] }, outputs: [], note: "", pitfalls: [], related: [], steps: [] });
  state.tab = "flow"; state.sel = null; renderAll();
  res = validate();
  R.push([res.errs.length === 0 && ($("treeScroll").innerHTML.match(/data-nav="stage:/g) || []).length === 8, "新增阶段后树 8 项且校验仍通过"]);
  state.cfg.stages.pop(); renderAll();
  // 11 全局/横切线表单
  state.tab = "meta"; state.sel = { type: "meta" }; renderAll();
  R.push([$("formPane").innerHTML.indexOf("主标题") >= 0, "全局表单渲染"]);
  state.sel = { type: "lane", li: 0 }; renderAll();
  R.push([$("formPane").innerHTML.indexOf("横切线") >= 0, "横切线表单渲染"]);
  return R;
}
)()`, ctx);

let fail = 0;
for (const [ok, name] of R) { console.log(ok ? "PASS" : "FAIL", name); if (!ok) fail++; }

/* ── 回归:删除单个活动 / 单个步骤(修复前为红)──
 * 反馈回路:捕获 treeFoot 的 click 监听器,直接以按钮事件调用,
 * 断言 ① 点击树中活动后 sel.type 仍是 "activity"(不被重定向成 step)
 *      ② fa-del 删除的恰好是那一个活动(步骤数、其余活动不动)
 *      ③ fa-del 选中 step 时只删该步骤(阶段数、其余步骤不动)
 * 注:state/els 均在 vm 沙箱内,断言需在沙箱里跑 */
const R2 = vm.runInContext(`(
function(){
  var R = [];
  var foot = document.getElementById("treeFoot");
  var footHandler = foot && foot._h && foot._h.click;
  if (typeof footHandler !== "function") {
    R.push([false, "treeFoot click 监听器未注册(测试桩失效)"]);
    return R;
  }
  function clickBtn(id){ footHandler({ target: { closest: function(){ return { id: id }; } } }); }

  // A. 选中活动 → sel 保持 activity,且表单按活动渲染
  state.tab = "flow";
  state.sel = { type: "activity", si: 0, pi: 0, ai: 1 };
  renderAll();
  R.push([state.sel.type === "activity", "选中活动后 sel 保持 activity(不被重定向为 step)"]);

  // B. 删除单个活动:只有目标活动消失
  var st0 = state.cfg.stages[0];
  var beforeActs = st0.steps[0].activities.map(function(a){ return a.text; });
  var stepCountBefore = st0.steps.length;
  clickBtn("fa-del");
  var afterActs = st0.steps[0].activities.map(function(a){ return a.text; });
  R.push([stepCountBefore === st0.steps.length
    && afterActs.length === beforeActs.length - 1
    && afterActs[0] === beforeActs[0]
    && afterActs.indexOf(beforeActs[1]) < 0
    && state.sel.type === "step" && state.sel.pi === 0,
    "fa-del 删除的是单个活动(步骤保留,编号顺延)"]);

  // C. 删除单个步骤:只有目标步骤消失
  state.sel = { type: "step", si: 0, pi: 1 };
  renderAll();
  var stagesBefore = state.cfg.stages.length;
  var stepsBefore = state.cfg.stages[0].steps.map(function(s){ return s.title; });
  clickBtn("fa-del");
  var stepsAfter = state.cfg.stages[0].steps.map(function(s){ return s.title; });
  R.push([stagesBefore === state.cfg.stages.length
    && stepsAfter.length === stepsBefore.length - 1
    && stepsAfter.indexOf(stepsBefore[1]) < 0
    && state.sel.type === "stage",
    "fa-del 删除的是单个步骤(阶段保留)"]);
  return R;
}
)()`, ctx);

for (const [ok, name] of R2) { console.log(ok ? "PASS" : "FAIL", name); if (!ok) fail++; }

console.log(fail === 0 ? "---- editor 冒烟测试全部通过" : `---- FAILED ${fail}`);
process.exit(fail ? 1 : 0);
