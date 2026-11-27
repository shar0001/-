// 実行: node tests/GlassLens.test.js GlassLens.jsx
// =====================================================================
// GlassLens.jsx 厳密検証ハーネス
//  - AE の挙動を厳しめに再現したモック上でスクリプトと UI を実行
//    * エフェクト/シェイプ要素の追加・削除・3D切替で同レイヤーの古い参照を無効化
//    * ロック中レイヤーの変更はエラー
//    * エクスプレッションは「設定した瞬間」と「最終状態」の両方で実際に評価
//  - 全エクスプレッションを評価し、値・座標変換の正しさを数値で検証
//  - ScriptUI をモックし、全ボタン/ドロップダウン/チェックボックスを操作
// =====================================================================
const fs = require('fs');
const SRC = fs.readFileSync(process.argv[2], 'utf8').replace(/^﻿/, '');

let failures = [], passes = 0, alerts = [];
function check(cond, msg) { if (cond) passes++; else failures.push(msg); }
function near(a, b, eps = 1e-6) {
  if (Array.isArray(a) || Array.isArray(b)) { if (!Array.isArray(a) || !Array.isArray(b)) return false; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (Math.abs(a[i] - b[i]) > eps) return false; return true; }
  return Math.abs(a - b) <= eps;
}

// ------------------------------------------------------------------ enums
const PropertyType = { PROPERTY: 6212, INDEXED_GROUP: 6213, NAMED_GROUP: 6214 };
const BlendingMode = { NORMAL: 'NORMAL', ADD: 'ADD', SUBTRACT: 'SUBTRACT', LIGHTEN: 'LIGHTEN' };
const TrackMatteType = { NO_TRACK_MATTE: 'NONE', ALPHA: 'ALPHA', ALPHA_INVERTED: 'ALPHA_INV' };

// ------------------------------------------------------------------ properties
class Prop {
  constructor(mn, type, layer, parent, name) { Object.assign(this, { matchName: mn, propertyType: type, layer, parent, name: name || mn, children: [], value: 0, expr: '', exprEnabled: true, dead: false, numKeys: 0, dimensionsSeparated: false }); }
}
const EFFECT_PARAMS = {
  'ADBE Slider Control': [['ADBE Slider Control-0001', 0]],
  'ADBE Checkbox Control': [['ADBE Checkbox Control-0001', 0]],
  'ADBE Fill': [['ADBE Fill-0001', 0], ['ADBE Fill-0007', 0], ['ADBE Fill-0002', [1, 0, 0, 1]], ['ADBE Fill-0006', 0], ['ADBE Fill-0003', 0], ['ADBE Fill-0004', 0], ['ADBE Fill-0005', 100]],
  'ADBE Box Blur2': [['ADBE Box Blur2-0001', 0], ['ADBE Box Blur2-0002', 1], ['ADBE Box Blur2-0003', 1], ['ADBE Box Blur2-0004', 0]],
  'ADBE Geometry2': [['ADBE Geometry2-0001', [0, 0]], ['ADBE Geometry2-0002', [0, 0]], ['ADBE Geometry2-0011', 1], ['ADBE Geometry2-0003', 100], ['ADBE Geometry2-0004', 100], ['ADBE Geometry2-0005', 0], ['ADBE Geometry2-0006', 0], ['ADBE Geometry2-0007', 0], ['ADBE Geometry2-0008', 100], ['ADBE Geometry2-0009', 1], ['ADBE Geometry2-0010', 0], ['ADBE Geometry2-0012', 1]],
  'ADBE Displacement Map': [1, 2, 3, 4, 5, 6, 7, 8].map(i => ['ADBE Displacement Map-000' + i, 0]),
  'ADBE Shift Channels': [['ADBE Shift Channels-0001', 1], ['ADBE Shift Channels-0002', 2], ['ADBE Shift Channels-0003', 3], ['ADBE Shift Channels-0004', 4]],
};
const NAMED = { 'ADBE Slider Control': 'Slider Control', 'ADBE Checkbox Control': 'Checkbox Control', 'ADBE Fill': 'Fill', 'ADBE Box Blur2': 'Fast Box Blur', 'ADBE Geometry2': 'Transform', 'ADBE Displacement Map': 'Displacement Map', 'ADBE Shift Channels': 'Shift Channels', 'ADBE Vector Filter - Offset': 'Offset Paths' };
function mkGroup(mn, layer, parent, kids, name, type = PropertyType.NAMED_GROUP) {
  const g = new Prop(mn, type, layer, parent, name);
  (kids || []).forEach(k => { const c = Array.isArray(k) ? Object.assign(new Prop(k[0], PropertyType.PROPERTY, layer, g), { value: k[1] }) : k(g); g.children.push(c); });
  return g;
}
function mkEffect(mn, layer, parent) {
  if (!EFFECT_PARAMS[mn]) throw new Error('Mock: unknown effect ' + mn);
  return mkGroup(mn, layer, parent, EFFECT_PARAMS[mn], NAMED[mn], PropertyType.INDEXED_GROUP);
}
function setLayerRec(p, layer) { p.layer = layer; p.children.forEach(c => setLayerRec(c, layer)); }
function cloneProp(p, layer, parent) { const c = new Prop(p.matchName, p.propertyType, layer, parent, p.name); Object.assign(c, { value: JSON.parse(JSON.stringify(p.value)), expr: p.expr, numKeys: p.numKeys, dimensionsSeparated: p.dimensionsSeparated }); c.children = p.children.map(k => cloneProp(k, layer, c)); return c; }

