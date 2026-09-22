/* ============================================================
   Canvas · 无边画布  (苹果「无边记」风格无限画布)
   - 无限画布引擎：相机 {x,y,scale} + 双层 transform
   - 元素：便签 / 文本 / 图片 / B站视频 / 画笔
   - 苹果式场景切换：相机飞行 + 景深聚焦 + 弹性入出场
   ============================================================ */
'use strict';

/* ---------------- 基础工具 ---------------- */
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

function makeBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = t => ((ax * t + bx) * t + cx) * t;
  const dfx = t => (3 * ax * t + 2 * bx) * t + cx;
  const fy = t => ((ay * t + by) * t + cy) * t;
  return p => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const x = fx(t) - p;
      if (Math.abs(x) < 1e-5) break;
      const d = dfx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= x / d;
    }
    return fy(clamp(t, 0, 1));
  };
}
const EASE_IOS = makeBezier(.32, .72, 0, 1);      // iOS 系统曲线
const EASE_OUT = makeBezier(.22, .61, .36, 1);
const EASE_IN = makeBezier(.4, 0, 1, 1);
const CSS_IOS = 'cubic-bezier(.32,.72,0,1)';

/* ---------------- DOM ---------------- */
const stage = $('#stage'), viewport = $('#viewport'), world = $('#world'), viewRegions = $('#viewRegions');
const grid = $('#grid'), marquee = $('#marquee'), guides = $('#guides');
const topbar = $('.topbar'), toolbar = $('#toolbar');
const boardsPanel = $('#boardsPanel'), boardList = $('#boardList');
const minimap = $('#minimap'), miniCanvas = $('#miniCanvas'), miniVp = $('#miniVp');
const ctxbar = $('#ctxbar'), toast = $('#toast'), dropHint = $('#dropHint');
const fileInput = $('#fileInput');
const modalMask = $('#modalMask'), modalInput = $('#modalInput'), modalErr = $('#modalErr');
const helpMask = $('#helpMask');

const MIN_SCALE = 0.08, MAX_SCALE = 5;

/* ---------------- 状态 ---------------- */
/* 本地存储的键跟着「当前打开的是哪份画布」走，多份才能并存互不覆盖 */
const STORE_PREFIX = 'canvas.freeform.v1.';
const lib = { items: [], wid: null, ready: false };   // 画布目录
const storeKey = wid => STORE_PREFIX + (wid || lib.wid || 'default');
const REMOTE = /[?&]remote=1/.test(location.search);   // ?remote=1 → 只当遥控器用，不加载画布

/* ------------------------------------------------------------------
   作品目录
   以前是「一个空间码 = 一整份画布」，忘了码就等于内容没了。
   现在改成：钥匙烧在页面里（不再要你记任何东西），一份云端索引 + 多份作品，
   每份作品单独一条记录，互不影响；访问则由图形密码把着。
   ⚠️ 钥匙在源码里，所以这仍是「帘子」不是「保险柜」——挡随手点开，挡不住翻源码的人。
   ------------------------------------------------------------------ */
const LIB = 'KxYFxLLoHCa3HHfkmVaMXQXXHzXh';
/* ⚠️ 键只能用 [A-Za-z0-9_-]，最长 64 位 —— 云函数 wb_sync 的 validKey 就是这么校验的。
   早先用冒号分隔，结果每次写回都被 400 bad key 拒掉（而且是静默失败），
   于是每台设备各建各的目录，看起来就像「手机和电脑不同步」。别再改回冒号。 */
const LIB_INDEX_KEY = 'cl-' + LIB;                        // 目录本身
const LIB_ITEM_KEY = id => 'cl-' + LIB + '-' + id;        // 单份作品

/* 手机遥控：状态与指令各存一条，互不覆盖（指令被冲掉就会丢按键） */
const RM_HOST = 'cl-' + LIB + '-rmh';    // 电脑端写：当前在第几个视图
const RM_CMD = 'cl-' + LIB + '-rmc';     // 手机端写：要执行的指令
const LIB_CFG = 'canvas.lib.cfg';
// —— 内置作品：《艺术（上）》腾讯文档转换件（首次启动自动加入目录，不覆盖用户已有画布）——
const BUILTIN_ART_ID = 'builtin-art-sj';
const BUILTIN_ART_NAME = '艺术（上）· 音乐鉴赏';
const BUILTIN_ART_PAYLOAD = {"v":1,"activeId":"b0eq4g8e","boards":[{"id":"b0eq4g8e","name":"艺术（上）· 音乐鉴赏","ver":2,"camera":{"x":-120,"y":-60,"scale":0.92},"elements":[{"id":"e020q7gx","type":"text","x":220,"y":260,"w":1160,"h":180,"text":"艺术（上）","fontSize":110},{"id":"ecj1bsnf","type":"text","x":220,"y":470,"w":1160,"h":90,"text":"音乐欣赏 · 中职公共艺术鉴赏课","fontSize":46},{"id":"eh7inztw","type":"note","x":220,"y":610,"w":1180,"h":70,"text":"本画布含 9 个视图：封面 / 分类 / 钢琴 / 二胡 / 吹管弹拨 / 提琴民乐 / 民族声乐 / 花絮 / B站详解","color":"c-blue"},{"id":"eqtwahxp","type":"note","x":1920,"y":70,"w":220,"h":64,"text":"一","color":"c-blue"},{"id":"ez6tqvik","type":"text","x":1920,"y":150,"w":1440,"h":120,"text":"音乐的分类","fontSize":66},{"id":"e6xkmweq","type":"text","x":1920,"y":300,"w":1440,"h":520,"text":"流行 Pop\n摇滚 Rock\n嘻哈 / 说唱 Hip-Hop / Rap\n民谣 Folk\nR&B / 灵魂乐 R&B / Soul\n乡村音乐 Country\n爵士乐 Jazz\n其他\n· 想一想：你觉得音乐还能怎么分？","fontSize":36},{"id":"efdgyr5r","type":"note","x":1920,"y":840,"w":1440,"h":56,"text":"资源：B 站《音乐歌曲分类及代表作品详解》合集（下方「B站详解」页已嵌入全部视频，可直接播放）","color":"c-yellow"},{"id":"ebf2w7la","type":"note","x":3760,"y":70,"w":220,"h":64,"text":"二·1","color":"c-pink"},{"id":"e765hatm","type":"text","x":3760,"y":150,"w":1440,"h":120,"text":"名曲鉴赏 · 钢琴","fontSize":66},{"id":"egy245td","type":"text","x":3760,"y":300,"w":1440,"h":520,"text":"海上钢琴师（电影配乐）\n拉赫玛尼诺夫《第三钢琴协奏曲》— 朗朗\n卡农 Canon\n漫威动画主题音乐 — 朗朗\n《加勒比海盗》主题曲 He’s a Pirate\n《权力的游戏》主题曲 Main Title\n《环太平洋》Pacific Rim\n《杀死比尔》Battle Without Honor or Humanity","fontSize":36},{"id":"efwz6ck9","type":"note","x":5600,"y":70,"w":220,"h":64,"text":"二·2","color":"c-green"},{"id":"eznolaya","type":"text","x":5600,"y":150,"w":1440,"h":120,"text":"名曲鉴赏 · 二胡","fontSize":66},{"id":"e0z7t6on","type":"text","x":5600,"y":300,"w":1440,"h":520,"text":"二泉映月\n赛马\n一步之遥\n悬溺","fontSize":36},{"id":"evdnp9g2","type":"note","x":7440,"y":70,"w":220,"h":64,"text":"二·3","color":"c-yellow"},{"id":"e4xjnylk","type":"text","x":7440,"y":150,"w":1440,"h":120,"text":"名曲鉴赏 · 吹管与弹拨","fontSize":66},{"id":"e9zgl6ho","type":"text","x":7440,"y":300,"w":1440,"h":520,"text":"唢呐《The Spectre》\n唢呐《百鸟朝凤》\n唢呐《summer》\n贝斯主题曲 — 于文文《冷夜雨》\n《加州旅馆》\n《欢乐斗地主》","fontSize":36},{"id":"e6jkfvxz","type":"note","x":9280,"y":70,"w":220,"h":64,"text":"二·4","color":"c-blue"},{"id":"ec2xdidp","type":"text","x":9280,"y":150,"w":1440,"h":120,"text":"名曲鉴赏 · 提琴与民乐","fontSize":66},{"id":"e88k8cem","type":"text","x":9280,"y":300,"w":1440,"h":520,"text":"小提琴《亡灵序曲》\n《猫和老鼠》（小提 + 钢琴）\n小提琴《七里香》\n民乐《七里香》\n中西乐器对决","fontSize":36},{"id":"excpiw9g","type":"note","x":11120,"y":70,"w":220,"h":64,"text":"二·5","color":"c-pink"},{"id":"ed9nlicx","type":"text","x":11120,"y":150,"w":1440,"h":120,"text":"名曲鉴赏 · 民族声乐","fontSize":66},{"id":"e462630q","type":"text","x":11120,"y":300,"w":1440,"h":520,"text":"呼麦《哪吒闹海 2》\n呼麦 — 马头琴（哈拉木吉）\nVitas《歌剧 2》\nVitas《星星》\n《达拉崩吧》— 周深\n《忐忑》— 龚琳娜\n男低音 / 约尔德唱法","fontSize":36},{"id":"etnfywrb","type":"note","x":12960,"y":70,"w":220,"h":64,"text":"三","color":"c-green"},{"id":"eawiah3r","type":"text","x":12960,"y":150,"w":1440,"h":120,"text":"花絮 · 趣味知识","fontSize":66},{"id":"eej7a68r","type":"text","x":12960,"y":300,"w":1440,"h":520,"text":"约翰·凯奇《4 分 33 秒》— 关于\"无声\"的观念音乐\n《头文字 D》动画配乐\n· 提示：每个视图都可在画布里继续补充视频链接、图片与批注","fontSize":36},{"id":"eqqg3e03","type":"note","x":14800,"y":70,"w":220,"h":64,"text":"四","color":"c-yellow"},{"id":"e0b2wxec","type":"text","x":14800,"y":150,"w":1440,"h":110,"text":"B站详解 · 音乐分类合集","fontSize":60},{"id":"e7xug4rg","type":"note","x":14800,"y":280,"w":1440,"h":56,"text":"下方 21 个视频均为原《艺术 上》文档里的 B 站链接，点一下即播放（懒加载，不占性能）","color":"c-yellow"},{"id":"evtzoao3","type":"video","x":14760,"y":360,"w":280,"h":176,"bvid":"BV1St4y1p7Ee","title":"【4K&1080P】周杰伦-《反方向的钟》MV完整版"},{"id":"ena2vqto","type":"video","x":15070,"y":360,"w":280,"h":176,"bvid":"BV1ks411P7PT","title":"blank space 泰勒斯威夫特 原版MV（蓝光）"},{"id":"effyxpkz","type":"video","x":15380,"y":360,"w":280,"h":176,"bvid":"BV1e2wjeYE41","title":"[Hi-res][4K60帧][Dua Lipa] - Levitating双语字幕"},{"id":"evjxvo2r","type":"video","x":15690,"y":360,"w":280,"h":176,"bvid":"BV17a4y1A7t6","title":"【4K60FPS】迈克尔·杰克逊《Billie Jean》太空步名场面现场！无法超越"},{"id":"ezrt6x4m","type":"video","x":16000,"y":360,"w":280,"h":176,"bvid":"BV1UR4y1D7Cv","title":"S.H.E《不想长大》MV"},{"id":"erxu78df","type":"video","x":14760,"y":566,"w":280,"h":176,"bvid":"BV1WJ411S7VW","title":"【莫扎特第40交响曲】卡瓦科斯：我不想我不想不想长大，再长大我就专职搞指挥 Leonidas Kavakos: Mozart Symphony No. 40"},{"id":"e82wo892","type":"video","x":15070,"y":566,"w":280,"h":176,"bvid":"BV11z411B75q","title":"崔健-一无所有【中国之星】"},{"id":"e7zxy1st","type":"video","x":15380,"y":566,"w":280,"h":176,"bvid":"BV18e4y1h7Zq","title":"【4K60FPS】许巍《蓝莲花》万人大合唱现场！盛开着永不凋零"},{"id":"egrcqmre","type":"video","x":15690,"y":566,"w":280,"h":176,"bvid":"BV1r54y1577U","title":"【4K修复】窦唯《高级动物》MV 阳光之下，都是迷幻、地狱天堂，皆在人间"},{"id":"ee4z1ex9","type":"video","x":16000,"y":566,"w":280,"h":176,"bvid":"BV1aE411M7Hg","title":"胡夏这首《同桌的你》，句句走心声声入耳，听完勾起了多少甜蜜的回忆？"},{"id":"edadxbyt","type":"video","x":14760,"y":772,"w":280,"h":176,"bvid":"BV1sN4y1U726","title":"有人说，《米店》是“近十年最好听的中文民谣歌曲之一” 张玮玮"},{"id":"e26qrqro","type":"video","x":15070,"y":772,"w":280,"h":176,"bvid":"BV1WT41117ug","title":"【4K60FPS】   马頔《南山南》   南山南  北秋悲"},{"id":"ecpd0jph","type":"video","x":15380,"y":772,"w":280,"h":176,"bvid":"BV1DyTgzmEmz","title":"【单依纯《李白》】如何呢，又能怎？"},{"id":"e7yjvch2","type":"video","x":15690,"y":772,"w":280,"h":176,"bvid":"BV1U4411C74b","title":"中国好声音十大盲选现场，他们一鸣惊人"},{"id":"ehbqbcfu","type":"video","x":16000,"y":772,"w":280,"h":176,"bvid":"BV1j5x8eKECK","title":"[音高测量]祖国母亲75岁生日快乐！ 《我爱你中国》群星版音高测量"},{"id":"eese1fxv","type":"video","x":14760,"y":978,"w":280,"h":176,"bvid":"BV1pb411L7k6","title":"《我和我的祖国》MV 中央广播电视总台制作"},{"id":"e3faq1ao","type":"video","x":15070,"y":978,"w":280,"h":176,"bvid":"BV1w14y1E71e","title":"听音乐，怎样才叫懂？"},{"id":"ee63n1nx","type":"video","x":15380,"y":978,"w":280,"h":176,"bvid":"BV1tK421C7Lt","title":"《海上钢琴师》斗琴片段"},{"id":"e6ozibkl","type":"video","x":15690,"y":978,"w":280,"h":176,"bvid":"BV14f4y1R7tc","title":"王羽佳（炫技八度野蜂飞舞）"},{"id":"e9j2uhtq","type":"video","x":16000,"y":978,"w":280,"h":176,"bvid":"BV1ugWbzkEr4","title":"台湾王世坚《没出息》完整版--经典语句：本来应该匆匆忙忙游刃有余，现在是匆匆忙忙连滚带爬#搞笑视频"},{"id":"eedhettz","type":"video","x":14760,"y":1184,"w":280,"h":176,"bvid":"BV1W14y1e7pE","title":"【4K60FPS极致修复】林俊杰《煎熬》起高了名场面"}],"views":[{"id":"vuy8fwoc","name":"封面","x":0,"y":0,"scale":1,"cx":800,"cy":450,"rw":1600,"rh":900,"thumb":""},{"id":"vmn7et29","name":"音乐的分类","x":1840,"y":0,"scale":1,"cx":2640,"cy":450,"rw":1600,"rh":900,"thumb":""},{"id":"v0yaxswi","name":"名曲鉴赏 · 钢琴","x":3680,"y":0,"scale":1,"cx":4480,"cy":450,"rw":1600,"rh":900,"thumb":""},{"id":"vtn2b6uy","name":"名曲鉴赏 · 二胡","x":5520,"y":0,"scale":1,"cx":6320,"cy":450,"rw":1600,"rh":900,"thumb":""},{"id":"vnrda2rv","name":"名曲鉴赏 · 吹管与弹拨","x":7360,"y":0,"scale":1,"cx":8160,"cy":450,"rw":1600,"rh":900,"thumb":""},{"id":"v85xeic9","name":"名曲鉴赏 · 提琴与民乐","x":9200,"y":0,"scale":1,"cx":10000,"cy":450,"rw":1600,"rh":900,"thumb":""},{"id":"v7aqkxtv","name":"名曲鉴赏 · 民族声乐","x":11040,"y":0,"scale":1,"cx":11840,"cy":450,"rw":1600,"rh":900,"thumb":""},{"id":"v3rnsc4g","name":"花絮 · 趣味知识","x":12880,"y":0,"scale":1,"cx":13680,"cy":450,"rw":1600,"rh":900,"thumb":""},{"id":"vrsdn22l","name":"B站详解 · 音乐分类合集","x":14720,"y":0,"scale":1,"cx":15520,"cy":860,"rw":1600,"rh":1380,"thumb":""}]}]};
const BUILTIN_ART_EL = (BUILTIN_ART_PAYLOAD.boards[0].elements || []).length;
const LIB_LOCAL = 'canvas.lib.local';

const state = {
  boards: [],
  tomb: [],                 // 已删除场景的墓碑 [{id, t}]，多端合并时靠它判断「是被删了，还是新加的」
  activeId: null,
  camera: { x: 0, y: 0, scale: 1 },
  tool: 'select',
  selection: new Set(),
  editingId: null,
  focusId: null,
  camBeforeFocus: null,
  immersive: false,
  quality: 'auto',        // auto | high | low —— 低画质会砍掉模糊/毛玻璃/部分动效
  presenting: false,
  presentIdx: 0,
  shapeKind: 'rect',      // 形状工具当前选中的种类：rect / round / ellipse
  showViewRegions: false, // 是否在画布上画出「已保存视图的区域」参考框（默认关）
};

const domMap = new Map();          // id -> DOM
let pendingTick = false;
let camAnim = null;                // 相机飞行动画
let boardAnimating = false;

const board = () => state.boards.find(b => b.id === state.activeId) || state.boards[0];
const els = () => board().elements;
const findEl = id => els().find(e => e.id === id);

/* ---------------- 持久化 ---------------- */
let saveTimer = null, saveStateEl = $('#saveState');

function markDirty() {
  // 给当前场景打时间戳：合并时靠它判断「哪边是新的」，
  // 这样两端同时改不同场景时，两边都能留下（不再整份覆盖）
  const b = board && state.activeId ? board() : null;
  if (b) b.mt = Date.now();
  saveStateEl.textContent = '保存中…';
  saveStateEl.classList.add('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}

function save() {
  const active = board();
  if (active) { active.camera = { ...state.camera }; }
  const payload = { v: 1, activeId: state.activeId, boards: state.boards, tomb: state.tomb || [] };
  let str;
  try { str = JSON.stringify(payload); } catch (e) { return; }
  try {
    localStorage.setItem(storeKey(), str);
    saveStateEl.textContent = '已保存';
  } catch (e) {
    // 超出配额：从最大的图片开始逐张剔除，能留几张留几张
    let dropped = 0, ok = false;
    try {
      const slim = JSON.parse(str);
      for (let round = 0; round < 200; round++) {
        const imgs = [];
        slim.boards.forEach(b => b.elements.forEach(el => { if (el.type === 'image' && el.src) imgs.push(el); }));
        if (!imgs.length) break;
        imgs.sort((a, b) => b.src.length - a.src.length);
        imgs[0].src = '';
        dropped++;
        try {
          localStorage.setItem(storeKey(), JSON.stringify(slim));
          ok = true;
          break;
        } catch (e3) { /* 还超，继续剔 */ }
      }
    } catch (e4) { /* 解析失败，放弃 */ }
    if (ok) {
      saveStateEl.textContent = '已保存';
    } else {
      saveStateEl.textContent = '存储已满';
    }
  }
  saveStateEl.classList.remove('saving');
  scheduleCloudPush();               // 本地一改，几秒后推到云端
}

function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(storeKey()) || 'null'); } catch (e) { data = null; }
  if (data && Array.isArray(data.boards) && data.boards.length) {
    state.boards = data.boards;
    state.tomb = Array.isArray(data.tomb) ? data.tomb : [];
    state.activeId = data.activeId && data.boards.some(b => b.id === data.activeId) ? data.activeId : data.boards[0].id;
    state.fresh = false;
  } else {
    state.boards = [seedBoard()];
    state.activeId = state.boards[0].id;
    state.fresh = true;
  }
  const c = board().camera || { x: 0, y: 0, scale: 1 };
  state.camera = { x: c.x, y: c.y, scale: clamp(c.scale || 1, MIN_SCALE, MAX_SCALE) };
}

function newBoard(name) {
  return { id: uid(), name: name || '未命名场景', camera: { x: 0, y: 0, scale: 1 }, elements: [] };
}

function seedBoard() {
  const b = newBoard('欢迎');
  const cx = 0, cy = 0;
  const title = { id: uid(), type: 'text', x: cx - 260, y: cy - 300, w: 520, h: 74, text: '无边画布' };
  b.elements.push(title);
  const notes = [
    ['拖动空白处平移\n按住空格也可以', 'c-yellow', -300, -180],
    ['滚轮缩放\n⌘ + 滚轮 更精细', 'c-blue', -60, -180],
    ['双击元素聚焦\n双击空白退出', 'c-pink', 180, -180],
  ];
  notes.forEach(([text, color, x, y]) => {
    b.elements.push({ id: uid(), type: 'note', x, y, w: 210, h: 180, text, color });
  });
  b.elements.push({
    id: uid(), type: 'note', x: -300, y: 50, w: 210, h: 150,
    text: '拖便签边缘的圆点\n可以拉出连接线',
    color: 'c-green',
  });
  b.elements.push({
    id: uid(), type: 'note', x: -40, y: 50, w: 210, h: 150,
    text: '⌘⇧R 记录视图\n⌘⇧P 开始演示',
    color: 'c-purple',
  });
  const vid = {
    id: uid(), type: 'video', x: 200, y: 50, w: 480, h: 306, bvid: 'BV1GJ411x7h7', title: '',
  };
  b.elements.push(vid);
  b.elements.push({ id: uid(), type: 'note', x: -560, y: -180, w: 210, h: 150, text: '点底部 ▶ 图标\n粘贴 B 站链接', color: 'c-gray' });
  // 示例连线
  b.elements.push({
    id: uid(), type: 'link', from: title.id, to: b.elements[1].id,
    fromSide: 'auto', toSide: 'auto', arrow: 'end', curve: 'curve', x: 0, y: 0, w: 2, h: 2,
  });
  return b;
}

