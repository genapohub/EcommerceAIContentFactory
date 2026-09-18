const state = {
  result: null,
  previews: {
    mainImage: [],
    viralVideo: [],
  },
};

const form = document.querySelector("#product-form");
const output = document.querySelector("#output");
const mainImageInput = document.querySelector("#main-image");
const viralVideoInput = document.querySelector("#viral-video");
const mainImagePreview = document.querySelector("#main-image-preview");
const viralVideoPreview = document.querySelector("#viral-video-preview");
const exportButton = document.querySelector("#export-md");
const copyButton = document.querySelector("#copy-md");
const resetButton = document.querySelector("#reset-demo");
const sampleButton = document.querySelector("#fill-sample");
const exportState = document.querySelector("#export-state");
const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
const engineForm = document.querySelector("#engine-form");
const engineStatus = document.querySelector("#engine-status");
const testEngineButton = document.querySelector("#test-engine");
const recordList = document.querySelector("#record-list");
const recordSummary = document.querySelector("#record-summary");
const refreshRecordsButton = document.querySelector("#refresh-records");
const RECORD_STORAGE_KEY = "contentFactoryGenerationRecords";
const ENGINE_STORAGE_KEY = "engineDraft";
const MAX_RECORDS = 30;

function field(name) {
  return form.elements[name].value.trim();
}

