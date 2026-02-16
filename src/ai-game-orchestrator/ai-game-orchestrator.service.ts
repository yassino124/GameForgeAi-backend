import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AiService } from '../ai/ai.service';
import { ProjectsService } from '../projects/projects.service';
import { Asset, AssetDocument } from '../assets/schemas/asset.schema';
import { UnityTemplate, UnityTemplateDocument } from '../templates/schemas/unity-template.schema';

type ClassifiedGame = {
  gameType: 'endless_runner' | 'platformer' | 'topdown_shooter' | 'survival' | 'puzzle';
  theme: string;
  mood: string;
  difficulty: number;
  mechanics: string[];
  style: '2d' | '3d';
};

type GenerateFullGameInput = {
  ownerId: string;
  prompt: string;
};

@Injectable()
export class AiGameOrchestratorService {
  constructor(
    private readonly aiService: AiService,
    private readonly projectsService: ProjectsService,
    @InjectModel(UnityTemplate.name)
    private readonly templateModel: Model<UnityTemplateDocument>,
    @InjectModel(Asset.name)
    private readonly assetModel: Model<AssetDocument>,
  ) {}

  private normalizePrompt(p: string) {
    return (p || '').toString().trim();
  }

  private async classifyPrompt(prompt: string): Promise<ClassifiedGame> {
    // MVP classifier: deterministic keywords (fast + no quota dependency).
    const p = (prompt || '').toLowerCase();

    let gameType: ClassifiedGame['gameType'] = 'platformer';
    if (p.includes('endless runner') || p.includes('endless-runner') || p.includes('runner')) gameType = 'endless_runner';
    else if (p.includes('top down') || p.includes('topdown') || p.includes('shooter')) gameType = 'topdown_shooter';
    else if (p.includes('survival')) gameType = 'survival';
    else if (p.includes('puzzle')) gameType = 'puzzle';

    const style: ClassifiedGame['style'] = (p.includes('3d') || p.includes('third person') || p.includes('first person')) ? '3d' : '2d';

    const theme = (p.includes('night') || p.includes('dark')) ? 'night' : (p.includes('sci-fi') || p.includes('space') ? 'sci-fi' : 'default');
    const mood = (p.includes('horror') || p.includes('scary')) ? 'horror' : (p.includes('cozy') ? 'cozy' : 'default');

    const mechanics: string[] = [];
    if (p.includes('rain')) mechanics.push('rain');
    if (p.includes('enemy') || p.includes('enemies')) mechanics.push('enemies');
    if (p.includes('coins') || p.includes('collect')) mechanics.push('collect');

    const difficulty = (p.includes('hard') || p.includes('hardcore')) ? 0.8 : 0.5;

    return { gameType, theme, mood, difficulty, mechanics, style };
  }

  private async selectTemplate(cls: ClassifiedGame) {
    // MVP: use tags/category heuristics.
    const tags = [cls.gameType, cls.style, cls.theme, cls.mood]
      .map((x) => (x || '').toString().trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8);

    const candidates = await this.templateModel
      .find({ isPublic: true })
      .sort({ downloads: -1 })
      .limit(30)
      .lean();

    if (!candidates.length) throw new NotFoundException('No public templates available');

    const score = (t: any) => {
      const hay = [t.category, ...(Array.isArray(t.tags) ? t.tags : []), t.name]
        .map((x) => String(x || '').toLowerCase())
        .join(' | ');
      let s = 0;
      for (const tok of tags) {
        if (!tok) continue;
        if (hay.includes(tok)) s += 3;
      }
      if (hay.includes('2d') && cls.style === '2d') s += 2;
      if (hay.includes('3d') && cls.style === '3d') s += 2;
      return s;
    };

    candidates.sort((a: any, b: any) => score(b) - score(a));
    return candidates[0];
  }

  private async matchAssets(ownerId: string, cls: ClassifiedGame) {
    // MVP: pick by tags only; role/style comes later (schema upgrade).
    const tagTokens = [cls.theme, cls.mood, cls.gameType]
      .join(' ')
      .split(/\s+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 3)
      .slice(0, 8);

    const assets = await this.assetModel
      .find({ ownerId, status: 'ready' })
      .limit(200)
      .lean();

    const score = (a: any) => {
      const tags = Array.isArray(a.tags) ? a.tags.map((t: any) => String(t).toLowerCase()) : [];
      let s = 0;
      for (const tok of tagTokens) {
        if (tags.some((t: string) => t.includes(tok))) s += 2;
      }
      return s;
    };

    const pick = (type: string) => {
      const list = assets.filter((a: any) => String(a.type) === type);
      list.sort((a: any, b: any) => score(b) - score(a));
      return list[0];
    };

    const character = pick('model') || pick('texture');
    const background = pick('texture');
    const enemy = pick('model') || pick('texture');
    const soundPack = pick('audio');

    return {
      characterAssetId: character?._id?.toString(),
      backgroundAssetId: background?._id?.toString(),
      enemyAssetId: enemy?._id?.toString(),
      soundPackId: soundPack?._id?.toString(),
    };
  }

  async generateFullGame(input: GenerateFullGameInput) {
    const ownerId = (input.ownerId || '').toString().trim();
    if (!ownerId) throw new BadRequestException('Missing ownerId');

    const prompt = this.normalizePrompt(input.prompt);
    if (!prompt) throw new BadRequestException('prompt is required');

    // 1) classify
    const cls = await this.classifyPrompt(prompt);

    // 2) select template
    const template = await this.selectTemplate(cls);
    const templateId = template?._id?.toString();
    if (!templateId) throw new NotFoundException('No template found');

    // 3) match assets (MVP: best effort, doesn't block generation)
    const matchedAssets = await this.matchAssets(ownerId, cls);

    // 4) generate runtime config (Gemini) using existing safe method
    // Use template name so Gemini tunes outputs to that template.
    let unityCfg: any = {};
    try {
      const unityCfgRes = await this.aiService.generateUnityConfig({ prompt, templateName: template?.name });
      unityCfg = (unityCfgRes as any)?.data || {};
    } catch {
      unityCfg = {};
    }

    // Seed a few values from classification if Gemini returns defaults.
    const initialConfig: any = {
      ...unityCfg,
      difficulty: typeof unityCfg?.difficulty === 'number' ? unityCfg.difficulty : cls.difficulty,
      theme: typeof unityCfg?.theme === 'string' && unityCfg.theme.trim() ? unityCfg.theme : cls.theme,
      mechanics: Array.isArray(unityCfg?.mechanics) && unityCfg.mechanics.length ? unityCfg.mechanics : cls.mechanics,
    };

    // 5) create + enqueue build using existing pipeline
    const created = await this.projectsService.createFromAi({
      ownerId,
      prompt,
      templateId,
      buildTarget: 'webgl',
      initialConfig,
    } as any);

    const projectId = (created as any)?.data?.projectId;
    if (!projectId) throw new BadRequestException('Failed to create project');

    return {
      success: true,
      data: {
        projectId: String(projectId),
        buildStatus: 'queued',
        // For debugging / future UI hints
        classified: cls,
        templateId,
        matchedAssets,
      },
    };
  }
}