/* ---------------- 历史 ---------------- */
let undoStack = [], redoStack = [], lastSnapshot = null;

function snapshot() {
  return JSON.stringify({ boards: state.boards, activeId: state.activeId });
}
function pushHistory() {
  const snap = snapshot();
  if (snap === lastSnapshot) return;
  undoStack.push(snap);
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  lastSnapshot = snap;
  updateHistoryButtons();
}
function restore(snap) {
  const d = JSON.parse(snap);
  state.boards = d.boards;
  state.activeId = d.activeId;
  lastSnapshot = snap;
  state.selection.clear();
  state.editingId = null;
  exitFocus(true);
  renderBoard();
  boardNameEl.value = board().name;
  const c = board().camera || { x: 0, y: 0, scale: 1 };
  flyTo(c.x, c.y, c.scale, 420);
  markDirty();
  updateHistoryButtons();
}
function undo() {
  if (!undoStack.length) return showToast('没有更多可撤销');
  const cur = snapshot();
  redoStack.push(cur);
  restore(undoStack.pop());
}
function redo() {
  if (!redoStack.length) return showToast('没有可重做');
  undoStack.push(snapshot());
  restore(redoStack.pop());
}
lastSnapshot = null;

/* ---------------- 相机 ---------------- */
const GRID_PAD = 200;
let lastZoomTxt = '', lastStep = -1, lastCullAt = 0, culledAny = false;

function applyCamera() {
  const { x, y, scale } = state.camera;
  world.style.transform = `translate3d(${-x * scale}px, ${-y * scale}px, 0) scale(${scale})`;
  if (viewRegions) viewRegions.style.transform = world.style.transform;

  // 网格：只在步长档位变化时改 background-size，其余走 transform（纯合成，不触发重绘）
  let step = 26 * scale;
  while (step < 15) step *= 2;
  while (step > 110) step /= 2;
  if (Math.abs(step - lastStep) > 0.01) {
    grid.style.backgroundSize = `${step}px ${step}px`;
    lastStep = step;
  }
  const gx = ((-x * scale + GRID_PAD) % step + step) % step;
  const gy = ((-y * scale + GRID_PAD) % step + step) % step;
  grid.style.transform = `translate3d(${gx.toFixed(2)}px, ${gy.toFixed(2)}px, 0)`;

  const zt = Math.round(scale * 100) + '%';
  if (zt !== lastZoomTxt) { $('#zoomVal').textContent = zt; lastZoomTxt = zt; }

  updateCtxbar();
  drawMinimap();

  // 剔除：节流到 ~8Hz，避免每帧遍历全部元素
  const now = performance.now();
  if (now - lastCullAt > 120) {
    lastCullAt = now;
    if (els().length > 40) cull();
    else if (culledAny) {
      for (const dom of domMap.values()) dom.classList.remove('culled');
      culledAny = false;
    }
  }
}

function tick() {
  pendingTick = false;
  applyCamera();
}
function requestTick() {
  if (!pendingTick) { pendingTick = true; requestAnimationFrame(tick); }
}

function screenToWorld(sx, sy) {
  const s = state.camera.scale;
  return { x: sx / s + state.camera.x, y: sy / s + state.camera.y };
}
function worldToScreen(wx, wy) {
  const s = state.camera.scale;
  return { x: (wx - state.camera.x) * s, y: (wy - state.camera.y) * s };
}

/* 相机飞行：缩放走对数插值，位置按 1/s 权重插值（目标不会飞出视野） */
function flyTo(tx, ty, tscale, dur = 620, ease = EASE_IOS) {
  cancelCamAnim();
  const s0 = { ...state.camera };
  const t1 = clamp(tscale, MIN_SCALE, MAX_SCALE);
  if (dur <= 0) {
    state.camera.x = tx; state.camera.y = ty; state.camera.scale = t1;
    applyCamera();
    return;
  }
  if (Math.abs(s0.x - tx) < .5 && Math.abs(s0.y - ty) < .5 && Math.abs(s0.scale - t1) < .001) return;
  setFlying(true);
  let elapsed = 0, last = performance.now();
  const ls0 = Math.log(s0.scale), ls1 = Math.log(t1);
  const inv0 = 1 / s0.scale, inv1 = 1 / t1;
  const step = now => {
    let dt = now - last; last = now;
    if (dt > 90) dt = 90;               // 掉帧 / 从后台切回来时不瞬移
    elapsed += dt;
    const p = clamp(elapsed / dur, 0, 1);
    const e = ease(p);
    const sc = Math.exp(lerp(ls0, ls1, e));
    let pe;
    if (Math.abs(inv0 - inv1) < 1e-6) pe = e;
    else pe = clamp((inv0 - 1 / sc) / (inv0 - inv1), 0, 1);
    state.camera.scale = sc;
    state.camera.x = lerp(s0.x, tx, pe);
    state.camera.y = lerp(s0.y, ty, pe);
    applyCamera();
    if (p < 1) camAnim = requestAnimationFrame(step);
    else { camAnim = null; setFlying(false); markDirty(); }
  };
  camAnim = requestAnimationFrame(step);
}
/* 视图跳转：距离远 / 缩放跨度大时走「拉远—推进」的弧形轨迹（Prezi 式） */
function flyToArc(tx, ty, tscale, dur = 1050) {
  cancelCamAnim();
  const s0 = { ...state.camera };
  const t1 = clamp(tscale, MIN_SCALE, MAX_SCALE);
  if (dur <= 0) { state.camera.x = tx; state.camera.y = ty; state.camera.scale = t1; applyCamera(); return; }
  setFlying(true);
  let elapsed = 0, last = performance.now();
  const ls0 = Math.log(s0.scale), ls1 = Math.log(t1);
  const inv0 = 1 / s0.scale, inv1 = 1 / t1;
  const dip = 0.24;                    // 中途最多收缩到 76%（再大就顿挫）
  const step = now => {
    let dt = now - last; last = now;
    if (dt > 90) dt = 90;               // 同上，防跳变
    elapsed += dt;
    const p = clamp(elapsed / dur, 0, 1);
    const e = EASE_IOS(p);
    const sc = Math.exp(lerp(ls0, ls1, e)) * (1 - dip * Math.sin(Math.PI * e));
    // 位置单独按 e 走：不再跟缩放挂钩，否则 dip 会让画面先卡住再突然窜出去
    state.camera.scale = clamp(sc, MIN_SCALE, MAX_SCALE);
    state.camera.x = lerp(s0.x, tx, e);
    state.camera.y = lerp(s0.y, ty, e);
    applyCamera();
    if (p < 1) camAnim = requestAnimationFrame(step);
    else { camAnim = null; setFlying(false); markDirty(); }
  };
  camAnim = requestAnimationFrame(step);
}

/* 动效时长（低画质档缩短） */
function dur(ms) { return state.quality === 'low' ? Math.round(ms * 0.55) : ms; }

function setFlying(on) { document.body.classList.toggle('flying', on); }

function cancelCamAnim() {
  if (camAnim) { cancelAnimationFrame(camAnim); camAnim = null; }
  setFlying(false);
}

function bboxOf(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  list.forEach(e => {
    x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h);
  });
  if (x0 === Infinity) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* 相机 (x,y) 表示「视口左上角」对应的世界点；要让某个世界点落在屏幕中心，得减去半个视口 */
function centerCam(wx, wy, scale) {
  return { x: wx - innerWidth / (2 * scale), y: wy - innerHeight / (2 * scale) };
}

function fitAll(durMs = 700) {
  const b = bboxOf(els());
  const vw = innerWidth, vh = innerHeight;
  if (!b) return flyTo(0, 0, 1, dur(durMs));
  const pad = 160;
  const sc = clamp(Math.min((vw - pad) / Math.max(b.w, 1), (vh - pad) / Math.max(b.h, 1)), MIN_SCALE, 1.6);
  const c = centerCam(b.x + b.w / 2, b.y + b.h / 2, sc);
  flyTo(c.x, c.y, sc, dur(durMs));
}

function zoomBy(factor, sx, sy) {
  const s0 = state.camera.scale;
  const s1 = clamp(s0 * factor, MIN_SCALE, MAX_SCALE);
  if (Math.abs(s1 - s0) < 1e-6) return;
  cancelCamAnim();
  const cx = sx === undefined ? innerWidth / 2 : sx;
  const cy = sy === undefined ? innerHeight / 2 : sy;
  state.camera.x += cx / s0 - cx / s1;
  state.camera.y += cy / s0 - cy / s1;
  state.camera.scale = s1;
  requestTick();
  markDirty();
}

/* ---------------- 视口剔除 ---------------- */
function cull() {
  const s = state.camera.scale;
  const wx0 = state.camera.x, wy0 = state.camera.y;
  const wx1 = wx0 + innerWidth / s, wy1 = wy0 + innerHeight / s;
  const pad = 500 / s;
  for (const e of els()) {
    const dom = domMap.get(e.id);
    if (!dom) continue;
      const vis = !(e.x + e.w < wx0 - pad || e.x > wx1 + pad || e.y + e.h < wy0 - pad || e.y > wy1 + pad);
      if (dom.classList.contains('culled') === !vis) continue;
      dom.classList.toggle('culled', !vis);
      culledAny = true;
    }
}

/* ---------------- 元素渲染 ---------------- */
const NOTE_COLORS = ['c-yellow', 'c-pink', 'c-blue', 'c-green', 'c-purple', 'c-gray'];

function elClass(d) {
  if (d.type === 'shape') return `el el-shape shape-${d.shape || 'rect'}${d.fill ? ' fill' : ''}${d.color ? ' ' + d.color : ''}`;
  return `el el-${d.type}${d.type === 'note' ? ' ' + (d.color || 'c-yellow') : ''}`;
}
const DEF_FONT = { note: 17, text: 28 };
function fontSizeOf(d) { return d.fontSize || DEF_FONT[d.type] || 17; }

function setBox(dom, d) {
  dom.style.width = d.w + 'px';
  dom.style.height = d.h + 'px';
  dom.style.setProperty('--tx', d.x + 'px');
  dom.style.setProperty('--ty', d.y + 'px');
  dom.style.transform = `translate3d(${d.x}px, ${d.y}px, 0)`;
}

function buildEl(d) {
  const dom = document.createElement('div');
  dom.className = elClass(d);
  dom.dataset.id = d.id;
  setBox(dom, d);

  const body = document.createElement('div');
  body.className = 'el-body';
  dom.appendChild(body);

  if (d.type === 'note' || d.type === 'text') {
    const t = document.createElement('div');
    t.className = 'txt';
    t.style.fontSize = fontSizeOf(d) + 'px';
    t.textContent = d.text || '';
    body.appendChild(t);
  } else if (d.type === 'image') {
    const img = document.createElement('img');
    img.src = d.src || '';
    img.draggable = false;
    // 存在云上的图：万一 CDN 域名不可达，回落到云函数代读（同一份图，两条路）
    img.onerror = () => {
      if (!d.imgId || img.dataset.retried) return;
      img.dataset.retried = '1';
      img.src = CLOUD_API + '?img=' + encodeURIComponent(d.imgId);
    };
    body.appendChild(img);
  } else if (d.type === 'video') {
    dom.classList.add('paused');
    const bar = document.createElement('div');
    bar.className = 'v-bar';
    bar.innerHTML = `<span class="dot"></span><span class="t">${escapeHtml(d.title || ('B站 · ' + (d.bvid || ('av' + d.aid))))}</span>`;
    const stub = document.createElement('div');
    stub.className = 'v-stub';
    stub.innerHTML = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="1.6"><rect x="2.5" y="5" width="19" height="14" rx="3.5"/><path d="M10.5 9.5l5 2.5-5 2.5z" fill="rgba(255,255,255,.8)" stroke="none"/></svg><span>点击载入播放器</span>`;
    const play = document.createElement('div');
    play.className = 'v-play';
    play.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13l11-6.5z"/></svg>`;
    body.appendChild(bar);
    body.appendChild(stub);
    body.appendChild(play);
  } else if (d.type === 'shape') {
    const box = document.createElement('div');
    box.className = 's-box';
    if (d.label) {
      const lb = document.createElement('span');
      lb.className = 's-label';
      lb.textContent = d.label;
      box.appendChild(lb);
    }
    body.appendChild(box);
  } else if (d.type === 'ink') {
    body.appendChild(inkSvg(d));
  } else if (d.type === 'link') {
    const g = computeLink(d);
    if (g) { d.x = g.x; d.y = g.y; d.w = g.w; d.h = g.h; setBox(dom, d); }
    body.appendChild(linkSvg(d, g));
  }

  if (d.type === 'link') {
    dom.style.zIndex = -1;
    return dom;
  }

  ['nw', 'ne', 'sw', 'se'].forEach(k => {
    const h = document.createElement('div');
    h.className = 'handle h-' + k;
    h.dataset.h = k;
    dom.appendChild(h);
  });
  ['top', 'right', 'bottom', 'left'].forEach(s => {
    const a = document.createElement('div');
    a.className = 'anchor a-' + s;
    a.dataset.a = s;
    a.title = '拖出连接线';
    dom.appendChild(a);
  });

  if (d.z) dom.style.zIndex = d.z;
  return dom;
}

function inkSvg(d) {
  const pts = d.points || [];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', d.w);
  svg.setAttribute('height', d.h);
  svg.setAttribute('viewBox', `0 0 ${d.w} ${d.h}`);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ptsToPath(pts));
  svg.appendChild(path);
  return svg;
}
function ptsToPath(pts) {
  if (!pts.length) return '';
  let minX = Infinity, minY = Infinity;
  for (const p of pts) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); }
  // 相对 bbox 原点（含 padding）
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0] - minX, y = pts[i][1] - minY;
    d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
  }
  return d.trim();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function refreshEl(d) {
  const dom = domMap.get(d.id);
  if (!dom) return;
  if (d.type === 'link') { refreshLink(d); return; }
  setBox(dom, d);
  dom.className = elClass(d) + (dom.classList.contains('sel') ? ' sel' : '') + (dom.classList.contains('editable') ? ' editable' : '');
  const body = dom.querySelector('.el-body');
  if (d.type === 'note' || d.type === 'text') {
    const t = dom.querySelector('.txt');
    if (t) {
      if (t.textContent !== (d.text || '')) t.textContent = d.text || '';
      t.style.fontSize = fontSizeOf(d) + 'px';
    }
  } else if (d.type === 'image') {
    const img = dom.querySelector('img');
    if (img && img.getAttribute('src') !== (d.src || '')) img.src = d.src || '';
  } else if (d.type === 'shape') {
    const box = dom.querySelector('.s-box');
    if (box) {
      let lb = box.querySelector('.s-label');
      if (d.label) { if (!lb) { lb = document.createElement('span'); lb.className = 's-label'; box.appendChild(lb); } lb.textContent = d.label; }
      else if (lb) lb.remove();
    }
  } else if (d.type === 'ink') {
    const old = body.querySelector('svg');
    const nw = inkSvg(d);
    if (old) body.replaceChild(nw, old); else body.appendChild(nw);
  } else if (d.type === 'video') {
    const bar = dom.querySelector('.v-bar .t');
    if (bar) bar.textContent = d.title || ('B站 · ' + (d.bvid || ('av' + d.aid)));
    updateVideoScale(dom, d);
  }
}