function createIcon(name) {
  return `<i data-lucide="${name}" aria-hidden="true"></i>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function card(title, body, meta = "") {
  return `
    <article class="result-card">
      <div class="card-head">
        <h3>${escapeHtml(title)}</h3>
        ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
      </div>
      ${body}
    </article>
  `;
}

function renderList(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function ensureMaterialPlan(result) {
  if (result.materialPlan) return result;
  result.materialPlan = {
    summary: {
      productAssets: "旧记录未统计素材",
      referenceAssets: result.productProfile?.viralLink ? "已填写爆款链接" : "旧记录未统计参考",
      productItems: ["旧记录没有分区素材数据，建议重新生成一次"],
      referenceItems: ["旧记录没有爆款视频文件数据，建议重新生成一次"],
    },
    boundaries: [
      "旧记录只包含脚本和详情页模块，未包含素材级复制方案",
      "重新点击生成后，可获得商品原图生成主图、视频、分屏图的方案",
    ],
    detailScreenPlan: [
      {
        screen: "旧记录兼容",
        status: "建议重生成",
        copyGoal: "保留原详情页模块",
        assetAdvice: "重新生成后会按商品实拍原图输出主图、视频和详情页分屏图生成建议。",
      },
    ],
    videoReplicationPlan: [
      {
        stage: "旧记录兼容",
        status: "建议重生成",
        action: "保留原短视频脚本，素材级复刻建议需重新生成。",
        boundary: "不影响原脚本查看和导出。",
      },
    ],
  };
  return result;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function fileNames(input) {
  return Array.from(input.files || []).map((file) => file.name);
}

function fileCount(input) {
  return (input.files || []).length;
}

function totalProductAssetCount() {
  return fileCount(mainImageInput);
}

function totalViralAssetCount() {
  return fileCount(viralVideoInput);
}

function clearPreviewGroup(key) {
  state.previews[key].forEach((item) => URL.revokeObjectURL(item.url));
  state.previews[key] = [];
}

function renderFilePreview(input, previewNode, key, mediaType, limit = 6) {
  clearPreviewGroup(key);
  state.previews[key] = Array.from(input.files || [])
    .slice(0, limit)
    .map((file) => ({
      url: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
    }));

  previewNode.innerHTML = state.previews[key]
    .map((item) => {
      const sizeText = `${(item.size / 1024 / 1024).toFixed(1)} MB`;
      if (mediaType === "image") {
        return `
          <figure>
            <img src="${item.url}" alt="${escapeHtml(item.name)}">
            <figcaption>${escapeHtml(item.name)} · ${escapeHtml(sizeText)}</figcaption>
          </figure>
        `;
      }
      return `
        <figure>
          <video src="${item.url}" muted controls></video>
          <figcaption>${escapeHtml(item.name)} · ${escapeHtml(sizeText)}</figcaption>
        </figure>
      `;
    })
    .join("");
}

function renderGeneratedPreview(result) {
  const productName = result.productProfile.name || "未命名商品";
  const uploadedPhoto = state.previews.mainImage[0];
  const mainPoint = result.sellingPointBank.corePoints[0]?.title || "核心卖点";
  const detailScreens = result.detailPagePlan.modules.slice(0, 6);
  const imagePreview = uploadedPhoto
    ? `<img src="${escapeHtml(uploadedPhoto.url)}" alt="${escapeHtml(productName)}">`
    : `<div class="asset-placeholder">${createIcon("image")}<span>生成主图预览</span></div>`;

  return `
    <section class="output-section asset-preview-section">
      <div class="section-title">
        <p>内容生产</p>
        <h2>商品主图、介绍视频、分屏详情页</h2>
      </div>
      <div class="asset-showcase">
        <article class="asset-card main-visual">
          <div class="asset-card-head">
            <span>商品主图</span>
            <strong>${escapeHtml(mainPoint)}</strong>
          </div>
          <div class="main-image-preview">${imagePreview}</div>
          <p>基于商品原图生成白底主图、场景主图和利益点主图。</p>
        </article>
        <article class="asset-card video-visual">
          <div class="asset-card-head">
            <span>介绍视频</span>
            <strong>${escapeHtml(result.videoCreativePlans[0]?.suggestedDuration || "30秒")}</strong>
          </div>
          <div class="video-frame">
            <div class="play-mark">${createIcon("play")}</div>
            <div>
              <h3>${escapeHtml(result.videoCreativePlans[0]?.hook || "生成商品介绍视频")}</h3>
              <p>结构：开头钩子、场景演示、卖点近景、商品卡收口</p>
            </div>
          </div>
          <div class="video-timeline">
            <span>钩子</span>
            <span>演示</span>
            <span>证明</span>
            <span>转化</span>
          </div>
        </article>
        <article class="asset-card detail-visual">
          <div class="asset-card-head">
            <span>分屏详情页</span>
            <strong>${detailScreens.length} 屏</strong>
          </div>
          <div class="detail-screens">
            ${detailScreens
              .map(
                (screen, index) => `
                  <div class="detail-screen">
                    <span>${index + 1}</span>
                    <strong>${escapeHtml(screen.type)}</strong>
                    <p>${escapeHtml(screen.title)}</p>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>
      </div>
    </section>
  `;
}

function readRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECORD_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeRecords(records) {
  localStorage.setItem(RECORD_STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
}

function buildRecord(result, input) {
  return {
    id: `record-${Date.now()}`,
    createdAt: new Date().toISOString(),
    productName: result.productProfile.name || "未命名商品",
    categoryLabel: result.productProfile.categoryLabel,
    targetAudience: result.sellingPointBank.targetAudience,
    detailModuleCount: result.detailPagePlan.modules.length,
    videoCount: result.videoCreativePlans.length,
    riskCount: result.complianceReport.riskTerms.length,
    sourceSummary: input.viralText ? input.viralText.slice(0, 48) : input.viralLink || "未填写爆款参考",
    assetSummary: result.materialPlan.summary,
    result,
  };
}

function saveGenerationRecord(result, input) {
  const records = readRecords();
  const record = buildRecord(result, input);
  writeRecords([record, ...records]);
  return record;
}

function renderRecords() {
  const records = readRecords();
  recordSummary.textContent = records.length
    ? `已保存 ${records.length} 条生成记录，最多保留最近 ${MAX_RECORDS} 条`
    : "还没有生成记录";

  if (!records.length) {
    recordList.innerHTML = `
      <div class="empty-state compact-empty">
        <div class="empty-icon"><i data-lucide="database" aria-hidden="true"></i></div>
        <h2>暂无生成记录</h2>
        <p>在左侧填入商品资料并生成方案后，这里会出现商品、时间、风险和视频数量摘要。</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  recordList.innerHTML = records
    .map((record) => {
      const riskLabel = record.riskCount ? `${record.riskCount} 个风险词` : "未发现风险词";
      return `
        <article class="record-card">
          <div>
            <div class="card-head">
              <h3>${escapeHtml(record.productName)}</h3>
              <span class="record-tag${record.riskCount ? " warning" : ""}">${escapeHtml(riskLabel)}</span>
            </div>
            <p>${escapeHtml(record.targetAudience)}</p>
            <div class="record-meta">
              <span>${escapeHtml(record.categoryLabel)}</span>
              <span>${escapeHtml(formatTime(record.createdAt))}</span>
              <span>${escapeHtml(record.sourceSummary)}</span>
            </div>
            <div class="record-stats">
              <span>${record.detailModuleCount} 个详情页模块</span>
              <span>${record.videoCount} 条短视频方案</span>
              <span>${escapeHtml(record.assetSummary?.productAssets || "素材未统计")}</span>
              <span>内容生产方案</span>
            </div>
          </div>
          <button class="button secondary" type="button" data-load-record="${escapeHtml(record.id)}">
            <i data-lucide="rotate-ccw" aria-hidden="true"></i>
            载入结果
          </button>
        </article>
      `;
    })
    .join("");
  if (window.lucide) window.lucide.createIcons();
}

function renderResult(result) {
  result = ensureMaterialPlan(result);
  const bank = result.sellingPointBank;
  const detailCards = result.detailPagePlan.modules
    .map((module) =>
      card(
        `${module.type}｜${module.title}`,
        `<p>${escapeHtml(module.copy).replace(/\n/g, "<br>")}</p><p class="hint">配图：${escapeHtml(
          module.imageHint
        )}</p>`,
        module.sourcePointIds.join(" / ")
      )
    )
    .join("");

  const videoCards = result.videoCreativePlans
    .map((video) =>
      card(
        video.title,
        `
        <div class="metric-row">
          <span>${escapeHtml(video.structure)}</span>
          <span>${escapeHtml(video.suggestedDuration)}</span>
        </div>
        <p class="hook">${escapeHtml(video.hook)}</p>
        <pre>${escapeHtml(video.voiceover)}</pre>
        <h4>镜头清单</h4>
        ${renderList(video.shots)}
        <h4>字幕关键词</h4>
        ${renderList(video.captions)}
        <p class="hint">${escapeHtml(video.productExposure)}</p>
      `,
        video.id
      )
    )
    .join("");

  const detailAssetCards = result.materialPlan.detailScreenPlan
    .map((item) =>
      card(
        item.screen,
        `<p>${escapeHtml(item.copyGoal)}</p><p class="hint">${escapeHtml(item.assetAdvice)}</p>`,
        item.status
      )
    )
    .join("");

  const videoAssetCards = result.materialPlan.videoReplicationPlan
    .map((item) =>
      card(
        item.stage,
        `<p>${escapeHtml(item.action)}</p><p class="hint">${escapeHtml(item.boundary)}</p>`,
        item.status
      )
    )
    .join("");

  output.innerHTML = `
    ${renderGeneratedPreview(result)}

    <section class="output-section">
      <div class="section-title">
        <p>商品转化档案</p>
        <h2>${escapeHtml(result.productProfile.name || "未命名商品")}</h2>
      </div>
      <div class="profile-grid">
        ${card("目标人群", `<p>${escapeHtml(bank.targetAudience)}</p>`, result.productProfile.categoryLabel)}
        ${card(
          "核心卖点库",
          bank.corePoints
            .map(
              (point) =>
                `<div class="point-line"><strong>${escapeHtml(point.id)}</strong><span>${escapeHtml(
                  point.title
                )}</span><small>${escapeHtml(point.proof)} / ${escapeHtml(point.scene)}</small></div>`
            )
            .join("")
        )}
        ${card("购买顾虑", renderList(bank.concerns))}
      </div>
    </section>

    <section class="output-section">
      <div class="section-title">
        <p>爆款结构卡</p>
        <h2>${escapeHtml(result.viralAnalysis.hookType)}</h2>
      </div>
      <div class="profile-grid">
        ${card("前三秒钩子", `<p>${escapeHtml(result.viralAnalysis.openingHook)}</p>`)}
        ${card("内容节奏", `<p>${escapeHtml(result.viralAnalysis.pacing)}</p>`)}
        ${card("复刻边界", renderList(result.viralAnalysis.reusableStrategy))}
      </div>
    </section>

    <section class="output-section">
      <div class="section-title">
        <p>素材复制工作台</p>
        <h2>商品原图如何生成主图、视频和详情页分屏图</h2>
      </div>
      <div class="profile-grid">
        ${card("商品素材", renderList(result.materialPlan.summary.productItems), result.materialPlan.summary.productAssets)}
        ${card("爆款参考", renderList(result.materialPlan.summary.referenceItems), result.materialPlan.summary.referenceAssets)}
        ${card("执行边界", renderList(result.materialPlan.boundaries))}
      </div>
      <div class="result-grid material-grid">${detailAssetCards}${videoAssetCards}</div>
    </section>

    <section class="output-section">
      <div class="section-title">
        <p>详情页模块</p>
        <h2>1 套可编辑商详页结构</h2>
      </div>
      <div class="result-grid">${detailCards}</div>
    </section>

    <section class="output-section">
      <div class="section-title">
        <p>短视频爆款复制</p>
        <h2>3 条可发布脚本方案</h2>
      </div>
      <div class="result-grid">${videoCards}</div>
    </section>

    <section class="output-section">
      <div class="section-title">
        <p>发布前检查</p>
        <h2>${escapeHtml(result.complianceReport.recommendation)}</h2>
      </div>
      <div class="profile-grid">
        ${card("卖点一致性", `<p>${escapeHtml(result.complianceReport.consistency)}</p>`)}
        ${card("风险词", renderList(result.complianceReport.riskTerms.length ? result.complianceReport.riskTerms : ["未发现"]))}
        ${card("素材缺口", renderList(result.complianceReport.missingAssets.length ? result.complianceReport.missingAssets : ["暂无明显缺口"]))}
        ${card("建议补拍镜头", renderList(result.complianceReport.nextShots))}
      </div>
    </section>
  `;

  exportButton.disabled = false;
  copyButton.disabled = false;
  if (window.lucide) window.lucide.createIcons();
}

function collectInput() {
  return {
    name: field("name"),
    category: field("category"),
    price: field("price"),
    audience: field("audience"),
    specs: field("specs"),
    claims: field("claims"),
    generationBrief: field("generationBrief"),
    viralLink: field("viralLink"),
    viralText: field("viralText"),
    imageCount: totalProductAssetCount(),
    productPhotoCount: fileCount(mainImageInput),
    mainImageCount: fileCount(mainImageInput),
    productVideoCount: 0,
    detailImageCount: 0,
    viralVideoFileCount: fileCount(viralVideoInput),
    productPhotoNames: fileNames(mainImageInput),
    mainImageNames: fileNames(mainImageInput),
    productVideoNames: [],
    detailImageNames: [],
    viralVideoFileNames: fileNames(viralVideoInput),
  };
}

function validateInput(data) {
  return [];
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function switchTab(target) {
  tabButtons.forEach((button) => {
    const active = button.dataset.tab === target;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === target);
  });
  if (target === "records") {
    renderRecords();
  }
  if (window.lucide) window.lucide.createIcons();
}

function getEngineDraft() {
  return {
    provider: engineForm.elements.provider.value,
    baseUrl: engineForm.elements.baseUrl.value.trim(),
    model: engineForm.elements.model.value.trim(),
    videoModel: engineForm.elements.videoModel.value.trim(),
    budget: engineForm.elements.budget.value.trim(),
    hasApiKey: Boolean(engineForm.elements.apiKey.value.trim()),
  };
}

function renderEngineStatus(draft, checked = false) {
  const providerMap = {
    volcengine: "火山 / 即梦 / 视频服务",
    aliyun: "阿里云 / 通义 / Aidge",
    baidu: "百度千帆 / 文心 / 图像服务",
    tencent: "腾讯混元 / 图像服务",
    zhipu: "智谱 / 多模态服务",
    "custom-cn": "自有国内模型网关",
  };
  const missing = [];
  if (!draft.baseUrl) missing.push("接口地址");
  if (!draft.model) missing.push("图文模型名称");
  if (!draft.videoModel) missing.push("视频模型名称");
  if (!draft.hasApiKey) missing.push("API Key");
  const ready = missing.length === 0;

  engineStatus.innerHTML = `
    <h3>${checked ? "模拟检测结果" : "接入状态"}</h3>
    <p>${ready ? "国内模型配置草案完整，可以进入后端 API 对接开发。" : `仍需补充：${missing.join("、") || "无"}`}</p>
    <div class="point-line"><strong>服务商</strong><span>${escapeHtml(providerMap[draft.provider])}</span><small>国内模型</small></div>
    <div class="point-line"><strong>图文</strong><span>${escapeHtml(draft.model || "未指定图文模型")}</span><small>${escapeHtml(draft.baseUrl || "未填写接口地址")}</small></div>
    <div class="point-line"><strong>视频</strong><span>${escapeHtml(draft.videoModel || "未指定视频模型")}</span><small>用于介绍视频和爆款复制</small></div>
    <div class="point-line"><strong>预算</strong><span>${escapeHtml(draft.budget || "未设置")}</span><small>${draft.hasApiKey ? "已填写密钥字段，不在页面展示" : "未填写密钥字段"}</small></div>
  `;
}

function restoreEngineDraft() {
  const saved = JSON.parse(localStorage.getItem(ENGINE_STORAGE_KEY) || "{}");
  ["provider", "baseUrl", "model", "videoModel", "budget"].forEach((key) => {
    if (saved[key] && engineForm.elements[key]) {
      engineForm.elements[key].value = saved[key];
    }
  });
  renderEngineStatus(getEngineDraft());
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = collectInput();
  const missing = validateInput(data);
  if (missing.length) {
    showToast(`请补充：${missing.join("、")}`);
    return;
  }
  state.result = ContentEngine.generatePlan(data);
  renderResult(state.result);
  const record = saveGenerationRecord(state.result, data);
  renderRecords();
  showToast(`已生成方案，并保存到生成记录：${record.productName}`);
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

refreshRecordsButton.addEventListener("click", () => {
  renderRecords();
  showToast("生成记录已刷新");
});

recordList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-load-record]");
  if (!button) return;
  const records = readRecords();
  const record = records.find((item) => item.id === button.dataset.loadRecord);
  if (!record) {
    showToast("未找到这条生成记录");
    return;
  }
  state.result = record.result;
  renderResult(state.result);
  switchTab("factory");
  showToast(`已载入记录：${record.productName}`);
});

mainImageInput.addEventListener("change", () => {
  renderFilePreview(mainImageInput, mainImagePreview, "mainImage", "image", 1);
});

viralVideoInput.addEventListener("change", () => {
  renderFilePreview(viralVideoInput, viralVideoPreview, "viralVideo", "video", 1);
});

exportButton.addEventListener("click", () => {
  if (!state.result) return;
  const markdown = ContentEngine.exportMarkdown(state.result);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const name = state.result.productProfile.name || "商品";
  link.href = url;
  link.download = `${name}_转化内容方案.md`;
  link.click();
  URL.revokeObjectURL(url);
  exportState.textContent = `已触发导出：${link.download}`;
  showToast("已触发 Markdown 导出");
});

copyButton.addEventListener("click", async () => {
  if (!state.result) return;
  await navigator.clipboard.writeText(ContentEngine.exportMarkdown(state.result));
  showToast("Markdown 已复制");
});

sampleButton.addEventListener("click", () => {
  form.elements.name.value = "通勤轻量保温杯";
  form.elements.category.value = "home";
  form.elements.price.value = "到手 59 元";
  form.elements.audience.value = "每天通勤、办公室久坐、想少喝外卖饮料的年轻上班族";
  form.elements.specs.value = "316 不锈钢内胆，480ml，单手开盖，杯身防滑，车载杯架可放";
  form.elements.claims.value = "轻便好带，保温稳定，单手开盖，清洗方便";
  form.elements.generationBrief.value = "保留商品真实外观，生成电商首屏主图、通勤场景短视频和详情页卖点分屏图";
  form.elements.viralLink.value = "https://example.com/viral-video";
  form.elements.viralText.value =
    "你是不是也买过很重的保温杯，背一天肩膀都累？这个杯子我通勤用了两周，早上装咖啡，到下午还是温的，重点是单手就能开。";
  showToast("已填入演示数据");
});

resetButton.addEventListener("click", () => {
  form.reset();
  state.result = null;
  Object.keys(state.previews).forEach(clearPreviewGroup);
  output.innerHTML = `
    <div class="empty-state">
      <h2>生成后直接预览主图、介绍视频和分屏详情页</h2>
      <p>右侧会优先展示三类交付物预览，再提供脚本、卖点和发布检查。</p>
    </div>
  `;
  mainImagePreview.innerHTML = "";
  viralVideoPreview.innerHTML = "";
  exportState.textContent = "";
  exportButton.disabled = true;
  copyButton.disabled = true;
});

engineForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const draft = getEngineDraft();
  localStorage.setItem(
    ENGINE_STORAGE_KEY,
    JSON.stringify({
      mode: draft.mode,
      provider: draft.provider,
      baseUrl: draft.baseUrl,
      model: draft.model,
      videoModel: draft.videoModel,
      budget: draft.budget,
    })
  );
  renderEngineStatus(draft);
  showToast("已保存国内模型配置草案，密钥未写入本地存储");
});

testEngineButton.addEventListener("click", () => {
  renderEngineStatus(getEngineDraft(), true);
  showToast("已完成模拟检测：未向外部服务发送请求");
});

if (window.lucide) window.lucide.createIcons();
restoreEngineDraft();
renderRecords();