// ハンドル: 取得時のレイヤー世代を記録し、構造変更後のアクセスは "Object is invalid"
const exprLog = [];
class PH {
  constructor(p) { this._p = p; this._g = p.layer ? p.layer.gen : 0; }
  _c(write) {
    const p = this._p;
    if (p.dead || (p.layer && p.layer.gen !== this._g)) throw new Error('Object is invalid (' + p.matchName + ')');
    if (write && p.layer && p.layer.locked) throw new Error('Cannot modify locked layer "' + p.layer.name + '"');
    return p;
  }
  get matchName() { return this._c().matchName; }
  get name() { return this._c().name; }
  set name(v) { this._c(true).name = v; }
  get propertyType() { return this._c().propertyType; }
  get numProperties() { return this._c().children.length; }
  get canSetExpression() { return this._c().propertyType === PropertyType.PROPERTY; }
  get value() { return this._c().value; }
  get numKeys() { return this._c().numKeys; }
  get dimensionsSeparated() { return this._c().dimensionsSeparated; }
  set dimensionsSeparated(v) { const p = this._c(true); p.dimensionsSeparated = v; p.layer.gen++; }
  get expression() { return this._c().expr; }
  set expression(e) {
    const p = this._c(true);
    if (p.propertyType !== PropertyType.PROPERTY) throw new Error('Cannot set expression on group');
    p.expr = e; p.exprEnabled = true;
    // AE と同様、設定時に評価してエラーなら無効化
    try { evalProp(p); } catch (err) { p.exprEnabled = false; exprLog.push({ where: fullPath(p), err: err.message, expr: e }); }
  }
  property(k) {
    const p = this._c();
    const c = typeof k === 'number' ? p.children[k - 1] : (p.children.find(x => x.matchName === k) || p.children.find(x => x.name === k));
    return c ? new PH(c) : null;
  }
  setValue(v) {
    const p = this._c(true); if (p.propertyType !== PropertyType.PROPERTY) throw new Error('setValue on group'); if (p.numKeys > 0) throw new Error('setValue on keyframed property');
    // レイヤー型パラメータ: AE は設定時のレイヤーそのものを参照し、並べ替えに追従する
    if (p.matchName === 'ADBE Displacement Map-0001') { const tgt = p.layer.comp.layers[v - 1]; if (!tgt) throw new Error('layer index out of range'); p.value = { __layer: tgt }; return; }
    p.value = v;
  }
  addProperty(mn) {
    const p = this._c(true);
    let c;
    if (p.matchName === 'ADBE Effect Parade') c = mkEffect(mn, p.layer, p);
    else if (mn === 'ADBE Vector Filter - Offset') c = mkGroup(mn, p.layer, p, [['ADBE Vector Offset Amount', 0], ['ADBE Vector Offset Line Join', 1], ['ADBE Vector Offset Miter Limit', 4]], 'Offset Paths 1');
    else throw new Error('Mock: cannot add ' + mn + ' to ' + p.matchName);
    p.children.push(c); p.layer.gen++;
    return new PH(c);
  }
  remove() { const p = this._c(true); p.parent.children.splice(p.parent.children.indexOf(p), 1); p.dead = true; p.layer.gen++; }
}
function fullPath(p) { const a = []; let q = p; while (q && q.parent) { a.unshift(q.name); q = q.parent; } return (p.layer ? '[' + p.layer.comp.name + '] ' + p.layer.name + ' > ' : '') + a.join(' > '); }

