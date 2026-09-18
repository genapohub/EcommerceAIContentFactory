import { ZipArchive } from 'archiver';
import { renderLongImage } from './排版.mjs';
import { assert } from './错误.mjs';

export function planMarkdown(project) {
  const { fields, plan } = project;
  return [`# ${fields.name || '未命名商品'}`, '', `方案来源：${plan.source === 'ai' ? 'AI分析，经人工确认后使用' : '人工资料草稿'}`,
    '', '## 商品卖点', ...plan.points.map(point => `- ${point.title}；依据：${point.proof || '待补充'}${point.locked ? '（已锁定）' : ''}`),
    '', '## 分屏详情', ...plan.screens.flatMap((screen, i) => [`### ${i + 1}. ${screen.title}`, screen.copy, `配图：${screen.prompt}`, '']),
    '## 视频方案', ...plan.videos.flatMap(video => [`### ${video.title}`, `钩子：${video.hook}`, video.voiceover, ...video.shots.map(shot => `- ${shot.time}：${shot.action}；字幕：${shot.caption}`), `CTA：${video.cta}`, '']),
    '## 参考视频', `来源：${plan.reference?.source === 'ai' ? 'AI已分析' : '尚未分析'}`, `钩子：${plan.reference?.hook || ''}`, `证明：${plan.reference?.proof || ''}`].join('\n');
}
function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function planCsv(project) {
  const rows = [['视频', '时间', '镜头', '字幕', '口播', 'CTA']];
  for (const video of project.plan.videos) for (const shot of video.shots) rows.push([video.title, shot.time, shot.action, shot.caption, video.voiceover, video.cta]);
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function createExports(store, media) {
  return async function exportProject(projectId, format, response) {
    const project = store.require('projects', projectId);
    const downloadable = store.list('assets', item => item.projectId === projectId && ['main_image', 'text_image', 'detail_image', 'intro_video', 'replica_video'].includes(item.kind));
    const disposition = name => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
    if (format === 'markdown' || format === 'csv') {
      response.set('Content-Disposition', disposition(`商品方案.${format === 'csv' ? 'csv' : 'md'}`));
      response.type(format === 'csv' ? 'text/csv' : 'text/markdown').send(format === 'csv' ? planCsv(project) : planMarkdown(project)); return;
    }
    if (format === 'long-image') {
      const screens = project.plan.screens.map((_, i) => downloadable.find(a => a.kind === 'detail_image' && a.screenIndex === i));
      assert(screens.every(Boolean), '请先生成全部详情屏，再导出完整长图。', 409);
      const bytes = await renderLongImage(screens.map(media.filename));
      response.set('Content-Disposition', disposition('商品详情长图.png')).type('png').send(bytes); return;
    }
    assert(format === 'zip', '导出格式不支持。');
    assert(downloadable.length, '当前没有可导出的成品。', 409);
    response.set('Content-Disposition', disposition('商品内容成品.zip')).type('zip');
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('error', error => response.destroy(error));
    archive.pipe(response);
    archive.append(planMarkdown(project), { name: '商品方案.md' });
    archive.append(planCsv(project), { name: '视频分镜.csv' });
    archive.append(JSON.stringify(downloadable.map(media.public), null, 2), { name: '素材清单.json' });
    for (const asset of downloadable) {
      const ext = asset.mime === 'video/quicktime' ? 'mov' : asset.mime.startsWith('video/') ? 'mp4' : 'png';
      archive.file(media.filename(asset), { name: `${asset.kind}/${asset.id}.${ext}` });
    }
    await archive.finalize();
  };
}