/* ---------------- 连接线（思维导图） ---------------- */
const NS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}
function edgePoint(r, side) {
  switch (side) {
    case 'top': return { x: r.x + r.w / 2, y: r.y, nx: 0, ny: -1 };
    case 'bottom': return { x: r.x + r.w / 2, y: r.y + r.h, nx: 0, ny: 1 };
    case 'left': return { x: r.x, y: r.y + r.h / 2, nx: -1, ny: 0 };
    default: return { x: r.x + r.w, y: r.y + r.h / 2, nx: 1, ny: 0 };
  }
}
function autoSides(ra, rb) {
  const dx = (rb.x + rb.w / 2) - (ra.x + ra.w / 2);
  const dy = (rb.y + rb.h / 2) - (ra.y + ra.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}
function computeGeom(p1, p2, curve) {
  const pad = 52;
  const bx = Math.min(p1.x, p2.x) - pad, by = Math.min(p1.y, p2.y) - pad;
  const bw = Math.max(2, Math.abs(p1.x - p2.x) + pad * 2);
  const bh = Math.max(2, Math.abs(p1.y - p2.y) + pad * 2);
  const a = { x: p1.x - bx, y: p1.y - by }, b = { x: p2.x - bx, y: p2.y - by };
  let d;
  if (curve === 'line') {
    d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  } else {
    const k = clamp(Math.hypot(b.x - a.x, b.y - a.y) * 0.42, 32, 170);
    d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${(a.x + p1.nx * k).toFixed(1)} ${(a.y + p1.ny * k).toFixed(1)} ` +
        `${(b.x + p2.nx * k).toFixed(1)} ${(b.y + p2.ny * k).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return { x: bx, y: by, w: bw, h: bh, path: d };
}
function computeLink(d) {
  const a = findEl(d.from), b = findEl(d.to);
  if (!a || !b || a === b) return null;
  const ra = { x: a.x, y: a.y, w: a.w, h: a.h }, rb = { x: b.x, y: b.y, w: b.w, h: b.h };
  let sa = d.fromSide, sb = d.toSide;
  if (!sa || sa === 'auto' || !sb || sb === 'auto') {
    const pair = autoSides(ra, rb);
    if (!sa || sa === 'auto') sa = pair[0];
    if (!sb || sb === 'auto') sb = pair[1];
  }
  return computeGeom(edgePoint(ra, sa), edgePoint(rb, sb), d.curve || 'curve');
}
function previewGeom(srcId, side, pt) {
  const a = findEl(srcId);
  if (!a) return null;
  const ra = { x: a.x, y: a.y, w: a.w, h: a.h };
  const p1 = edgePoint(ra, side === 'auto' ? 'right' : side);
  const p2 = { x: pt.x, y: pt.y, nx: -p1.nx, ny: -p1.ny };
  return computeGeom(p1, p2, 'curve');
}
function linkSvg(d, g) {
  const svg = svgNode('svg', { width: d.w, height: d.h, viewBox: `0 0 ${d.w} ${d.h}` });
  const arrow = d.arrow || 'end';
  if (arrow !== 'none') {
    const defs = svgNode('defs', {});
    const m = svgNode('marker', {
      id: 'mk-' + d.id, viewBox: '0 0 10 10', refX: '9', refY: '5',
      markerWidth: '13', markerHeight: '13', markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse',
    });
    m.appendChild(svgNode('path', { d: 'M0 0.6 L10 5 L0 9.4 z' }));
    defs.appendChild(m);
    svg.appendChild(defs);
  }
  const dstr = g ? g.path : '';
  svg.appendChild(svgNode('path', { class: 'lk-hit', d: dstr }));
  const attrs = { class: 'lk-path', d: dstr };
  if (arrow === 'end' || arrow === 'both') attrs['marker-end'] = `url(#mk-${d.id})`;
  if (arrow === 'both') attrs['marker-start'] = `url(#mk-${d.id})`;
  svg.appendChild(svgNode('path', attrs));
  return svg;
}
function buildLink(d) {
  const dom = document.createElement('div');
  dom.className = 'el el-link';
  dom.dataset.id = d.id;
  const g = computeLink(d);
  if (g) { d.x = g.x; d.y = g.y; d.w = g.w; d.h = g.h; }
  setBox(dom, d);
  const body = document.createElement('div');
  body.className = 'el-body';
  body.appendChild(linkSvg(d, g));
  dom.appendChild(body);
  return dom;
}
function refreshLink(d) {
  const dom = domMap.get(d.id);
  if (!dom) return;
  const g = computeLink(d);
  if (!g) return;
  d.x = g.x; d.y = g.y; d.w = g.w; d.h = g.h;
  setBox(dom, d);
  const svg = dom.querySelector('svg');
  if (!svg) return;
  svg.setAttribute('width', d.w);
  svg.setAttribute('height', d.h);
  svg.setAttribute('viewBox', `0 0 ${d.w} ${d.h}`);
  svg.querySelectorAll('path.lk-hit, path.lk-path').forEach(p => p.setAttribute('d', g.path));
}

/* 从锚点 / 连线工具拖出一条新连接线 */
function startLinkDrag(e, srcId, side) {
  const tmp = { id: 'pv', type: 'link', from: srcId, to: srcId, fromSide: side || 'auto', toSide: 'auto', arrow: 'end', curve: 'curve', x: 0, y: 0, w: 2, h: 2 };
  const dom = document.createElement('div');
  dom.className = 'el el-link preview';
  dom.style.zIndex = -1;
  const body = document.createElement('div');
  body.className = 'el-body';
  dom.appendChild(body);
  world.appendChild(dom);

  let targetId = null, hoverId = null;
  const upd = ev => {
    const pt = screenToWorld(ev.clientX, ev.clientY);
    const g = previewGeom(srcId, side, pt);
    if (!g) return;
    tmp.x = g.x; tmp.y = g.y; tmp.w = g.w; tmp.h = g.h;
    setBox(dom, tmp);
    const svg = linkSvg({ id: 'pv', w: tmp.w, h: tmp.h, arrow: 'end' }, g);
    const old = body.querySelector('svg');
    if (old) body.replaceChild(svg, old); else body.appendChild(svg);

    const hitEl = document.elementFromPoint(ev.clientX, ev.clientY);
    const host = hitEl && hitEl.closest ? hitEl.closest('.el') : null;
    const id = host && !host.classList.contains('el-link') ? host.dataset.id : null;
    if (id !== hoverId) {
      if (hoverId) { const od = domMap.get(hoverId); if (od) od.classList.remove('link-target'); }
      if (id && id !== srcId) { const nd = domMap.get(id); if (nd) nd.classList.add('link-target'); }
      hoverId = id;
    }
    targetId = (id && id !== srcId) ? id : null;
  };
  drag = {
    mode: 'link', moved: true,
    move: upd,
    end() {
      dom.remove();
      if (hoverId) { const od = domMap.get(hoverId); if (od) od.classList.remove('link-target'); }
      if (targetId) {
        const d = createLink(srcId, targetId, side);
        select([d.id]);
      }
    }
  };
  bindDrag(e);
  upd(e);
}

function createLink(from, to, side, opts = {}) {
  const d = {
    id: uid(), type: 'link', from, to,
    fromSide: side || 'auto', toSide: 'auto', arrow: 'end', curve: 'curve',
    x: 0, y: 0, w: 2, h: 2,
  };
  const g = computeLink(d);
  if (g) { d.x = g.x; d.y = g.y; d.w = g.w; d.h = g.h; }
  addEl(d, { silent: true, noHistory: opts.noHistory });
  return d;
}

/* ---------------- 思维导图：子节点 + 自动对齐 ---------------- */
function childLinksOf(pid) {
  return els().filter(e => e.type === 'link' && e.from === pid);
}
function parentOf(id) {
  const l = els().find(e => e.type === 'link' && e.to === id);
  return l ? l.from : null;
}

/* 把一个节点的子节点重新排成右边一列，整列相对父节点垂直居中 */
function layoutChildren(pid) {
  const p = findEl(pid);
  if (!p) return;
  const kids = childLinksOf(pid).map(l => findEl(l.to)).filter(Boolean);
  if (!kids.length) return;
  const gapX = 140, gapY = 40;
  const totalH = kids.reduce((a, k) => a + k.h, 0) + gapY * (kids.length - 1);
  const x = Math.round(p.x + p.w + gapX);
  let y = p.y + (p.h - totalH) / 2;
  kids.forEach(k => {
    k.x = x;
    k.y = Math.round(y);
    y += k.h + gapY;
    const dom = domMap.get(k.id);
    if (dom) setBox(dom, k);
    updateLinksFor([k.id]);
  });
  drawMinimap();
  markDirty();
}

/* Tab 加子节点、Enter 加同级 —— 像思维导图那样一路敲下去 */
function addMindNode(id, mode) {
  const cur = findEl(id);
  if (!cur) return;
  let parent = cur;
  if (mode === 'sibling') {
    const pid = parentOf(id);
    if (pid) parent = findEl(pid) || cur;
  }
  pushHistory();
  const w = clamp(Math.round(cur.w), 150, 240);
  const h = 92;
  const node = {
    id: uid(), type: 'note',
    x: Math.round(parent.x + parent.w + 140),
    y: Math.round(parent.y + parent.h + 40),
    w, h, text: '',
    color: cur.type === 'note' ? (cur.color || 'c-yellow') : 'c-yellow',
  };
  addEl(node, { silent: true, noHistory: true });
  createLink(parent.id, node.id, 'right', { noHistory: true });
  layoutChildren(parent.id);
  select([node.id]);
  enterEdit(node.id);
}

/* ---------------- 对齐参考线 ---------------- */
function unionBox(items) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  items.forEach(o => {
    const d = o.d || o;
    x0 = Math.min(x0, d.x); y0 = Math.min(y0, d.y);
    x1 = Math.max(x1, d.x + d.w); y1 = Math.max(y1, d.y + d.h);
  });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* 找出与被拖内容最接近的对齐位置（左/中/右、上/中/下），返回吸附偏移 */
function snapFor(box, exclude) {
  const T = 6 / state.camera.scale;         // 6px 屏幕距离内才吸附
  const ex = [box.x, box.x + box.w / 2, box.x + box.w];
  const ey = [box.y, box.y + box.h / 2, box.y + box.h];
  let dx = 0, dy = 0, vx = null, hy = null, bx = T, by = T;
  for (const o of els()) {
    if (o.type === 'link' || exclude.has(o.id)) continue;
    const ox = [o.x, o.x + o.w / 2, o.x + o.w];
    const oy = [o.y, o.y + o.h / 2, o.y + o.h];
    for (const a of ox) for (const b of ex) {
      const d = a - b;
      if (Math.abs(d) < bx) { bx = Math.abs(d); dx = d; vx = a; }
    }
    for (const a of oy) for (const b of ey) {
      const d = a - b;
      if (Math.abs(d) < by) { by = Math.abs(d); dy = d; hy = a; }
    }
  }
  return { dx, dy, vx, hy };
}

function showGuides(vx, hy) {
  const g = $('#guides');
  if (!g) return;
  if (vx === null && hy === null) { g.classList.remove('on'); return; }
  g.classList.add('on');
  const gv = $('#gv'), gh = $('#gh');
  if (vx === null) gv.style.display = 'none';
  else { gv.style.display = 'block'; gv.style.left = worldToScreen(vx, 0).x + 'px'; }
  if (hy === null) gh.style.display = 'none';
  else { gh.style.display = 'block'; gh.style.top = worldToScreen(0, hy).y + 'px'; }
}
function hideGuides() {
  const g = $('#guides');
  if (g) g.classList.remove('on');
}
function updateLinksFor(ids) {
  const set = new Set(ids);
  for (const d of els()) {
    if (d.type === 'link' && (set.has(d.from) || set.has(d.to))) refreshLink(d);
  }
}
function updateAllLinks() {
  for (const d of els()) if (d.type === 'link') refreshLink(d);
}

function renderBoard() {
  world.innerHTML = '';
  domMap.clear();
  for (const d of els()) {
    const dom = buildEl(d);
    world.appendChild(dom);
    domMap.set(d.id, dom);
  }
  updateBoardMeta();
  renderBoardList();
  renderViews();
  renderViewRegions();
  drawMinimap();
}

/* ---------------- 增删元素 ---------------- */
function addEl(d, opts = {}) {
  if (!opts.noHistory) pushHistory();
  els().push(d);
  const dom = buildEl(d);
  world.appendChild(dom);
  domMap.set(d.id, dom);
  if (!opts.silent) {
    dom.classList.add('appear');
    setTimeout(() => dom.classList.remove('appear'), 480);
  }
  updateBoardMeta();
  drawMinimap();
  markDirty();
  return d;
}

function removeEls(ids) {
  if (!ids.length) return;
  pushHistory();
  const set = new Set(ids);
  // 连带删除依附其上的连接线
  const links = els().filter(e => e.type === 'link' && (set.has(e.from) || set.has(e.to))).map(e => e.id);
  const all = [...new Set([...ids, ...links])];
  all.forEach(id => {
    const dom = domMap.get(id);
    const i = els().findIndex(e => e.id === id);
    if (i >= 0) els().splice(i, 1);
    if (dom) {
      domMap.delete(id);
      dom.classList.add('leaving');
      setTimeout(() => dom.remove(), 240);
    }
    state.selection.delete(id);
    if (state.focusId === id) exitFocus(true);
  });
  updateCtxbar();
  updateBoardMeta();
  drawMinimap();
  markDirty();
}

function bringToFront(ids) {
  pushHistory();
  const maxZ = els().reduce((m, e) => Math.max(m, e.z || 0), 0);
  ids.forEach((id, i) => {
    const e = findEl(id);
    if (e) { e.z = maxZ + 1 + i; const dom = domMap.get(id); if (dom) dom.style.zIndex = e.z; }
  });
  markDirty();
}

/* ---------------- 选择 ---------------- */
function select(ids, additive = false) {
  if (!additive) {
    state.selection.forEach(id => {
      const dom = domMap.get(id);
      if (dom) dom.classList.remove('sel', 'editable', 'anchors');
    });
    state.selection.clear();
  }
  const single = ids.length === 1 && (findEl(ids[0]) || {}).type !== 'link';
  ids.forEach(id => {
    state.selection.add(id);
    const dom = domMap.get(id);
    if (dom) {
      dom.classList.add('sel', 'editable');
      if (single) dom.classList.add('anchors');
      else dom.classList.remove('anchors');
    }
  });
  if (state.editingId && !state.selection.has(state.editingId)) exitEdit();
  updateCtxbar();
}
function clearSelection() { select([]); }

let ctxSig = '';
function updateCtxbar() {
  const ids = [...state.selection];
  const list = ids.map(findEl).filter(Boolean);
  if (!list.length || state.editingId) {
    ctxbar.classList.remove('show');
    ctxSig = '';
    return;
  }
  // 内容只在「选中的东西变了」时重建 —— 这个函数每帧都会被调用，
  // 每帧重设 innerHTML 会在相机飞行时白白吃掉十几帧
  const sig = list.map(e => [e.id, e.type, e.arrow, e.curve, e.fontSize, e.color, e.fill, e.shape, e.label].join(':')).join('|');
  if (sig !== ctxSig) {
    ctxSig = sig;
    ctxbar.innerHTML = ctxHtml(list);
  }
  ctxbar.classList.add('show');
  const b = bboxOf(list);
  const s = state.camera.scale;
  const sx = (b.x + b.w / 2 - state.camera.x) * s;
  const topY = (b.y - state.camera.y) * s;
  const botY = (b.y + b.h - state.camera.y) * s;
  if (sx < -80 || sx > innerWidth + 80 || botY < 40 || topY > innerHeight - 20) {
    ctxbar.classList.remove('show');
    return;
  }
  /* ⚠️ 别用 transform 做居中：入场动画 ctxIn 的 keyframes 会覆盖掉内联 transform，
     动画那 0.34 秒里工具条是偏的，动画一结束又跳回去 —— 手机上看着就是「错位」。
     改成直接算 left（减去自身一半宽度），把 transform 完全让给动画。 */
  const w = ctxbar.offsetWidth || 200;
  const h = ctxbar.offsetHeight || 38;
  const narrow = innerWidth < 700;
  const bottomLimit = innerHeight - (narrow ? 88 : 70);   // 手机底部还有工具栏 + 安全区
  // 元素贴着屏幕下边时，把工具条翻到元素上方，别压在工具栏上
  let top = botY + 16;
  if (top > bottomLimit) top = topY - 16 - h;
  top = clamp(top, 62, Math.max(62, bottomLimit));
  const left = clamp(sx - w / 2, 8, Math.max(8, innerWidth - w - 8));
  ctxbar.style.left = left + 'px';
  ctxbar.style.top = top + 'px';
  ctxbar.style.transform = '';
  ctxbar.classList.toggle('multi', h > 48);              // 换成多行时收一收圆角
}

const ICON = {
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  front: '<svg viewBox="0 0 24 24"><path d="M12 3l8 5-8 5-8-5z"/><path d="M4 13l8 5 8-5"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M12 21l-8-5 8-5 8 5z"/><path d="M4 11l8-5 8 5"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7L11.5 5"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7L12.5 19"/></svg>',
  reload: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 5v6h-6"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><path d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M4 12h15"/><path d="M13 6l6 6-6 6"/></svg>',
  arrow2: '<svg viewBox="0 0 24 24"><path d="M4 12h15"/><path d="M8 7l-4 5 4 5"/><path d="M20 7l-4 5 4 5"/></svg>',
  line: '<svg viewBox="0 0 24 24"><path d="M4 18L20 6"/></svg>',
  curve: '<svg viewBox="0 0 24 24"><path d="M4 18C10 18 14 6 20 6"/></svg>',
  child: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>',
  sibling: '<svg viewBox="0 0 24 24"><path d="M5 4v16"/><path d="M5 12h6a3 3 0 003-3V6"/><path d="M5 12h6a3 3 0 013 3v4"/></svg>',
  fill: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>',
  crop: '<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 002 2h14"/><path d="M2 6h14a2 2 0 012 2v14"/></svg>',
};
const SWATCHES = { 'c-yellow': '#FFE066', 'c-pink': '#FFAFCC', 'c-blue': '#A9D6FF', 'c-green': '#A8E6B8', 'c-purple': '#CDB4FF', 'c-gray': '#DCDCE1' };

function ctxHtml(list) {
  const one = list[0], all = list.length > 1;
  let html = '';
  if (!all && one.type === 'note') {
    html += '<div style="display:flex;gap:5px;padding:0 4px">';
    NOTE_COLORS.forEach(c => {
      const on = (one.color || 'c-yellow') === c ? ' on' : '';
      html += `<div class="sw ${c}${on}" data-act="color" data-v="${c}" style="background:${
        { 'c-yellow': '#FFE066', 'c-pink': '#FFAFCC', 'c-blue': '#A9D6FF', 'c-green': '#A8E6B8', 'c-purple': '#CDB4FF', 'c-gray': '#DCDCE1' }[c]
      }"></div>`;
    });
    html += '</div><div class="cdiv"></div>';
  }
  if (!all && (one.type === 'note' || one.type === 'text')) {
    html += `<div class="cx fs" data-act="font" data-v="-2" title="缩小字号 (⌘-)">A−</div>` +
            `<div class="fsv">${Math.round(fontSizeOf(one))}</div>` +
            `<div class="cx fs" data-act="font" data-v="2" title="放大字号 (⌘+)">A+</div>`;
    html += '<div class="cdiv"></div>';
    html += `<div class="cx" data-act="child" title="添加子节点 (Tab)">${ICON.child}</div>`;
    html += `<div class="cx" data-act="sibling" title="添加同级节点 (Enter)">${ICON.sibling}</div>`;
    html += '<div class="cdiv"></div>';
  }
  if (!all && one.type === 'link') {
    const ar = one.arrow || 'end';
    html += `<div class="cx" data-act="arrow" title="箭头：${ar === 'none' ? '无' : ar === 'both' ? '双向' : '单向'}">${ar === 'both' ? ICON.arrow2 : ar === 'none' ? ICON.line : ICON.arrow}</div>`;
    html += `<div class="cx" data-act="curve" title="${one.curve === 'line' ? '换成曲线' : '换成直线'}">${one.curve === 'line' ? ICON.curve : ICON.line}</div>`;
    html += '<div class="cdiv"></div>';
  }
  if (!all && one.type === 'video') {
    html += `<div class="cx" data-act="open" title="在 B 站打开">${ICON.link}</div>`;
    html += `<div class="cx" data-act="reload" title="重新载入播放器">${ICON.reload}</div>`;
    html += `<div class="cx" data-act="focus" title="聚焦">${ICON.fit}</div>`;
    html += '<div class="cdiv"></div>';
  }
  if (!all && one.type === 'shape') {
    html += '<div style="display:flex;gap:5px;padding:0 4px">';
    NOTE_COLORS.forEach(c => {
      const on = (one.color || 'c-blue') === c ? ' on' : '';
      html += `<div class="sw ${c}${on}" data-act="color" data-v="${c}" style="background:${SWATCHES[c]}"></div>`;
    });
    html += '</div><div class="cdiv"></div>';
    html += `<div class="cx" data-act="fill" title="切换填充 ${one.fill ? '（已填）' : '（描边）'}">${ICON.fill}</div>`;
    html += '<div class="cdiv"></div>';
  }
  if (!all && one.type === 'image') {
    html += `<div class="cx" data-act="crop" title="裁切为固定比例">${ICON.crop}</div>`;
    html += '<div class="cdiv"></div>';
  }
  if (!all && (one.type === 'image' || one.type === 'video')) {
    html += `<div class="cx" data-act="focus" title="聚焦">${ICON.fit}</div>`;
    html += '<div class="cdiv"></div>';
  }
  html += `<div class="cx" data-act="front" title="置顶">${ICON.front}</div>`;
  html += `<div class="cx" data-act="copy" title="再制">${ICON.copy}</div>`;
  html += `<div class="cx danger" data-act="del" title="删除">${ICON.trash}</div>`;
  return html;
}

ctxbar.addEventListener('pointerdown', e => {
  e.stopPropagation();
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  const ids = [...state.selection];
  const one = findEl(ids[0]);
  if (act === 'color' && one) {
    pushHistory();
    one.color = t.dataset.v;
    const dom = domMap.get(one.id);
    if (dom) dom.className = elClass(one) + ' sel editable';
    markDirty();
  } else if (act === 'fill' && one) {
    pushHistory();
    one.fill = !one.fill;
    const dom = domMap.get(one.id);
    if (dom) dom.className = elClass(one) + (dom.classList.contains('sel') ? ' sel' : '') + (dom.classList.contains('editable') ? ' editable' : '');
    markDirty();
    updateCtxbar();
  } else if (act === 'crop' && one) {
    openCrop(one);
  } else if (act === 'del') {
    removeEls(ids);
  } else if (act === 'copy') {
    duplicate(ids);
  } else if (act === 'front') {
    bringToFront(ids);
  } else if (act === 'focus' && one) {
    focusOn(one);
  } else if (act === 'open' && one) {
    const url = one.bvid ? `https://www.bilibili.com/video/${one.bvid}` : `https://www.bilibili.com/video/av${one.aid}`;
    window.open(url, '_blank', 'noopener');
  } else if (act === 'reload' && one) {
    const dom = domMap.get(one.id);
    if (dom) { unmountVideo(dom); mountVideo(dom, one); }
  } else if (act === 'font') {
    adjustFontSize(ids, +t.dataset.v);
  } else if (act === 'child' && one) {
    addMindNode(one.id, 'child');
  } else if (act === 'sibling' && one) {
    addMindNode(one.id, 'sibling');
  } else if (act === 'arrow' && one) {
    pushHistory();
    one.arrow = { none: 'end', end: 'both', both: 'none' }[one.arrow || 'end'] || 'end';
    rebuildLink(one);
    markDirty();
  } else if (act === 'curve' && one) {
    pushHistory();
    one.curve = one.curve === 'line' ? 'curve' : 'line';
    refreshLink(one);
    markDirty();
  }
});

/* 字号：改完自动长高，避免文字被裁掉 */
function adjustFontSize(ids, delta) {
  const list = ids.map(findEl).filter(d => d && (d.type === 'note' || d.type === 'text'))
    .filter(d => clamp(Math.round(fontSizeOf(d) + delta), 10, 120) !== fontSizeOf(d));
  if (!list.length) return;
  pushHistory();
  list.forEach(d => {
    d.fontSize = clamp(Math.round(fontSizeOf(d) + delta), 10, 120);
    refreshEl(d);
    autoGrow(d);
  });
  updateCtxbar();
  drawMinimap();
  markDirty();
}

function autoGrow(d) {
  const dom = domMap.get(d.id);
  const t = dom && dom.querySelector('.txt');
  if (!t) return;
  const pad = d.type === 'note' ? 38 : 12;
  const need = t.scrollHeight + pad;
  if (need > d.h && need < 1600) { d.h = need; setBox(dom, d); }
  updateLinksFor([d.id]);
}

function rebuildLink(d) {
  const dom = domMap.get(d.id);
  if (!dom) return;
  const g = computeLink(d);
  if (g) { d.x = g.x; d.y = g.y; d.w = g.w; d.h = g.h; }
  setBox(dom, d);
  const body = dom.querySelector('.el-body');
  body.innerHTML = '';
  body.appendChild(linkSvg(d, g));
}

function duplicate(ids) {
  pushHistory();
  const copies = [];
  ids.forEach(id => {
    const e = findEl(id);
    if (!e || e.type === 'link') return;      // 连线不参与复制
    const c = JSON.parse(JSON.stringify(e));
    c.id = uid();
    c.x += 28; c.y += 28;
    c.z = els().reduce((m, x) => Math.max(m, x.z || 0), 0) + 1;
    els().push(c);
    const dom = buildEl(c);
    dom.classList.add('appear');
    setTimeout(() => dom.classList.remove('appear'), 480);
    world.appendChild(dom);
    domMap.set(c.id, dom);
    copies.push(c.id);
  });
  select(copies);
  updateBoardMeta();
  markDirty();
}

/* ---------------- 视频挂载（懒加载，保证流畅） ---------------- */
function videoSrc(d) {
  const base = 'https://player.bilibili.com/player.html';
  const q = d.bvid ? `bvid=${d.bvid}` : `aid=${d.aid}`;
  return `${base}?${q}&page=${d.page || 1}&high_quality=1&danmaku=0&as_wide=1&autoplay=0`;
}
function mountVideo(dom, d) {
  if (dom.querySelector('.v-frame')) return;
  const f = document.createElement('iframe');
  f.className = 'v-frame';
  f.src = videoSrc(d);
  f.setAttribute('allowfullscreen', '');
  f.setAttribute('allow', 'fullscreen; autoplay; encrypted-media; picture-in-picture');
  f.setAttribute('scrolling', 'no');
  f.setAttribute('frameborder', '0');
  const stub = dom.querySelector('.v-stub');
  if (stub) stub.remove();
  // iframe 固定用「内部基准尺寸」渲染（B 站播放器只在加载时排一次版），
  // 之后靠 transform 缩放去跟随卡片大小 —— 既不重载、也不丢播放进度
  const base = videoBase(d);
  f.style.width = base.w + 'px';
  f.style.height = base.h + 'px';
  dom.dataset.vw = base.w;
  dom.dataset.vh = base.h;
  dom.querySelector('.el-body').appendChild(f);
  updateVideoScale(dom, d);
  dom.classList.remove('paused');
  dom.dataset.mounted = '1';
}

/* 基准尺寸 = 卡片当前尺寸的 2 倍（超采样，放大也清楚），并夹在合理区间 */
function videoBase(d) {
  return {
    w: clamp(Math.round(d.w * 2), 640, 2560),
    h: clamp(Math.round(Math.max(40, d.h - 34) * 2), 360, 1440),
  };
}
function updateVideoScale(dom, d) {
  const f = dom.querySelector('.v-frame');
  if (!f) return;
  const bw = +dom.dataset.vw || 1000, bh = +dom.dataset.vh || 562;
  const k = Math.min(d.w / bw, Math.max(40, d.h - 34) / bh);
  f.style.transformOrigin = '0 0';
  f.style.transform = `scale(${k})`;
}
function unmountVideo(dom) {
  const f = dom.querySelector('.v-frame');
  if (f) f.remove();
  dom.classList.add('paused');
  delete dom.dataset.mounted;
  if (!dom.querySelector('.v-stub')) {
    const stub = document.createElement('div');
    stub.className = 'v-stub';
    stub.innerHTML = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="1.6"><rect x="2.5" y="5" width="19" height="14" rx="3.5"/><path d="M10.5 9.5l5 2.5-5 2.5z" fill="rgba(255,255,255,.8)" stroke="none"/></svg><span>点击载入播放器</span>`;
    dom.querySelector('.el-body').appendChild(stub);
  }
}

/* ---------------- 聚焦（景深 + 相机飞行） ---------------- */
function focusOn(d) {
  if (state.focusId === d.id) return;
  if (!state.focusId) state.camBeforeFocus = { ...state.camera };
  pushHistoryless(() => {});
  state.focusId = d.id;
  setImmersive(true);
  for (const e of els()) {
    const dom = domMap.get(e.id);
    if (!dom) continue;
    dom.classList.toggle('dimmed', e.id !== d.id);
  }
  const vw = innerWidth, vh = innerHeight;
  const sc = clamp(Math.min(vw * 0.62 / d.w, vh * 0.68 / d.h), 0.15, 2.2);
  const c = centerCam(d.x + d.w / 2, d.y + d.h / 2, sc);
  flyTo(c.x, c.y, sc, dur(760));
  select([d.id]);
  ctxbar.classList.remove('show');
}
function exitFocus(instant) {
  if (!state.focusId) return;
  state.focusId = null;
  setImmersive(false);
  for (const dom of domMap.values()) dom.classList.remove('dimmed');
  const c = state.camBeforeFocus;
  state.camBeforeFocus = null;
  if (c) flyTo(c.x, c.y, c.scale, instant ? 0 : 680);
}
function pushHistoryless() { }

function setImmersive(on) {
  state.immersive = on;
  document.body.classList.toggle('immersive', on);
}

/* ---------------- 文本编辑 ---------------- */
function enterEdit(id) {
  const d = findEl(id);
  const dom = domMap.get(id);
  if (!d || !dom) return;
  if (d.type !== 'note' && d.type !== 'text') return;
  state.editingId = id;
  dom.classList.add('editing');
  dom.classList.remove('editable', 'anchors');   // 编辑时收起手柄与连接锚点
  const t = dom.querySelector('.txt');
  t.contentEditable = 'true';
  t.focus();
  const r = document.createRange();
  r.selectNodeContents(t);
  r.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  ctxbar.classList.remove('show');
}
function exitEdit() {
  const id = state.editingId;
  if (!id) return;
  const dom = domMap.get(id);
  state.editingId = null;
  if (dom) {
    dom.classList.remove('editing');
    const t = dom.querySelector('.txt');
    if (t) {
      t.contentEditable = 'false';
      const d = findEl(id);
      if (d && d.text !== t.textContent) { d.text = t.textContent; markDirty(); }
      t.blur();
    }
    if (state.selection.has(id)) {
      dom.classList.add('editable');
      if (state.selection.size === 1) dom.classList.add('anchors');
    }
  }
  if (getSelection()) getSelection().removeAllRanges();
  updateCtxbar();
}

/* ---------------- 指针交互 ---------------- */
let drag = null;
let spaceDown = false;

/* 触屏多指：双指 = 缩放 + 平移 */
const touchPts = new Map();
let pinch = null;

function startPinch() {
  if (touchPts.size < 2) return;
  // 第二指落下：取消单指正在进行的操作（拖拽 / 框选 / 画笔）
  if (drag) { const d = drag; if (d.end) d.end(); if (drag === d) drag = null; }
  marquee.style.display = 'none';
  document.body.classList.remove('dragging');
  cancelCamAnim();
  const [a, b] = [...touchPts.values()];
  pinch = {
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
    cam: { ...state.camera },
  };
}
function endPinch() {
  if (!pinch) return;
  pinch = null;
  markDirty();
}
function updatePinch() {
  if (!pinch || touchPts.size < 2) return;
  const [a, b] = [...touchPts.values()];
  const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const s0 = pinch.cam.scale;
  const s1 = clamp(s0 * (dist / pinch.dist), MIN_SCALE, MAX_SCALE);
  // 按下时中点对应的世界点，始终跟随当前中点
  const wx = pinch.mx / s0 + pinch.cam.x;
  const wy = pinch.my / s0 + pinch.cam.y;
  state.camera.scale = s1;
  state.camera.x = wx - mx / s1;
  state.camera.y = wy - my / s1;
  requestTick();
}

stage.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch') return;
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchPts.size === 2) startPinch();
});
window.addEventListener('pointermove', e => {
  if (e.pointerType !== 'touch' || !touchPts.has(e.pointerId)) return;
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch) updatePinch();
}, { passive: true });
['pointerup', 'pointercancel'].forEach(t => window.addEventListener(t, e => {
  if (e.pointerType !== 'touch') return;
  touchPts.delete(e.pointerId);
  if (touchPts.size < 2) endPinch();
}));

stage.addEventListener('pointerdown', onDown);

/* 右键用于平移后，画布上的系统菜单要关掉（编辑文字时保留，方便粘贴） */
stage.addEventListener('contextmenu', e => {
  if (state.editingId) return;
  if (e.target.closest('.txt')) return;
  e.preventDefault();
});

function onDown(e) {
  if (pinch) return;                   // 双指手势进行中，不再走单指逻辑
  if (e.target.closest('.ctxbar') || e.target.closest('.topbar') || e.target.closest('.toolbar')) return;

  // 右键：直接拖画布（编辑文字时让位给系统的粘贴菜单）
  if (e.button === 2) {
    if (state.editingId) return;
    startPan(e);
    return;
  }

  const elDom = e.target.closest('.el');
  const vid = elDom && elDom.classList.contains('el-video');

  // 视频卡：点击占位层 → 载入播放器
  if (vid && elDom.classList.contains('paused') && state.tool === 'select' && !spaceDown && e.button !== 1) {
    const d = findEl(elDom.dataset.id);
    if (d) mountVideo(elDom, d);
    select([d.id]);
    e.preventDefault();
    return;
  }

  if (state.editingId && elDom && elDom.dataset.id === state.editingId) return; // 编辑中不劫持
  if (state.editingId && (!elDom || elDom.dataset.id !== state.editingId)) exitEdit();

  const panMode = e.button === 1 || spaceDown || state.tool === 'pan';

  if (state.tool === 'erase') {
    if (elDom) { removeEls([elDom.dataset.id]); }
    return;
  }
  if (state.tool === 'ink' && !panMode) { startInk(e); return; }

  if (elDom && !panMode) {
    const id = elDom.dataset.id;
    const isLink = elDom.classList.contains('el-link');
    if (state.tool === 'link' && !isLink) { select([id]); startLinkDrag(e, id, 'auto'); return; }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    let ids;
    if (additive) {
      ids = state.selection.has(id) ? [...state.selection] : [...state.selection, id];
    } else {
      ids = state.selection.has(id) ? [...state.selection] : [id];
    }
    select(ids, additive);
    if (isLink) return;               // 连线跟随端点自动重算，不直接拖动
    startDrag(e, ids);
    return;
  }

  if (panMode) { startPan(e); return; }

  if (state.tool === 'select') {
    // 触屏上单指拖空白更自然的是平移（框选留给桌面鼠标）
    if (e.pointerType === 'touch') { startPan(e); return; }
    if (state.focusId) { exitFocus(); return; }   // 聚焦时点一下空白就退出
    startMarquee(e);
    return;
  }

  // 创建型工具
  const p = screenToWorld(e.clientX, e.clientY);
  if (state.tool === 'note') createNote(p);
  else if (state.tool === 'text') createText(p);
  else if (state.tool === 'shape') createShape(p);
  setTool('select');
}

function startPan(e) {
  cancelCamAnim();
  const sx = e.clientX, sy = e.clientY;
  const c0 = { ...state.camera };
  drag = {
    mode: 'pan', moved: false,
    move(ev) {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) {
        drag.moved = true;
        document.body.classList.add('dragging');
        stage.classList.add('is-panning');
      }
      if (!drag.moved) return;
      state.camera.x = c0.x - dx / state.camera.scale;
      state.camera.y = c0.y - dy / state.camera.scale;
      requestTick();
    },
    end() {
      document.body.classList.remove('dragging');
      stage.classList.remove('is-panning');
      if (drag.moved) markDirty();
    }
  };
  bindDrag(e);
}

function startDrag(e, ids) {
  cancelCamAnim();
  const sx = e.clientX, sy = e.clientY;
  const items = ids.map(id => ({ id, d: findEl(id) })).filter(o => o.d);
  const start = items.map(o => ({ id: o.id, x: o.d.x, y: o.d.y }));
  const links = els().filter(e => e.type === 'link' && ids.includes(e.from) || (e.type === 'link' && ids.includes(e.to)));
  drag = {
    mode: 'drag', moved: false, ids,
    move(ev) {
      const dx = (ev.clientX - sx) / state.camera.scale;
      const dy = (ev.clientY - sy) / state.camera.scale;
      if (!drag.moved && Math.abs(dx * state.camera.scale) + Math.abs(dy * state.camera.scale) > 3) {
        drag.moved = true;
        pushHistory();
        document.body.classList.add('dragging');
        items.forEach(o => domMap.get(o.id)?.classList.add('dragging'));
      }
      if (!drag.moved) return;
      start.forEach(s => {
        const d = findEl(s.id);
        if (!d) return;
        d.x = s.x + dx; d.y = s.y + dy;
        const dom = domMap.get(s.id);
        if (dom) setBox(dom, d);
      });
      // 对齐吸附（按住 ⌘/Ctrl 可临时关掉）
      const snap = (ev.metaKey || ev.ctrlKey)
        ? { dx: 0, dy: 0, vx: null, hy: null }
        : snapFor(unionBox(items), new Set(ids));
      if (snap.dx || snap.dy) {
        items.forEach(o => {
          const d = findEl(o.id);
          if (!d) return;
          d.x += snap.dx; d.y += snap.dy;
          const dom = domMap.get(o.id);
          if (dom) setBox(dom, d);
        });
      }
      showGuides(snap.vx, snap.hy);
      links.forEach(refreshLink);     // 连线实时跟随
      updateCtxbar();
    },
    end() {
      hideGuides();
      document.body.classList.remove('dragging');
      items.forEach(o => domMap.get(o.id)?.classList.remove('dragging'));
      if (drag.moved) {
        items.forEach(o => {
          const dom = domMap.get(o.id);
          if (dom) {
            dom.classList.add('dropped');
            setTimeout(() => dom.classList.remove('dropped'), 320);
          }
        });
        drawMinimap();
        markDirty();
      }
    }
  };
  bindDrag(e);
}

function startMarquee(e) {
  const sx = e.clientX, sy = e.clientY;
  const additive = e.shiftKey;
  const base = additive ? [...state.selection] : [];
  drag = {
    mode: 'marquee', moved: false,
    move(ev) {
      const x = Math.min(sx, ev.clientX), y = Math.min(sy, ev.clientY);
      const w = Math.abs(ev.clientX - sx), h = Math.abs(ev.clientY - sy);
      if (!drag.moved && w + h > 4) { drag.moved = true; marquee.style.display = 'block'; }
      if (!drag.moved) return;
      marquee.style.left = x + 'px'; marquee.style.top = y + 'px';
      marquee.style.width = w + 'px'; marquee.style.height = h + 'px';
      const a = screenToWorld(x, y), b = screenToWorld(x + w, y + h);
      const hit = els().filter(el => !(el.x + el.w < a.x || el.x > b.x || el.y + el.h < a.y || el.y > b.y)).map(el => el.id);
      select([...new Set([...base, ...hit])]);
    },
    end() {
      marquee.style.display = 'none';
      if (!drag.moved) clearSelection();
    }
  };
  bindDrag(e);
}

/* 缩放手柄 */
stage.addEventListener('pointerdown', e => {
  const anchor = e.target.closest('.anchor');
  if (anchor) {
    e.stopPropagation();
    startLinkDrag(e, anchor.closest('.el').dataset.id, anchor.dataset.a);
    return;
  }
  const h = e.target.closest('.handle');
  if (!h) return;
  e.stopPropagation();
  const id = h.closest('.el').dataset.id;
  const d = findEl(id);
  if (!d) return;
  cancelCamAnim();
  pushHistory();
  const sx = e.clientX, sy = e.clientY;
  const s0 = { x: d.x, y: d.y, w: d.w, h: d.h };
  const dir = h.dataset.h;
  const ratio = (d.type === 'video' || d.type === 'image') ? s0.h / s0.w : 0;
  const links = els().filter(e => e.type === 'link' && (e.from === id || e.to === id));
  drag = {
    mode: 'resize', moved: false,
    move(ev) {
      const dx = (ev.clientX - sx) / state.camera.scale;
      const dy = (ev.clientY - sy) / state.camera.scale;
      let w = s0.w, h = s0.h, x = s0.x, y = s0.y;
      if (dir.includes('e')) w = s0.w + dx;
      if (dir.includes('s')) h = s0.h + dy;
      if (dir.includes('w')) { w = s0.w - dx; x = s0.x + dx; }
      if (dir.includes('n')) { h = s0.h - dy; y = s0.y + dy; }
      w = Math.max(60, w); h = Math.max(45, h);
      if (ratio) h = w * ratio;
      d.w = w; d.h = h; d.x = x; d.y = y;
      const dom = domMap.get(id);
      if (dom) {
        setBox(dom, d);
        if (d.type === 'video') updateVideoScale(dom, d);   // 视频跟着卡片实时缩放
      }
      links.forEach(refreshLink);
      updateCtxbar();
    },
    end() {
      refreshEl(d);
      links.forEach(refreshLink);
      drawMinimap();
      markDirty();
    }
  };
  bindDrag(e);
}, true);

/* 画笔 */
let inkLive = null;
function startInk(e) {
  pushHistory();                       // 入栈：undo 可撤销整笔
  const p = screenToWorld(e.clientX, e.clientY);
  const d = { id: uid(), type: 'ink', x: p.x, y: p.y, w: 1, h: 1, points: [[p.x, p.y]] };
  els().push(d);
  const dom = buildEl(d);
  world.appendChild(dom);
  domMap.set(d.id, dom);
  inkLive = { d, dom, last: p };
  drag = {
    mode: 'ink', moved: true,
    move(ev) {
      const q = screenToWorld(ev.clientX, ev.clientY);
      const last = inkLive.last;
      if (Math.hypot(q.x - last.x, q.y - last.y) * state.camera.scale < 2.2) return;
      inkLive.d.points.push([q.x, q.y]);
      inkLive.last = q;
      updateInkFrame(inkLive.d, dom);
    },
    end() {
      const pts = d.points;
      if (pts.length < 2) {
        const i = els().findIndex(e2 => e2.id === d.id);
        if (i >= 0) els().splice(i, 1);
        domMap.delete(d.id);
        dom.remove();
      } else {
        finalizeInk(d);
        select([d.id]);
        updateBoardMeta();
      }
      inkLive = null;
      drawMinimap();
      markDirty();
    }
  };
  bindDrag(e);
}
function updateInkFrame(d, dom) {
  const xs = d.points.map(p => p[0]), ys = d.points.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const pad = 6;
  d.x = minX - pad; d.y = minY - pad;
  d.w = Math.max(...xs) - minX + pad * 2;
  d.h = Math.max(...ys) - minY + pad * 2;
  setBox(dom, d);
  const path = dom.querySelector('path');
  if (path) path.setAttribute('d', ptsToPath(d.points));
  const svg = dom.querySelector('svg');
  if (svg) { svg.setAttribute('width', d.w); svg.setAttribute('height', d.h); svg.setAttribute('viewBox', `0 0 ${d.w} ${d.h}`); }
}
function finalizeInk(d) {
  const dom = domMap.get(d.id);
  if (!dom) return;
  const svg = dom.querySelector('svg');
  if (svg) { svg.setAttribute('width', d.w); svg.setAttribute('height', d.h); }
  const path = dom.querySelector('path');
  if (path) path.setAttribute('d', ptsToPath(d.points));
}

function bindDrag(e) {
  const move = ev => { if (drag && drag.move) drag.move(ev); };
  const up = ev => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (drag) {
      const d = drag;
      if (d.end) d.end(ev);            // end 内部仍可读取 drag 状态
      if (drag === d) drag = null;
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  e.preventDefault();
}

/* 双击 */
stage.addEventListener('dblclick', e => {
  const elDom = e.target.closest('.el');
  if (elDom) {
    const d = findEl(elDom.dataset.id);
    if (!d) return;
    if (d.type === 'note' || d.type === 'text') { select([d.id]); enterEdit(d.id); }
    else focusOn(d);
  } else {
    if (state.focusId) exitFocus();
    else fitAll(560);
  }
});

/* 滚轮：缩放 / 平移 */
stage.addEventListener('wheel', e => {
  e.preventDefault();
  cancelCamAnim();
  if (state.editingId) exitEdit();
  const trackpadPan = !e.ctrlKey && (Math.abs(e.deltaX) > 0 || !Number.isInteger(e.deltaY));
  if (trackpadPan) {
    // 双指滑动 → 平移
    state.camera.x += e.deltaX / state.camera.scale;
    state.camera.y += e.deltaY / state.camera.scale;
    requestTick();
    markDirty();
    return;
  }
  const unit = e.deltaMode === 1 ? 18 : (e.deltaMode === 2 ? 320 : 1);
  const delta = e.deltaY * unit;
  const factor = Math.exp(-delta * (e.ctrlKey ? 0.012 : 0.0022));
  zoomBy(clamp(factor, 0.5, 2), e.clientX, e.clientY);
}, { passive: false });

/* ---------------- 键盘 ---------------- */
window.addEventListener('keydown', e => {
  const typing = e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if (e.code === 'Space' && !typing) {
    if (state.presenting) { e.preventDefault(); stepView(e.shiftKey ? -1 : 1); return; }
    if (!spaceDown) { spaceDown = true; stage.classList.add('space'); }
    e.preventDefault();
    return;
  }
  if (typing) {
    if (e.key === 'Escape') { e.target.blur(); exitEdit(); }
    return;
  }
  const meta = e.metaKey || e.ctrlKey;

  if (meta && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (meta && e.key.toLowerCase() === 'a') { e.preventDefault(); select(els().map(x => x.id)); return; }
  if (meta && e.key.toLowerCase() === 'c') { copySelection(); return; }
  if (meta && e.key.toLowerCase() === 'v') { /* 由 paste 事件处理 */ return; }
  if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate([...state.selection]); return; }
  if (meta && e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleBoards(); return; }
  if (meta && e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); captureView(); return; }
  if (meta && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); togglePresent(); return; }
  if (meta && (e.key === '=' || e.key === '+')) { e.preventDefault(); adjustFontSize([...state.selection], 2); return; }
  if (meta && (e.key === '-' || e.key === '_')) { e.preventDefault(); adjustFontSize([...state.selection], -2); return; }
  if (meta) return;

  if (state.presenting) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); stepView(1); return; }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); stepView(-1); return; }
  }

  switch (e.key) {
    case 'Tab': {
      if (state.selection.size === 1) {
        const id = [...state.selection][0];
        const d = findEl(id);
        if (d && (d.type === 'note' || d.type === 'text')) { e.preventDefault(); addMindNode(id, 'child'); }
      }
      break;
    }
    case 'Enter': {
      if (state.selection.size === 1) {
        const id = [...state.selection][0];
        const d = findEl(id);
        if (d && (d.type === 'note' || d.type === 'text')) { e.preventDefault(); addMindNode(id, 'sibling'); }
      }
      break;
    }
    case 'l': case 'L': setTool('link'); break;
    case 'v': case 'V': setTool('select'); break;
    case 'h': case 'H': setTool('pan'); break;
    case 'n': case 'N': setTool('note'); break;
    case 't': case 'T': setTool('text'); break;
    case 'i': case 'I': setTool('image'); openImage(); break;
    case 'b': case 'B': setTool('video'); openVideoModal(); break;
    case 'p': case 'P': setTool('ink'); break;
    case 'e': case 'E': setTool('erase'); break;
    case '1': fitAll(); break;
    case '0': flyTo(state.camera.x, state.camera.y, 1, 420); break;
    case 'ArrowRight': if ((board().views || []).length) { e.preventDefault(); stepView(1); } break;
    case 'ArrowLeft': if ((board().views || []).length) { e.preventDefault(); stepView(-1); } break;
    case 'Escape':
      if (state.presenting) { togglePresent(false); }
      else if (state.focusId) exitFocus();
      else if (state.editingId) exitEdit();
      else if (helpMask.classList.contains('show')) helpMask.classList.remove('show');
      else if (modalMask.classList.contains('show')) closeModal();
      else if (!boardsPanel.classList.contains('hidden')) toggleBoards(false);
      else clearSelection();
      break;
    case 'Delete': case 'Backspace':
      if (state.selection.size) { e.preventDefault(); removeEls([...state.selection]); }
      break;
    case 'Enter':
      if (state.selection.size === 1) {
        const d = findEl([...state.selection][0]);
        if (d && (d.type === 'note' || d.type === 'text')) enterEdit(d.id);
      }
      break;
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') { spaceDown = false; stage.classList.remove('space'); }
});
window.addEventListener('blur', () => { spaceDown = false; stage.classList.remove('space'); });

/* ---------------- 剪贴板 / 拖放 ---------------- */
let clipboard = [];
function copySelection() {
  clipboard = [...state.selection].map(findEl).filter(Boolean).map(e => JSON.parse(JSON.stringify(e)));
  if (clipboard.length) showToast(`已复制 ${clipboard.length} 个元素`);
}
window.addEventListener('paste', e => {
  if (e.target.isContentEditable || e.target.tagName === 'INPUT') return;
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) { addImageFile(f, screenToWorld(innerWidth / 2, innerHeight / 2)); e.preventDefault(); }
      return;
    }
  }
  const txt = (e.clipboardData || window.clipboardData).getData('text');
  if (!txt) return;
  const bili = parseBili(txt);
  if (bili) {
    addVideo(bili, screenToWorld(innerWidth / 2, innerHeight / 2));
    showToast('已插入 B 站视频');
    e.preventDefault();
    return;
  }
  if (/^https?:\/\//i.test(txt.trim()) && /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(txt.trim())) {
    addImageUrl(txt.trim(), screenToWorld(innerWidth / 2, innerHeight / 2));
    showToast('已插入图片');
    e.preventDefault();
  }
});

['dragenter', 'dragover'].forEach(t => stage.addEventListener(t, e => {
  if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dropHint.classList.add('show'); }
}));
['dragleave', 'dragend'].forEach(t => stage.addEventListener(t, e => {
  if (e.relatedTarget === null || e.target === stage) dropHint.classList.remove('show');
}));
stage.addEventListener('drop', e => {
  e.preventDefault();
  dropHint.classList.remove('show');
  const files = [...(e.dataTransfer.files || [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  const p0 = screenToWorld(e.clientX, e.clientY);
  files.forEach((f, i) => addImageFile(f, { x: p0.x + i * 32, y: p0.y + i * 32 }));
  showToast(`已置入 ${files.length} 张图片`);
});

/* ---------------- 创建元素 ---------------- */
function createNote(p) {
  const d = { id: uid(), type: 'note', x: p.x - 105, y: p.y - 90, w: 210, h: 180, text: '', color: 'c-yellow' };
  addEl(d);
  select([d.id]);
  enterEdit(d.id);
}
function createText(p) {
  const d = { id: uid(), type: 'text', x: p.x - 130, y: p.y - 30, w: 260, h: 60, text: '' };
  addEl(d);
  select([d.id]);
  enterEdit(d.id);
}
function createShape(p) {
  const kind = state.shapeKind || 'rect';
  const w = 220, h = 140;
  const d = { id: uid(), type: 'shape', shape: kind, x: p.x - w / 2, y: p.y - h / 2, w, h, color: 'c-blue' };
  if (kind === 'ellipse') d.h = 160;
  addEl(d);
  select([d.id]);
}

/* ---------------- 图片裁切（固定比例，中心裁切 + 重采样） ---------------- */
const cropPop = $('#cropPop');
let cropTargetId = null;
function openCrop(d) {
  if (!d || d.type !== 'image') return showToast('请先选中一张图片');
  if (!d.src) return showToast('这张图片没有可裁切的源图');
  cropTargetId = d.id;
  cropPop.classList.add('show');
}
function cropApply(ratioStr) {
  const d = findEl(cropTargetId);
  cropPop.classList.remove('show');
  if (!d || d.type !== 'image' || !d.src) return;
  const [rw, rh] = ratioStr.split(':').map(Number);
  const r = rw / rh;
  pushHistory();
  const img = new Image();
  img.onload = () => {
    const W = img.naturalWidth || 0, H = img.naturalHeight || 0;
    if (!W || !H) { showToast('图片还没加载好，稍后再试'); return; }
    let cw, ch, cx, cy;
    if (W / H >= r) { ch = H; cw = Math.round(H * r); cx = Math.round((W - cw) / 2); cy = 0; }
    else { cw = W; ch = Math.round(W / r); cx = 0; cy = Math.round((H - ch) / 2); }
    const k = Math.min(1, 2048 / Math.max(cw, ch));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(cw * k)); cv.height = Math.max(1, Math.round(ch * k));
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cv.width, cv.height);
    let url;
    try {
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let alpha = false;
      for (let i = 3; i < data.length; i += 4 * 53) if (data[i] < 250) { alpha = true; break; }
      url = alpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.9);
    } catch (e) { url = cv.toDataURL('image/jpeg', 0.9); }
    d.src = url; delete d.imgId;          // 裁切后改为本地源，避免还指向旧的云图
    // 维持视觉高度，宽度按新比例换算
    d.w = Math.round((d.h || 140) * r);
    refreshEl(d);
    drawMinimap();
    markDirty();
    showToast('已裁切为 ' + ratioStr);
  };
  img.onerror = () => showToast('图片加载失败，无法裁切');
  img.src = d.src;
}
function openImage() { fileInput.value = ''; fileInput.click(); setTool('select'); }
fileInput.addEventListener('change', () => {
  const files = [...fileInput.files].filter(f => f.type.startsWith('image/'));
  addImages(files);
});
function addImages(files) {
  if (!files.length) return;
  const c = screenToWorld(innerWidth / 2, innerHeight / 2);
  const n = files.length;
  files.forEach((f, i) => {
    const cols = Math.min(4, n);
    const gx = (i % cols) - (cols - 1) / 2, gy = Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2;
    addImageFile(f, { x: c.x + gx * 60, y: c.y + gy * 60 });
  });
  if (n <= 6) showToast(`已置入 ${n} 张图片`);   // 批量时静默，不打扰
}

/* 图片一律先降采样再进画布：原始相机图动辄好几 MB，塞进 localStorage 会直接写爆 */
const IMG_MAX_SIDE = 2048;      // 最长边上限（画布上放大到 3~4 倍仍然是清晰的）
const IMG_KEEP_RAW = 400000;    // 小于这个长度（约 290KB）的原图直接用，避免二次压缩掉画质
const IMG_QUALITY = 0.88;       // JPEG 质量

function downscale(dataUrl) {
  return new Promise(resolve => {
    if (dataUrl.length <= IMG_KEEP_RAW) return resolve(dataUrl);
    const img = new Image();
    img.onload = () => {
      try {
        const nw = img.naturalWidth || 0, nh = img.naturalHeight || 0;
        if (!nw || !nh) return resolve(dataUrl);
        const k = Math.min(1, IMG_MAX_SIDE / Math.max(nw, nh));
        if (k >= 1) return resolve(dataUrl);
        const cv = document.createElement('canvas');
        cv.width = Math.round(nw * k);
        cv.height = Math.round(nh * k);
        const ctx = cv.getContext('2d');
        if (!ctx || !ctx.drawImage) return resolve(dataUrl);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, cv.width, cv.height);

        // 带透明的图必须走 PNG，否则 JPEG 会把透明区压成黑底
        let hasAlpha = false;
        try {
          const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
          for (let i = 3; i < data.length; i += 4 * 53) {
            if (data[i] < 250) { hasAlpha = true; break; }
          }
        } catch (e) { hasAlpha = false; }

        const out = hasAlpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', IMG_QUALITY);
        resolve(out && out.length && out.length < dataUrl.length ? out : dataUrl);
      } catch (err) { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function addImageFile(file, p) {
  const fr = new FileReader();
  fr.onload = async () => {
    const raw = String(fr.result || '');
    if (!raw) return showToast('图片读取失败');
    let src = raw;
    try { src = await downscale(raw); } catch (e) { src = raw; }

    // 云同步开着就把图片传到云存储：画布数据里只留一个短链接。
    // 好处有两个：图片也能跨设备看到，且不再挤占本机 localStorage 的 5MB 额度。
    // 没开云同步（或上传失败）就照旧存 base64，功能不退化。
    const up = await cloudUploadImage(src);
    const useSrc = up ? up.url : src;

    const img = new Image();
    img.onload = () => {
      const maxW = 460;
      const w = Math.min(maxW, img.naturalWidth || maxW);
      const h = w * (img.naturalHeight || maxW) / (img.naturalWidth || maxW);
      const d = { id: uid(), type: 'image', x: p.x - w / 2, y: p.y - h / 2, w, h, src: useSrc };
      if (up) d.imgId = up.id;
      addEl(d);
      if (up) scheduleCloudPush();
    };
    img.onerror = () => showToast('图片读取失败');
    img.src = useSrc;
  };
  fr.onerror = () => showToast('图片读取失败');
  fr.readAsDataURL(file);
}
function addImageUrl(url, p) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const maxW = 460;
    const w = Math.min(maxW, img.naturalWidth);
    const h = w * img.naturalHeight / img.naturalWidth;
    addEl({ id: uid(), type: 'image', x: p.x - w / 2, y: p.y - h / 2, w, h, src: url });
  };
  img.onerror = () => showToast('图片加载失败');
  img.src = url;
}

/* B 站 */
function parseBili(input) {
  const s = String(input || '').trim();
  let m = s.match(/BV[0-9A-Za-z]{10}/);
  if (m) {
    const pm = s.match(/[?&]p=(\d+)/);
    return { bvid: m[0], page: pm ? +pm[1] : 1 };
  }
  m = s.match(/(?:bilibili\.com\/video\/|^\/?)(av\d+)/i) || s.match(/\bav(\d+)\b/i);
  if (m) {
    const num = typeof m[1] === 'string' && m[1].startsWith('av') ? m[1].slice(2) : m[1];
    const pm = s.match(/[?&]p=(\d+)/);
    return { aid: num, page: pm ? +pm[1] : 1 };
  }
  return null;
}
function addVideo(info, p) {
  const w = 500;
  const h = Math.round(w * 9 / 16) + 34;
  const d = { id: uid(), type: 'video', x: p.x - w / 2, y: p.y - h / 2, w, h, page: info.page || 1, title: '' };
  if (info.bvid) d.bvid = info.bvid; else d.aid = info.aid;
  addEl(d);
  select([d.id]);
  return d;
}

/* ---------------- 弹窗 ---------------- */
let modalResolve = null;
function openVideoModal() {
  modalMask.classList.add('show');
  modalErr.classList.remove('show');
  modalInput.value = '';
  setTimeout(() => modalInput.focus(), 120);
  setTool('select');
}
function closeModal() { modalMask.classList.remove('show'); }
$('#modalCancel').addEventListener('click', closeModal);
modalMask.addEventListener('click', e => { if (e.target === modalMask) closeModal(); });
$('#modalOk').addEventListener('click', submitVideo);
modalInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') submitVideo();
  if (e.key === 'Escape') closeModal();
});
function submitVideo() {
  const v = modalInput.value.trim();
  const info = parseBili(v);
  if (!info) {
    modalErr.textContent = '没认出来 — 请粘贴 BV 号或 bilibili.com/video/… 链接（b23.tv 短链需先展开）';
    modalErr.classList.add('show');
    modalInput.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
      { duration: 260, easing: 'ease-in-out' }
    );
    return;
  }
  closeModal();
  const d = addVideo(info, screenToWorld(innerWidth / 2, innerHeight / 2));
  showToast('已插入视频，点击卡片载入播放器');
  setTimeout(() => {
    const dom = domMap.get(d.id);
    if (dom) { dom.classList.add('appear'); setTimeout(() => dom.classList.remove('appear'), 480); }
  }, 0);
}

$('#helpOk').addEventListener('click', () => helpMask.classList.remove('show'));
helpMask.addEventListener('click', e => { if (e.target === helpMask) helpMask.classList.remove('show'); });

/* ---------------- 工具栏 / 顶栏 ---------------- */
function setTool(t) {
  state.tool = t;
  document.querySelectorAll('.tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  stage.className = '';
  stage.classList.add('tool-' + t);
  if (t !== 'select') clearSelection();
  if (t === 'erase') stage.classList.add('is-erasing');
  if (shapePop) shapePop.classList.toggle('show', t === 'shape');
  if (cropPop) cropPop.classList.remove('show');
}
document.querySelectorAll('.tool[data-tool]').forEach(b => {
  b.addEventListener('click', () => {
    const t = b.dataset.tool;
    if (t === 'image') { openImage(); return; }
    if (t === 'video') { openVideoModal(); return; }
    if (t === 'crop') {
      const sel = [...state.selection].map(findEl).filter(x => x && x.type === 'image');
      if (sel.length === 1) openCrop(sel[0]);
      else showToast('先选中（且仅选中）一张图片，再点裁切');
      return;
    }
    setTool(t);
  });
});

/* 形状选择弹层 */
const shapePop = $('#shapePop');
if (shapePop) {
  shapePop.querySelectorAll('[data-shape]').forEach(b => {
    b.addEventListener('click', () => {
      state.shapeKind = b.dataset.shape;
      shapePop.querySelectorAll('[data-shape]').forEach(x => x.classList.toggle('active', x === b));
    });
  });
}
/* 裁切比例弹层 */
if (cropPop) {
  cropPop.querySelectorAll('[data-ratio]').forEach(b => {
    b.addEventListener('click', () => cropApply(b.dataset.ratio));
  });
}

$('#btnZoomIn').addEventListener('click', () => zoomAnimated(1.3));
$('#btnZoomOut').addEventListener('click', () => zoomAnimated(1 / 1.3));
function zoomAnimated(f) {
  flyTo(state.camera.x, state.camera.y, clamp(state.camera.scale * f, MIN_SCALE, MAX_SCALE), dur(300), EASE_OUT);
}
$('#zoomVal').addEventListener('click', () => flyTo(state.camera.x, state.camera.y, 1, dur(380), EASE_OUT));
$('#btnFit').addEventListener('click', () => fitAll());
$('#btnHelp').addEventListener('click', () => helpMask.classList.add('show'));

$('#btnTheme').addEventListener('click', () => {
  const now = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = now;
  localStorage.setItem('canvas.theme', now);
  drawMinimap();
  renderBoardList();
});

const boardNameEl = $('#boardName');
boardNameEl.addEventListener('input', () => {
  board().name = boardNameEl.value || '未命名场景';
  renderBoardList();
  markDirty();
});
boardNameEl.addEventListener('blur', () => { if (!boardNameEl.value.trim()) { board().name = '未命名场景'; boardNameEl.value = board().name; markDirty(); } });
boardNameEl.addEventListener('keydown', e => { if (e.key === 'Enter') boardNameEl.blur(); });

/* ---------------- 场景面板 ---------------- */
function toggleBoards(force) {
  const hidden = boardsPanel.classList.contains('hidden');
  const show = force === undefined ? hidden : force;
  boardsPanel.classList.toggle('hidden', !show);
  if (show) renderBoardList();
}
$('#btnBoards').addEventListener('click', () => toggleBoards());
$('#btnNewBoard').addEventListener('click', () => {
  const b = newBoard('场景 ' + (state.boards.length + 1));
  pushHistory();
  state.boards.push(b);
  renderBoardList();
  switchBoard(b.id);
});

function renderBoardList() {
  boardList.innerHTML = '';
  state.boards.forEach(b => {
    const card = document.createElement('div');
    card.className = 'board-card' + (b.id === state.activeId ? ' active' : '');
    card.dataset.bid = b.id;
    card.innerHTML = `
      <div class="bc-grip" title="拖动调整顺序"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg></div>
      <div class="thumb"><canvas width="88" height="68"></canvas></div>
      <div class="bc-t">
        <div class="bc-n">${escapeHtml(b.name)}</div>
        <div class="bc-c">${b.elements.length} 个元素</div>
      </div>
      <div class="bc-x" title="删除场景"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6L6 18"/></svg></div>`;
    card.addEventListener('click', e => {
      if (e.target.closest('.bc-x')) {
        if (state.boards.length === 1) return showToast('至少要保留一个场景');
        pushHistory();
        state.boards = state.boards.filter(x => x.id !== b.id);
        // 记一笔墓碑：否则别的设备不知道这个场景被删了，一合并又把它复活
        state.tomb = (state.tomb || []).filter(t => t.id !== b.id);
        state.tomb.push({ id: b.id, t: Date.now() });
        if (state.activeId === b.id) switchBoard(state.boards[0].id);
        else renderBoardList();
        markDirty();
        return;
      }
      if (e.target.closest('.bc-grip')) return;   // 拖手柄不触发切换
      switchBoard(b.id);
    });
    boardList.appendChild(card);
    drawThumb(card.querySelector('canvas'), b);
    bindSort(boardList, card, card.querySelector('.bc-grip'), () => {
      const order = [...boardList.children].map(c => c.dataset.bid);
      pushHistory();
      state.boards.sort((a, b2) => order.indexOf(a.id) - order.indexOf(b2.id));
      renderBoardList();
      markDirty();
    });
  });
}

/* 通用的「按住手柄上下拖动排序」（场景面板与视图面板共用） */
function bindSort(listEl, card, grip, commit) {
  if (!grip) return;
  grip.addEventListener('click', e => e.stopPropagation());
  grip.addEventListener('pointerdown', e => {
    e.stopPropagation();
    e.preventDefault();
    let startY = e.clientY, moved = false;
    const move = ev => {
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dy) < 4) return;
      if (!moved) { moved = true; card.classList.add('sorting'); }
      card.style.transform = `translateY(${dy}px) scale(1.02)`;
      const r = card.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      const kids = [...listEl.children];
      const myIdx = kids.indexOf(card);
      for (const s of kids) {
        if (s === card) continue;
        const sr = s.getBoundingClientRect();
        const mid = sr.top + sr.height / 2;
        const sIdx = kids.indexOf(s);
        if (sIdx < myIdx && cy < mid) {
          listEl.insertBefore(card, s);
          startY -= (sr.height + 6);
          break;
        }
        if (sIdx > myIdx && cy > mid) {
          listEl.insertBefore(s, card);
          startY += (sr.height + 6);
          break;
        }
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!moved) return;
      card.classList.remove('sorting');
      card.style.transform = '';
      commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

function drawThumb(cv, b) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const box = bboxOf(b.elements);
  if (!box) return;
  const pad = 8;
  const sc = Math.min((cv.width - pad * 2) / Math.max(box.w, 1), (cv.height - pad * 2) / Math.max(box.h, 1));
  const ox = cv.width / 2 - (box.x + box.w / 2) * sc;
  const oy = cv.height / 2 - (box.y + box.h / 2) * sc;
  const dark = document.documentElement.dataset.theme === 'dark';
  b.elements.forEach(e => {
    const x = e.x * sc + ox, y = e.y * sc + oy;
    const w = Math.max(2, e.w * sc), h = Math.max(2, e.h * sc);
    drawThumbShape(ctx, e, x, y, w, h, dark);
  });
  ctx.globalAlpha = 1;
}

/* 场景切换：整体缩放 + 模糊淡出 → 换内容 → 飞入 */
async function switchBoard(id) {
  if (boardAnimating || id === state.activeId) { toggleBoards(false); return; }
  const target = state.boards.find(b => b.id === id);
  if (!target) return;
  boardAnimating = true;
  toggleBoards(false);
  cancelCamAnim();
  if (state.editingId) exitEdit();
  clearSelection();
  const prev = board();                 // 记住离开时的视图
  if (prev) prev.camera = { ...state.camera };

  const outDur = state.quality === 'low' ? 120 : 200;
  const inDur = state.quality === 'low' ? 240 : 420;

  // 1) 淡出（不用 blur：低端机上模糊层会闪、也吃性能）
  viewport.animate(
    [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(.965)', opacity: 0 }
    ],
    { duration: outDur, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }
  );

  await wait(outDur + 60);   // 多留一帧余量，确保完全不可见了再换内容

  // 2) 换数据：相机直接就位（此刻画布是透明的，不做飞行，避免两层缩放叠加产生跳跃）
  state.activeId = id;
  renderBoard();
  boardNameEl.value = target.name;
  const c = target.camera || { x: 0, y: 0, scale: 1 };
  state.camera = { x: c.x, y: c.y, scale: clamp(c.scale || 1, MIN_SCALE, MAX_SCALE) };
  applyCamera();
  refreshGuides();

  // 3) 淡入（轻微推近）+ 元素错峰弹入 —— 动感交给 stagger，不再叠加相机飞行
  viewport.animate(
    [
      { transform: 'scale(1.025)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1 }
    ],
    { duration: inDur, easing: CSS_IOS, fill: 'forwards' }
  );
  staggerIn();

  await wait(inDur);
  viewport.getAnimations().forEach(a => a.cancel());
  viewport.style.transform = '';
  viewport.style.opacity = '';
  viewport.style.filter = '';
  boardAnimating = false;
  markDirty();
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/* 元素错峰弹入（苹果 Keynote「神奇移动」式的层次感） */
function staggerIn() {
  if (state.quality === 'low') return;   // 精简模式跳过逐元素弹入
  const kids = [...world.children].slice(0, 16);
  kids.forEach((dom, i) => {
    const delay = 40 + i * 26;
    dom.classList.add('appear');
    dom.style.animationDelay = delay + 'ms';
    setTimeout(() => {
      dom.classList.remove('appear');
      dom.style.animationDelay = '';
    }, delay + 470);
  });
}

function updateBoardMeta() {
  const n = els().length;
  $('#boardMeta').textContent = n + ' 个元素';
}

/* 导入 / 导出 / 清空 */
$('#btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ v: 1, activeId: state.activeId, boards: state.boards }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'canvas-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  showToast('已导出');
});
$('#btnImport').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => {
    const f = inp.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(fr.result);
        if (!d.boards || !Array.isArray(d.boards)) throw 0;
        pushHistory();
        state.boards = d.boards;
        state.activeId = d.boards[0].id;
        renderBoard();
        boardNameEl.value = board().name;
        fitAll();
        renderBoardList();
        showToast('已导入');
        markDirty();
      } catch (e) { showToast('文件格式不对'); }
    };
    fr.readAsText(f);
  };
  inp.click();
});
$('#btnClear').addEventListener('click', () => {
  if (!els().length) return showToast('当前场景已经是空的');
  if (!confirm('清空当前场景的所有元素？')) return;
  pushHistory();
  board().elements = [];
  renderBoard();
  markDirty();
  showToast('已清空');
});