// ------------------------------------------------------------------ layers / items
let nextId = 1;
const project = { items_: [], bitsPerChannel: 8, activeItem: null };
class FolderItem { constructor(name) { this.name = name; this.id = nextId++; } }
class SolidSource { constructor(c) { this.color = c; } }
class FootageItem {
  constructor(name, color) { this.name = name; this.id = nextId++; this.mainSource = new SolidSource(color); }
  get usedIn() { return project.items_.filter(i => i instanceof CompItem && i.layers.some(l => l.source === this)); }
  remove() { project.items_.splice(project.items_.indexOf(this), 1); }
}
const LOCK_FREE = new Set(['locked', 'selected', 'gen', '_t', 'comp']);
function makeLayer(comp, name, opts = {}) {
  const t = {
    comp, gen: 0, id: nextId++, name, matchName: opts.matchName || 'ADBE AV Layer', comment: '', enabled: true, shy: false, locked: false, selected: false,
    adjustmentLayer: false, blendingMode: 'NORMAL', _three: false, startTime: 0, inPoint: 0, outPoint: comp.duration, parent: null, source: opts.source || null,
    trackMatteType: 'NONE', matteLayer: null, srcRect: opts.srcRect || null, root: null,
  };
  t.root = mkGroup('ROOT', t, null, []);
  if (t.matchName === 'ADBE Vector Layer') t.root.children.push(opts.contents(t, t.root));
  t.root.children.push(mkGroup('ADBE Transform Group', t, t.root, [['ADBE Anchor Point', [0, 0]], ['ADBE Position', [comp.width / 2, comp.height / 2]], ['ADBE Position_0', 0], ['ADBE Position_1', 0], ['ADBE Scale', [100, 100]], ['ADBE Rotate Z', 0], ['ADBE Opacity', 100]]));
  t.root.children.push(mkGroup('ADBE Effect Parade', t, t.root, [], 'Effects', PropertyType.INDEXED_GROUP));
  const api = {
    get index() { return comp.layers.indexOf(proxy) + 1; },
    get containingComp() { return comp; },
    get threeDLayer() { return t._three; },
    set threeDLayer(v) { if (t.locked) throw new Error('locked'); t._three = v; t.gen++; },
    get hasTrackMatte() { return t.trackMatteType !== 'NONE'; },
    property(k) { const c = typeof k === 'number' ? t.root.children[k - 1] : t.root.children.find(x => x.matchName === k || x.name === k); return c ? new PH(c) : null; },
    remove() { if (t.locked) throw new Error('Cannot remove locked layer ' + t.name); comp.layers.splice(comp.layers.indexOf(proxy), 1); t.dead = true; },
    moveAfter(l) { comp.layers.splice(comp.layers.indexOf(proxy), 1); comp.layers.splice(comp.layers.indexOf(l) + 1, 0, proxy); },
    moveBefore(l) { comp.layers.splice(comp.layers.indexOf(proxy), 1); comp.layers.splice(comp.layers.indexOf(l), 0, proxy); },
    duplicate() { const d = cloneLayer(proxy, comp); comp.layers.splice(comp.layers.indexOf(proxy), 0, d); return d; },
    copyToComp(c) { const d = cloneLayer(proxy, c); d._t.parent = null; c.layers.unshift(d); },
  };
  if (!opts.legacy) api.setTrackMatte = function (m, type) { if (t.locked) throw new Error('locked'); if (m.containingComp !== comp) throw new Error('matte must be in same comp'); t.matteLayer = m; t.trackMatteType = type; };
  const proxy = new Proxy(t, {
    get(o, k) { if (k === '_t') return t; if (k in api) { const d = Object.getOwnPropertyDescriptor(api, k); return d.get ? d.get.call(proxy) : api[k]; } return o[k]; },
    set(o, k, v) {
      if (k in api) { const d = Object.getOwnPropertyDescriptor(api, k); if (d.set) { d.set.call(proxy, v); return true; } throw new Error('read-only ' + String(k)); }
      if (o.locked && !LOCK_FREE.has(k)) throw new Error('Cannot set "' + String(k) + '" on locked layer "' + o.name + '"');
      if (k === 'trackMatteType' && v !== 'NONE') { const above = comp.layers[comp.layers.indexOf(proxy) - 1]; if (!above) throw new Error('no layer above for track matte'); o.matteLayer = above; }
      o[k] = v; return true;
    },
  });
  return proxy;
}
function cloneLayer(src, comp) {
  const s = src._t;
  const d = makeLayer(comp, s.name, { matchName: s.matchName, contents: () => mkGroup('X', null, null, []), source: s.source, srcRect: s.srcRect, legacy: !src.setTrackMatte });
  const t = d._t;
  Object.assign(t, { comment: s.comment, enabled: s.enabled, shy: s.shy, locked: s.locked, adjustmentLayer: s.adjustmentLayer, blendingMode: s.blendingMode, _three: s._three, startTime: s.startTime, inPoint: s.inPoint, outPoint: s.outPoint, parent: s.parent });
  t.root = cloneProp(s.root, t, null); setLayerRec(t.root, t); t.root.parent = null;
  return d;
}
class CompItem {
  constructor(name, w, h, pa, dur, fps) {
    Object.assign(this, { name, width: w, height: h, pixelAspect: pa || 1, duration: dur || 10, frameRate: fps || 30, id: nextId++, comment: '', hideShyLayers: false, parentFolder: null, layers: [] });
    const comp = this;
    this.layers.addSolid = (col, name, w2, h2) => { const f = new FootageItem(name, col); project.items_.push(f); const l = makeLayer(comp, name, { source: f, legacy: LEGACY }); comp.layers.unshift(l); return l; };
    this.layers.add = (item) => { const l = makeLayer(comp, item.name, { source: item, legacy: LEGACY }); comp.layers.unshift(l); return l; };
  }
  get numLayers() { return this.layers.length; }
  layer(i) { return typeof i === 'number' ? this.layers[i - 1] : this.layers.find(l => l.name === i); }
  get selectedLayers() { return this.layers.filter(l => l.selected); }
  remove() {
    project.items_.forEach(i => { if (i instanceof CompItem) for (let k = i.layers.length - 1; k >= 0; k--) if (i.layers[k].source === this) { i.layers[k]._t.locked = false; i.layers.splice(k, 1); } });
    project.items_.splice(project.items_.indexOf(this), 1);
  }
}
let LEGACY = false;
project.items = {
  addComp: (n, w, h, pa, d, f) => { const c = new CompItem(n, w, h, pa, d, f); project.items_.push(c); return c; },
  addFolder: n => { const f = new FolderItem(n); project.items_.push(f); return f; },
};
Object.defineProperty(project, 'numItems', { get() { return this.items_.length; } });
project.item = i => project.items_[i - 1];

// ------------------------------------------------------------------ expression engine (mock)
function compByName(n) { const c = project.items_.find(i => i instanceof CompItem && i.name === n); if (!c) throw new Error('comp("' + n + '") not found'); return c; }
function resolveChild(p, k) {
  const c = typeof k === 'number' ? p.children[k - 1] : (p.children.find(x => x.matchName === k) || p.children.find(x => x.name === k));
  if (!c) throw new Error('property "' + k + '" not found under ' + p.matchName);
  return c;
}
let evalDepth = 0;
function evalProp(p) {
  if (!p.expr || !p.exprEnabled) return p.value;
  if (++evalDepth > 40) { evalDepth = 0; throw new Error('expression recursion'); }
  try { return evalExpr(p.expr, p.layer); } finally { evalDepth--; }
}
function layerParamIndex(v) { return v && v.__layer ? v.__layer.index : v; }
function tval(L, mn) { return evalProp(L.root.children.find(c => c.matchName === 'ADBE Transform Group').children.find(c => c.matchName === mn)); }
function groupFn(p) {
  if (p.propertyType === PropertyType.PROPERTY) return evalProp(p);
  const f = k => groupFn(resolveChild(p, k));
  f.__prop = p;
  return f;
}
function rot(v, deg) { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; }
// レイヤー座標 → コンプ座標（2D、親子付け込み）
function toComp(L, pt) {
  const a = tval(L, 'ADBE Anchor Point'), pos = tval(L, 'ADBE Position'), sc = tval(L, 'ADBE Scale'), r = tval(L, 'ADBE Rotate Z');
  let v = [(pt[0] - a[0]) * sc[0] / 100, (pt[1] - a[1]) * sc[1] / 100];
  v = rot(v, r); v = [v[0] + pos[0], v[1] + pos[1]];
  return L.parent ? toComp(L.parent._t, v) : v;
}
function layerFn(L) {
  const f = k => groupFn(resolveChild(L.root, k));
  f.transform = { get anchorPoint() { return tval(L, 'ADBE Anchor Point'); }, get position() { return tval(L, 'ADBE Position'); }, get opacity() { return tval(L, 'ADBE Opacity'); } };
  f.effect = n => { const parade = L.root.children.find(c => c.matchName === 'ADBE Effect Parade'); return groupFn(resolveChild(parade, n)); };
  f.toComp = (p) => { const r = toComp(L, p); return [r[0], r[1], 0]; };
  f.sourceRectAtTime = () => { if (!L.srcRect) throw new Error('sourceRectAtTime on non-shape'); return L.srcRect; };
  return f;
}
function compFn(c) { return { name: c.name, width: c.width, height: c.height, layer: n => { const l = c.layers.find(x => x.name === n); if (!l) throw new Error('layer("' + n + '") not found in ' + c.name); return layerFn(l._t); } }; }
const vadd = (a, b) => { const n = Math.max(a.length, b.length); const r = []; for (let i = 0; i < n; i++) r.push((a[i] || 0) + (b[i] || 0)); return r; };
const vsub = (a, b) => { const n = Math.max(a.length, b.length); const r = []; for (let i = 0; i < n; i++) r.push((a[i] || 0) - (b[i] || 0)); return r; };
function evalExpr(code, owner) {
  const env = { comp: n => compFn(compByName(n)), thisComp: compFn(owner.comp), thisLayer: layerFn(owner), time: 0, add: vadd, sub: vsub,
    length: (a, b) => { const v = b ? vsub(a, b) : a; return Math.hypot(...v); }, radiansToDegrees: r => r * 180 / Math.PI };
  const fn = new Function(...Object.keys(env), '"use strict";return eval(' + JSON.stringify(code) + ')');
  const v = fn(...Object.values(env));
  if (typeof v === 'function') throw new Error('expression returned a property group');
  if (v === undefined || (typeof v === 'number' && !isFinite(v)) || (Array.isArray(v) && v.some(x => typeof x !== 'number' || !isFinite(x)))) throw new Error('bad value ' + JSON.stringify(v));
  return v;
}

