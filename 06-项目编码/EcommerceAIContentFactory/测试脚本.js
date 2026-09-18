const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const engine = require("./生成引擎.js");

const fixtures = [
  {
    name: "轻薄防晒衬衫",
    category: "clothing",
    price: "到手 79 元",
    audience: "夏天通勤、怕晒但不想穿厚外套的女生",
    specs: "凉感面料，UPF50+，宽松版型，机洗不易变形",
    claims: "轻薄透气，防晒，显瘦，通勤百搭",
    viralText: "夏天通勤怕晒又怕闷，看这个防晒衬衫上身效果",
    generationBrief: "基于商品原图生成主图、通勤场景短视频和详情页分屏图",
    imageCount: 1,
    productPhotoCount: 1,
    mainImageCount: 1,
    viralVideoFileCount: 1,
    productPhotoNames: ["防晒衬衫商品原图.jpg"],
    mainImageNames: ["防晒衬衫商品原图.jpg"],
    viralVideoFileNames: ["参考视频.mp4"],
  },
  {
    name: "柔雾持妆粉底液",
    category: "beauty",
    price: "活动价 99 元",
    audience: "油皮、混油皮、需要上班持妆的人",
    specs: "柔雾妆效，不卡粉，便携泵头，三个色号",
    claims: "持妆稳定，肤感清爽，妆效自然",
    viralText: "粉底液不要只看遮瑕，下午不暗沉才重要",
    imageCount: 1,
    productPhotoCount: 1,
    mainImageCount: 1,
  },
  {
    name: "低糖坚果燕麦棒",
    category: "food",
    price: "三盒 49 元",
    audience: "办公室加班、健身后想控制热量的人",
    specs: "独立包装，低糖配方，坚果颗粒，保质期 9 个月",
    claims: "低糖，饱腹，独立包装，方便囤货",
    viralText: "下午饿了别总点奶茶，这个燕麦棒放办公室正好",
    imageCount: 1,
    productPhotoCount: 1,
    mainImageCount: 1,
  },
  {
    name: "厨房免打孔置物架",
    category: "home",
    price: "券后 39 元",
    audience: "租房、小厨房、台面总是乱的人",
    specs: "免打孔，承重强，沥水设计，可拆洗",
    claims: "节省空间，安装简单，清洁方便",
    viralText: "厨房台面乱不是懒，是东西没有上墙",
    imageCount: 1,
    productPhotoCount: 1,
    mainImageCount: 1,
  },
  {
    name: "磁吸快充数据线",
    category: "tech",
    price: "两条 29 元",
    audience: "桌面设备多、经常插拔充电线的人",
    specs: "磁吸收纳，Type-C 接口，快充，耐弯折",
    claims: "收纳方便，充电稳定，耐用，桌面整洁",
    viralText: "桌面线缆乱的人，可以先看这个磁吸收纳效果",
    imageCount: 1,
    productPhotoCount: 1,
    mainImageCount: 1,
  },
];

fixtures.forEach((fixture) => {
  const result = engine.generatePlan(fixture);
  assert.equal(result.sellingPointBank.corePoints.length, 3);
  assert.equal(result.videoCreativePlans.length, 3);
  assert.ok(result.detailPagePlan.modules.length >= 8);
  assert.ok(result.materialPlan.summary.productAssets);
  assert.ok(result.materialPlan.summary.productAssets.includes("商品原图"));
  assert.ok(result.materialPlan.summary.productAssets.includes("生成视频"));
  assert.ok(result.materialPlan.detailScreenPlan.length >= 3);
  assert.ok(result.materialPlan.videoReplicationPlan.length >= 3);
  assert.ok(result.viralAnalysis.openingHook);
  assert.ok(result.complianceReport.consistency.includes("通过"));
  const markdown = engine.exportMarkdown(result);
  assert.ok(markdown.includes("详情页模块"));
  assert.ok(markdown.includes("短视频方案"));
  assert.ok(markdown.includes("素材复制工作台"));
});

const risky = engine.generatePlan({
  name: "测试商品",
  category: "other",
  audience: "测试用户",
  claims: "全网第一，100%有效",
  viralText: "这个商品真的很强",
  imageCount: 0,
});

assert.ok(risky.complianceReport.riskTerms.includes("全网第一"));
assert.ok(risky.complianceReport.riskTerms.includes("100%"));
assert.ok(risky.complianceReport.missingAssets.length >= 1);

const emptyInput = engine.generatePlan({
  category: "home",
});

assert.equal(emptyInput.productProfile.name, "");
assert.equal(emptyInput.videoCreativePlans.length, 3);
assert.ok(emptyInput.detailPagePlan.modules.length >= 8);
assert.ok(emptyInput.viralAnalysis.openingHook);

const html = fs.readFileSync(path.join(__dirname, "工作台.html"), "utf8");
assert.ok(html.includes("科技内容控制台"));
assert.ok(html.includes("生成记录"));
assert.ok(html.includes("国内模型配置"));
assert.ok(html.includes("商品实拍原图"));
assert.ok(html.includes("生成主图"));
assert.ok(html.includes("生成视频"));
assert.ok(html.includes("生成详情页分屏图"));
assert.ok(html.includes("爆款视频文件"));
assert.ok(html.includes("接入国内图文和视频模型"));
assert.ok(html.includes("火山 / 即梦 / 视频服务"));
assert.ok(html.includes("阿里云 / 通义 / Aidge"));
assert.ok(!html.includes("OpenAI 兼容接口"));
assert.ok(!html.includes("先用本地模式"));
assert.ok(html.includes("data-tab=\"records\""));
assert.ok(html.includes("data-tab=\"engine-guide\""));
assert.ok(html.includes("export-state"));

const app = fs.readFileSync(path.join(__dirname, "应用.js"), "utf8");
assert.ok(app.includes("contentFactoryGenerationRecords"));
assert.ok(app.includes("saveGenerationRecord"));
assert.ok(app.includes("renderRecords"));
assert.ok(app.includes("renderFilePreview"));
assert.ok(app.includes("function validateInput(data)"));
assert.ok(app.includes("return [];"));
assert.ok(app.includes("viralVideoFileCount"));
assert.ok(app.includes("videoModel"));
assert.ok(!app.includes("本地规则引擎"));
assert.ok(!app.includes("apiKey:"));

console.log("全部生成引擎测试通过");