/* ---------------- 小地图 ---------------- */
const mctx = miniCanvas.getContext('2d');
let miniTimer = null;
function drawMinimap() {
  clearTimeout(miniTimer);
  miniTimer = setTimeout(drawMinimapNow, 90);
}
function drawMinimapNow() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const list = els();
  // 统一用 CSS 像素做坐标系：canvas 只做 dpr 放大，
  // 否则视口框（DOM 元素，按 CSS 像素定位）在高分屏上会错位一倍
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = minimap.clientWidth || 180, ch = minimap.clientHeight || 122;
  const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
  if (miniCanvas.width !== pw || miniCanvas.height !== ph) {
    miniCanvas.width = pw; miniCanvas.height = ph;
  }
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, cw, ch);
  const box = bboxOf(list) || { x: -500, y: -400, w: 1000, h: 800 };
  // 扩展视口范围
  const vw = innerWidth / state.camera.scale, vh = innerHeight / state.camera.scale;
  const vbox = {
    x: Math.min(box.x, state.camera.x), y: Math.min(box.y, state.camera.y),
    w: Math.max(box.x + box.w, state.camera.x + vw) - Math.min(box.x, state.camera.x),
    h: Math.max(box.y + box.h, state.camera.y + vh) - Math.min(box.y, state.camera.y),
  };
  const pad = 30;
  const sc = Math.min((cw - pad) / Math.max(vbox.w, 1), (ch - pad) / Math.max(vbox.h, 1));
  const ox = cw / 2 - (vbox.x + vbox.w / 2) * sc;
  const oy = ch / 2 - (vbox.y + vbox.h / 2) * sc;
  minimap._m = { sc, ox, oy };

  list.forEach(e => {
    const map = { note: '#FFE066', text: dark ? '#f5f5f7' : '#8e8e93', image: '#A9D6FF', video: '#00AEEC', ink: dark ? '#f5f5f7' : '#1d1d1f', link: dark ? '#8e8e93' : '#b9b9c0' };
    mctx.fillStyle = (e.type === 'note' && ({
      'c-yellow': '#FFE066', 'c-pink': '#FFAFCC', 'c-blue': '#A9D6FF',
      'c-green': '#A8E6B8', 'c-purple': '#CDB4FF', 'c-gray': '#DCDCE1'
    }[e.color])) || map[e.type] || '#c7c7cc';
    mctx.globalAlpha = e.type === 'text' ? .45 : (e.type === 'link' ? .3 : .85);
    const x = e.x * sc + ox, y = e.y * sc + oy, w = Math.max(2, e.w * sc), h = Math.max(2, e.h * sc);
    mctx.beginPath();
    const r = Math.min(2.5, w / 2, h / 2);
    if (mctx.roundRect) mctx.roundRect(x, y, w, h, r); else mctx.rect(x, y, w, h);
    mctx.fill();
  });
  mctx.globalAlpha = 1;

  // 视口框
  const vx = state.camera.x * sc + ox, vy = state.camera.y * sc + oy;
  const vW = vw * sc, vH = vh * sc;
  miniVp.style.left = vx + 'px';
  miniVp.style.top = vy + 'px';
  miniVp.style.width = vW + 'px';
  miniVp.style.height = vH + 'px';
}