// ------------------------------------------------------------------ ScriptUI (mock)
class Ctl {
  constructor(type, text, props) { this.type = type; this.text = Array.isArray(text) ? '' : text; this.children = []; this.preferredSize = [0, 0]; this.value = false; this.layout = { layout() {}, resize() {} };
    if (type === 'dropdownlist') { this.items = text.map((t, i) => ({ text: t, index: i })); this._sel = null; } }
  add(type, bounds, text, props) { const c = new Ctl(type, text, props); this.children.push(c); return c; }
  set selection(v) { this._sel = typeof v === 'number' ? this.items[v] : v; }
  get selection() { return this._sel; }
  find(pred) { if (pred(this)) return this; for (const c of this.children) { const r = c.find(pred); if (r) return r; } return null; }
  all(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach(c => c.all(pred, out)); return out; }
}
class Panel extends Ctl { constructor() { super('panel', ''); } }
class Window extends Ctl { constructor(type, title) { super('window', title); } center() {} show() { this.shown = true; } }

// ------------------------------------------------------------------ globals & load
Object.assign(global, { app: { project, beginUndoGroup() {}, endUndoGroup() {} }, PropertyType, BlendingMode, TrackMatteType, CompItem, FolderItem, SolidSource, Panel, Window,
  alert: m => alerts.push(m), $: { global: globalThis }, __GLASSLENS_TEST__: true });
eval(SRC);
const GL = globalThis.__GLASSLENS__;

// ------------------------------------------------------------------ scene
let uid = 1000;
function shapeContents(layer, root) {
  // グループ2つ（同名）: 楕円 + 長方形、塗り/線つき
  const R = mkGroup('ADBE Root Vectors Group', layer, root, [], 'Contents', PropertyType.INDEXED_GROUP);
  const grp = (name, shapeMn, shapeProps) => mkGroup('ADBE Vector Group', layer, R, [
    ['ADBE Vector Blend Mode', 1],
    g => mkGroup('ADBE Vectors Group', layer, g, [
      g2 => mkGroup(shapeMn, layer, g2, shapeProps.map(p => [p, uid++])),
      g2 => mkGroup('ADBE Vector Graphic - Fill', layer, g2, [['ADBE Vector Fill Color', [uid++, 0, 0, 1]], ['ADBE Vector Fill Opacity', uid++]]),
      g2 => mkGroup('ADBE Vector Graphic - Stroke', layer, g2, [['ADBE Vector Stroke Color', [uid++, 1, 1, 1]], ['ADBE Vector Stroke Width', uid++]]),
    ], 'Contents', PropertyType.INDEXED_GROUP),
    g => mkGroup('ADBE Vector Transform Group', layer, g, [['ADBE Vector Anchor', [uid++, 0]], ['ADBE Vector Position', [uid++, 0]], ['ADBE Vector Scale', [uid++, 100]], ['ADBE Vector Rotation', uid++], ['ADBE Vector Group Opacity', uid++]]),
  ], name);
  R.children.push(grp('Shape', 'ADBE Vector Shape - Ellipse', ['ADBE Vector Ellipse Size', 'ADBE Vector Ellipse Position']));
  R.children.push(grp('Shape', 'ADBE Vector Shape - Rect', ['ADBE Vector Rect Size', 'ADBE Vector Rect Position', 'ADBE Vector Rect Roundness']));
  return R;
}
function newScene(opts = {}) {
  project.items_ = []; project.bitsPerChannel = 8; alerts = []; exprLog.length = 0;
  const main = project.items.addComp(opts.compName || 'Main', 1080, 1920, 1, 10, 30);
  if (opts.dupCompName) project.items.addComp(opts.compName || 'Main', 100, 100, 1, 1, 30);
  project.activeItem = main;
  const bg = makeLayer(main, 'BG', { legacy: LEGACY });
  const nul = makeLayer(main, 'Parent Null', { legacy: LEGACY });
  const shp = makeLayer(main, opts.shapeName || 'Ball', { matchName: 'ADBE Vector Layer', contents: shapeContents, srcRect: { left: -100, top: -150, width: 200, height: 300 }, legacy: LEGACY });
  main.layers.push(shp, nul, bg);
  const T = shp._t.root.children.find(c => c.matchName === 'ADBE Transform Group');
  const set = (mn, v) => { T.children.find(c => c.matchName === mn).value = v; };
  set('ADBE Anchor Point', [10, 20]); set('ADBE Position', [600, 900]); set('ADBE Scale', [120, -80]); set('ADBE Rotate Z', 30); set('ADBE Opacity', 80);
  if (opts.parent) {
    shp._t.parent = nul;
    const NT = nul._t.root.children.find(c => c.matchName === 'ADBE Transform Group');
    NT.children.find(c => c.matchName === 'ADBE Position').value = [300, 200];
    NT.children.find(c => c.matchName === 'ADBE Rotate Z').value = -15;
    NT.children.find(c => c.matchName === 'ADBE Scale').value = [150, 150];
  }
  if (opts.locked) shp._t.locked = true;
  if (opts.separated) T.children.find(c => c.matchName === 'ADBE Position').dimensionsSeparated = true;
  return { main, shp, bg, nul };
}
const L = (comp, prefix) => comp.layers.find(l => l.name.indexOf(prefix) === 0);
const fx = (layer, name) => layer._t.root.children.find(c => c.matchName === 'ADBE Effect Parade').children.find(e => e.name === name);
const pv = (fxp, mn) => evalProp(fxp.children.find(c => c.matchName === mn));
const tv = (layer, mn) => tval(layer._t, mn);
const ctrl = (shp, key) => evalProp(fx(shp, GL.CTRL[key]).children[0]);
function setCtrl(shp, key, v) { fx(shp, GL.CTRL[key]).children[0].value = v; }

