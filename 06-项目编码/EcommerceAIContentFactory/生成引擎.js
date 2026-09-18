(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ContentEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const categoryPresets = {
    clothing: {
      label: "服饰",
      scenes: ["通勤出门", "周末约会", "换季叠穿"],
      proof: ["版型遮肉", "面料亲肤", "上身显精神"],
      concerns: ["尺码不准", "显胖", "洗后变形"],
    },
    beauty: {
      label: "美妆个护",
      scenes: ["早八快速出门", "约会补妆", "熬夜后急救"],
      proof: ["妆效自然", "肤感清爽", "便携好补"],
      concerns: ["卡粉", "闷肤", "色号踩雷"],
    },
    food: {
      label: "食品",
      scenes: ["办公室加餐", "晚间追剧", "家庭囤货"],
      proof: ["配料清楚", "独立包装", "口味稳定"],
      concerns: ["太甜太腻", "不新鲜", "分量不够"],
    },
    home: {
      label: "家居日用",
      scenes: ["通勤携带", "办公室使用", "居家收纳"],
      proof: ["节省空间", "使用方便", "清洁方便"],
      concerns: ["占地方", "不好清理", "质量不稳"],
    },
    tech: {
      label: "3C数码",
      scenes: ["通勤办公", "居家学习", "旅行备用"],
      proof: ["续航稳定", "连接方便", "兼容常用设备"],
      concerns: ["不耐用", "操作复杂", "兼容差"],
    },
    other: {
      label: "通用商品",
      scenes: ["日常使用", "送礼场景", "新人入门"],
      proof: ["上手简单", "使用频率高", "售后清楚"],
      concerns: ["不知道值不值", "不会用", "怕买错"],
    },
  };

  const bannedTerms = [
    "全网第一",
    "销量第一",
    "国家级",
    "永久",
    "根治",
    "包治",
    "100%",
    "绝对",
    "最便宜",
    "顶级",
    "唯一",
  ];

  const stopWords = new Set([
    "一个",
    "我们",
    "这个",
    "商品",
    "产品",
    "适合",
    "可以",
    "支持",
    "非常",
    "以及",
    "使用",
    "已经",
    "没有",
    "用户",
    "人群",
    "卖点",
  ]);

  function cleanText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function splitList(value) {
    return cleanText(value)
      .split(/[,，;；、\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function extractKeywords(input) {
    const text = cleanText(input);
    const words = text
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ")
      .split(/\s+/)
      .flatMap((word) => {
        if (/^[\u4e00-\u9fa5]{5,}$/.test(word)) {
          return word.match(/.{2,4}/g) || [word];
        }
        return [word];
      })
      .map((word) => word.trim())
      .filter((word) => word.length >= 2 && !stopWords.has(word));

    const score = new Map();
    words.forEach((word) => score.set(word, (score.get(word) || 0) + 1));
    return Array.from(score.entries())
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      .slice(0, 8)
      .map(([word]) => word);
  }

  function pickCategory(category) {
    return categoryPresets[category] || categoryPresets.other;
  }

  function inferPoints(product) {
    const preset = pickCategory(product.category);
    const manualPoints = splitList(product.claims);
    const specPoints = splitList(product.specs);
    const keywords = extractKeywords(
      `${product.name} ${product.audience} ${product.claims} ${product.specs}`
    );

    const candidates = [
      ...manualPoints,
      ...specPoints,
      ...preset.proof,
      ...keywords.map((word) => `${word}相关优势`),
    ];

    const unique = [];
    candidates.forEach((item) => {
      const normalized = item.replace(/\s/g, "");
      if (normalized && !unique.some((seen) => seen.replace(/\s/g, "") === normalized)) {
        unique.push(item);
      }
    });

    return unique.slice(0, 5);
  }

  function buildSellingPointBank(product) {
    const preset = pickCategory(product.category);
    const points = inferPoints(product);
    const audience = cleanText(product.audience) || "对品质和效率有要求的日常消费者";

    return {
      categoryLabel: preset.label,
      corePoints: points.slice(0, 3).map((point, index) => ({
        id: `SP-${index + 1}`,
        title: point,
        proof: preset.proof[index % preset.proof.length],
        scene: preset.scenes[index % preset.scenes.length],
        audience,
      })),
      scenarios: preset.scenes,
      concerns: preset.concerns,
      forbiddenClaims: bannedTerms.filter((term) =>
        `${product.claims} ${product.specs}`.includes(term)
      ),
      targetAudience: audience,
    };
  }

  function analyzeViralReference(product, viralInput) {
    const text = cleanText(viralInput);
    const lower = text.toLowerCase();
    const hasCompare = /对比|之前|用了|没用|区别|vs|VS/.test(text);
    const hasPrice = /价格|到手|优惠|券|省|便宜|预算/.test(text);
    const hasDemo = /看|展示|实测|开箱|试用|上手|镜头/.test(text);
    const hasPain = /痛点|烦|怕|担心|问题|不会|容易/.test(text);

    const hookType = hasPain
      ? "痛点拦截型"
      : hasCompare
      ? "对比反差型"
      : hasDemo
      ? "场景演示型"
      : hasPrice
      ? "价格锚定型"
      : "口播种草型";

    return {
      hookType,
      openingHook: text
        ? text.slice(0, 42)
        : `${product.audience || "目标用户"}别急着下单，先看这个${product.name || "商品"}值不值`,
      painPoint: hasPain
        ? "参考内容通过先放大用户顾虑来建立观看理由"
        : "建议补充一个真实使用前的顾虑，提升前三秒停留",
      productShow: hasDemo ? "适合用近景和上手镜头承接卖点" : "需要补充商品细节和使用场景镜头",
      trustProof: "用细节、对比、真实使用过程承接信任，不直接照搬竞品人物和文案",
      offerMechanism: hasPrice ? "保留价格锚点，但改写为自有活动机制" : "可加入限时福利或组合装理由",
      cta: "结尾引导点击商品卡、进橱窗或私信领取清单",
      pacing: product.viralVideoFileCount
        ? "先按上传视频记录来源，再用 3秒钩子、8秒建立问题、12秒展示商品、5秒收口转化复刻节奏"
        : "3秒钩子、8秒建立问题、12秒展示商品、5秒收口转化",
      subtitleStyle: "短句大字，关键词加重，单屏不超过两行",
      reusableStrategy: [
        "复刻结构，不复制原画面、人物、商标和完整文案",
        "把竞品表达替换成自家商品卖点和真实素材",
        "每条视频只主打一类人群或一个购买理由",
      ],
    };
  }

  function formatCount(count, unit) {
    return count ? `${count} ${unit}` : `0 ${unit}`;
  }

  function summarizeNames(names, fallback) {
    return names && names.length ? names.slice(0, 3).join("、") : fallback;
  }

  function buildDetailPage(product, bank) {
    const productName = cleanText(product.name) || "这款商品";
    const price = cleanText(product.price) || "按当前活动价";
    const topPoints = bank.corePoints;

    return {
      modules: [
        {
          type: "首屏利益点",
          title: `${productName}，先解决${bank.concerns[0]}这个顾虑`,
          copy: `适合${bank.targetAudience}，主打${topPoints[0].title}，${price}入手更适合先试用。`,
          imageHint: "商品主图加一个真实使用场景，首屏只放一个核心利益点。",
          sourcePointIds: [topPoints[0].id],
        },
        ...topPoints.map((point) => ({
          type: "核心卖点",
          title: point.title,
          copy: `在${point.scene}里，这个卖点能直接减少用户决策成本；证明点用“${point.proof}”承接。`,
          imageHint: `拍${point.scene}下的使用前后或细节特写。`,
          sourcePointIds: [point.id],
        })),
        {
          type: "使用场景",
          title: `三个高频场景让用户知道怎么买`,
          copy: bank.scenarios.map((scene) => `${scene}：突出${topPoints[0].title}`).join("；"),
          imageHint: "用三宫格展示不同人群或不同时间点的使用状态。",
          sourcePointIds: topPoints.map((point) => point.id),
        },
        {
          type: "细节证明",
          title: "把信任感放到细节里",
          copy: topPoints.map((point) => `${point.title}对应证明：${point.proof}`).join("；"),
          imageHint: "用近景展示材质、结构、包装、使用过程或实测结果。",
          sourcePointIds: topPoints.map((point) => point.id),
        },
        {
          type: "对比模块",
          title: "为什么不是随便买一个同类款",
          copy: `普通同类款容易出现${bank.concerns.slice(0, 2).join("、")}，本商品用${topPoints
            .map((point) => point.title)
            .join("、")}降低试错。`,
          imageHint: "用表格或左右对比图展示购买前后差异，避免点名竞品。",
          sourcePointIds: topPoints.map((point) => point.id),
        },
        {
          type: "用户顾虑 FAQ",
          title: "下单前常见问题",
          copy: bank.concerns.map((concern) => `担心${concern}？建议用实拍细节和售后说明回答。`).join("\n"),
          imageHint: "用问答卡片承接评论区常见问题。",
          sourcePointIds: topPoints.map((point) => point.id),
        },
        {
          type: "下单理由",
          title: "现在下单的理由",
          copy: `如果你是${bank.targetAudience}，先看${topPoints[0].title}是否命中需求，再用${topPoints[1]?.title || topPoints[0].title}判断是否值得复购。`,
          imageHint: "收口图放商品全貌、规格、活动信息和售后承诺。",
          sourcePointIds: [topPoints[0].id, topPoints[1]?.id || topPoints[0].id],
        },
      ],
    };
  }

  function scriptTemplate(product, bank, analysis, index) {
    const productName = cleanText(product.name) || "这款商品";
    const point = bank.corePoints[index % bank.corePoints.length];
    const nextPoint = bank.corePoints[(index + 1) % bank.corePoints.length];
    const scene = bank.scenarios[index % bank.scenarios.length];
    const concern = bank.concerns[index % bank.concerns.length];
    const templates = [
      {
        structure: "痛点拦截型",
        title: `${concern}的人，先看完这个再买${productName}`,
        hook: `你是不是也怕买${productName}踩到${concern}？`,
        body: [
          `很多人不是不想买，是不知道怎么判断值不值。`,
          `这款我会先看${point.title}，因为它直接影响${scene}里的真实体验。`,
          `再看${nextPoint.title}，这个决定你买回去是不是能长期用。`,
          `最后别只看主图，评论区和详情页的细节证明也要对上。`,
        ],
      },
      {
        structure: "场景演示型",
        title: `${scene}真实怎么用，30秒讲清楚`,
        hook: `${productName}别只看静态图，放到${scene}里更好判断。`,
        body: [
          `第一镜先拍使用前的状态，让用户看到问题。`,
          `第二镜展示${point.title}，镜头给到细节。`,
          `第三镜补一个${nextPoint.title}，把购买理由讲完整。`,
          `最后回到商品全貌，告诉用户适合谁买。`,
        ],
      },
      {
        structure: "对比测评型",
        title: `同类商品怎么选，看这三个点就够了`,
        hook: `买${productName}不要只比价格，先比这三个点。`,
        body: [
          `第一看${point.title}，这是直接影响体验的部分。`,
          `第二看${nextPoint.title}，这是决定复购的部分。`,
          `第三看售后和规格是否写清楚，避免买错。`,
          `如果这三个点都对上，再去看价格才有意义。`,
        ],
      },
    ];
    return templates[index];
  }

  function buildVideoPlans(product, bank, analysis) {
    return [0, 1, 2].map((index) => {
      const template = scriptTemplate(product, bank, analysis, index);
      const point = bank.corePoints[index % bank.corePoints.length];
      const duration = [28, 35, 42][index];
      const materialLine = product.productPhotoCount
        ? "用商品实拍原图生成开头手持、核心卖点近景、使用过程、结尾商品全貌四类镜头。"
        : "当前缺少商品实拍原图，只能先输出脚本和镜头生成提示词。";
      return {
        id: `V-${index + 1}`,
        title: template.title,
        structure: template.structure,
        hook: template.hook,
        voiceover: [template.hook, ...template.body, "想少踩坑，点商品卡先看详情。"].join("\n"),
        shots: [
          `0-3秒：正面抛出钩子，字幕突出“${point.title}”`,
          `4-10秒：展示用户痛点或使用前状态`,
          `11-22秒：商品近景、上手、细节证明连续切换`,
          `23-${duration}秒：回到商品全貌和下单理由，露出商品卡`,
          materialLine,
        ],
        captions: [template.hook, point.title, "细节比主图更重要", "点商品卡看完整说明"],
        productExposure: "至少出现 3 次：开头手持、核心卖点近景、结尾商品全貌。",
        cta: "点商品卡，看完整详情和当前活动。",
        suggestedDuration: `${duration}秒`,
        variationTips: ["换人群", "换场景", "换前三秒钩子", "换价格机制", "换平台语气"],
        sourcePointIds: [point.id],
      };
    });
  }

  function buildMaterialPlan(product, detailPage, videos, analysis) {
    const hasProductPhoto = product.productPhotoCount > 0;
    const hasViralReference = Boolean(product.viralVideoFileCount || cleanText(product.viralLink) || cleanText(product.viralText));
    const mainImageTargetCount = hasProductPhoto ? 3 : 0;
    const videoTargetCount = hasProductPhoto ? videos.length : 0;
    const detailScreenTargetCount = hasProductPhoto ? Math.max(6, detailPage.modules.length) : 0;

    return {
      summary: {
        productAssets: `${formatCount(product.productPhotoCount, "张商品原图")} -> ${formatCount(mainImageTargetCount, "张主图")} / ${formatCount(videoTargetCount, "条生成视频")} / ${formatCount(detailScreenTargetCount, "张分屏图")}`,
        referenceAssets: product.viralVideoFileCount
          ? `${formatCount(product.viralVideoFileCount, "个爆款视频文件")}`
          : cleanText(product.viralLink)
          ? "已填写爆款链接"
          : "未上传爆款视频文件",
        productItems: [
          `商品原图：${summarizeNames(product.productPhotoNames, hasProductPhoto ? "已上传" : "未上传")}`,
          `生成主图：${mainImageTargetCount ? "计划生成 3 张，覆盖白底主图、场景主图、利益点主图" : "需先上传商品原图"}`,
          `生成视频：${videoTargetCount ? `计划生成 ${videoTargetCount} 条，对应 3 条爆款脚本` : "需先上传商品原图"}`,
          `生成详情页分屏图：${detailScreenTargetCount ? `计划生成 ${detailScreenTargetCount} 张，覆盖首屏、卖点、场景、对比、FAQ` : "需先上传商品原图"}`,
        ],
        referenceItems: [
          `爆款链接：${cleanText(product.viralLink) || "未填写"}`,
          `爆款视频文件：${summarizeNames(product.viralVideoFileNames, product.viralVideoFileCount ? "已上传" : "未上传")}`,
          `爆款文案观察：${cleanText(product.viralText) ? "已填写" : "未填写"}`,
        ],
      },
      boundaries: [
        "当前版本先用商品原图生成主图、视频、详情页分屏图的生产方案，不直接产出真实图片和视频文件",
        "爆款链接或文件用于复制结构、节奏、镜头功能和字幕策略，当前不自动解析视频画面、字幕和音频",
        "复刻的是结构、节奏、镜头功能和转化策略，不复制竞品素材",
        "真实视频理解需要后续接入抽帧、OCR、语音转文字和多模态模型",
      ],
      detailScreenPlan: [
        {
          screen: "主图生成",
          status: hasProductPhoto ? "可生成" : "需商品原图",
          copyGoal: detailPage.modules[0].title,
          assetAdvice: hasProductPhoto
            ? "基于商品原图生成白底主图、场景主图和活动利益点主图，保留商品真实外观。"
            : "先拍一张清晰商品原图，建议正面、无遮挡、光线均匀。",
        },
        {
          screen: "详情页分屏图生成",
          status: hasProductPhoto ? "可生成" : "需商品原图",
          copyGoal: "把 3 个核心卖点分别做成独立分屏，方便用户扫读。",
          assetAdvice: hasProductPhoto
            ? "用商品原图扩展生成卖点特写、场景使用、细节证明、对比说明和 FAQ 问答图。"
            : "没有商品原图时只能生成文案结构，不能生成可用分屏图提示。",
        },
        {
          screen: "对比和 FAQ 分屏",
          status: hasProductPhoto ? "可生成" : "需商品原图",
          copyGoal: "用对比和问答解决下单前顾虑。",
          assetAdvice: "生成左右对比、规格卡和售后说明分屏，避免点名竞品。",
        },
      ],
      videoReplicationPlan: [
        {
          stage: "爆款参考拆解",
          status: hasViralReference ? "已有参考" : "需补参考",
          action: product.viralVideoFileCount
            ? "已接收爆款视频文件，可先人工填写观察文本，后续接模型自动抽帧和转写。"
            : "当前主要依赖链接或文案观察生成结构卡。",
          boundary: analysis.reusableStrategy[0],
        },
        {
          stage: "商品原图生成视频",
          status: hasProductPhoto ? "可生成" : "需商品原图",
          action: hasProductPhoto
            ? "把商品原图转成开头手持、核心卖点近景、使用过程、结尾商品全貌四类视频镜头，再按爆款节奏重排。"
            : "先上传商品原图，再生成视频镜头提示词和剪辑结构。",
          boundary: "用自家商品生成素材替换竞品画面和人物。",
        },
        {
          stage: "详情页联动",
          status: hasProductPhoto ? "可联动" : "需商品原图",
          action: "生成视频前三秒钩子、生成主图利益点和详情页分屏图应使用同一套核心卖点。",
          boundary: "视频承诺必须能在详情页素材中找到证明。",
        },
      ],
    };
  }

  function buildCompliance(product, detailPage, videos, analysis, materialPlan) {
    const allText = [
      product.name,
      product.claims,
      product.specs,
      product.viralText,
      ...detailPage.modules.map((module) => `${module.title} ${module.copy}`),
      ...videos.map((video) => `${video.title} ${video.voiceover}`),
    ].join(" ");

    const riskTerms = bannedTerms.filter((term) => allText.includes(term));
    const missingAssets = [];
    if (!product.productPhotoCount) missingAssets.push("缺少商品实拍原图，无法生成主图、视频和详情页分屏图");
    if (!cleanText(product.viralText) && !cleanText(product.viralLink) && !product.viralVideoFileCount) {
      missingAssets.push("缺少爆款参考，当前使用通用结构生成");
    }
    if (!cleanText(product.claims)) missingAssets.push("缺少人工卖点描述，建议补充真实证明");

    const detailPointIds = new Set(detailPage.modules.flatMap((module) => module.sourcePointIds));
    const videoPointIds = new Set(videos.flatMap((video) => video.sourcePointIds));
    const shared = Array.from(detailPointIds).filter((id) => videoPointIds.has(id));

    return {
      consistency:
        shared.length > 0
          ? "通过：详情页和短视频共用同一套核心卖点库"
          : "需复核：详情页和短视频未形成明确卖点引用",
      riskTerms,
      copyrightRisk: analysis.reusableStrategy,
      missingAssets,
      nextShots: [
        materialPlan.videoReplicationPlan[1].action,
        "基于商品原图生成核心卖点对应的使用过程镜头 2-3 段",
        "基于商品原图生成详情页首屏、卖点、对比、FAQ 分屏图各 1 张",
      ],
      recommendation:
        riskTerms.length || missingAssets.length
          ? "建议修改风险词并补齐素材后再发布"
          : "可以进入人工微调和发布排期",
    };
  }

  function generatePlan(productInput) {
    const product = {
      name: cleanText(productInput.name),
      category: productInput.category || "other",
      price: cleanText(productInput.price),
      audience: cleanText(productInput.audience),
      specs: cleanText(productInput.specs),
      claims: cleanText(productInput.claims),
      generationBrief: cleanText(productInput.generationBrief),
      viralText: cleanText(productInput.viralText),
      viralLink: cleanText(productInput.viralLink),
      imageCount: Number(productInput.imageCount || 0),
      productPhotoCount: Number(productInput.productPhotoCount || productInput.mainImageCount || 0),
      productPhotoNames: Array.isArray(productInput.productPhotoNames)
        ? productInput.productPhotoNames
        : Array.isArray(productInput.mainImageNames)
        ? productInput.mainImageNames
        : [],
      mainImageCount: Number(productInput.mainImageCount || 0),
      productVideoCount: Number(productInput.productVideoCount || 0),
      detailImageCount: Number(productInput.detailImageCount || 0),
      viralVideoFileCount: Number(productInput.viralVideoFileCount || 0),
      mainImageNames: Array.isArray(productInput.mainImageNames) ? productInput.mainImageNames : [],
      productVideoNames: Array.isArray(productInput.productVideoNames) ? productInput.productVideoNames : [],
      detailImageNames: Array.isArray(productInput.detailImageNames) ? productInput.detailImageNames : [],
      viralVideoFileNames: Array.isArray(productInput.viralVideoFileNames) ? productInput.viralVideoFileNames : [],
    };

    const sellingPointBank = buildSellingPointBank(product);
    const viralAnalysis = analyzeViralReference(
      product,
      `${product.viralText} ${product.viralLink}`
    );
    const detailPagePlan = buildDetailPage(product, sellingPointBank);
    const videoCreativePlans = buildVideoPlans(product, sellingPointBank, viralAnalysis);
    const materialPlan = buildMaterialPlan(product, detailPagePlan, videoCreativePlans, viralAnalysis);
    const complianceReport = buildCompliance(
      product,
      detailPagePlan,
      videoCreativePlans,
      viralAnalysis,
      materialPlan
    );

    return {
      productProfile: {
        ...product,
        categoryLabel: sellingPointBank.categoryLabel,
      },
      sellingPointBank,
      viralAnalysis,
      materialPlan,
      detailPagePlan,
      videoCreativePlans,
      complianceReport,
      generatedAt: new Date().toISOString(),
    };
  }

  function exportMarkdown(result) {
    const lines = [];
    lines.push(`# ${result.productProfile.name || "商品"} 转化内容方案`);
    lines.push("");
    lines.push("## 商品转化档案");
    lines.push(`- 类目：${result.productProfile.categoryLabel}`);
    lines.push(`- 目标人群：${result.sellingPointBank.targetAudience}`);
    result.sellingPointBank.corePoints.forEach((point) => {
      lines.push(`- ${point.id}：${point.title}；证明：${point.proof}；场景：${point.scene}`);
    });
    lines.push("");
    lines.push("## 爆款结构卡");
    lines.push(`- 类型：${result.viralAnalysis.hookType}`);
    lines.push(`- 前三秒：${result.viralAnalysis.openingHook}`);
    lines.push(`- 节奏：${result.viralAnalysis.pacing}`);
    lines.push("");
    lines.push("## 素材复制工作台");
    lines.push(`- 商品素材：${result.materialPlan.summary.productAssets}`);
    if (result.productProfile.generationBrief) {
      lines.push(`- 生成要求：${result.productProfile.generationBrief}`);
    }
    result.materialPlan.summary.productItems.forEach((item) => lines.push(`- ${item}`));
    lines.push(`- 爆款参考：${result.materialPlan.summary.referenceAssets}`);
    result.materialPlan.summary.referenceItems.forEach((item) => lines.push(`- ${item}`));
    lines.push("### 详情页分屏建议");
    result.materialPlan.detailScreenPlan.forEach((item) => {
      lines.push(`- ${item.screen}：${item.status}；${item.assetAdvice}`);
    });
    lines.push("### 视频复刻素材建议");
    result.materialPlan.videoReplicationPlan.forEach((item) => {
      lines.push(`- ${item.stage}：${item.status}；${item.action}`);
    });
    lines.push("");
    lines.push("## 详情页模块");
    result.detailPagePlan.modules.forEach((module) => {
      lines.push(`### ${module.type}：${module.title}`);
      lines.push(module.copy);
      lines.push(`配图建议：${module.imageHint}`);
      lines.push("");
    });
    lines.push("## 短视频方案");
    result.videoCreativePlans.forEach((video) => {
      lines.push(`### ${video.id} ${video.title}`);
      lines.push(`- 结构：${video.structure}`);
      lines.push(`- 前三秒：${video.hook}`);
      lines.push(`- 建议时长：${video.suggestedDuration}`);
      lines.push("口播稿：");
      lines.push(video.voiceover);
      lines.push("镜头清单：");
      video.shots.forEach((shot) => lines.push(`- ${shot}`));
      lines.push("");
    });
    lines.push("## 发布前检查");
    lines.push(`- 一致性：${result.complianceReport.consistency}`);
    lines.push(`- 风险词：${result.complianceReport.riskTerms.join("、") || "未发现"}`);
    lines.push(`- 素材缺口：${result.complianceReport.missingAssets.join("；") || "暂无明显缺口"}`);
    return lines.join("\n");
  }

  return {
    generatePlan,
    exportMarkdown,
    extractKeywords,
    bannedTerms,
  };
});