minimap.addEventListener('pointerdown', e => {
  e.stopPropagation();
  const move = ev => gotoMini(ev);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  gotoMini(e);
});
minimap.addEventListener('click', e => e.stopPropagation());
function gotoMini(e) {
  const m = minimap._m;
  if (!m) return;
  const r = minimap.getBoundingClientRect();
  const cx = e.clientX - r.left, cy = e.clientY - r.top;   // 与绘制同用 CSS 像素
  const wx = (cx - m.ox) / m.sc, wy = (cy - m.oy) / m.sc;
  cancelCamAnim();
  state.camera.x = wx - (innerWidth / state.camera.scale) / 2;
  state.camera.y = wy - (innerHeight / state.camera.scale) / 2;
  applyCamera();
  markDirty();
}

/* 参考线（目前未启用吸附，保留接口） */
function refreshGuides() { guides.innerHTML = ''; }

/* ---------------- Toast ---------------- */
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1900);
}

/* ---------------- 视图记录 —— 把画布当 PPT 用 ---------------- */
const viewsDock = $('#viewsDock'), viewsPanel = $('#viewsPanel'), viewsList = $('#viewsList');
const vdCount = $('#btnToggleViews');

/* 默认收起：只在左下角留翻页键；需要增删/改名时再展开面板 */
function toggleViewsPanel(force) {
  const show = force === undefined ? !viewsPanel.classList.contains('show') : force;
  viewsPanel.classList.toggle('show', show);
  vdCount.classList.toggle('on', show);
}