// ------------------------------------------------------------------ verification of a built rig
function verifyRig(tag, s, extra = {}) { try { verifyRig0(tag, s, extra); } catch (e) { check(false, `${tag}: verify crashed: ${e.message}`); } }
function verifyRig0(tag, s, extra = {}) {
  const { main, shp } = s;
  const name = shp.name, sfx = ' - ' + name;
  const order = main.layers.map(l => l.name);
  const want = [name, 'GL Rim Inner' + sfx, 'GL Rim' + sfx, 'GL Disp B' + sfx, 'GL Disp R' + sfx, 'GL Lens' + sfx, 'GL Map' + sfx];
  if (!LEGACY) check(JSON.stringify(order.slice(0, 7)) === JSON.stringify(want), `${tag}: layer order ${JSON.stringify(order)}`);
  const lens = L(main, 'GL Lens'), dR = L(main, 'GL Disp R'), dB = L(main, 'GL Disp B'), rim = main.layer('GL Rim' + sfx), rimIn = L(main, 'GL Rim Inner'), map = L(main, 'GL Map');
  check(lens && dR && dB && rim && rimIn && map, `${tag}: rig layers exist`);
  // 状態
  check(shp.enabled === false, `${tag}: master hidden`);
  check(map.enabled === false && rimIn.enabled === false, `${tag}: map / rim inner hidden`);
  [lens, dR, dB].forEach(l => check(l.adjustmentLayer, `${tag}: ${l.name} is adjustment`));
  [lens, dR, dB, rim, rimIn, map].forEach(l => check(l.shy && l.locked, `${tag}: ${l.name} shy+locked`));
  check(main.hideShyLayers === true, `${tag}: hideShyLayers`);
  check(dR.blendingMode === 'LIGHTEN' && dB.blendingMode === 'LIGHTEN' && rim.blendingMode === 'ADD', `${tag}: blend modes`);
  // マット
  if (!LEGACY) {
    [lens, dR, dB].forEach(l => check(l.matteLayer === shp && l.trackMatteType === 'ALPHA', `${tag}: ${l.name} matte = master alpha`));
  } else {
    [lens, dR, dB].forEach(l => { const above = main.layers[l.index - 2]; check(l.matteLayer === above && above.name.indexOf('GL Matte') === 0 && l.trackMatteType === 'ALPHA', `${tag}: legacy matte above ${l.name} (${above && above.name})`); });
  }
  check(rim.matteLayer === rimIn && rim.trackMatteType === 'ALPHA_INV', `${tag}: rim matte = inner inverted`);
  // 設定時に無効化されたエクスプレッションが無いこと
  check(exprLog.length === 0, `${tag}: expressions disabled at set time: ${JSON.stringify(exprLog.slice(0, 3))}`);
  // 全エクスプレッションを最終状態で評価
  let nExpr = 0;
  project.items_.filter(i => i instanceof CompItem).forEach(c => c.layers.forEach(l => {
    (function walk(p) { if (p.expr) { nExpr++; try { evalExpr(p.expr, p.layer); check(p.exprEnabled, `${tag}: expr enabled ${fullPath(p)}`); } catch (e) { check(false, `${tag}: expr error ${fullPath(p)}: ${e.message}`); } } p.children.forEach(walk); })(l._t.root);
  }));
  check(nExpr > 100, `${tag}: expression count ${nExpr}`);
  // 自動計算値: 見た目の短辺の半分 × Edge%（親スケール込み）
  const ps = extra.parentScale || 1;
  const halfShort = Math.min(200 * 1.2, 300 * 0.8) * ps / 2;
  const edge = Math.max(0.5, halfShort * ctrl(shp, 'edgeWidth') / 100);
  check(near(pv(fx(map, 'GL Edge px'), 'ADBE Slider Control-0001'), edge), `${tag}: edge px ${pv(fx(map, 'GL Edge px'), 'ADBE Slider Control-0001')} vs ${edge}`);
  const disp = edge * ctrl(shp, 'refraction') / 50 * (ctrl(shp, 'invert') > 0 ? -1 : 1);
  check(near(pv(fx(map, 'GL Disp px'), 'ADBE Slider Control-0001'), disp), `${tag}: disp px`);
  // Displacement Map
  const dm = (l) => fx(l, 'GL Refract');
  [lens, dR, dB].forEach(l => {
    const ref = dm(l).children[0].value;
    check(ref && ref.__layer === map, `${tag}: ${l.name} map layer -> ${ref && ref.__layer && ref.__layer.name}`);
    check(pv(dm(l), 'ADBE Displacement Map-0002') === 1 && pv(dm(l), 'ADBE Displacement Map-0004') === 2, `${tag}: ${l.name} R/G channels`);
    check(pv(dm(l), 'ADBE Displacement Map-0006') === 2 && pv(dm(l), 'ADBE Displacement Map-0007') === 0, `${tag}: ${l.name} behavior`);
  });
  check(near(pv(dm(lens), 'ADBE Displacement Map-0003'), disp) && near(pv(dm(lens), 'ADBE Displacement Map-0005'), disp), `${tag}: lens displacement amount`);
  const dd = disp * ctrl(shp, 'dispersion') / 100;
  check(near(pv(dm(dR), 'ADBE Displacement Map-0003'), dd) && near(pv(dm(dB), 'ADBE Displacement Map-0003'), -dd), `${tag}: dispersion amounts`);
  check(pv(fx(dR, 'GL Keep Channel'), 'ADBE Shift Channels-0002') === 2 && pv(fx(dR, 'GL Keep Channel'), 'ADBE Shift Channels-0003') === 11 && pv(fx(dR, 'GL Keep Channel'), 'ADBE Shift Channels-0004') === 11, `${tag}: R keep red`);
  check(pv(fx(dB, 'GL Keep Channel'), 'ADBE Shift Channels-0002') === 11 && pv(fx(dB, 'GL Keep Channel'), 'ADBE Shift Channels-0004') === 4, `${tag}: B keep blue`);
  check(tv(dR, 'ADBE Opacity') === (ctrl(shp, 'dispersion') > 0 ? 100 : 0), `${tag}: dispersion on/off`);
  // 拡大と中心
  const mg = fx(lens, 'GL Magnify');
  check(near(pv(mg, 'ADBE Geometry2-0003'), 100 + ctrl(shp, 'magnify')), `${tag}: magnify`);
  const cExp = toComp(shp._t, [0, 0]);  // srcRect 中心 = (0,0)
  check(near(pv(mg, 'ADBE Geometry2-0001'), cExp) && near(pv(mg, 'ADBE Geometry2-0002'), cExp), `${tag}: magnify center`);
  check(near(pv(fx(lens, 'GL Frost'), 'ADBE Box Blur2-0001'), Math.max(0, ctrl(shp, 'frost'))), `${tag}: frost`);
  // リム
  check(near(tv(rim, 'ADBE Opacity'), ctrl(shp, 'rimOpacity') * 80 / 100), `${tag}: rim opacity x master opacity`);
  const rOff = rimIn._t.root.children[0].children.find(c => c.name === 'GL Rim Offset');
  check(rOff && near(evalProp(rOff.children[0]), -ctrl(shp, 'rimWidth')), `${tag}: rim width`);
  // 同コンプ複製の変換がマスターと一致
  [rim, rimIn].forEach(d => { for (const pt of [[0, 0], [100, -50], [-80, 120]]) check(near(toComp(d._t, pt), toComp(shp._t, pt), 1e-6), `${tag}: ${d.name} transform follows master`); });
  // H プリコンプ: toComp 変換の数学的一致（親子付け・負スケール込み）
  const hComp = project.items_.find(i => i instanceof CompItem && i.name === 'GL_H_' + name);
  const hDup = hComp.layers[0];
  for (const pt of [[0, 0], [100, -50], [-80, 120], [37, 11]]) {
    const a = toComp(hDup._t, pt), b = toComp(shp._t, pt);
    check(near(a, b, 1e-6), `${tag}: H dup maps ${pt} -> ${a} vs master ${b}`);
  }
  check(hDup.threeDLayer === false && hDup.enabled === true && hDup.locked === false, `${tag}: H dup state`);
  const erode = hDup._t.root.children[0].children.find(c => c.name === 'GL Erode');
  check(erode && near(evalProp(erode.children[0]), -edge * 0.05), `${tag}: erode`);
  check(near(pv(fx(hDup, 'GL Height Blur'), 'ADBE Box Blur2-0001'), edge * 0.33) && pv(fx(hDup, 'GL Height Blur'), 'ADBE Box Blur2-0002') === 3, `${tag}: height blur`);
  check(JSON.stringify(pv(fx(hDup, 'GL Fill'), 'ADBE Fill-0002')) === '[1,1,1,1]', `${tag}: height fill white`);
  // コンテンツのリンク: すべてのプロパティがマスターの同じ位置の値を返す
  for (const dup of [hDup, rim, rimIn]) {
    const mR = shp._t.root.children[0], dR2 = dup._t.root.children[0];
    let n = 0;
    (function cmp(a, b) { for (let i = 0; i < a.children.length; i++) { const x = a.children[i], y = b.children[i]; if (x.propertyType === PropertyType.PROPERTY) { n++; check(y.expr && JSON.stringify(evalProp(y)) === JSON.stringify(evalProp(x)), `${tag}: ${dup.name} link ${fullPath(y)}`); } else cmp(x, y); } })(mR, dR2);
    check(n >= 20, `${tag}: ${dup.name} linked ${n} props`);
  }
  // MAP プリコンプ
  const mapComp = project.items_.find(i => i instanceof CompItem && i.name === 'GL_MAP_' + name);
  const e = edge * 0.33;
  const expectPos = { 'GL +X': [540 + e, 960], 'GL -X': [540 - e, 960], 'GL +Y': [540, 960 + e], 'GL -Y': [540, 960 - e] };
  const expectBlend = { 'GL +X': 'ADD', 'GL +Y': 'ADD', 'GL -X': 'SUBTRACT', 'GL -Y': 'SUBTRACT' };
  const expectCol = { 'GL +X': [0.5, 0, 0, 1], 'GL -X': [0.5, 0, 0, 1], 'GL +Y': [0, 0.5, 0, 1], 'GL -Y': [0, 0.5, 0, 1] };
  for (const k in expectPos) {
    const l = mapComp.layer(k);
    check(l && near(tv(l, 'ADBE Position'), expectPos[k]) && l.blendingMode === expectBlend[k] && JSON.stringify(pv(fx(l, 'GL Fill'), 'ADBE Fill-0002')) === JSON.stringify(expectCol[k]) && l.source === hComp, `${tag}: map instance ${k}`);
  }
  const neutral = mapComp.layers[mapComp.layers.length - 1];
  check(neutral.name === 'GL Neutral' && JSON.stringify(neutral.source.mainSource.color) === '[0.5,0.5,0]', `${tag}: neutral gray at bottom`);
  // コントロールは 0..100 のドラッグ範囲内
  GL.CTRL && Object.keys(GL.CTRL).forEach(k => { const v = ctrl(shp, k); check(v >= 0 && v <= 100, `${tag}: control ${k}=${v} within 0..100`); });
}

