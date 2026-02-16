import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import AdmZip from 'adm-zip';
import Stripe from 'stripe';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

import { TemplateStorageService } from './template-storage.service';
import { UnityTemplate, UnityTemplateDocument } from './schemas/unity-template.schema';
import { TemplateReview, TemplateReviewDocument } from './schemas/template-review.schema';
import { TemplatePurchase, TemplatePurchaseDocument } from './schemas/template-purchase.schema';
import { AiService } from '../ai/ai.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class TemplatesService {
  private stripe: Stripe | null = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(UnityTemplate.name)
    private readonly templateModel: Model<UnityTemplateDocument>,
    @InjectModel(TemplateReview.name)
    private readonly reviewModel: Model<TemplateReviewDocument>,
    @InjectModel(TemplatePurchase.name)
    private readonly purchaseModel: Model<TemplatePurchaseDocument>,
    private readonly storage: TemplateStorageService,
    private readonly aiService: AiService,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private _resolveReviewStatus(rating: number): 'pending' | 'approved' {
    return rating >= 4 ? 'approved' : 'pending';
  }

  private _getStripe(): Stripe {
    if (this.stripe) return this.stripe;

    const secretKey = (this.configService.get<string>('stripe.secretKey') || '').trim();
    if (!secretKey) {
      throw new BadRequestException('Stripe is not configured');
    }

    const rawApiVersion = (this.configService.get<string>('stripe.apiVersion') || '').trim();
    const apiVersionCandidate = rawApiVersion && /^\d{4}-\d{2}-\d{2}$/.test(rawApiVersion) ? rawApiVersion : '';
    const apiVersion = (apiVersionCandidate || '2024-06-20') as any;

    this.stripe = new Stripe(secretKey, { apiVersion });
    return this.stripe;
  }

  private _toStripeAmount(price: number) {
    const p = typeof price === 'number' ? price : 0;
    if (!Number.isFinite(p) || p <= 0) return 0;
    return Math.round(p * 100);
  }

  async uploadTemplate(params: {
    ownerId: string;
    file: any;
    previewImage?: any;
    screenshots?: any[];
    previewVideo?: any;
    baseUrl: string;
    name?: string;
    description?: string;
    category?: string;
    tagsCsv?: string;
    price?: number;
  }) {
    const file = params.file;
    if (!file?.buffer) {
      throw new BadRequestException('file is required');
    }

    const buf: Buffer = file.buffer;
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw new BadRequestException('Invalid zip file. Expected a .zip archive.');
    }

    try {
      const zip = new AdmZip(buf);
      const entries = zip.getEntries();
      if (!entries || entries.length === 0) {
        throw new Error('empty zip');
      }
    } catch {
      throw new BadRequestException('Invalid or unsupported zip format');
    }

    let fallbackZipName = '';
    try {
      const zip = new AdmZip(buf);
      const entries = zip.getEntries() || [];
      const names = entries
        .map((e) => String((e as any).entryName || ''))
        .filter(Boolean)
        .map((n) => n.replace(/^\//, ''))
        .filter((n) => !n.startsWith('__MACOSX/'))
        .map((n) => n.split('/')[0])
        .filter((n) => n && n !== '.' && n !== '..');
      fallbackZipName = (names[0] || '').trim();
    } catch {
      // ignore
    }

    const incomingName = (params.name || '').trim();
    const incomingDescription = (params.description || '').trim();
    const incomingCategory = (params.category || '').trim();

    const tags = params.tagsCsv
      ? String(params.tagsCsv)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    const missingName = !incomingName;
    const missingDescription = !incomingDescription;
    const missingCategory = !incomingCategory;
    const missingTags = tags.length === 0;

    // Try to read metadata from inside the uploaded zip (works even without Unity/auto-capture).
    // Accept any path ending with metadata.json or gameforge_template.json.
    let zipMetadata: any = null;
    if (missingName || missingDescription || missingCategory || missingTags) {
      try {
        const zip = new AdmZip(buf);
        const entries = zip.getEntries() || [];
        const metaEntry = entries.find((e: any) => {
          const n = String(e?.entryName || '').replace(/\\/g, '/').toLowerCase();
          return n.endsWith('/metadata.json') || n === 'metadata.json' || n.endsWith('/gameforge_template.json') || n === 'gameforge_template.json';
        });
        if (metaEntry) {
          const raw = metaEntry.getData().toString('utf8');
          zipMetadata = JSON.parse(raw || '{}');
        }
      } catch {
        zipMetadata = null;
      }
    }

    const mdName = zipMetadata?.name && String(zipMetadata.name).trim() ? String(zipMetadata.name).trim() : '';
    const mdDescription =
      zipMetadata?.description && String(zipMetadata.description).trim() ? String(zipMetadata.description).trim() : '';
    const mdCategory = zipMetadata?.category && String(zipMetadata.category).trim() ? String(zipMetadata.category).trim() : '';
    const mdTags = Array.isArray(zipMetadata?.tags)
      ? zipMetadata.tags
          .map((t: any) => String(t || '').trim())
          .filter(Boolean)
      : [];

    // Best-effort: if metadata is still missing, infer it from uploaded images via Gemini Vision.
    // (Only fills fields that are missing from incoming request and zip metadata.)
    let visionDraft: any = null;
    if ((missingName || missingDescription || missingCategory || missingTags) && !mdName && !mdDescription && !mdCategory && mdTags.length === 0) {
      try {
        const imgs: Array<{ mimeType: string; base64: string }> = [];
        const p = params.previewImage;
        if (p?.buffer && p?.mimetype) {
          imgs.push({ mimeType: String(p.mimetype), base64: Buffer.from(p.buffer).toString('base64') });
        }
        const shots = Array.isArray(params.screenshots) ? params.screenshots : [];
        for (const s of shots.slice(0, 2)) {
          if (!s?.buffer || !s?.mimetype) continue;
          imgs.push({ mimeType: String(s.mimetype), base64: Buffer.from(s.buffer).toString('base64') });
        }
        if (imgs.length) {
          visionDraft = await this.aiService.generateTemplateDraftFromImages({
            templateZipName: fallbackZipName,
            images: imgs,
          });
        }
      } catch {
        visionDraft = null;
      }
    }

    const vName = visionDraft?.name && String(visionDraft.name).trim() ? String(visionDraft.name).trim() : '';
    const vDescription =
      visionDraft?.description && String(visionDraft.description).trim() ? String(visionDraft.description).trim() : '';
    const vCategory = visionDraft?.category && String(visionDraft.category).trim() ? String(visionDraft.category).trim() : '';
    const vTags = Array.isArray(visionDraft?.tags)
      ? visionDraft.tags
          .map((t: any) => String(t || '').trim())
          .filter(Boolean)
      : [];

    const finalName = (incomingName || mdName || vName || fallbackZipName || 'Untitled Template').slice(0, 80);
    const finalDescription = (incomingDescription || mdDescription || vDescription || '').slice(0, 400);
    const finalCategory = (incomingCategory || mdCategory || vCategory || 'General').slice(0, 60);
    const finalTags = (tags.length ? tags : (mdTags.length ? mdTags : vTags)).slice(0, 20);

    const created = await this.templateModel.create({
      ownerId: params.ownerId,
      name: finalName,
      description: finalDescription,
      category: finalCategory,
      tags: finalTags,
      isPublic: true,
      price: typeof params.price === 'number' ? params.price : 0,
      rating: 4.7,
      downloads: 0,
      storageKey: 'pending',
    });

    const key = `${created._id.toString()}.zip`;
    await this.storage.putBuffer({ key, buffer: file.buffer });

    created.storageKey = key;

    const base = params.baseUrl.replace(/\/$/, '');

    const previewImage = params.previewImage;
    if (previewImage?.buffer) {
      const imgKey = `${created._id.toString()}/preview_${Date.now()}_${String(previewImage.originalname || 'image').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.storage.putBuffer({ key: imgKey, buffer: previewImage.buffer });
      created.previewImageUrl = `${base}/api/templates/files/${encodeURIComponent(imgKey)}`;
    }

    const screenshots = Array.isArray(params.screenshots) ? params.screenshots : [];
    const shotUrls: string[] = [];
    for (const s of screenshots) {
      if (!s?.buffer) continue;
      const shotKey = `${created._id.toString()}/shot_${Date.now()}_${Math.random().toString(16).slice(2)}_${String(s.originalname || 'screenshot').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.storage.putBuffer({ key: shotKey, buffer: s.buffer });
      shotUrls.push(`${base}/api/templates/files/${encodeURIComponent(shotKey)}`);
    }
    if (shotUrls.length) {
      created.screenshotUrls = shotUrls;
    }

    const previewVideo = params.previewVideo;
    if (previewVideo?.buffer) {
      const vidKey = `${created._id.toString()}/video_${Date.now()}_${String(previewVideo.originalname || 'video').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.storage.putBuffer({ key: vidKey, buffer: previewVideo.buffer });
      created.previewVideoUrl = `${base}/api/templates/files/${encodeURIComponent(vidKey)}`;
    }

    // Auto-generate media if not provided (best-effort)
    try {
      const needsPreview = !created.previewImageUrl || !String(created.previewImageUrl).trim();
      const needsShots = !Array.isArray((created as any).screenshotUrls) || (created as any).screenshotUrls.length === 0;
      const needsVideo = !created.previewVideoUrl || !String(created.previewVideoUrl).trim();

      if (needsPreview || needsShots || needsVideo) {
        const unityEditorPath = (process.env.UNITY_EDITOR_PATH || '').trim();
        if (unityEditorPath) {
          const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gameforge-template-'));
          try {
            const zipCopyAbs = path.join(workDir, 'template.zip');
            await fs.promises.writeFile(zipCopyAbs, buf);

            const extractedRoot = path.join(workDir, 'unity');
            await fs.promises.mkdir(extractedRoot, { recursive: true });
            const zip = new AdmZip(zipCopyAbs);
            zip.extractAllTo(extractedRoot, true);

            // Find Unity project root
            let unityRoot = extractedRoot;
            let assetsDir = path.join(unityRoot, 'Assets');
            let packagesDir = path.join(unityRoot, 'Packages');
            let projectSettingsDir = path.join(unityRoot, 'ProjectSettings');

            if (!fs.existsSync(assetsDir) || !fs.existsSync(packagesDir) || !fs.existsSync(projectSettingsDir)) {
              const maxDepth = 3;
              const queue: Array<{ dir: string; depth: number }> = [{ dir: extractedRoot, depth: 0 }];
              const visited = new Set<string>();
              while (queue.length > 0) {
                const cur = queue.shift()!;
                if (visited.has(cur.dir)) continue;
                visited.add(cur.dir);

                const a = path.join(cur.dir, 'Assets');
                const p = path.join(cur.dir, 'Packages');
                const s = path.join(cur.dir, 'ProjectSettings');
                if (fs.existsSync(a) && fs.existsSync(p) && fs.existsSync(s)) {
                  unityRoot = cur.dir;
                  assetsDir = a;
                  packagesDir = p;
                  projectSettingsDir = s;
                  break;
                }

                if (cur.depth >= maxDepth) continue;
                let children: fs.Dirent[] = [];
                try {
                  children = await fs.promises.readdir(cur.dir, { withFileTypes: true });
                } catch {
                  continue;
                }
                for (const d of children) {
                  if (!d.isDirectory()) continue;
                  if (d.name === '__MACOSX') continue;
                  queue.push({ dir: path.join(cur.dir, d.name), depth: cur.depth + 1 });
                }
              }
            }

            // Inject capture script
            const editorDir = path.join(assetsDir, 'Editor');
            await fs.promises.mkdir(editorDir, { recursive: true });
            const captureMediaAbs = path.join(editorDir, 'GameForgeCaptureMedia.cs');
            const captureCs = `using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GameForge {
  public static class CaptureMedia {
    [Serializable]
    private class GameForgeTemplateMetadata {
      public string name;
      public string description;
      public string category;
      public string[] tags;
      public int width;
      public int height;
      public int fps;
      public int seconds;
    }

    private static string GetArg(string name) {
      try {
        var args = Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length; i++) {
          if (args[i] == name && i + 1 < args.Length) return args[i + 1];
        }
      } catch {}
      return null;
    }

    private static string[] GetEnabledScenesOrFallback() {
      var scenes = EditorBuildSettings.scenes;
      var enabledScenes = scenes
        .Where(s => s != null && s.enabled && !string.IsNullOrEmpty(s.path))
        .Select(s => s.path)
        .ToArray();

      if (enabledScenes.Length == 0) {
        var guids = AssetDatabase.FindAssets("t:Scene");
        if (guids == null || guids.Length == 0) {
          throw new Exception("No scenes found for capture");
        }
        var firstScenePath = AssetDatabase.GUIDToAssetPath(guids[0]);
        if (string.IsNullOrEmpty(firstScenePath)) {
          throw new Exception("Could not resolve first scene path");
        }
        enabledScenes = new string[] { firstScenePath };
      }
      return enabledScenes;
    }

    private static Camera FindCamera() {
      try {
        var cam = Camera.main;
        if (cam != null) return cam;
      } catch {}
      try {
        #if UNITY_2023_1_OR_NEWER
          var cams = UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None);
          if (cams != null && cams.Length > 0) return cams[0];
        #else
          var cams = UnityEngine.Object.FindObjectsOfType<Camera>();
          if (cams != null && cams.Length > 0) return cams[0];
        #endif
      } catch {}
      return null;
    }

    private static void RenderToPng(Camera cam, int w, int h, string outAbs) {
      var rt = new RenderTexture(w, h, 24);
      var prev = cam.targetTexture;
      var prevActive = RenderTexture.active;
      cam.targetTexture = rt;
      RenderTexture.active = rt;
      cam.Render();
      var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
      tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
      tex.Apply();
      var bytes = tex.EncodeToPNG();
      File.WriteAllBytes(outAbs, bytes);
      cam.targetTexture = prev;
      RenderTexture.active = prevActive;
      UnityEngine.Object.DestroyImmediate(tex);
      rt.Release();
      UnityEngine.Object.DestroyImmediate(rt);
    }

    private static int GetIntArg(string name, int fallback) {
      try {
        var s = GetArg(name);
        if (string.IsNullOrEmpty(s)) return fallback;
        int v;
        if (int.TryParse(s, out v) && v > 0) return v;
      } catch {}
      return fallback;
    }

    private static void SafeWriteMetadata(string outDir, int w, int h, int fps, int seconds) {
      try {
        var md = new GameForgeTemplateMetadata();
        var pn = PlayerSettings.productName;
        if (string.IsNullOrEmpty(pn)) {
          try {
            pn = new DirectoryInfo(Application.dataPath).Parent.Name;
          } catch {}
        }
        md.name = pn;
        md.description = string.IsNullOrEmpty(pn)
          ? "Unity template"
          : (pn + " Unity template");
        md.category = "General";
        md.tags = string.IsNullOrEmpty(pn)
          ? new string[] { "unity", "template" }
          : pn
              .Split(new char[] { ' ', '-', '_', '.', ',' }, StringSplitOptions.RemoveEmptyEntries)
              .Select(t => t.Trim().ToLowerInvariant())
              .Where(t => !string.IsNullOrEmpty(t))
              .Distinct()
              .Take(10)
              .Concat(new string[] { "unity", "template" })
              .Distinct()
              .ToArray();
        md.width = w;
        md.height = h;
        md.fps = fps;
        md.seconds = seconds;
        var json = JsonUtility.ToJson(md, true);
        File.WriteAllText(Path.Combine(outDir, "metadata.json"), json);
      } catch {}
    }

    public static void PerformCapture() {
      var outDir = GetArg("-gameforgeMediaOut");
      if (string.IsNullOrEmpty(outDir)) {
        outDir = Path.Combine(Directory.GetCurrentDirectory(), "gameforge_media_out");
      }
      Directory.CreateDirectory(outDir);
      var framesDir = Path.Combine(outDir, "frames");
      Directory.CreateDirectory(framesDir);

      var scenes = GetEnabledScenesOrFallback();
      EditorSceneManager.OpenScene(scenes[0]);

      try { UnityEditorInternal.InternalEditorUtility.RepaintAllViews(); } catch {}

      var cam = FindCamera();
      if (cam == null) throw new Exception("No camera found for capture");

      int w = GetIntArg("-gameforgeW", 1280);
      int h = GetIntArg("-gameforgeH", 720);
      int fps = GetIntArg("-gameforgeFps", 24);
      int seconds = GetIntArg("-gameforgeSeconds", 6);
      SafeWriteMetadata(outDir, w, h, fps, seconds);

      var p0 = cam.transform.position;
      var r0 = cam.transform.rotation;

      int total = fps * seconds;
      for (int i = 0; i < total; i++) {
        float t = (total <= 1) ? 0f : (float)i / (float)(total - 1);
        float dx = Mathf.Sin(t * 6.2831f) * 0.35f;
        float dy = Mathf.Cos(t * 6.2831f) * 0.15f;
        float dz = Mathf.Sin(t * 6.2831f) * 0.20f;
        float yaw = Mathf.Sin(t * 6.2831f) * 8.0f;
        float pitch = Mathf.Cos(t * 6.2831f) * 3.0f;
        try {
          cam.transform.position = p0 + new Vector3(dx, dy, dz);
          cam.transform.rotation = r0 * Quaternion.Euler(pitch, yaw, 0f);
        } catch {}
        var fp = Path.Combine(framesDir, string.Format("frame_{0:0000}.png", i + 1));
        RenderToPng(cam, w, h, fp);
      }

      try {
        int idxCover = Mathf.Clamp((int)(total * 0.50f), 1, total);
        int idx1 = Mathf.Clamp((int)(total * 0.15f), 1, total);
        int idx2 = Mathf.Clamp((int)(total * 0.55f), 1, total);
        int idx3 = Mathf.Clamp((int)(total * 0.90f), 1, total);

        var coverSrc = Path.Combine(framesDir, string.Format("frame_{0:0000}.png", idxCover));
        var s1 = Path.Combine(framesDir, string.Format("frame_{0:0000}.png", idx1));
        var s2 = Path.Combine(framesDir, string.Format("frame_{0:0000}.png", idx2));
        var s3 = Path.Combine(framesDir, string.Format("frame_{0:0000}.png", idx3));

        if (File.Exists(coverSrc)) File.Copy(coverSrc, Path.Combine(outDir, "cover.png"), true);
        if (File.Exists(s1)) File.Copy(s1, Path.Combine(outDir, "shot_1.png"), true);
        if (File.Exists(s2)) File.Copy(s2, Path.Combine(outDir, "shot_2.png"), true);
        if (File.Exists(s3)) File.Copy(s3, Path.Combine(outDir, "shot_3.png"), true);
      } catch {}

      cam.transform.position = p0;
      cam.transform.rotation = r0;

      Debug.Log("GAMEFORGE_MEDIA_CAPTURE_OK");
    }
  }
}`;
            await fs.promises.writeFile(captureMediaAbs, captureCs, 'utf8');

            // Run Unity capture
            const unityEnv: Record<string, string | undefined> = { ...process.env };
            for (const k of Object.keys(unityEnv)) {
              const key = k.toUpperCase();
              if (key.startsWith('MONO_')) delete unityEnv[k];
              if (key.startsWith('UNITY_DEBUG')) delete unityEnv[k];
              if (key === 'DEBUGGER_AGENT') delete unityEnv[k];
            }

            const mediaOutAbs = path.join(workDir, 'media_out');
            await fs.promises.mkdir(mediaOutAbs, { recursive: true });
            await new Promise<void>((resolve, reject) => {
              const maxMs = Number(process.env.UNITY_BUILD_TIMEOUT_MS || '') || 20 * 60 * 1000;

              const captureApi = (process.env.UNITY_CAPTURE_GRAPHICS_API || '').trim().toLowerCase();
              const captureApiArgs: string[] = [];
              if (process.platform === 'darwin') {
                if (captureApi === 'metal') {
                  captureApiArgs.push('-force-metal');
                } else if (captureApi === 'glcore' || captureApi === 'opengl') {
                  captureApiArgs.push('-force-glcore');
                }
              }

              const child = spawn(
                unityEditorPath,
                [
                  '-batchmode',
                  // NOTE: We intentionally avoid -nographics here. Many URP/HDRP projects crash when
                  // trying to render camera output in headless mode.
                  ...captureApiArgs,
                  '-quit',
                  '-projectPath',
                  unityRoot,
                  '-buildTarget',
                  'WebGL',
                  '-executeMethod',
                  'GameForge.CaptureMedia.PerformCapture',
                  '-gameforgeMediaOut',
                  mediaOutAbs,
                  '-logFile',
                  '-',
                ],
                { stdio: ['ignore', 'pipe', 'pipe'], env: unityEnv },
              );
              let out = '';
              const timer = setTimeout(() => {
                try {
                  child.kill('SIGKILL');
                } catch {
                  // ignore
                }
              }, maxMs);
              child.stdout.on('data', (d) => (out += d.toString()));
              child.stderr.on('data', (d) => (out += d.toString()));
              child.on('error', reject);
              child.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) return resolve();
                const tail = out.length > 4000 ? out.slice(out.length - 4000) : out;
                return reject(new Error(`Unity exited with code ${code}. Output tail: ${tail}`));
              });
            });

            // Upload generated media
            const coverAbs = path.join(mediaOutAbs, 'cover.png');
            const shotsAbs = [
              path.join(mediaOutAbs, 'shot_1.png'),
              path.join(mediaOutAbs, 'shot_2.png'),
              path.join(mediaOutAbs, 'shot_3.png'),
            ].filter((p) => fs.existsSync(p));

            // Auto-fill template metadata if missing
            if (missingName || missingDescription || missingCategory || missingTags) {
              const mdAbs = path.join(mediaOutAbs, 'metadata.json');
              if (fs.existsSync(mdAbs)) {
                try {
                  const raw = await fs.promises.readFile(mdAbs, 'utf8');
                  const md = JSON.parse(raw || '{}') as any;
                  if (missingName) {
                    const mdName = md?.name && String(md.name).trim() ? String(md.name).trim() : '';
                    const finalName = mdName || fallbackZipName;
                    if (finalName) created.name = finalName.slice(0, 80);
                  }
                  if (missingDescription && md?.description && String(md.description).trim()) {
                    created.description = String(md.description).trim().slice(0, 400);
                  }
                  if (missingCategory && md?.category && String(md.category).trim()) {
                    created.category = String(md.category).trim().slice(0, 60);
                  }
                  if (missingTags && Array.isArray(md?.tags)) {
                    const tgs = md.tags
                      .map((t: any) => String(t || '').trim())
                      .filter(Boolean)
                      .slice(0, 20);
                    if (tgs.length) (created as any).tags = tgs;
                  }
                } catch {
                  // ignore
                }
              }

              if (missingTags && (!Array.isArray((created as any).tags) || (created as any).tags.length === 0) && fallbackZipName) {
                const extra = fallbackZipName
                  .split(/[-_ .]+/)
                  .map((t) => t.trim().toLowerCase())
                  .filter(Boolean)
                  .slice(0, 8);
                if (extra.length) (created as any).tags = extra;
              }

              // If still missing metadata and user did not provide any, infer from generated images via Gemini Vision.
              // This allows auto-fill even when uploader provides no preview/screenshot files.
              const stillMissingName = !(created.name || '').toString().trim() || created.name === 'Untitled Template';
              const stillMissingDescription = !(created.description || '').toString().trim();
              const stillMissingCategory = !(created.category || '').toString().trim() || created.category === 'General';
              const stillMissingTags = !Array.isArray((created as any).tags) || (created as any).tags.length === 0;
              if ((stillMissingName || stillMissingDescription || stillMissingCategory || stillMissingTags) && (missingName || missingDescription || missingCategory || missingTags)) {
                try {
                  const candidates = [
                    path.join(mediaOutAbs, 'preview.png'),
                    path.join(mediaOutAbs, 'shot_1.png'),
                    path.join(mediaOutAbs, 'shot_2.png'),
                  ].filter((p) => fs.existsSync(p));

                  const imgs: Array<{ mimeType: string; base64: string }> = [];
                  for (const p of candidates.slice(0, 3)) {
                    const b = await fs.promises.readFile(p);
                    imgs.push({ mimeType: 'image/png', base64: b.toString('base64') });
                  }

                  if (imgs.length) {
                    const draft = await this.aiService.generateTemplateDraftFromImages({
                      templateZipName: fallbackZipName,
                      images: imgs,
                    });

                    if (stillMissingName && draft?.name && String(draft.name).trim()) {
                      created.name = String(draft.name).trim().slice(0, 80);
                    }
                    if (stillMissingDescription && draft?.description && String(draft.description).trim()) {
                      created.description = String(draft.description).trim().slice(0, 400);
                    }
                    if (stillMissingCategory && draft?.category && String(draft.category).trim()) {
                      created.category = String(draft.category).trim().slice(0, 60);
                    }
                    if (stillMissingTags && Array.isArray(draft?.tags)) {
                      const tgs = draft.tags
                        .map((t: any) => String(t || '').trim())
                        .filter(Boolean)
                        .slice(0, 20);
                      if (tgs.length) (created as any).tags = tgs;
                    }
                  }
                } catch {
                  // ignore
                }
              }
            }

            if (needsPreview && fs.existsSync(coverAbs)) {
              const key0 = `${created._id.toString()}/media/cover_${Date.now()}.png`;
              const b0 = await fs.promises.readFile(coverAbs);
              await this.storage.putBuffer({ key: key0, buffer: b0 });
              created.previewImageUrl = `${base}/api/templates/files/${encodeURIComponent(key0)}`;
            }

            if (needsShots && shotsAbs.length) {
              const urls: string[] = [];
              for (const p of shotsAbs) {
                const key1 = `${created._id.toString()}/media/shot_${Date.now()}_${Math.random().toString(16).slice(2)}.png`;
                const b1 = await fs.promises.readFile(p);
                await this.storage.putBuffer({ key: key1, buffer: b1 });
                urls.push(`${base}/api/templates/files/${encodeURIComponent(key1)}`);
              }
              created.screenshotUrls = urls;
            }

            if (needsVideo) {
              const framesDir = path.join(mediaOutAbs, 'frames');
              const first = path.join(framesDir, 'frame_0001.png');
              if (fs.existsSync(first)) {
                const mp4Abs = path.join(mediaOutAbs, 'preview.mp4');
                const ffmpeg = (process.env.FFMPEG_PATH || 'ffmpeg').trim();

                let fps = 24;
                try {
                  const mdAbs = path.join(mediaOutAbs, 'metadata.json');
                  if (fs.existsSync(mdAbs)) {
                    const md = JSON.parse(await fs.promises.readFile(mdAbs, 'utf8')) as any;
                    const v = Number(md?.fps);
                    if (Number.isFinite(v) && v > 0 && v <= 60) fps = Math.round(v);
                  }
                } catch {
                  // ignore
                }

                const crf = (process.env.FFMPEG_CRF || '23').trim();
                const preset = (process.env.FFMPEG_PRESET || 'medium').trim();
                await new Promise<void>((resolve, reject) => {
                  const child = spawn(
                    ffmpeg,
                    [
                      '-y',
                      '-framerate',
                      String(fps),
                      '-i',
                      path.join(framesDir, 'frame_%04d.png'),
                      '-c:v',
                      'libx264',
                      '-profile:v',
                      'high',
                      '-level',
                      '4.0',
                      '-preset',
                      preset,
                      '-crf',
                      crf,
                      '-vf',
                      'scale=1280:-2',
                      '-pix_fmt',
                      'yuv420p',
                      '-movflags',
                      '+faststart',
                      mp4Abs,
                    ],
                    { stdio: ['ignore', 'pipe', 'pipe'] },
                  );
                  let out = '';
                  child.stdout.on('data', (d) => (out += d.toString()));
                  child.stderr.on('data', (d) => (out += d.toString()));
                  child.on('error', reject);
                  child.on('close', (code) => {
                    if (code === 0) return resolve();
                    const tail = out.length > 3000 ? out.slice(out.length - 3000) : out;
                    return reject(new Error(`ffmpeg exited with code ${code}. Output tail: ${tail}`));
                  });
                });

                if (fs.existsSync(mp4Abs)) {
                  const key2 = `${created._id.toString()}/media/video_${Date.now()}.mp4`;
                  const b2 = await fs.promises.readFile(mp4Abs);
                  await this.storage.putBuffer({ key: key2, buffer: b2 });
                  created.previewVideoUrl = `${base}/api/templates/files/${encodeURIComponent(key2)}`;
                } else {
                  try {
                    // eslint-disable-next-line no-console
                    console.warn('[Templates] ffmpeg did not produce preview.mp4 (check FFMPEG_PATH / ffmpeg install)');
                  } catch {
                    // ignore
                  }
                }
              }
            }
          } finally {
            try {
              await fs.promises.rm(workDir, { recursive: true, force: true });
            } catch {
              // ignore
            }
          }
        } else {
          try {
            // eslint-disable-next-line no-console
            console.warn('[Templates] Auto media skipped: UNITY_EDITOR_PATH is not set');
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      try {
        // eslint-disable-next-line no-console
        console.warn('[Templates] Auto media generation failed:', e);
      } catch {
        // ignore
      }
    }

    await created.save();

    return { success: true, data: created };
  }

  async updateTemplateMedia(params: {
    templateId: string;
    ownerId: string;
    allowNonOwner?: boolean;
    baseUrl: string;
    previewImage?: any;
    screenshots?: any[];
    previewVideo?: any;
  }) {
    const t = await this.templateModel.findById(params.templateId);
    if (!t) throw new NotFoundException('Template not found');

    if (!params.allowNonOwner && t.ownerId !== params.ownerId) {
      throw new ForbiddenException();
    }

    const base = params.baseUrl.replace(/\/$/, '');

    const previewImage = params.previewImage;
    const screenshots = Array.isArray(params.screenshots) ? params.screenshots : [];
    const previewVideo = params.previewVideo;

    if (!previewImage?.buffer && screenshots.length === 0 && !previewVideo?.buffer) {
      throw new BadRequestException('No media files provided');
    }

    if (previewImage?.buffer) {
      const imgKey = `${t._id.toString()}/preview_${Date.now()}_${String(previewImage.originalname || 'image').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.storage.putBuffer({ key: imgKey, buffer: previewImage.buffer });
      t.previewImageUrl = `${base}/api/templates/files/${encodeURIComponent(imgKey)}`;
    }

    if (screenshots.length) {
      const shotUrls: string[] = [];
      for (const s of screenshots) {
        if (!s?.buffer) continue;
        const shotKey = `${t._id.toString()}/shot_${Date.now()}_${Math.random().toString(16).slice(2)}_${String(s.originalname || 'screenshot').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        await this.storage.putBuffer({ key: shotKey, buffer: s.buffer });
        shotUrls.push(`${base}/api/templates/files/${encodeURIComponent(shotKey)}`);
      }
      t.screenshotUrls = shotUrls;
    }

    if (previewVideo?.buffer) {
      const vidKey = `${t._id.toString()}/video_${Date.now()}_${String(previewVideo.originalname || 'video').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.storage.putBuffer({ key: vidKey, buffer: previewVideo.buffer });
      t.previewVideoUrl = `${base}/api/templates/files/${encodeURIComponent(vidKey)}`;
    }

    await t.save();
    const updated = await this.templateModel.findById(params.templateId).lean();
    return { success: true, data: updated };
  }

  async listPublic(query: any) {
    const filter: any = { isPublic: true };
    if (query.category) filter.category = String(query.category);
    if (query.q) {
      const q = String(query.q);
      const rx = { $regex: q, $options: 'i' };
      filter.$or = [
        { name: rx },
        { description: rx },
        { category: rx },
        { tags: rx },
      ];
    }

    const items = await this.templateModel.find(filter).sort({ createdAt: -1 }).lean();
    return { success: true, data: items };
  }

  async getPublicById(id: string) {
    const t = await this.templateModel.findById(id).lean();
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();
    return { success: true, data: t };
  }

  async getAccess(params: { templateId: string; userId: string }) {
    const t = await this.templateModel.findById(params.templateId).lean();
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    const price = typeof (t as any).price === 'number' ? (t as any).price : 0;
    if (!price || price <= 0) {
      return { success: true, data: { hasAccess: true } };
    }

    const exists = await this.purchaseModel
      .findOne({ templateId: params.templateId, userId: params.userId })
      .select({ _id: 1 })
      .lean();

    return { success: true, data: { hasAccess: Boolean(exists) } };
  }

  async createPurchasePaymentSheet(params: { templateId: string; userId: string; customerEmail?: string }) {
    const t = await this.templateModel.findById(params.templateId).lean();
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    const price = typeof (t as any).price === 'number' ? (t as any).price : 0;
    const amount = this._toStripeAmount(price);
    if (!amount) throw new BadRequestException('Template is free');

    const currency = (this.configService.get<string>('stripe.currency') || 'usd').toLowerCase();

    const stripe = this._getStripe();
    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      receipt_email: params.customerEmail,
      metadata: {
        kind: 'template_purchase',
        templateId: String(params.templateId),
        userId: String(params.userId),
      },
    });

    if (!intent.client_secret) {
      throw new BadRequestException('Stripe did not return a client secret');
    }

    return {
      success: true,
      data: {
        paymentIntentId: intent.id,
        paymentIntentClientSecret: intent.client_secret,
        currency,
        amount,
      },
    };
  }

  async confirmPurchase(params: { templateId: string; userId: string; paymentIntentId: string }) {
    const t = await this.templateModel.findById(params.templateId).lean();
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    const price = typeof (t as any).price === 'number' ? (t as any).price : 0;
    const expectedAmount = this._toStripeAmount(price);
    if (!expectedAmount) throw new BadRequestException('Template is free');

    const stripe = this._getStripe();
    const intent = await stripe.paymentIntents.retrieve(params.paymentIntentId);
    if (!intent) throw new NotFoundException('PaymentIntent not found');

    const md: any = (intent as any).metadata || {};
    if (String(md.kind || '') !== 'template_purchase') {
      throw new BadRequestException('Invalid payment intent');
    }
    if (String(md.templateId || '') !== String(params.templateId)) {
      throw new BadRequestException('Payment intent does not match template');
    }
    if (String(md.userId || '') !== String(params.userId)) {
      throw new BadRequestException('Payment intent does not match user');
    }

    if (intent.status !== 'succeeded') {
      throw new BadRequestException(`Payment not completed (status=${intent.status})`);
    }

    const amountReceived = (intent as any).amount_received ?? intent.amount;
    if (amountReceived !== expectedAmount) {
      throw new BadRequestException('Payment amount mismatch');
    }

    await this.purchaseModel.findOneAndUpdate(
      { templateId: params.templateId, userId: params.userId },
      {
        $set: {
          templateId: params.templateId,
          userId: params.userId,
          stripePaymentIntentId: intent.id,
          amount: expectedAmount,
          currency: String(intent.currency || 'usd'),
        },
      },
      { upsert: true, new: true },
    );

    const updatedTemplate = await this.templateModel.findById(params.templateId).lean();
    return { success: true, data: { hasAccess: true, template: updatedTemplate } };
  }

  async listPublicReviews(templateId: string) {
    const t = await this.templateModel.findById(templateId).lean();
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    const items = await this.reviewModel
      .find({
        templateId,
        $or: [{ status: 'approved' }, { status: { $exists: false } }],
      })
      .sort({ createdAt: -1 })
      .select({ templateId: 1, userId: 1, username: 1, rating: 1, comment: 1, createdAt: 1 })
      .lean();

    return { success: true, data: items };
  }

  async upsertReview(params: {
    templateId: string;
    userId: string;
    username: string;
    rating: number;
    comment: string;
  }) {
    const t = await this.templateModel.findById(params.templateId);
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    const rating = Math.max(1, Math.min(5, Math.round(params.rating)));
    const comment = String(params.comment || '').trim();
    if (!comment) throw new BadRequestException('comment is required');
    if (comment.length > 400) throw new BadRequestException('comment too long');

    const status = this._resolveReviewStatus(rating);

    const now = new Date();
    const approvedAt = status === 'approved' ? now : null;
    const approvedBy = status === 'approved' ? params.userId : null;

    await this.reviewModel.updateOne(
      { templateId: params.templateId, userId: params.userId },
      {
        $set: {
          templateId: params.templateId,
          userId: params.userId,
          username: params.username,
          rating,
          comment,
          status,
          approvedAt,
          approvedBy,
        },
      },
      { upsert: true },
    );

    if (status === 'pending') {
      const adminIds = await this.usersService.listUserIdsByRoles(['admin', 'dev', 'devl']);
      await this.notificationsService.createForUsers({
        userIds: adminIds,
        title: 'Review pending approval',
        message: `A ${rating}★ review was submitted for template "${t.name}" and needs approval.`,
        type: 'warning',
        data: {
          kind: 'template_review_pending',
          templateId: params.templateId,
          userId: params.userId,
          rating,
        },
      });
    }

    const stats = await this.reviewModel.aggregate([
      {
        $match: {
          templateId: params.templateId,
          $or: [{ status: 'approved' }, { status: { $exists: false } }],
        },
      },
      { $group: { _id: '$templateId', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    const avg = stats?.[0]?.avg;
    if (typeof avg === 'number' && Number.isFinite(avg)) {
      t.rating = Math.round(avg * 10) / 10;
      await t.save();
    }

    const updatedTemplate = await this.templateModel.findById(params.templateId).lean();
    return { success: true, data: { template: updatedTemplate, reviewStatus: status } };
  }

  async listPendingReviews(params: { templateId: string }) {
    const t = await this.templateModel.findById(params.templateId).lean();
    if (!t) throw new NotFoundException('Template not found');

    const items = await this.reviewModel
      .find({ templateId: params.templateId, status: 'pending' })
      .sort({ createdAt: -1 })
      .select({ templateId: 1, userId: 1, username: 1, rating: 1, comment: 1, createdAt: 1 })
      .lean();

    return { success: true, data: items };
  }

  async approveReview(params: { templateId: string; userId: string; approvedBy: string }) {
    const t = await this.templateModel.findById(params.templateId);
    if (!t) throw new NotFoundException('Template not found');

    const now = new Date();
    await this.reviewModel.updateOne(
      { templateId: params.templateId, userId: params.userId },
      { $set: { status: 'approved', approvedAt: now, approvedBy: params.approvedBy } },
    );

    const stats = await this.reviewModel.aggregate([
      {
        $match: {
          templateId: params.templateId,
          $or: [{ status: 'approved' }, { status: { $exists: false } }],
        },
      },
      { $group: { _id: '$templateId', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    const avg = stats?.[0]?.avg;
    if (typeof avg === 'number' && Number.isFinite(avg)) {
      t.rating = Math.round(avg * 10) / 10;
      await t.save();
    }

    const updatedTemplate = await this.templateModel.findById(params.templateId).lean();
    return { success: true, data: { template: updatedTemplate } };
  }

  async getDownloadUrl(id: string, baseUrl: string) {
    const t = await this.templateModel.findById(id);
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    t.downloads = (t.downloads || 0) + 1;
    await t.save();

    const url = `${baseUrl.replace(/\/$/, '')}/api/templates/files/${encodeURIComponent(t.storageKey)}`;
    return { success: true, data: { url } };
  }

  async getDownloadUrlAuthed(params: { templateId: string; baseUrl: string; userId: string }) {
    const t = await this.templateModel.findById(params.templateId);
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    const price = typeof (t as any).price === 'number' ? (t as any).price : 0;
    if (price > 0) {
      const has = await this.purchaseModel
        .findOne({ templateId: params.templateId, userId: params.userId })
        .select({ _id: 1 })
        .lean();
      if (!has) {
        throw new ForbiddenException('Purchase required');
      }
    }

    t.downloads = (t.downloads || 0) + 1;
    await t.save();

    const url = `${params.baseUrl.replace(/\/$/, '')}/api/templates/files/${encodeURIComponent(t.storageKey)}`;
    return { success: true, data: { url } };
  }

  async generateAiMetadata(params: {
    templateId: string;
    ownerId: string;
    notes?: string;
    overwrite?: boolean;
    allowNonOwner?: boolean;
  }) {
    const t = await this.templateModel.findById(params.templateId);
    if (!t) throw new NotFoundException('Template not found');

    if (!params.allowNonOwner && t.ownerId !== params.ownerId) {
      throw new ForbiddenException();
    }

    if (!params.overwrite && t.aiMetadata) {
      return { success: true, data: t.toObject() };
    }

    const result = await this.aiService.generateTemplateMetadata({
      name: t.name,
      description: t.description,
      category: t.category,
      tags: Array.isArray(t.tags) ? t.tags : [],
      notes: params.notes,
    });

    t.aiMetadata = {
      description: result.description,
      category: result.category,
      type: result.type,
      tags: result.tags,
      mediaPrompts: result.mediaPrompts,
    };
    t.aiGeneratedAt = new Date();

    if (params.overwrite) {
      if (typeof result.description === 'string' && result.description.trim()) {
        t.description = result.description.trim();
      }
      if (typeof result.category === 'string' && result.category.trim()) {
        t.category = result.category.trim();
      }
      if (Array.isArray(result.tags) && result.tags.length) {
        t.tags = result.tags;
      }
    }

    await t.save();
    const updated = await this.templateModel.findById(params.templateId).lean();
    return { success: true, data: updated };
  }
}