function thumbColor(e, dark) {
  if (e.type === 'note') {
    return {
      'c-yellow': '#FFE066', 'c-pink': '#FFAFCC', 'c-blue': '#A9D6FF',
      'c-green': '#A8E6B8', 'c-purple': '#CDB4FF', 'c-gray': '#DCDCE1'
    }[e.color] || '#FFE066';
  }
  return { text: dark ? '#f5f5f7' : '#8e8e93', image: '#A9D6FF', video: '#00AEEC', ink: dark ? '#f5f5f7' : '#1d1d1f', link: dark ? '#8e8e93' : '#b9b9c0' }[e.type] || '#c7c7cc';
}

/* 缩略图：2 倍分辨率绘制，并且画出内容的样子（便签文字、图片、播放三角…），
   不然光看一片色块根本认不出是哪个视图 */
function drawThumbShape(ctx, e, x, y, w, h, dark) {
  const base = thumbColor(e, dark);
  const rect = (fill, alpha = .9) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    const r = Math.min(2.5, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, Math.max(1.5, w), Math.max(1.5, h), r);
    else ctx.rect(x, y, Math.max(1.5, w), Math.max(1.5, h));
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  if (e.type === 'note') {
    rect(base, .92);
    if (h > 11 && w > 13) {                     // 画几道横线示意文字
      ctx.fillStyle = 'rgba(0,0,0,.24)';
      const lines = Math.min(4, Math.max(1, Math.floor((h - 6) / 8)));
      for (let i = 0; i < lines; i++) {
        const lw = w * (i === lines - 1 ? 0.45 : 0.74);
        ctx.fillRect(x + w * 0.11, y + 4 + i * 8, Math.max(2, lw), 2);
      }
    }
  } else if (e.type === 'text') {
    ctx.globalAlpha = .5;
    ctx.fillStyle = base;
    ctx.fillRect(x, y + h * 0.3, Math.max(2, w * 0.72), Math.max(2, h * 0.42));
    ctx.globalAlpha = 1;
  } else if (e.type === 'image') {
    rect(base, .85);
    ctx.fillStyle = 'rgba(255,255,255,.62)';    // 山的形状，一眼看出是图
    ctx.beginPath();
    ctx.moveTo(x + w * 0.12, y + h * 0.82);
    ctx.lineTo(x + w * 0.42, y + h * 0.38);
    ctx.lineTo(x + w * 0.72, y + h * 0.82);
    ctx.closePath();
    ctx.fill();
  } else if (e.type === 'video') {
    rect(base, .95);
    const s = Math.min(w, h);
    if (s > 9) {                                 // 播放三角
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.beginPath();
      ctx.moveTo(x + w / 2 - s * 0.11, y + h / 2 - s * 0.17);
      ctx.lineTo(x + w / 2 + s * 0.17, y + h / 2);
      ctx.lineTo(x + w / 2 - s * 0.11, y + h / 2 + s * 0.17);
      ctx.closePath();
      ctx.fill();
    }
  } else if (e.type === 'ink') {
    ctx.globalAlpha = .55;
    ctx.strokeStyle = base;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, Math.max(1.5, w), Math.max(1.5, h));
    ctx.globalAlpha = 1;
  } else {
    rect(base, .3);
  }
}

function captureThumb(w = 256, h = 112) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) return '';
  const dark = document.documentElement.dataset.theme === 'dark';
  ctx.fillStyle = dark ? '#1b1c1f' : '#f2f2f6';
  ctx.fillRect(0, 0, w, h);
  const vw = innerWidth / state.camera.scale, vh = innerHeight / state.camera.scale;
  const sx = w / vw, sy = h / vh;
  for (const e of els()) {
    const x = (e.x - state.camera.x) * sx, y = (e.y - state.camera.y) * sy;
    const ew = e.w * sx, eh = e.h * sy;
    if (x > w || y > h || x + ew < 0 || y + eh < 0) continue;
    drawThumbShape(ctx, e, x, y, ew, eh, dark);
  }
  try { return cv.toDataURL('image/jpeg', 0.72); } catch (err) { return ''; }
}

function captureView() {
  const b = board();
  if (!b.views) b.views = [];
  const v = addViewNamed('视图 ' + (b.views.length + 1));
  pushHistory();
  state.presentIdx = b.views.length - 1;
  renderViews();
  renderBoardList();
  toggleViewsPanel(true);            // 展开看一眼刚记录的缩略图
  markDirty();
  showToast(`已记录「${v.name}」`);
}

function removeView(i) {
  const b = board();
  if (!b.views || !b.views[i]) return;
  pushHistory();
  b.views.splice(i, 1);
  if (state.presentIdx >= b.views.length) state.presentIdx = Math.max(0, b.views.length - 1);
  renderViews();
  renderBoardList();
  updatePresHint();
  markDirty();
}

function renderViews() {
  const vs = board().views || [];
  viewsList.innerHTML = '';
  vs.forEach((v, i) => {
    const card = document.createElement('div');
    card.className = 'view-card' + (i === state.presentIdx ? ' active' : '');
    card.dataset.vid = v.id;
    card.innerHTML =
      `<div class="v-grip" title="拖动调整顺序"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg></div>` +
      `<img class="v-thumb" src="${v.thumb || ''}" alt="">` +
      `<div class="v-n"><b>${i + 1}</b><span title="点一下改名">${escapeHtml(v.name)}</span></div>` +
      `<div class="v-x" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6L6 18"/></svg></div>`;

    const nameEl = card.querySelector('.v-n span');
    // 点名字 → 直接改名（手机上双击很难触发，所以单击就行）
    nameEl.addEventListener('click', ev => { ev.stopPropagation(); startRenameView(nameEl, v); });
    nameEl.addEventListener('dblclick', ev => ev.stopPropagation());
    card.querySelector('.v-x').addEventListener('click', ev => { ev.stopPropagation(); removeView(i); });
    // 卡片其它地方（缩略图等）→ 跳转
    card.addEventListener('click', ev => {
      if (ev.target.closest('.v-x') || ev.target.closest('.v-grip') || ev.target.closest('.v-n span')) return;
      gotoView(i);
      toggleViewsPanel(false);        // 跳转后收起，不挡画布
    });
    viewsList.appendChild(card);
    bindSort(viewsList, card, card.querySelector('.v-grip'), () => {
      const order = [...viewsList.children].map(c => c.dataset.vid);
      pushHistory();
      board().views.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      renderViews();
      markDirty();
    });
  });
  updatePresHint();
  renderViewRegions();
}

function startRenameView(span, v) {
  if (span.getAttribute('contenteditable') === 'true') return;
  span.setAttribute('contenteditable', 'true');
  span.focus();
  const sel = getSelection();
  if (sel) sel.selectAllChildren(span);
  const finish = save => {
    span.removeAttribute('contenteditable');
    const t = span.textContent.trim();
    if (save && t && t !== v.name) { pushHistory(); v.name = t; markDirty(); }
    renderViews();
  };
  span.addEventListener('blur', () => finish(true), { once: true });
  span.addEventListener('keydown', k => {
    if (k.key === 'Enter') { k.preventDefault(); span.blur(); }
    else if (k.key === 'Escape') { span.textContent = v.name; span.blur(); }
  });
}

function markActiveView() {
  [...viewsList.children].forEach((c, i) => c.classList.toggle('active', i === state.presentIdx));
}

/* 在画布上画出「已保存视图」对应的浅色区域框，方便定位；
   默认不显示（state.showViewRegions），演示 / 聚焦时由 CSS 强制隐藏。 */
function renderViewRegions() {
  if (!viewRegions) return;
  viewRegions.innerHTML = '';
  if (!state.showViewRegions) return;
  const vs = board().views || [];
  vs.forEach((v, i) => {
    if (v.cx == null || v.cy == null || !v.rw || !v.rh) return;
    const box = document.createElement('div');
    box.className = 'vr-box' + (i === state.presentIdx ? ' active' : '');
    box.style.left = (v.cx - v.rw / 2) + 'px';
    box.style.top = (v.cy - v.rh / 2) + 'px';
    box.style.width = v.rw + 'px';
    box.style.height = v.rh + 'px';
    const tag = document.createElement('span');
    tag.className = 'vr-tag';
    tag.textContent = (v.name || ('视图 ' + (i + 1)));
    box.appendChild(tag);
    viewRegions.appendChild(box);
  });
}

function setViewRegions(on) {
  state.showViewRegions = on;
  localStorage.setItem('canvas.viewRegions', on ? 'on' : 'off');
  const btn = $('#btnRegions');
  if (btn) btn.textContent = '区域：' + (on ? '开' : '关');
  renderViewRegions();
}

/* 距离远或缩放跨度大 → 走「拉远—推进」的弧线，长距离跳转也不晕 */
/* ------------------------------------------------------------------
   视图的跨屏一致（以「屏幕中心」为锚）
   以前只存「相机左上角 + 缩放倍数」，同样一组数字在手机（细长）和电脑（宽扁）上
   看到的范围完全不同，而且内容会被钉在屏幕一角，看着就是没对齐。
   现在记「屏幕中心对应的世界坐标 (cx,cy)」+「当时整块可视区域 (rw,rh)」，
   回放时以中心为锚、把这块区域 contain 进任何比例的屏幕：
   手机缩小把电脑的画面完整装进来，四周多出的区域均匀分布，不同设备看到的是同一片内容。
   ------------------------------------------------------------------ */
let viewFit = localStorage.getItem('canvas.viewFit') !== 'off';   // 默认开

function setViewFit(on) {
  viewFit = on;
  localStorage.setItem('canvas.viewFit', on ? 'on' : 'off');
  const btn = $('#btnViewFit');
  if (btn) btn.textContent = '跨屏适配：' + (on ? '开' : '关');
  showToast(on ? '视图会按当前屏幕自动缩放，各设备看到的内容一致' : '视图按记录时的倍数显示');
}

/* 把某个视图换算成「当前窗口下」的相机参数
   以视图中心 (cx,cy) 为锚，把记录时那块世界区域整块 contain 进当前屏幕：
   比例不同 → 手机缩小、把电脑的画面完整装进来，四周多出的区域均匀分布。 */
function viewTarget(v) {
  if (!viewFit || !v || v.cx == null || v.cy == null || !v.rw || !v.rh)
    return { x: v.x, y: v.y, scale: v.scale };
  // contain：取「按宽 / 按高」里较小的缩放，保证整块都进屏幕；留 5% 余量避开边缘
  const s = clamp(Math.min(innerWidth / v.rw, innerHeight / v.rh) * 0.95, MIN_SCALE, MAX_SCALE);
  // 相机 x/y 是「屏幕左上角」对应的世界坐标，换算成「中心对准 (cx,cy)」
  return { x: v.cx - innerWidth / 2 / s, y: v.cy - innerHeight / 2 / s, scale: s };
}

/* 旧视图只有 x/y/scale：补出中心锚 (cx,cy) 和当时覆盖的世界区域（标注 est，便于日后重录） */
function migrateViews() {
  let n = 0;
  state.boards.forEach(b => (b.views || []).forEach(v => {
    if (v.cx == null || v.cy == null || !v.rw || !v.rh) {
      const s = v.scale || state.camera.scale || 1;
      const hw = innerWidth / 2 / s, hh = innerHeight / 2 / s;
      v.cx = (v.x || 0) + hw; v.cy = (v.y || 0) + hh;
      v.rw = hw * 2; v.rh = hh * 2; v.est = true;
      n++;
    }
  }));
  return n;
}

function gotoView(i) {
  const v = (board().views || [])[i];
  if (!v) return;
  state.presentIdx = i;
  if (state.editingId) exitEdit();
  clearSelection();
  const t = viewTarget(v);
  const dist = Math.hypot(t.x - state.camera.x, t.y - state.camera.y) * state.camera.scale;
  const ratio = Math.max(state.camera.scale / t.scale, t.scale / state.camera.scale);
  // 只有「距离远 + 缩放相近」才走拉远弧线；缩放跨度大时普通飞行更稳（弧线会闪）
  const arc = dist > innerWidth * 1.1 && ratio < 1.8;
  const ms = dur(arc ? 1050 : (ratio > 1.8 ? 900 : 780));
  if (arc) flyToArc(t.x, t.y, t.scale, ms);
  else flyTo(t.x, t.y, t.scale, ms);
  markActiveView();
  updatePresHint();
}

function nearestView() {
  const vs = board().views || [];
  if (!vs.length) return 0;
  let best = 0, bd = Infinity;
  vs.forEach((v, i) => {
    const d = Math.hypot(v.x - state.camera.x, v.y - state.camera.y) * state.camera.scale + Math.abs(Math.log(v.scale / state.camera.scale)) * 600;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function togglePresent(on) {
  const want = on === undefined ? !state.presenting : on;
  const vs = board().views || [];
  if (want && !vs.length) { showToast('先点 + 记录几个视图，再开始演示'); return; }
  state.presenting = want;
  document.body.classList.toggle('presenting', want);
  $('#btnPlay').classList.toggle('on', want);
  if (want) {
    toggleViewsPanel(false);
    state.presentIdx = nearestView();
    gotoView(state.presentIdx);
    showToast('演示中：← → 切换视图，Esc 退出');
  } else {
    markActiveView();
  }
  updatePresHint();
}
function stepView(dir) {
  const vs = board().views || [];
  if (!vs.length) return;
  state.presentIdx = (state.presentIdx + dir + vs.length) % vs.length;
  gotoView(state.presentIdx);
}
/* 页码只留左下角那一个 —— 中间那条曾经和它重复，已整个移除 */
function updatePresHint() {
  const vs = board().views || [];
  const txt = vs.length ? `${state.presentIdx + 1} / ${vs.length}` : '0 / 0';
  vdCount.textContent = txt;
  vdCount.title = vs.length ? '展开视图列表' : '还没有视图，点这里记录当前画面';
}

vdCount.addEventListener('click', () => toggleViewsPanel());
$('#btnPrevView').addEventListener('click', () => stepView(-1));
$('#btnNextView').addEventListener('click', () => stepView(1));
$('#btnAddView').addEventListener('click', captureView);
$('#btnPlay').addEventListener('click', () => {
  togglePresent();
  if (state.presenting) goFullscreen();     // 开始演示顺带全屏（同一手势内，允许）
});

/* 退出键：手机没有 Esc，演示 / 聚焦时靠它回到正常模式 */
$('#btnExitMode').addEventListener('click', () => {
  if (state.presenting) togglePresent(false);
  else if (state.focusId) exitFocus();
  else setImmersive(false);
});
/* 中间那条现在只是「第几个」的指示器，退出一律用左下角的 ✕ —— 不再两套控件 */
$('#btnCloseViews').addEventListener('click', () => toggleViewsPanel(false));
$('#btnViewFit').addEventListener('click', () => setViewFit(!viewFit));
{ const b = $('#btnViewFit'); if (b) b.textContent = '跨屏适配：' + (viewFit ? '开' : '关'); }
$('#btnRegions').addEventListener('click', () => setViewRegions(!state.showViewRegions));
{ const b = $('#btnRegions'); if (b) b.textContent = '区域：' + (state.showViewRegions ? '开' : '关'); }

/* 点画布其它地方收起视图面板 / 场景抽屉 */
stage.addEventListener('pointerdown', () => {
  if (viewsPanel.classList.contains('show')) toggleViewsPanel(false);
  if (!boardsPanel.classList.contains('hidden')) boardsPanel.classList.add('hidden');
});

/* 撤销 / 重做：移动端没有 ⌘Z，顶栏给可见按钮 */
const btnUndo = $('#btnUndo'), btnRedo = $('#btnRedo');
function updateHistoryButtons() {
  if (btnUndo) btnUndo.classList.toggle('disabled', !undoStack.length);
  if (btnRedo) btnRedo.classList.toggle('disabled', !redoStack.length);
}
if (btnUndo) btnUndo.addEventListener('click', () => { undo(); });
if (btnRedo) btnRedo.addEventListener('click', () => { redo(); });

/* ---------------- 云同步 ----------------
   数据存在腾讯云 CloudBase（经云函数中转），手机 / 电脑填同一个「空间码」即可互通。
   空间码相当于一把钥匙：知道它的人才能读写这份画布。 */
const CLOUD_CFG = 'canvas.cloud';
const CLOUD_API = 'https://art-d9giyyspp3921f818-1312774719.ap-shanghai.app.tcloudbase.com/sync';

const cloud = {
  key: '', on: false,
  lastPush: 0,       // 本地最后一次写入云端的时间
  cloudTime: 0,      // 云端记录的更新时间
  busy: false, applying: false,
};
let cloudPushTimer = null, cloudPullTimer = null;

function loadCloudCfg() {
  try { Object.assign(cloud, JSON.parse(localStorage.getItem(CLOUD_CFG) || '{}')); } catch (e) { /* 忽略 */ }
  cloud.busy = false; cloud.applying = false;
}
function saveCloudCfg() {
  localStorage.setItem(CLOUD_CFG, JSON.stringify({ key: cloud.key, on: cloud.on, lastPush: cloud.lastPush }));
}
function ensureCloudTimers() {
  if (cloudPullTimer) return;
  /* 只有窗口可见时才轮询：后台标签页没必要一直拉（切回来时下面的 focus / visibilitychange 会补一次） */
  cloudPullTimer = setInterval(() => { if (cloud.on && !document.hidden) cloudPull(true); }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && cloud.on) cloudPull(true);
  });
  // 从别的窗口切回来时立刻拉一次（visibilitychange 只在同一标签页内可靠）
  window.addEventListener('focus', () => { if (cloud.on && !document.hidden) cloudPull(true); });
}

async function cloudConnect(key, quiet) {
  cloud.key = key;
  cloud.on = true;
  saveCloudCfg();
  ensureCloudTimers();
  if (!quiet) showToast('云同步已开启');
  await cloudPull(false);          // 先看看云端有没有内容
  scheduleCloudPush();             // 再把本机内容推上去
  cloudMigrateImages();            // 最后把本机旧的 base64 图片也搬到云上
}

/* data:image/png;base64,xxx → { blob, mime }（上传要用原始字节，不能再套一层 base64） */
function dataUrlToBlob(dataUrl) {
  const s = String(dataUrl);
  const i = s.indexOf(',');
  if (i < 0) return null;
  const m = /^data:(image\/[a-z0-9.+-]+);base64$/i.exec(s.slice(0, i));
  if (!m) return null;
  let bin;
  try { bin = atob(s.slice(i + 1)); } catch (e) { return null; }
  const u8 = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
  return { blob: new Blob([u8], { type: m[1] }), mime: m[1].toLowerCase() };
}

/* 图片上传：交给云函数中转，浏览器不接触任何密钥。
   ⚠️ 必须用二进制请求体：云函数对 application/json 这类「文本类型」请求体只放行 100KB，
   换成 application/octet-stream 才是 6MB —— 把图片塞进 JSON 会直接 413。
   成功返回 { id, url }，失败返回 null —— 调用方回落到本地 base64，功能不退化。 */
async function cloudUploadImage(dataUrl) {
  if (!cloud.on || !cloud.key || String(dataUrl).indexOf('data:image/') !== 0) return null;
  const conv = dataUrlToBlob(dataUrl);
  if (!conv) return null;
  try {
    const r = await fetch(
      CLOUD_API + '?put=' + encodeURIComponent(cloud.key) + '&ct=' + encodeURIComponent(conv.mime),
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: conv.blob }
    );
    const j = await r.json().catch(() => null);
    return (j && j.ok && j.id && j.url) ? j : null;
  } catch (e) {
    console.warn('图片上传失败，回落到本地存储', e);
    return null;
  }
}