function section(t) { console.log('\n== ' + t); }
const before = () => [failures.length, passes];
function report(t, b) { const f = failures.length - b[0], p = passes - b[1]; console.log(`   ${f ? 'FAIL' : 'ok  '} ${t}: ${p} checks passed, ${f} failed`); failures.slice(b[0]).slice(0, 8).forEach(m => console.log('      - ' + m)); }

// ================================================================== 1. UI (Panel) を通した操作
section('UI: ScriptUI パネルを構築して全コントロールを操作');
let b = before();
let s = newScene();
const panel = new Panel();
GL.buildUI(panel);
const btn = t => panel.find(c => c.type === 'button' && c.text.indexOf(t) >= 0);
const bApply = btn('(Apply)'), bRebuild = btn('(Rebuild)'), bRemove = btn('(Remove)');
const dd = panel.find(c => c.type === 'dropdownlist'), cb = panel.find(c => c.type === 'checkbox');
const bPreset = panel.all(c => c.type === 'button').find(c => c !== bApply && c !== bRebuild && c !== bRemove && c.text === '適用');
const bToggle = panel.all(c => c.type === 'button').slice(-1)[0];
check(bApply && bRebuild && bRemove && dd && cb && bPreset && bToggle, 'UI: all controls exist');
check(dd.items.length === GL.PRESETS.length && dd.selection && dd.selection.index === 0, 'UI: preset list populated, default selected');
check(cb.value === true, 'UI: 16bpc checkbox default on');
[bApply, bRebuild, bRemove, bPreset, bToggle].forEach(x => check(typeof x.onClick === 'function', 'UI: onClick wired ' + x.text));
// 何も選択せずに押す
alerts = []; bApply.onClick(); check(alerts.length === 1 && /シェイプ/.test(alerts[0]), 'UI: apply w/o selection -> alert');
alerts = []; bRebuild.onClick(); check(alerts.length === 1, 'UI: rebuild w/o selection -> alert');
alerts = []; bRemove.onClick(); check(alerts.length === 1, 'UI: remove w/o selection -> alert');
alerts = []; bPreset.onClick(); check(alerts.length === 1, 'UI: preset w/o selection -> alert');
// シェイプ以外を選んで適用
s.bg.selected = true; alerts = []; bApply.onClick(); check(alerts.length === 1 && s.main.layers.length === 3, 'UI: apply on non-shape -> alert, no change');
s.bg.selected = false;
// 適用
s.shp.selected = true; alerts = []; bApply.onClick();
check(alerts.length === 0, 'UI: apply no alert: ' + alerts.join(' | '));
check(project.bitsPerChannel === 16, 'UI: 16bpc applied');
verifyRig('apply', s);
report('Apply（パネル経由）', b);

