import { planSchema, draftPlan } from './项目.mjs';

export async function analyzeProduct(project, providers, media, store) {
  const schema = draftPlan(project.fields);
  const result = await providers.understand({ image: await media.imageData(store.require('assets', project.imageId)),
    prompt: `你是电商内容编辑。根据商品照片和商家资料，输出JSON，结构参照：${JSON.stringify(schema)}。
商品资料：${JSON.stringify(project.fields)}。
points提取3个以内有依据的卖点，proof说明来源，locked=false。不能从照片猜测材质、容量、效果、认证或价格。未证实信息不写。
screens生成6屏，标题和文案适合中文电商，不使用绝对化用词，prompt为无文字商品场景配图要求，所有屏保持商品一致。
videos生成3种结构，含完整口播、镜头、字幕、CTA。只使用已知商品事实。保留参考结构各字段为空，source设置ai。只输出JSON。` });
  return planSchema.parse({ ...result, source: 'ai' });
}

export async function analyzeReference(project, providers, media, store) {
  const asset = store.require('assets', project.referenceId);
  const result = await providers.understand({ video: await media.videoData(asset),
    prompt: `分析提供的视频本身，输出JSON：{"source":"ai","hook":"前三秒钩子","pain":"痛点","proof":"信任证明","cta":"行动号召","shots":[{"time":"0-3秒","action":"画面、运镜、节奏","caption":"实际字幕或口播"}]}。
视频时长${asset.duration}秒；镜头时间不能超出总时长。未观察到的内容写空字符串，不编造。不要复制人物或品牌用于新商品。
用户的补充观察仅供参考：${project.fields.referenceText || ''}。输出不超过20个镜头。` });
  const reference = planSchema.shape.reference.unwrap().parse({ ...result, source: 'ai' });
  return reference;
}