/* 把还以 base64 存在本机的旧图片逐张搬到云上，换成短链接。
   逐张、可中断：中途断网或关掉同步，已完成的部分保留，剩下的维持原样，下次再补。 */
let imgMigrating = false;
async function cloudMigrateImages() {
  if (!cloud.on || !cloud.key || imgMigrating) return;
  const todo = [];
  state.boards.forEach(b => b.elements.forEach(e => {
    if (e.type === 'image' && !e.imgId && typeof e.src === 'string' && e.src.indexOf('data:image/') === 0) todo.push(e);
  }));
  if (!todo.length) return;
  imgMigrating = true;
  let done = 0;
  for (const e of todo) {
    if (!cloud.on) break;
    const up = await cloudUploadImage(e.src);
    if (!up) break;                       // 失败就停，不硬撑
    e.src = up.url;
    e.imgId = up.id;
    refreshEl(e);
    done++;
  }
  imgMigrating = false;
  if (done) { markDirty(); scheduleCloudPush(); showToast(`已把 ${done} 张图片传到云端`); }
}

function cloudStatus() {
  if (!cloud.on || !cloud.key) return '未开启';
  if (cloud.busy) return '同步中…';
  if (cloud.pushFail) return '没同步上 · 检查网络';   // 让失败看得见，不要再静默
  const t = cloud.lastPush || cloud.cloudTime;
  if (!t) return '已连接';
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `已连接 · 上次同步 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* 云端文档：{ data: {boards, tomb, activeId}, updatedAt } */
function cloudPayload() {
  const data = { boards: state.boards, tomb: state.tomb || [], activeId: state.activeId, v: 1 };
  const txt = JSON.stringify(data);
  if (txt.length <= 2600000) return { data };
  // 太大就只同步结构（图片留在各设备），避免超出云函数请求体限制
  const slim = JSON.parse(txt);
  slim.boards.forEach(b => b.elements.forEach(e => { if (e.type === 'image') e.src = ''; }));
  return { data: slim };
}

async function cloudPush() {
  if (!cloud.on || !cloud.key || cloud.busy || cloud.applying) return;
  cloud.busy = true;
  try {
    const { data } = cloudPayload();
    /* 先读再写能避免旧页面盖新内容，但会多一次往返。
       刚拉过（5 秒内）就说明手里这份是新的，直接写 —— 既快又省一半请求 */
    const fresh = Date.now() - (cloud.lastPullAt || 0) < 5000;
    let toWrite = data;
    if (!fresh) {
      try {
        const cur = await cloudGet(cloud.key);
        if (cur && cur.data && Array.isArray(cur.data.boards)) {
          const merged = mergeBoards(data.boards, data.tomb, cur.data.boards, cur.data.tomb);
          toWrite = { boards: merged.boards, tomb: merged.tomb, activeId: data.activeId, v: 1 };
          // 合并结果如果跟本机不一样，也让本机看到（否则本机下次推还会再盖回去）
          if (applyMerged(merged)) showToast('已并入云端的改动');
        }
      } catch (e) { /* 读不到就照原样写 */ }
    }
    const r = await fetch(CLOUD_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: cloud.key, data: toWrite }),
    });
    const j = await r.json().catch(() => null);
    if (j && j.ok) {
      cloud.lastPush = j.updatedAt || Date.now();
      cloud.cloudTime = Math.max(cloud.cloudTime, cloud.lastPush);
      cloud.pushFail = false;
      saveCloudCfg();
    } else if (j && j.error) {
      // 别再静默失败：上一次就是因为 400 被悄悄吞掉，才变成「手机电脑不同步」
      cloud.pushFail = true;
      console.warn('云同步写入被拒：' + j.error);
    }
  } catch (e) {
    cloud.pushFail = true;
    console.warn('云同步写入失败', e);
  } finally {
    cloud.busy = false;
    updateCloudUi();
  }
}

/* ------------------------------------------------------------------
   多端合并：以前是「整份文档后写覆盖先写」，两端一改就互相抹掉。
   现在改成按场景粒度合并：每个场景自带 mt 时间戳，新的留下、旧的让位，
   于是「手机改 A 场景 + 电脑改 B 场景」两边都能保住。
   删除靠墓碑（tomb）同步，否则被删的场景会在合并时被复活。
   ⚠️ 同一时刻改**同一个**场景仍然只能留一份（新的赢），这是单用户场景可接受的选择。
   ------------------------------------------------------------------ */
const boardMt = b => (b && b.mt) || 0;
function tombAt(tomb, id) {
  let m = 0;
  (tomb || []).forEach(t => { if (t && t.id === id && t.t > m) m = t.t; });
  return m;
}
function mergeTomb(a, b) {
  const map = new Map();
  [].concat(a || [], b || []).forEach(t => {
    if (!t || !t.id) return;
    const cur = map.get(t.id);
    if (!cur || (t.t || 0) > (cur.t || 0)) map.set(t.id, t);
  });
  return [...map.values()];
}
function mergeBoards(localBoards, localTomb, cloudBoards, cloudTomb) {
  const tomb = mergeTomb(localTomb, cloudTomb);
  const order = [];                                  // 先按本机顺序排，云端新增的排后面
  const map = new Map();
  (localBoards || []).forEach(b => { if (b && b.id) { map.set(b.id, b); order.push(b.id); } });
  (cloudBoards || []).forEach(b => {
    if (!b || !b.id) return;
    const cur = map.get(b.id);
    if (!cur) {
      if (tombAt(tomb, b.id) <= boardMt(b)) { map.set(b.id, b); order.push(b.id); }
    } else if (boardMt(b) > boardMt(cur)) {
      map.set(b.id, b);                              // 云端这份更新 → 采用
    }
  });
  const out = [];
  order.forEach(id => {
    const b = map.get(id);
    if (b && tombAt(tomb, id) <= boardMt(b)) out.push(b);
  });
  return { boards: out.length ? out : (localBoards || []).slice(0, 1), tomb };
}
/* 把合并结果写回界面 */
function applyMerged(merged) {
  const changed = JSON.stringify(merged.boards.map(b => b.id + ':' + boardMt(b)))
                !== JSON.stringify(state.boards.map(b => b.id + ':' + boardMt(b)));
  if (!changed && JSON.stringify(merged.tomb) === JSON.stringify(state.tomb || [])) return false;
  const localSrc = new Map();
  state.boards.forEach(b => b.elements.forEach(e => { if (e.type === 'image' && e.src) localSrc.set(e.id, e.src); }));
  state.boards = merged.boards;
  state.tomb = merged.tomb || [];
  state.boards.forEach(b => b.elements.forEach(e => {
    if (e.type === 'image' && !e.src && localSrc.has(e.id)) e.src = localSrc.get(e.id);
  }));
  if (!state.boards.some(b => b.id === state.activeId)) state.activeId = (state.boards[0] || {}).id;
  cloud.applying = true;
  renderBoard();
  boardNameEl.value = board().name;
  applyCamera(); drawMinimap(); renderViews();
  lastSnapshot = snapshot();
  cloud.applying = false;
  return true;
}

async function cloudPull(silent) {
  if (!cloud.on || !cloud.key || cloud.busy || cloud.applying) return false;
  cloud.busy = true;
  let applied = false;
  try {
    const r = await fetch(CLOUD_API + '?key=' + encodeURIComponent(cloud.key), { cache: 'no-store' });
    const j = await r.json();
    if (j && j.data && j.updatedAt) {
      cloud.cloudTime = j.updatedAt;
      cloud.lastPullAt = Date.now();
      if (j.updatedAt > cloud.lastPush + 1500 && Array.isArray(j.data.boards)) {
        const merged = mergeBoards(state.boards, state.tomb, j.data.boards, j.data.tomb);
        applied = applyMerged(merged);
        cloud.lastPush = j.updatedAt;
        saveCloudCfg();
        if (applied && !silent) showToast('已合并别的设备的改动');
      }
    }
  } catch (e) {
    console.warn('云同步读取失败', e);
  } finally {
    cloud.busy = false;
    updateCloudUi();
  }
  return applied;
}

function scheduleCloudPush() {
  if (!cloud.on || !cloud.key || cloud.applying) return;
  clearTimeout(cloudPushTimer);
  /* 一个人用，同步越快越好体验：本机落盘 500ms + 推云端 700ms。
     700ms 而不是立刻推，是为了把连续拖拽/输入合成一次请求（否则每帧一个请求，反而拖慢） */
  cloudPushTimer = setTimeout(() => cloudPush(), 700);
}

/* ============================================================
   作品目录：一份索引 + 多份作品记录，每份单独存，互不影响
   ============================================================ */
async function cloudGet(key) {
  const r = await fetch(CLOUD_API + '?key=' + encodeURIComponent(key), { cache: 'no-store' });
  return r.json();
}
async function cloudSet(key, data) {
  const r = await fetch(CLOUD_API, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, data })
  });
  return r.json().catch(() => null);
}

function loadLibCfg() {
  try { const j = JSON.parse(localStorage.getItem(LIB_CFG) || '{}'); lib.wid = j.wid || null; } catch (e) { /* 忽略 */ }
}
function saveLibCfg() { try { localStorage.setItem(LIB_CFG, JSON.stringify({ wid: lib.wid })); } catch (e) { /* 忽略 */ } }
function libWriteLocal() { try { localStorage.setItem(LIB_LOCAL, JSON.stringify(lib.items)); } catch (e) { /* 忽略 */ } }
function libReadLocal() { try { const a = JSON.parse(localStorage.getItem(LIB_LOCAL) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

const elCount = () => state.boards.reduce((s, b) => s + (b.elements ? b.elements.length : 0), 0);
function flushSave() { clearTimeout(saveTimer); save(); }

function libTouch(pushIdx) {
  const it = lib.items.find(x => x.id === lib.wid);
  if (it) { it.updatedAt = Date.now(); it.el = elCount(); }
  libWriteLocal();
  if (pushIdx) libPushIndex();
}

async function libPullIndex() {
  try {
    const j = await cloudGet(LIB_INDEX_KEY);
    if (j && j.data && Array.isArray(j.data.items)) lib.items = j.data.items;
  } catch (e) { /* 离线就用本机那份 */ }
  // 本机多出来的（比如某台设备离线时自己建的那份）也并进目录，
  // 顺便把它的内容补传给云端 —— 否则那台设备上的东西就永远躺在暗处
  const local = libReadLocal();
  const extra = local.filter(x => !lib.items.some(y => y.id === x.id));
  if (extra.length) {
    for (const m of extra) {
      try {
        const raw = localStorage.getItem(storeKey(m.id));
        if (raw) {
          const d = JSON.parse(raw);
          await cloudSet(LIB_ITEM_KEY(m.id), { v: 1, boards: d.boards || [], activeId: d.activeId });
        }
      } catch (e) { /* 忽略 */ }
      const clash = lib.items.some(y => y.name === m.name);
      lib.items.push(Object.assign({}, m, { name: clash ? m.name + '（本机）' : m.name }));
    }
  }
  if (!lib.items.length) lib.items = local;
  libWriteLocal();
}
async function libPushIndex() {
  try {
    const j = await cloudSet(LIB_INDEX_KEY, { v: 1, items: lib.items, active: lib.wid });
    const ok = !!(j && j.ok);
    if (!ok && !cloud.idxWarned) { cloud.idxWarned = true; showToast('目录没写回云端（键可能不合法）'); }
    return ok;
  } catch (e) { return false; }
}

/* 旧版本把内容存在一个固定的本地键里 —— 别丢，搬进目录作为第一份作品 */
function libMigrateLocal() {
  try {
    const raw = localStorage.getItem('canvas.freeform.v1');
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.boards) || !d.boards.length) return false;
    const id = uid();
    localStorage.setItem(storeKey(id), raw);
    localStorage.removeItem('canvas.freeform.v1');
    lib.items.push({ id, name: '原来的画布', el: d.boards.reduce((s, b) => s + (b.elements || []).length, 0), updatedAt: Date.now() });
    libWriteLocal();
    return true;
  } catch (e) { return false; }
}

/* 以前用「空间码」存的那份，也一并搬过来 */
async function libMigrateCloud() {
  const flag = 'canvas.lib.migrated';
  if (localStorage.getItem(flag)) return false;
  localStorage.setItem(flag, '1');
  const oldKey = cloud.key;
  if (!oldKey || /^(cl:|--portal$)/.test(oldKey)) return false;
  try {
    const j = await cloudGet(oldKey);
    if (j && j.data && Array.isArray(j.data.boards) && j.data.boards.length) {
      const id = uid();
      await cloudSet(LIB_ITEM_KEY(id), j.data);
      lib.items.push({ id, name: '原来的画布', el: j.data.boards.reduce((s, b) => s + (b.elements || []).length, 0), updatedAt: Date.now() });
      await libPushIndex();
      return true;
    }
  } catch (e) { /* 失败就算了 */ }
  return false;
}

/* ============================================================
   手机遥控
   电脑端开着「遥控」时：把当前视图状态写进 RM_HOST，同时每秒读一次 RM_CMD。
   手机打开 ?remote=1 只显示几个大按钮，点一下往 RM_CMD 写一条指令。
   两端都只通过云端那条记录通信，所以不用新服务器；代价是 1~2 秒延迟。
   ============================================================ */
const remote = { on: false, lastSeq: 0, tCmd: null, tHost: null };

function remoteHostData(off) {
  if (off) return { v: 1, t: Date.now(), off: true };
  const b = (typeof board === 'function' && board()) ? board() : null;
  return {
    v: 1, t: Date.now(),
    workId: lib.wid || '', boardId: b ? b.id : '', boardName: b ? b.name : '',
    playing: !!state.presenting, idx: state.presentIdx || 0,
    views: ((b && b.views) || []).map(v => ({ name: v.name || '' })),
  };
}
async function remotePublish(off) {
  try { await cloudSet(RM_HOST, remoteHostData(off)); } catch (e) { /* 忽略 */ }
}
async function remoteTick() {
  if (!remote.on) return;
  try {
    const j = await cloudGet(RM_CMD);
    const c = j && j.data && j.data.cmd;
    if (!c || !c.seq || c.seq <= remote.lastSeq) return;
    remote.lastSeq = c.seq;
    if (c.op === 'next') stepView(1);
    else if (c.op === 'prev') stepView(-1);
    else if (c.op === 'goto') gotoView(c.idx || 0);
    else if (c.op === 'play') {
      togglePresent(true);
      /* 全屏必须由本机手势触发：手机发来的指令是定时器里执行的，浏览器会拒绝。
         所以真正可靠的是「开遥控那一下就全屏」（见 setRemote）。这里再尽力试一次，
         试不成就提示一下，不至于让人以为坏了。 */
      if (!fsNow() && !goFullscreen()) showToast('若没全屏：电脑上按 F 或点一下 ▶');
    } else if (c.op === 'exit') togglePresent(false);
    remotePublish();          // 立刻回写状态，手机端马上看到新位置
  } catch (e) { /* 忽略 */ }
}
/* ---------------- 全屏 ----------------
   ⚠️ 必须由「用户手势」触发（点一下），放在定时器里调用会被浏览器拒绝。
   iPhone 上的 Safari 压根不支持网页全屏，只能靠「添加到主屏幕」兜底。 */
const fsEl = () => document.documentElement;
const fsSupported = () => !!(fsEl().requestFullscreen || fsEl().webkitRequestFullscreen || fsEl().webkitRequestFullScreen);
function fsNow() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function goFullscreen() {
  const el = fsEl();
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen;
  if (!req) return false;
  try { const p = req.call(el); if (p && p.catch) p.catch(() => { /* 不允许就拉倒 */ }); return true; }
  catch (e) { return false; }
}
function exitFullscreen() {
  const ex = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen;
  if (ex && fsNow()) { try { const p = ex.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 忽略 */ } }
}
function toggleFullscreen() { if (fsNow()) exitFullscreen(); else goFullscreen(); }

async function setRemote(on) {
  remote.on = on;
  clearInterval(remote.tCmd); clearInterval(remote.tHost);
  const btn = $('#btnRemote');
  if (btn) { btn.textContent = '遥控：' + (on ? '开' : '关'); btn.classList.toggle('on', on); }
  if (on) {
    await remotePublish();
    remote.tCmd = setInterval(remoteTick, 1200);
    remote.tHost = setInterval(() => remotePublish(), 2500);
    goFullscreen();      // 开遥控就全屏（这次调用还在点击的上下文里，浏览器允许）
    showToast('遥控已开：手机打开 ' + location.origin + location.pathname + '?remote=1');
  } else {
    await remotePublish(true);
    showToast('遥控已关');
  }
}

/* ---------------- 遥控器界面（手机） ---------------- */
async function rmSend(op, idx) {
  const label = { next: '下一个', prev: '上一个', play: '开始演示', exit: '结束演示', goto: '跳转' }[op] || op;
  try {
    await cloudSet(RM_CMD, { v: 1, cmd: { op, idx: (idx === undefined ? -1 : +idx), seq: Date.now(), t: Date.now() } });
    const s = $('#rmStatus'); if (s) s.textContent = '已发送：' + label;
  } catch (e) { const s = $('#rmStatus'); if (s) s.textContent = '发送失败，检查网络'; }
}
async function rmPoll() {
  try {
    const j = await cloudGet(RM_HOST);
    const h = j && j.data;
    const st = $('#rmStatus'), list = $('#rmList');
    if (!h || !h.t || h.off || !h.boardId) {
      if (st) st.textContent = '电脑上还没开遥控（场景面板 → 遥控）';
      if (list) list.innerHTML = '';
      return;
    }
    const n = (h.views || []).length;
    if (!n) { if (st) st.textContent = '这份画布还没记录视图（⌘⇧R 记录）'; if (list) list.innerHTML = ''; return; }
    if (st && !/^已发送/.test(st.textContent)) {
      st.textContent = (h.boardName || '画布') + ' · 第 ' + (h.idx + 1) + ' / ' + n + (h.playing ? ' · 演示中' : '');
    }
    const stop = $('#rmStop');
    if (stop) { stop.disabled = !h.playing; stop.classList.toggle('on', !!h.playing); }
    if (list) list.innerHTML = (h.views || []).map((v, i) =>
      `<button class="rm-item${i === h.idx ? ' cur' : ''}" data-op="goto" data-idx="${i}">` +
      `<span class="rm-i">${i + 1}</span>${escapeHtml(v.name || ('视图 ' + (i + 1)))}</button>`).join('');
  } catch (e) { /* 忽略 */ }
}
function startRemoteMode() {
  if ($('#rmui')) return;
  const el = document.createElement('div');
  el.id = 'rmui';
  el.innerHTML =
    '<div class="rm-head"><span class="rm-brand">XY<i>.</i>6300</span><span class="rm-tag">遥控</span>' +
    '<button class="rm-fs" id="rmFs" data-op="fs">全屏</button></div>' +
    '<div class="rm-status" id="rmStatus">正在连接…</div>' +
    '<div class="rm-pad">' +
      '<button class="rm-btn" data-op="prev" aria-label="上一个">&#8249;</button>' +
      '<button class="rm-btn wide" data-op="play" id="rmPlay">演示</button>' +
      '<button class="rm-btn" data-op="next" aria-label="下一个">&#8250;</button>' +
    '</div>' +
    '<button class="rm-btn stop" data-op="exit" id="rmStop">退出演示</button>' +
    '<div class="rm-list" id="rmList"></div>' +
    '<a class="rm-back" href="./">返回画布</a>';
  document.body.appendChild(el);
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-op]');
    if (!b) return;
    const op = b.dataset.op;
    if (op === 'fs') { toggleFullscreen(); return; }   // 切换全屏，不发指令
    if (op === 'play') rmSend(b.dataset.playing === '1' ? 'exit' : 'play');
    else rmSend(op, b.dataset.idx);
  });
  const fsb = $('#rmFs');
  if (fsb) {
    if (fsSupported()) fsb.textContent = fsNow() ? '退出全屏' : '全屏';
    else { fsb.textContent = '加到主屏幕可全屏'; fsb.disabled = true; }
  }
  document.addEventListener('fullscreenchange', syncFsBtn);
  document.addEventListener('webkitfullscreenchange', syncFsBtn);
  rmPoll();
  setInterval(rmPoll, 2000);
}
function syncFsBtn() {
  const fsb = $('#rmFs');
  if (fsb && fsSupported()) fsb.textContent = fsNow() ? '退出全屏' : '全屏';
}

async function libOpen(id, quiet) {
  if (lib.wid && lib.wid !== id) flushSave();        // 切走前先把当前这份存好
  lib.wid = id; saveLibCfg();
  cloud.key = LIB_ITEM_KEY(id); cloud.on = true; ensureCloudTimers();
  load();
  renderBoard();
  boardNameEl.value = board().name;
  applyCamera(); drawMinimap(); renderViews();
  lastSnapshot = snapshot();
  await cloudPull(true);
  cloudMigrateImages();
  libTouch(true);
  updateCloudUi();
  if (!quiet) {
    const it = lib.items.find(x => x.id === id);
    showToast('已打开「' + ((it && it.name) || '未命名') + '」');
  }
}

async function libCreate(name) {
  const id = uid();
  lib.items.push({ id, name: name || ('画布 ' + (lib.items.length + 1)), el: 0, updatedAt: Date.now() });
  await libPushIndex();
  await libOpen(id, true);
  showToast('已新建「' + (name || '画布') + '」');
}

async function libRename(id) {
  const it = lib.items.find(x => x.id === id);
  if (!it) return;
  const v = prompt('给它起个名字', it.name || '');
  if (v == null) return;
  it.name = v.trim() || '未命名';
  await libPushIndex(); libWriteLocal();
  renderLib();
}

async function libDup(id) {
  try {
    const j = await cloudGet(LIB_ITEM_KEY(id));
    if (!j || !j.data) throw 0;
    const nid = uid();
    const src = lib.items.find(x => x.id === id);
    await cloudSet(LIB_ITEM_KEY(nid), j.data);
    lib.items.push({ id: nid, name: ((src && src.name) || '画布') + ' 副本', el: (src && src.el) || 0, updatedAt: Date.now() });
    await libPushIndex(); libWriteLocal();
    renderLib();
    showToast('已复制一份');
  } catch (e) { showToast('复制失败，检查网络'); }
}

async function libDelete(id) {
  if (lib.items.length <= 1) { showToast('至少留一份画布'); return; }
  const it = lib.items.find(x => x.id === id);
  if (!confirm('删除「' + ((it && it.name) || '未命名') + '」？里面的内容会一起删掉，删了找不回来。')) return;
  lib.items = lib.items.filter(x => x.id !== id);
  libWriteLocal();
  await libPushIndex();
  try { localStorage.removeItem(storeKey(id)); } catch (e) { /* 忽略 */ }
  renderLib();
  if (lib.wid === id) { await libOpen(lib.items[0].id, true); }
  showToast('已删除');
}

function fmtTime(t) {
  if (!t) return '还没同步';
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderLib() {
  const box = $('#libList');
  if (!box) return;
  if (!lib.items.length) { box.innerHTML = '<div class="lib-empty">还没有画布 — 点下面「新建画布」</div>'; }
  else {
    box.innerHTML = lib.items.map(it => `
      <div class="lib-row${it.id === lib.wid ? ' cur' : ''}" data-id="${it.id}">
        <span class="lib-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M7.5 9.5h9M7.5 13.5h5"/></svg></span>
        <span class="lib-main">
          <span class="lib-name">${escapeHtml(it.name || '未命名')}</span>
          <span class="lib-meta">${it.el || 0} 个元素 · ${fmtTime(it.updatedAt)}</span>
        </span>
        <span class="lib-acts">
          <button data-a="rename" title="改名" aria-label="改名">&#9998;</button>
          <button data-a="dup" title="复制一份" aria-label="复制">&#9147;</button>
          <button data-a="del" class="danger" title="删除" aria-label="删除">&#10005;</button>
        </span>
      </div>`).join('');
  }
  const s = $('#libSync');
  if (s) s.textContent = '云同步：' + cloudStatus();
}

$('#btnRemote').addEventListener('click', () => setRemote(!remote.on));
$('#btnRemoteOpen').addEventListener('click', () => {
  const url = location.origin + location.pathname + '?remote=1';
  try { navigator.clipboard && navigator.clipboard.writeText(url); } catch (e) { /* 忽略 */ }
  showToast('地址已复制：' + url);
  window.open(url, '_blank');
});
$('#btnCloud').addEventListener('click', async () => {
  $('#libMask').classList.add('show');
  renderLib();
  await libPullIndex();
  renderLib();
});
$('#libClose').addEventListener('click', () => $('#libMask').classList.remove('show'));
$('#libMask').addEventListener('click', e => { if (e.target === $('#libMask')) $('#libMask').classList.remove('show'); });
$('#libNew').addEventListener('click', async () => {
  const v = prompt('新画布的名字', '画布 ' + (lib.items.length + 1));
  if (v == null) return;
  await libCreate(v.trim() || ('画布 ' + (lib.items.length + 1)));
  renderLib();
  $('#libMask').classList.remove('show');
});
$('#libList').addEventListener('click', async e => {
  const row = e.target.closest('.lib-row');
  if (!row) return;
  const id = row.dataset.id;
  const btn = e.target.closest('button[data-a]');
  if (!btn) { $('#libMask').classList.remove('show'); await libOpen(id); return; }
  e.stopPropagation();
  const a = btn.dataset.a;
  if (a === 'rename') await libRename(id);
  else if (a === 'dup') await libDup(id);
  else if (a === 'del') await libDelete(id);
});

async function libEnsureBuiltin() {
  // 保证《艺术 上》这件作品存在于目录里；并随 BUILTIN_ART_PAYLOAD 版本推进而更新（ver 增大即覆盖）
  const payload = BUILTIN_ART_PAYLOAD;
  const payloadVer = (payload.boards && payload.boards[0] && payload.boards[0].ver) || 1;
  const stored = (() => { try { return localStorage.getItem(storeKey(BUILTIN_ART_ID)); } catch (e) { return null; } })();
  const haveItem = lib.items.some(x => x.id === BUILTIN_ART_ID);

  let needSeed = false;
  if (haveItem) {
    // 目录里已有：比对版本，旧则覆盖；本地内容丢了则补回（不覆盖用户可能的新版本）
    let curVer = payloadVer;
    if (stored) { try { curVer = (JSON.parse(stored).boards[0].ver) || 1; } catch (e) {} }
    if (curVer < payloadVer) needSeed = true;
    else if (!stored) { try { localStorage.setItem(storeKey(BUILTIN_ART_ID), JSON.stringify(payload)); } catch (e) {} }
  } else {
    needSeed = true;
  }

  if (needSeed) {
    try { localStorage.setItem(storeKey(BUILTIN_ART_ID), JSON.stringify(payload)); } catch (e) {}
    if (!haveItem) {
      lib.items.push({ id: BUILTIN_ART_ID, name: BUILTIN_ART_NAME, el: BUILTIN_ART_EL, updatedAt: Date.now() });
    }
    libWriteLocal();
    try { await cloudSet(LIB_ITEM_KEY(BUILTIN_ART_ID), { v: payloadVer, boards: payload.boards, activeId: payload.activeId }); } catch (e) {}
    await libPushIndex();
  }
}

async function libBoot() {
  loadLibCfg();
  try { localStorage.removeItem(STORE_PREFIX + 'default'); } catch (e) { /* 忽略 */ }
  libMigrateLocal();                       // 旧的本机内容别丢
  await libPullIndex();
  if (!lib.items.length) await libMigrateCloud();
  const had = lib.items.length > 0;   // 旧空间码那份也搬过来
  await libEnsureBuiltin();                          // 保证《艺术 上》在目录里（幂等）
  if (had) {
    const want = lib.items.some(x => x.id === lib.wid) ? lib.wid : lib.items[0].id;
    await libOpen(want, true);
  } else {
    await libCreate('画布 1');                       // 全新用户：空白画布为当前，《艺术 上》作第二件
  }
  if (!lib.items.length) {
    await libCreate('画布 1');
  } else {
    const want = lib.items.some(x => x.id === lib.wid) ? lib.wid : lib.items[0].id;
    await libOpen(want, true);
  }
  lib.ready = true;
  await libPushIndex();
}

function updateCloudUi() {
  const btn = $('#btnCloud');
  if (!btn) return;
  btn.textContent = '目录';
  btn.title = cloudStatus();
}

/* ============================================================
   图形密码：与门户页xy6300.cc 共用同一把锁（同一个 localStorage 键）
   ⚠️ 帘子，不是保险柜：验证在前端，源文件谁都能看
   ============================================================ */
const LOCK_LS = 'xy6300.portal.lock';
const UNLOCK_SS = 'xy6300.portal.unlocked';
const PRESET_DONE = 'xy6300.portal.lockinit';
const PRESET_SEQ = [0, 8, 4];          // 音符 → 月牙 → 波浪，与门户页一致
const PRESET_SALT = 'xy6300-factory-2026';

const LOCK_MARKS = [
  '<circle cx="8.5" cy="16.5" r="3.2"/><path d="M11.7 16.5V6.5l7-2.6v9"/><path d="M18.7 12.9c-1.4.6-2.8.5-4-.4"/>',
  '<circle cx="12" cy="12" r="7.5"/>',
  '<path d="M12 5l7 13H5z"/>',
  '<rect x="5.5" y="5.5" width="13" height="13"/>',
  '<path d="M3 12c2.2-3.4 4.4-3.4 6.6 0s4.4 3.4 6.6 0 4.4-3.4 4.8-2.6"/>',
  '<path d="M12 3.5c1.2 5.2 1.2 8.8 0 17-1.2-8.2-1.2-11.8 0-17z"/><path d="M3.5 12c5.2-1.2 8.8-1.2 17 0-8.2 1.2-11.8 1.2-17 0z"/>',
  '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/>',
  '<path d="M6 6l12 12M18 6L6 18"/>',
  '<path d="M15.8 4.2a8.2 8.2 0 1 0 0 15.6 10 10 0 0 1 0-15.6z"/>',
  '<path d="M12 3.5s6 6.6 6 10.5a6 6 0 0 1-12 0C6 10.1 12 3.5 12 3.5z"/>',
  '<path d="M4.5 19.5C4.5 11 11 6 19.5 6c0 8.5-6.5 13.5-15 13.5z"/><path d="M4.5 19.5C9 15 13.5 12 19.5 10.4"/>',
  '<path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>'
];

let lockCfg = null, lockChain = [], lockStage = 'check', lockFirst = null;
try { const raw = localStorage.getItem(LOCK_LS); if (raw) lockCfg = JSON.parse(raw); } catch (e) { /* 忽略 */ }

/* 出厂密码：没设过就装一个，以后可以自己在门户页改 */
(function installPreset() {
  try {
    const done = localStorage.getItem(PRESET_DONE);
    if (done || lockCfg) { localStorage.setItem(PRESET_DONE, '1'); return; }
    lockCfg = { h: lockDigest(PRESET_SEQ, PRESET_SALT), len: PRESET_SEQ.length, salt: PRESET_SALT };
    localStorage.setItem(LOCK_LS, JSON.stringify(lockCfg));
    localStorage.setItem(PRESET_DONE, '1');
  } catch (e) { /* 忽略 */ }
})();

function lockDigest(seq, salt) {          // 不用 crypto.subtle：http 下取不到
  const s = seq.join(',') + '|' + salt;
  let a = 0x811c9dc5, b = 0x5f3a1c07;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0;
    b = (Math.imul(b, 0x21) + s.charCodeAt(i) * (i + 7)) >>> 0;
  }
  return a.toString(36) + '-' + b.toString(36);
}

const lockEl = $('#lockMask');
const lockSvg = inner => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

function buildLockMarks() {
  $('#marks').innerHTML = LOCK_MARKS.map((m, i) =>
    `<li><button class="mark-t" data-i="${i}" aria-pressed="false" aria-label="符号 ${i + 1}">${lockSvg(m)}</button></li>`
  ).join('');
}

function setLockMsg(t, warn) {
  const m = $('#lockMsg');
  m.textContent = t;
  m.className = 'lock-msg' + (warn ? ' warn' : '');
}

function lockRefresh() {
  const n = Math.max(lockChain.length, 3);
  $('#seq').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < lockChain.length ? 'on' : ''}"></i>`).join('');
  const a = $('#lockActs');
  if (lockStage === 'manage') a.innerHTML = '<button data-act="off">取消密码</button><button data-act="close">关闭</button>';
  else a.innerHTML = '<button data-act="clear">重来</button>';
  document.querySelectorAll('#marks .mark-t').forEach(b => {
    const k = lockChain.indexOf(+b.dataset.i);
    b.setAttribute('aria-pressed', k >= 0 ? 'true' : 'false');
    let o = b.querySelector('.ord');
    if (k >= 0) { if (!o) b.insertAdjacentHTML('beforeend', '<span class="ord"></span>'), o = b.querySelector('.ord'); o.textContent = k + 1; }
    else if (o) o.remove();
  });
}