b = before();
// プリセット（球体）をリグレイヤー選択状態から適用
s.main.layers.forEach(l => l.selected = false); L(s.main, 'GL Lens').selected = true;
dd.selection = 1; alerts = []; bPreset.onClick();
check(alerts.length === 0, 'preset: no alert ' + alerts.join('|'));
const sph = GL.PRESETS[1].v; Object.keys(sph).forEach(k => check(ctrl(s.shp, k) === sph[k], `preset: ${k}=${ctrl(s.shp, k)} expected ${sph[k]}`));
verifyRig('preset sphere', s);
// 凹レンズ（invert）
dd.selection = 5; bPreset.onClick(); check(ctrl(s.shp, 'invert') === 1, 'preset concave sets invert');
verifyRig('preset concave', s);
report('プリセット適用', b);

b = before();
// キーフレームのある値はプリセットで上書きしない
fx(s.shp, GL.CTRL.refraction).children[0].numKeys = 2; fx(s.shp, GL.CTRL.refraction).children[0].value = 33;
dd.selection = 0; alerts = []; bPreset.onClick(); check(alerts.length === 0 && ctrl(s.shp, 'refraction') === 33, 'preset skips keyframed control');
fx(s.shp, GL.CTRL.refraction).children[0].numKeys = 0;
report('プリセット: キーフレーム保護', b);

b = before();
// 表示切替
const h0 = s.main.hideShyLayers; bToggle.onClick(); check(s.main.hideShyLayers === !h0, 'toggle shy 1'); bToggle.onClick(); check(s.main.hideShyLayers === h0, 'toggle shy 2');
report('補助レイヤー表示切替', b);

b = before();
// 再構築（値は保持、重複なし）
setCtrl(s.shp, 'edgeWidth', 77); setCtrl(s.shp, 'dispersion', 0);
s.main.layers.forEach(l => l.selected = false); s.shp.selected = true;
const nItems = project.items_.length;
alerts = []; bRebuild.onClick();
check(alerts.length === 0, 'rebuild no alert ' + alerts.join('|'));
check(ctrl(s.shp, 'edgeWidth') === 77 && ctrl(s.shp, 'dispersion') === 0, 'rebuild keeps control values');
check(s.main.layers.filter(l => l.name.indexOf('GL ') === 0).length === 6, 'rebuild: no duplicate rig layers');
check(project.items_.length === nItems, `rebuild: project item count stable ${project.items_.length} vs ${nItems}`);
check(fx(s.shp, GL.CTRL.edgeWidth) && s.shp._t.root.children.find(c => c.matchName === 'ADBE Effect Parade').children.length === 8, 'rebuild: controls not duplicated');
verifyRig('rebuild', s);
report('再構築', b);

