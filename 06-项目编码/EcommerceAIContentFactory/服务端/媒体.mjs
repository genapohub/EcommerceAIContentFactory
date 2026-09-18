import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { load } from 'cheerio';
import { assert, AppError } from './错误.mjs';
import { downloadPublic } from './网络.mjs';

const runFile = promisify(execFile);
export async function probeVideo(filename) {
  try {
    const { stdout } = await runFile(ffprobe.path, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filename],
      { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const data = JSON.parse(stdout);
    const stream = data.streams.find(item => item.codec_type === 'video');
    assert(stream && Number(data.format.duration) > 0, '文件中没有可读的视频轨道。');
    return { width: stream.width, height: stream.height, duration: Number(data.format.duration), hasAudio: data.streams.some(s => s.codec_type === 'audio') };
  } catch { throw new AppError('视频无法读取，请上传有效的MP4或MOV文件。', 422, 'INVALID_MEDIA'); }
}

export function createMedia(store, downloader = downloadPublic) {
  const directory = path.join(store.directory, '素材');
  async function save(bytes, { projectId, kind, name = '素材', source = 'upload', jobId, metadata = {} }) {
    await fs.mkdir(directory, { recursive: true });
    const type = await fileTypeFromBuffer(bytes);
    assert(type && ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'].includes(type.mime), '仅支持真实JPG、PNG、WebP图片和MP4、MOV视频。', 422, 'INVALID_MEDIA');
    const id = randomUUID();
    const isImage = type.mime.startsWith('image/');
    const expectedImage = ['product', 'main_image', 'text_image', 'detail_source', 'detail_image'].includes(kind);
    const expectedVideo = ['reference', 'intro_video', 'replica_video'].includes(kind);
    assert(!(expectedImage && !isImage) && !(expectedVideo && isImage), expectedImage ? '此任务需要图片，返回的素材类型不匹配。' : '此任务需要视频，返回的素材类型不匹配。', 422, 'MEDIA_TYPE_MISMATCH');
    const filename = path.join(directory, `${id}.${isImage ? 'png' : type.ext}`);
    const poster = path.join(directory, `${id}-poster.jpg`);
    let properties;
    try {
      if (isImage) {
        const processor = sharp(bytes, { limitInputPixels: 60000000 }).rotate();
        const info = await processor.metadata();
        assert(info.width >= 64 && info.height >= 64, '图片过小，请使用至少64像素的图片。');
        await processor.png().toFile(filename);
        const result = await sharp(filename).metadata();
        properties = { width: result.width, height: result.height };
      } else {
        await fs.writeFile(filename, bytes);
        properties = await probeVideo(filename);
        if (source === 'upload' || source === 'url') assert(properties.duration <= 180, '参考视频最长180秒，请裁剪后上传。');
        try {
          await runFile(ffmpeg, ['-v', 'error', '-y', '-ss', '0.1', '-i', filename, '-frames:v', '1', '-vf', 'scale=480:-2', poster], { timeout: 20000, windowsHide: true });
          properties.posterFilename = path.basename(poster);
        } catch { await fs.rm(poster, { force: true }); }
      }
      const stat = await fs.stat(filename);
      const extension = isImage ? 'png' : type.ext;
      return store.save('assets', { id, projectId, jobId, kind, name: name.replace(/\.(png|jpe?g|webp|mp4|mov)$/i, '').slice(0, 150) + '.' + extension, source,
        filename: path.basename(filename), mime: isImage ? 'image/png' : type.mime, bytes: stat.size, ...properties, ...metadata });
    } catch (error) {
      await fs.rm(filename, { force: true });
      await fs.rm(poster, { force: true });
      throw error instanceof AppError ? error : new AppError('素材处理失败，请换一张图片或视频。', 422, 'INVALID_MEDIA');
    }
  }
  function filename(asset) { return path.join(directory, path.basename(asset.filename)); }
  async function imageData(asset) {
    assert(asset.mime.startsWith('image/'), '请选择商品图片。');
    const bytes = await sharp(filename(asset)).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  }
  async function videoData(asset) {
    const output = path.join(directory, `${randomUUID()}-input.mp4`);
    try {
      await runFile(ffmpeg, ['-v', 'error', '-y', '-i', filename(asset), '-vf', "scale=w='min(720,iw)':h=-2", '-c:v', 'libx264', '-preset', 'fast', '-b:v', '300k', '-maxrate', '400k', '-bufsize', '800k', '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart', output],
        { timeout: 180000, windowsHide: true, maxBuffer: 1024 * 1024 });
      const bytes = await fs.readFile(output);
      assert(bytes.length <= 12 * 1024 * 1024, '压缩后的参考视频仍然过大，请裁剪后再提交。');
      return `data:video/mp4;base64,${bytes.toString('base64')}`;
    } catch (error) {
      throw error instanceof AppError ? error : new AppError('参考视频压缩失败，请上传较短的MP4视频。', 422);
    } finally { await fs.rm(output, { force: true }); }
  }
  async function importUrl(projectId, input) {
    let result = await downloader(input);
    if (result.contentType.includes('text/html')) {
      assert(result.bytes.length < 4 * 1024 * 1024, '页面内容过大，请上传视频文件。');
      const $ = load(result.bytes.toString('utf8'));
      const candidate = $('meta[property="og:video:secure_url"]').attr('content') || $('meta[property="og:video"]').attr('content') || $('video[src]').attr('src') || $('video source[src]').attr('src');
      assert(candidate, '该分享页面没有公开可读取的视频，请上传视频文件。', 422, 'UNSUPPORTED_LINK');
      result = await downloader(new URL(candidate, result.url).href);
    }
    const type = await fileTypeFromBuffer(result.bytes);
    assert(type?.mime.startsWith('video/'), '链接未返回视频文件，请上传MP4或MOV。', 422, 'UNSUPPORTED_LINK');
    return save(result.bytes, { projectId, kind: 'reference', name: '链接参考视频', source: 'url', metadata: { originalUrl: input } });
  }
  return { save, filename, imageData, videoData, importUrl,
    async removeAssets(assets) {
      const files = assets.flatMap(asset => [asset.filename, asset.posterFilename].filter(Boolean));
      const results = await Promise.allSettled(files.map(name => fs.rm(filename({ filename: name }), { force: true })));
      return results.some(result => result.status === 'rejected');
    },
    async captureRemote(url, options) { const { bytes } = await downloader(url); return save(bytes, options); },
    public(asset) { const { filename: privatePath, posterFilename, ...item } = asset; return { ...item, url: `/api/v1/assets/${asset.id}`, ...(posterFilename ? { posterUrl: `/api/v1/assets/${asset.id}?poster=1` } : {}) }; },
  };
}