function openLockScreen(s, msg) {
  lockStage = s; lockChain = []; lockFirst = null;
  lockEl.classList.add('on');
  $('#lockTitle').textContent = s === 'manage' ? '图案密码' : '我的画布';
  setLockMsg(msg);
  lockRefresh();
}
function closeLockScreen() {
  lockEl.classList.remove('on');
  lockChain = []; lockFirst = null;
  try { sessionStorage.setItem(UNLOCK_SS, '1'); } catch (e) { /* 忽略 */ }
  if (REMOTE) { startRemoteMode(); return; }   // 遥控模式不需要载入画布内容
  if (!lib.ready) libBoot().catch(err => { console.warn('目录载入失败', err); });
}

function lockFail(msg) {
  setLockMsg(msg || '顺序不对，再试一次', true);
  lockEl.querySelector('.lockbox').classList.add('shake');
  setTimeout(() => lockEl.querySelector('.lockbox').classList.remove('shake'), 460);
  setTimeout(() => { if (lockStage === 'check') { lockChain = []; setLockMsg('按顺序点击符号解锁'); lockRefresh(); } }, 620);
}

function lockTap(i) {
  if (lockStage === 'manage') return;
  if (lockChain.includes(i)) { lockChain = lockChain.filter(x => x !== i); lockRefresh(); return; }
  lockChain.push(i);
  lockRefresh();
  if (lockStage === 'check') {
    if (lockCfg && lockDigest(lockChain, lockCfg.salt) === lockCfg.h) {
      setLockMsg('好');
      // 全屏必须在这次点击的上下文里申请；放进 setTimeout 就不算用户手势了
      if (REMOTE) goFullscreen();
      setTimeout(closeLockScreen, 260);
    } else if (lockCfg && lockChain.length >= lockCfg.len) lockFail();
  }
}

$('#marks').addEventListener('click', e => {
  const b = e.target.closest('.mark-t');
  if (b) lockTap(+b.dataset.i);
});
$('#lockActs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const a = b.dataset.act;
  if (a === 'clear') { lockChain = []; setLockMsg('按顺序点击符号解锁'); lockRefresh(); }
  if (a === 'close') closeLockScreen();
  if (a === 'off') {
    lockCfg = null;
    try { localStorage.removeItem(LOCK_LS); } catch (err) { /* 忽略 */ }
    closeLockScreen();
    showToast('已取消图形密码');
  }
});

function lockNeeded() {
  let u = false;
  try { u = sessionStorage.getItem(UNLOCK_SS) === '1'; } catch (e) { /* 忽略 */ }
  return !!lockCfg && !u;
}

/* ---------------- 动效质量档位 ---------------- */
function setQuality(q) {
  state.quality = q;
  document.body.classList.toggle('q-low', q === 'low');
  localStorage.setItem('canvas.quality', q);
  const label = { auto: '自动', high: '全部', low: '精简' }[q] || '自动';
  const p = $('#btnPerfPanel');
  if (p) p.textContent = '动效：' + label;
}
$('#btnPerf').addEventListener('click', () => {
  const order = ['auto', 'high', 'low'];
  const next = order[(order.indexOf(state.quality) + 1) % 3];
  setQuality(next);
  showToast({ auto: '动效：自动（按帧率调节）', high: '动效：全部开启', low: '动效：精简模式（更流畅）' }[next]);
});
/* 竖屏手机上顶栏的 ⚡ 是隐藏的，场景面板里再给一个入口 */
$('#btnPerfPanel').addEventListener('click', () => $('#btnPerf').click());

let fpsFrames = 0, fpsAt = 0, fpsAvg = 60, autoDegraded = false;
function fpsLoop(now) {
  if (!fpsAt) fpsAt = now;
  fpsFrames++;
  if (now - fpsAt >= 1000) {
    const fps = fpsFrames * 1000 / (now - fpsAt);
    fpsAvg = fpsAvg * 0.35 + fps * 0.65;
    fpsFrames = 0; fpsAt = now;
    if (state.quality === 'auto' && !autoDegraded && fpsAvg < 38) {
      autoDegraded = true;
      setQuality('low');
      showToast('检测到掉帧，已切到精简动效以保证流畅');
    }
  }
  requestAnimationFrame(fpsLoop);
}

/* ---------------- 启动 ---------------- */
function addViewNamed(name) {
  const b = board();
  if (!b.views) b.views = [];
  const s = state.camera.scale;
  const hw = innerWidth / 2 / s, hh = innerHeight / 2 / s;          // 半宽 / 半高（世界单位）
  const v = {
    id: uid(), name,
    x: state.camera.x, y: state.camera.y, scale: s,                 // 保留旧字段（兼容 / 距离估算）
    // 跨屏一致的关键：记「屏幕中心的世界坐标」+「当时整块可视区域」，
    // 回放时以中心为锚把这块区域 contain 进任何比例的屏幕
    cx: state.camera.x + hw, cy: state.camera.y + hh, rw: hw * 2, rh: hh * 2,
    thumb: captureThumb(),
  };
  b.views.push(v);
  return v;
}

function boot() {
  const savedTheme = localStorage.getItem('canvas.theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  const q = localStorage.getItem('canvas.quality');
  setQuality(q === 'high' || q === 'low' ? q : 'auto');
  state.showViewRegions = localStorage.getItem('canvas.viewRegions') === 'on';
  { const b = $('#btnRegions'); if (b) b.textContent = '区域：' + (state.showViewRegions ? '开' : '关'); }
  load();
  /* 旧视图（没有中心锚）按当前屏幕补出 cx/cy/rw/rh，跨设备效果才能一致；
     只要还有视图缺锚就补（不靠一次性开关，避免旧部署的视图漏掉），补完立即存盘 */
  if (state.boards.some(b => (b.views || []).some(v => v.cx == null || v.rw == null))) {
    const n = migrateViews();
    if (n) { markDirty(); setTimeout(() => showToast(`已让 ${n} 个旧视图适配不同屏幕；想要最准可在当前屏幕上重录一次`), 900); }
  }
  boardNameEl.value = board().name;
  renderBoard();
  setTool('select');
  if (shapePop) shapePop.querySelectorAll('[data-shape]').forEach(x => x.classList.toggle('active', x.dataset.shape === state.shapeKind));
  applyCamera();

  if (state.fresh) {
    fitAll(0);
    applyCamera();
    addViewNamed('总览');
    const vd = els().find(e => e.type === 'video');
    if (vd) {
      const sc = clamp(Math.min(innerWidth * 0.62 / vd.w, innerHeight * 0.68 / vd.h), 0.2, 2);
      state.camera.x = vd.x + vd.w / 2 - innerWidth / 2 / sc;
      state.camera.y = vd.y + vd.h / 2 - innerHeight / 2 / sc;
      state.camera.scale = sc;
      applyCamera();
      addViewNamed('视频特写');
      const v0 = board().views[0];
      state.camera.x = v0.x; state.camera.y = v0.y; state.camera.scale = v0.scale;
      applyCamera();
    }
    renderViews();
    markDirty();
  }

  lastSnapshot = snapshot();
  updateHistoryButtons();
  requestAnimationFrame(fpsLoop);
  if (!localStorage.getItem('canvas.seen')) {
    localStorage.setItem('canvas.seen', '1');
    setTimeout(() => helpMask.classList.add('show'), 500);
  }
  window.addEventListener('resize', () => { applyCamera(); drawMinimap(); });
  window.addEventListener('beforeunload', () => { try { save(); } catch (e) { } });

  // 目录与云同步：先把旧配置读出来（迁移要用），但先别急着同步
  loadCloudCfg();
  cloud.on = false;                       // 等真正打开某份画布才连上
  buildLockMarks();
  updateCloudUi();
  if (REMOTE) {                           // 只当遥控器：不载入画布内容，省电也省流量
    document.body.classList.add('rm');
    if (lockNeeded()) openLockScreen('check', '按顺序点击符号解锁');
    else startRemoteMode();
    return;
  }
  if (lockNeeded()) openLockScreen('check', '按顺序点击符号解锁');   // 锁着不发任何请求
  else libBoot().catch(err => { console.warn('目录载入失败', err); });
}

/* 编辑时同步文本（轻量级，避免频繁入栈） */
world.addEventListener('input', e => {
  const t = e.target.closest('.txt');
  if (!t) return;
  const dom = t.closest('.el');
  const d = findEl(dom.dataset.id);
  if (d) { d.text = t.textContent; markDirty(); }
});
world.addEventListener('focusout', e => {
  const t = e.target.closest && e.target.closest('.txt');
  if (t && state.editingId === t.closest('.el').dataset.id) exitEdit();
});

/* 点击空白（单击）清除选择 —— 由 marquee end 处理 */

boot();