b = before();
// 解除
s.main.layers.forEach(l => l.selected = false); L(s.main, 'GL Rim').selected = true;
alerts = []; bRemove.onClick();
check(alerts.length === 0, 'remove no alert ' + alerts.join('|'));
check(s.main.layers.length === 3, 'remove: only original layers remain: ' + s.main.layers.map(l => l.name));
check(s.shp.enabled === true, 'remove: master visible again');
check(s.shp._t.root.children.find(c => c.matchName === 'ADBE Effect Parade').children.length === 0, 'remove: controls removed');
check(s.shp.comment === '', 'remove: comment restored');
check(project.items_.every(i => !(i instanceof CompItem) || i.name === 'Main'), 'remove: precomps removed');
check(!project.items_.some(i => i instanceof FootageItem), 'remove: solids cleaned: ' + project.items_.filter(i => i instanceof FootageItem).map(i => i.name));
report('解除', b);

// ================================================================== 2. パレット(Window)でも UI が動く
section('UI: パレットウィンドウ（スクリプトファイルを実行した場合）');
b = before();
s = newScene();
const win = GL.buildUI(undefined);
check(win instanceof Window && win.shown, 'palette shown');
s.shp.selected = true; alerts = [];
win.find(c => c.type === 'button' && c.text.indexOf('(Apply)') >= 0).onClick();
check(alerts.length === 0, 'palette apply no alert ' + alerts.join('|'));
verifyRig('palette', s);
report('パレットから適用', b);

// ================================================================== 3. 厳しい条件
section('厳しい条件');
b = before();
s = newScene({ parent: true });
s.shp.selected = true; alerts = []; GL.run('apply', { bpc16: false });
check(alerts.length === 0, 'parent: no alert ' + alerts.join('|'));
check(project.bitsPerChannel === 8, '16bpc off respected');
verifyRig('parented', s, { parentScale: 1.5 });
report('親子付け（回転・拡大した親）＋ 負スケール ＋ 16bpcオフ', b);

b = before();
s = newScene({ locked: true });
s.shp.selected = true; alerts = []; GL.run('apply', {});
check(alerts.length === 0, 'locked: no alert ' + alerts.join('|'));
check(s.shp.locked === true, 'locked master relocked');
verifyRig('locked', s);
s.shp.selected = true; alerts = []; GL.run('remove'); check(alerts.length === 0 && s.main.layers.length === 3 && s.shp.locked, 'locked: remove ok');
report('ロックされたシェイプ', b);

b = before();
s = newScene({ separated: true });
s.shp.selected = true; alerts = []; GL.run('apply', {});
check(alerts.length === 0, 'separated: no alert ' + alerts.join('|'));
verifyRig('separated', s);
report('位置の次元分割', b);

b = before();
s = newScene({ shapeName: 'My "Lens" \\ 1', compName: 'Comp "A"' });
s.shp.selected = true; alerts = []; GL.run('apply', {});
check(alerts.length === 0, 'quotes: no alert ' + alerts.join('|'));
verifyRig('quotes in names', s);
report('名前に " や \\ を含む', b);

b = before();
s = newScene({ dupCompName: true });
s.shp.selected = true; alerts = []; GL.run('apply', {});
check(alerts.length === 0 && s.main.name !== 'Main', 'duplicate comp name made unique: ' + s.main.name);
verifyRig('dup comp name', s);
report('同名コンプがある', b);

b = before();
s = newScene();
const shp2 = makeLayer(s.main, 'Ball', { matchName: 'ADBE Vector Layer', contents: shapeContents, srcRect: { left: -50, top: -50, width: 100, height: 100 }, legacy: LEGACY });
s.main.layers.unshift(shp2);
shp2.selected = true; s.shp.selected = true; alerts = []; GL.run('apply', {});
check(alerts.length === 0, '2 shapes: no alert ' + alerts.join('|'));
check(shp2.name !== s.shp.name, 'same-named shapes made unique');
check(s.main.layers.filter(l => l.name.indexOf('GL Lens') === 0).length === 2, 'two rigs');
const evalAll = () => { let bad = 0; project.items_.filter(i => i instanceof CompItem).forEach(c => c.layers.forEach(l => (function w(p) { if (p.expr) { try { evalExpr(p.expr, p.layer); } catch (e) { bad++; } } p.children.forEach(w); })(l._t.root))); return bad; };
check(evalAll() === 0 && exprLog.length === 0, 'two rigs: all expressions evaluate');
s.main.layers.forEach(l => l.selected = false); shp2.selected = true; GL.run('remove');
check(L(s.main, 'GL Lens') && L(s.main, 'GL Lens').name === 'GL Lens - ' + s.shp.name, 'removing one rig leaves the other');
check(evalAll() === 0, 'remaining rig expressions still evaluate');
report('同名シェイプ2つに同時適用 → 片方だけ解除', b);

b = before();
LEGACY = true;
s = newScene();
s.shp.selected = true; alerts = []; GL.run('apply', {});
check(alerts.length === 0, 'legacy: no alert ' + alerts.join('|'));
verifyRig('legacy AE (no setTrackMatte)', s);
s.shp.selected = true; GL.run('remove'); check(s.main.layers.length === 3, 'legacy remove');
LEGACY = false;
report('旧AE（setTrackMatte 無し）フォールバック', b);

b = before();
// モーフィング: パスの値・楕円サイズを変えると複製側も同じ値を返す（リンク）
s = newScene(); s.shp.selected = true; GL.run('apply', {});
const hDup = project.items_.find(i => i.name === 'GL_H_Ball').layers[0];
const ell = s.shp._t.root.children[0].children[0].children[1].children[0].children[0];
ell.value = 98765; const dEll = hDup._t.root.children[0].children[0].children[1].children[0].children[0];
check(evalProp(dEll) === 98765, 'morph: H dup follows master ellipse size');
s.shp._t.srcRect = { left: -300, top: -300, width: 600, height: 600 };
const edge2 = Math.min(600 * 1.2, 600 * 0.8) / 2 * 50 / 100;
check(near(pv(fx(L(s.main, 'GL Map'), 'GL Edge px'), 'ADBE Slider Control-0001'), edge2), 'scale-aware edge after morph');
report('モーフィング追従・サイズ追従', b);

// ================================================================== result
console.log(`\nTOTAL: ${passes} checks passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
