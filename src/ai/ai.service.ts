import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type GeminiGenerateResult = {
  description?: string;
  category?: string;
  tags?: string[];
  type?: string;
  mediaPrompts?: {
    cover?: string;
    screenshots?: string[];
    video?: string;
  };
};

 type GeminiTemplateDraft = {
   name?: string;
   description?: string;
   category?: string;
   tags?: string[];
   type?: string;
   mediaPrompts?: {
     cover?: string;
     screenshots?: string[];
     video?: string;
   };
 };

@Injectable()
export class AiService {
  constructor(private readonly configService: ConfigService) {}

  private _trendsCache: { at: number; items: any[] } | null = null;

  private async _sleep(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    await new Promise((r) => setTimeout(r, ms));
  }

  private _stripCdata(v: string): string {
    const s = (v || '').trim();
    if (!s) return '';
    return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
  }

  private _decodeXmlEntities(v: string): string {
    const s = (v || '').trim();
    if (!s) return '';
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  private _extractTag(xml: string, tag: string): string {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m?.[1] ? this._decodeXmlEntities(this._stripCdata(m[1])) : '';
  }

  private _extractAtomLink(xml: string): string {
    const m = xml.match(/<link[^>]*href=['"]([^'"]+)['"][^>]*>/i);
    return m?.[1] ? this._decodeXmlEntities(m[1]) : '';
  }

  private _extractAttr(xml: string, tag: string, attr: string): string {
    const re = new RegExp(`<${tag}[^>]*\\s+${attr}=['\\\"]([^'\\\"]+)['\\\"][^>]*\\/?>`, 'i');
    const m = xml.match(re);
    return m?.[1] ? this._decodeXmlEntities(m[1]) : '';
  }

  private _extractFirstImgSrc(html: string): string {
    const raw = (html || '').toString();
    if (!raw) return '';
    const m = raw.match(/<img[^>]*\ssrc=['\"]([^'\"]+)['\"][^>]*>/i);
    return m?.[1] ? this._decodeXmlEntities(this._stripCdata(m[1])) : '';
  }

  private _parseRssOrAtom(xml: string, source: string) {
    const raw = (xml || '').toString();
    const items: any[] = [];

    const rssItems = raw.match(/<item[\s\S]*?<\/item>/gi) || [];
    for (const block of rssItems) {
      const title = this._extractTag(block, 'title');
      const link = this._extractTag(block, 'link');
      const pubDate = this._extractTag(block, 'pubDate');
      const enclosure = this._extractAttr(block, 'enclosure', 'url');
      const media = this._extractAttr(block, 'media:content', 'url') || this._extractAttr(block, 'media:thumbnail', 'url');
      const desc = this._extractTag(block, 'description');
      const imageUrl = enclosure || media || this._extractFirstImgSrc(desc);
      const publishedAt = pubDate ? new Date(pubDate).toISOString() : undefined;
      if (title && link) items.push({ title, url: link, source, publishedAt, imageUrl });
    }

    if (items.length) return items;

    const atomEntries = raw.match(/<entry[\s\S]*?<\/entry>/gi) || [];
    for (const block of atomEntries) {
      const title = this._extractTag(block, 'title');
      const link = this._extractAtomLink(block) || this._extractTag(block, 'link');
      const updated = this._extractTag(block, 'updated') || this._extractTag(block, 'published');
      const content = this._extractTag(block, 'content') || this._extractTag(block, 'summary');
      const imageUrl = this._extractAttr(block, 'media:content', 'url') || this._extractAttr(block, 'media:thumbnail', 'url') || this._extractFirstImgSrc(content);
      const publishedAt = updated ? new Date(updated).toISOString() : undefined;
      if (title && link) items.push({ title, url: link, source, publishedAt, imageUrl });
    }

    return items;
  }

  async listAiGameTrends(params?: { limit?: number }) {
    const limit = Math.max(1, Math.min(30, Number(params?.limit ?? 12)));
    const now = Date.now();
    if (this._trendsCache && now - this._trendsCache.at <= 30_000) {
      return { success: true, data: { items: this._trendsCache.items.slice(0, limit) } };
    }

    const feeds = [
      {
        source: 'Google News',
        url: 'https://news.google.com/rss/search?q=ai%20game%20development&hl=en-US&gl=US&ceid=US:en',
      },
      {
        source: 'Google News',
        url: 'https://news.google.com/rss/search?q=generative%20ai%20games&hl=en-US&gl=US&ceid=US:en',
      },
      {
        source: 'Google News',
        url: 'https://news.google.com/rss/search?q=unity%20ai%20tools%20game%20dev&hl=en-US&gl=US&ceid=US:en',
      },
    ];

    const results = await Promise.all(
      feeds.map(async (f) => {
        try {
          const res = await fetch(f.url, { method: 'GET' });
          if (!res.ok) return [];
          const text = await res.text();
          return this._parseRssOrAtom(text, f.source);
        } catch {
          return [];
        }
      }),
    );

    const merged = results.flat();
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const it of merged) {
      const key = `${(it.url || '').trim()}|${(it.title || '').trim()}`;
      if (!it.url || !it.title) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(it);
    }

    deduped.sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return tb - ta;
    });

    this._trendsCache = { at: now, items: deduped.slice(0, 30) };
    return { success: true, data: { items: this._trendsCache.items.slice(0, limit) } };
  }

  private _parseRetryDelaySecondsFromGeminiError(text: string): number | undefined {
    const raw = (text || '').trim();
    if (!raw) return undefined;
    try {
      const parsed: any = JSON.parse(raw);
      const details: any[] = Array.isArray(parsed?.error?.details) ? parsed.error.details : [];
      const retryInfo = details.find((d: any) => String(d?.['@type'] || '').includes('RetryInfo'));
      const delayStr = retryInfo?.retryDelay;
      if (typeof delayStr === 'string') {
        const m = delayStr.match(/^(\d+)(?:\.\d+)?s$/i);
        if (m?.[1]) {
          const s = Number(m[1]);
          if (Number.isFinite(s) && s > 0) return s;
        }
      }
    } catch {
      // not JSON
    }
    return undefined;
  }

  private _extractJson(text: string): string {
    const raw = (text || '').trim();
    if (!raw) return '';

    const noFences = raw
      .replace(/```json\s*/gi, '```')
      .replace(/```/g, '')
      .trim();

    if (!noFences) return '';
    if (noFences.startsWith('{') || noFences.startsWith('[')) return noFences;

    const startObj = noFences.indexOf('{');
    const startArr = noFences.indexOf('[');
    let start = -1;
    if (startObj >= 0 && startArr >= 0) start = Math.min(startObj, startArr);
    else start = startObj >= 0 ? startObj : startArr;
    if (start < 0) return '';

    const openChar = noFences[start];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < noFences.length; i++) {
      const ch = noFences[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === openChar) depth++;
      if (ch === closeChar) depth--;
      if (depth === 0) {
        return noFences.slice(start, i + 1).trim();
      }
    }

    return '';
  }

  private _parseModelJson(text: string): any {
    const extracted = this._extractJson(text) || (text || '').trim();
    const candidates: string[] = [];

    const tryBalance = (input: string): string => {
      const s = (input || '').trim();
      if (!s) return s;
      // If Gemini truncates output (missing closing braces), attempt a best-effort balance.
      const firstObj = s.indexOf('{');
      const firstArr = s.indexOf('[');
      let start = -1;
      if (firstObj >= 0 && firstArr >= 0) start = Math.min(firstObj, firstArr);
      else start = firstObj >= 0 ? firstObj : firstArr;
      if (start < 0) return s;

      const openChar = s[start];
      const closeChar = openChar === '{' ? '}' : ']';
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === '"') {
            inString = false;
          }
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === openChar) depth++;
        if (ch === closeChar) depth--;
      }

      if (depth <= 0) return s;
      return s + closeChar.repeat(depth);
    };

    const sanitize = (input: string): string => {
      const s = (input || '')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');

      let out = '';
      let inString = false;
      let escaped = false;

      for (let i = 0; i < s.length; i++) {
        const ch = s[i];

        if (inString) {
          if (escaped) {
            escaped = false;
            out += ch;
            continue;
          }
          if (ch === '\\') {
            escaped = true;
            out += ch;
            continue;
          }
          if (ch === '"') {
            inString = false;
            out += ch;
            continue;
          }

          if (ch === '\n') {
            out += '\\n';
            continue;
          }
          if (ch === '\r') {
            out += '\\r';
            continue;
          }
          if (ch === '\t') {
            out += '\\t';
            continue;
          }
          out += ch;
          continue;
        }

        if (ch === '"') {
          inString = true;
          out += ch;
          continue;
        }

        out += ch;
      }
      return out;
    };

    if (extracted) {
      const sanitized = sanitize(extracted);
      candidates.push(sanitized);
      candidates.push(sanitized.replace(/,(\s*[}\]])/g, '$1'));
      candidates.push(sanitize(tryBalance(extracted)));
      candidates.push(sanitize(tryBalance(extracted)).replace(/,(\s*[}\]])/g, '$1'));
    }

    for (const c of candidates) {
      try {
        return JSON.parse(c);
      } catch (_) {
        // try next candidate
      }
    }

    const snippet = (extracted || '').slice(0, 400);
    throw new BadRequestException(`Gemini returned invalid JSON. Snippet: ${snippet}`);
  }

  private _apiKey(): string {
    const key = (this.configService.get<string>('gemini.apiKey') || '').trim();
    if (!key) throw new BadRequestException('Gemini is not configured');
    return key;
  }

  async listModels() {
    const apiKey = this._apiKey();

    const fetchList = async (apiVersion: 'v1beta' | 'v1') => {
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          ok: false,
          status: res.status,
          error: text || res.statusText,
        };
      }
      const data: any = await res.json();
      const models = Array.isArray(data?.models) ? data.models : [];
      const simplified = models.map((m: any) => ({
        name: m?.name,
        displayName: m?.displayName,
        supportedGenerationMethods: m?.supportedGenerationMethods,
      }));
      return {
        ok: true,
        status: res.status,
        count: simplified.length,
        models: simplified,
      };
    };

    const v1beta = await fetchList('v1beta');
    const v1 = await fetchList('v1');

    return {
      success: true,
      data: {
        v1beta,
        v1,
      },
    };
  }

  async generateTemplateDraftFromImages(params: {
    templateZipName?: string;
    notes?: string;
    images: Array<{ mimeType: string; base64: string }>;
  }): Promise<GeminiTemplateDraft> {
    const apiKey = this._apiKey();
    const configuredModel = (this.configService.get<string>('gemini.model') || '').trim();
    const model = configuredModel || 'gemini-1.5-flash';

    const images = Array.isArray(params.images) ? params.images : [];
    const clipped = images
      .filter((im) => im && typeof im.base64 === 'string' && im.base64.trim() && typeof im.mimeType === 'string' && im.mimeType.trim())
      .slice(0, 3);
    if (!clipped.length) {
      throw new BadRequestException('No images provided');
    }

    const prompt =
      'You are an expert at analyzing game template screenshots and generating marketplace metadata.\n' +
      'Return ONLY strict minified JSON with keys: name (string), description (string), category (string), tags (string[]), type (string).\n' +
      'Constraints: name <= 60 chars; description <= 400 chars; category <= 60 chars; tags 3-8 items, each <= 20 chars, lowercase.\n' +
      'If possible, infer the core genre/mechanics from the images.\n' +
      `Template zip/folder name: ${JSON.stringify(params.templateZipName || '')}\n` +
      `Notes: ${JSON.stringify(params.notes || '')}`;

    const parts: any[] = [{ text: prompt }];
    for (const im of clipped) {
      parts.push({ inlineData: { mimeType: im.mimeType, data: im.base64 } });
    }

    const call = async (apiVersion: 'v1beta' | 'v1') => {
      return await this._generateContentJsonParts({ apiKey, apiVersion, model, parts });
    };

    let text: string;
    try {
      text = await call('v1beta');
    } catch (e: any) {
      const msg = (e?.message || '').toString().toLowerCase();
      const shouldRetry = msg.includes('(404)') || msg.includes('not found') || msg.includes('not supported');
      if (!shouldRetry) throw e;
      text = await call('v1');
    }

    const parsed = this._parseModelJson(text);
    const out: GeminiTemplateDraft = {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      category: typeof parsed.category === 'string' ? parsed.category : undefined,
      type: typeof parsed.type === 'string' ? parsed.type : undefined,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t).trim()).filter(Boolean) : undefined,
      mediaPrompts:
        parsed.mediaPrompts && typeof parsed.mediaPrompts === 'object'
          ? {
              cover: typeof parsed.mediaPrompts.cover === 'string' ? parsed.mediaPrompts.cover : undefined,
              screenshots: Array.isArray(parsed.mediaPrompts.screenshots)
                ? parsed.mediaPrompts.screenshots.map((s: any) => String(s).trim()).filter(Boolean)
                : undefined,
              video: typeof parsed.mediaPrompts.video === 'string' ? parsed.mediaPrompts.video : undefined,
            }
          : undefined,
    };
    return out;
  }

  private async _generateContentJson(params: {
    apiKey: string;
    apiVersion: 'v1beta' | 'v1';
    model: string;
    prompt: string;
  }): Promise<string> {
    const rawModel = (params.model || '').trim();
    const normalizedModel = rawModel.startsWith('models/') ? rawModel.slice('models/'.length) : rawModel;
    const url = `https://generativelanguage.googleapis.com/${params.apiVersion}/models/${encodeURIComponent(normalizedModel)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 1200,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');

      if (res.status === 429) {
        const retryS = this._parseRetryDelaySecondsFromGeminiError(text);
        throw new HttpException(
          {
            message: 'Gemini quota exceeded',
            retryAfterSeconds: retryS,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Keep errors concise; the raw JSON can be very large and will overwhelm the mobile UI.
      const brief = (text || res.statusText || '').toString().slice(0, 600);
      throw new BadRequestException(`Gemini request failed (${res.status}): ${brief}`);
    }

    const data: any = await res.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? '';

    if (!text) {
      throw new BadRequestException('Gemini returned empty response');
    }

    return text;
  }

  private async _generateContentJsonParts(params: {
    apiKey: string;
    apiVersion: 'v1beta' | 'v1';
    model: string;
    parts: any[];
  }): Promise<string> {
    const rawModel = (params.model || '').trim();
    const normalizedModel = rawModel.startsWith('models/') ? rawModel.slice('models/'.length) : rawModel;
    const url = `https://generativelanguage.googleapis.com/${params.apiVersion}/models/${encodeURIComponent(normalizedModel)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: params.parts }],
        generationConfig: {
          temperature: 0.25,
          topP: 0.9,
          maxOutputTokens: 1200,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 429) {
        const retryS = this._parseRetryDelaySecondsFromGeminiError(text);
        throw new HttpException(
          {
            message: 'Gemini quota exceeded',
            retryAfterSeconds: retryS,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const brief = (text || res.statusText || '').toString().slice(0, 600);
      throw new BadRequestException(`Gemini request failed (${res.status}): ${brief}`);
    }

    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? '';
    if (!text) {
      throw new BadRequestException('Gemini returned empty response');
    }
    return text;
  }

  private async _generateWithFallback(params: {
    prompt: string;
  }): Promise<string> {
    const apiKey = this._apiKey();
    const configuredModel = (this.configService.get<string>('gemini.model') || '').trim();
    const primaryModel = configuredModel || 'gemini-1.5-flash';
    const fallbackModels = [
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-1.0-pro',
    ];

    const call = async (apiVersion: 'v1beta' | 'v1', model: string) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await this._generateContentJson({ apiKey, apiVersion, model, prompt: params.prompt });
        } catch (e: any) {
          const statusCode = Number(e?.getStatus?.() ?? e?.status ?? e?.statusCode);
          if (statusCode !== 429) throw e;
          const resp = (typeof e?.getResponse === 'function' ? e.getResponse() : undefined) as any;
          const retryS = resp && typeof resp === 'object' ? Number(resp.retryAfterSeconds) : undefined;
          if (attempt === 0 && typeof retryS === 'number' && Number.isFinite(retryS) && retryS > 0 && retryS <= 120) {
            await this._sleep(retryS * 1000);
            continue;
          }
          throw e;
        }
      }
      throw new BadRequestException('Gemini request failed');
    };

    let lastErr: any;

    // Primary model on v1beta, then v1
    try {
      return await call('v1beta', primaryModel);
    } catch (e: any) {
      lastErr = e;
      const msg = (e?.message || '').toString();
      const statusCode = Number(e?.getStatus?.() ?? e?.status ?? e?.statusCode);
      if (statusCode === 429) throw e;
      const shouldRetry = msg.includes('(404)') || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('not supported');
      if (!shouldRetry) throw e;
    }

    try {
      return await call('v1', primaryModel);
    } catch (e: any) {
      lastErr = e;
    }

    // Fallback models
    for (const m of fallbackModels) {
      if (m === primaryModel) continue;
      try {
        try {
          return await call('v1beta', m);
        } catch (err: any) {
          const msg = (err?.message || '').toString();
          const statusCode = Number(err?.getStatus?.() ?? err?.status ?? err?.statusCode);
          if (statusCode === 429) throw err;
          const vRetry = msg.includes('(404)') || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('not supported');
          if (!vRetry) throw err;
          return await call('v1', m);
        }
      } catch (e: any) {
        lastErr = e;
        continue;
      }
    }

    throw lastErr || new BadRequestException('Gemini request failed');
  }

  async generateImageBase64(params: { prompt: string }) {
    const apiKey = this._apiKey();
    const model = 'models/gemini-2.0-flash-exp-image-generation';
    const rawModel = model.trim();
    const normalizedModel = rawModel.startsWith('models/') ? rawModel.slice('models/'.length) : rawModel;

    const attempt = async (apiVersion: 'v1beta' | 'v1') => {
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(normalizedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
          generationConfig: {
            temperature: 0.6,
            topP: 0.9,
            maxOutputTokens: 1200,
          },
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 429) {
          const retryS = this._parseRetryDelaySecondsFromGeminiError(text);
          throw new HttpException(
            {
              message: 'Gemini quota exceeded',
              retryAfterSeconds: retryS,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        const brief = (text || res.statusText || '').toString().slice(0, 600);
        throw new BadRequestException(`Gemini image request failed (${res.status}): ${brief}`);
      }

      const data: any = await res.json();
      const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
      const inline = parts.find((p: any) => p?.inlineData?.data);
      const mimeType = inline?.inlineData?.mimeType;
      const base64 = inline?.inlineData?.data;
      if (!mimeType || !base64) {
        throw new BadRequestException('Gemini did not return inline image data');
      }
      return { mimeType: String(mimeType), base64: String(base64) };
    };

    for (let i = 0; i < 2; i++) {
      try {
        const out = await attempt('v1beta');
        return { success: true, data: out };
      } catch (e: any) {
        const statusCode = Number(e?.getStatus?.() ?? e?.status ?? e?.statusCode);
        if (statusCode === 429) {
          const resp = (typeof e?.getResponse === 'function' ? e.getResponse() : undefined) as any;
          const retryS = resp && typeof resp === 'object' ? Number(resp.retryAfterSeconds) : undefined;
          if (i === 0 && retryS && Number.isFinite(retryS) && retryS > 0 && retryS <= 120) {
            await this._sleep(retryS * 1000);
            continue;
          }
          throw e;
        }

        const msg = (e?.message || '').toString().toLowerCase();
        const shouldRetry = msg.includes('(404)') || msg.includes('not found') || msg.includes('not supported');
        if (!shouldRetry) throw e;

        const out = await attempt('v1');
        return { success: true, data: out };
      }
    }

    // should never reach
    throw new BadRequestException('Gemini image generation failed');
  }

  async generateTemplateMetadata(params: {
    name: string;
    description?: string;
    category?: string;
    tags?: string[];
    notes?: string;
  }): Promise<GeminiGenerateResult> {
    const prompt =
      `You are generating metadata for a Unity game template in a marketplace.\n` +
      `Return ONLY strict JSON with keys: description (string), category (string), tags (string[]), type (string), mediaPrompts (object).\n` +
      `mediaPrompts keys: cover (string), screenshots (string[] of 4 items), video (string).\n` +
      `Constraints: description <= 400 chars; category <= 60 chars; tags 3-8 items, each <= 20 chars, lowercase.\n` +
      `Template name: ${JSON.stringify(params.name)}\n` +
      `Existing description: ${JSON.stringify(params.description || '')}\n` +
      `Existing category: ${JSON.stringify(params.category || '')}\n` +
      `Existing tags: ${JSON.stringify(params.tags || [])}\n` +
      `Notes: ${JSON.stringify(params.notes || '')}`;

    const strictSuffix =
      `\nIMPORTANT: Output must be valid minified JSON only (no markdown, no comments, no trailing commas, no extra text).` +
      ` Do not include raw newlines inside JSON strings (use \\n).`;

    let text = await this._generateWithFallback({ prompt });

    let parsed: any;
    try {
      parsed = this._parseModelJson(text);
    } catch (e: any) {
      const msg = (e?.message || '').toString();
      if (!msg.toLowerCase().includes('invalid json')) throw e;
      text = await this._generateWithFallback({ prompt: prompt + strictSuffix });
      parsed = this._parseModelJson(text);
    }

    const out: GeminiGenerateResult = {
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      category: typeof parsed.category === 'string' ? parsed.category : undefined,
      type: typeof parsed.type === 'string' ? parsed.type : undefined,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t).trim()).filter(Boolean) : undefined,
      mediaPrompts: parsed.mediaPrompts && typeof parsed.mediaPrompts === 'object'
        ? {
            cover: typeof parsed.mediaPrompts.cover === 'string' ? parsed.mediaPrompts.cover : undefined,
            screenshots: Array.isArray(parsed.mediaPrompts.screenshots)
              ? parsed.mediaPrompts.screenshots.map((s: any) => String(s).trim()).filter(Boolean)
              : undefined,
            video: typeof parsed.mediaPrompts.video === 'string' ? parsed.mediaPrompts.video : undefined,
          }
        : undefined,
    };

    return out;
  }

  async generateProjectMetadata(params: {
    name: string;
    description?: string;
    templateName?: string;
    notes?: string;
  }): Promise<GeminiGenerateResult> {
    const prompt =
      `You are generating metadata for a game project created from a template.\n` +
      `Return ONLY strict JSON with keys: description (string), tags (string[]), type (string), mediaPrompts (object).\n` +
      `mediaPrompts keys: cover (string), screenshots (string[] of 4 items), video (string).\n` +
      `Constraints: description <= 400 chars; tags 3-8 items, each <= 20 chars, lowercase.\n` +
      `Project name: ${JSON.stringify(params.name)}\n` +
      `Existing description: ${JSON.stringify(params.description || '')}\n` +
      `Template name: ${JSON.stringify(params.templateName || '')}\n` +
      `Notes: ${JSON.stringify(params.notes || '')}`;

    const strictSuffix =
      `\nIMPORTANT: Output must be valid minified JSON only (no markdown, no comments, no trailing commas, no extra text).` +
      ` Do not include raw newlines inside JSON strings (use \\n).`;

    let text = await this._generateWithFallback({ prompt });

    let parsed: any;
    try {
      parsed = this._parseModelJson(text);
    } catch (e: any) {
      const msg = (e?.message || '').toString();
      if (!msg.toLowerCase().includes('invalid json')) throw e;
      text = await this._generateWithFallback({ prompt: prompt + strictSuffix });
      parsed = this._parseModelJson(text);
    }

    const out: GeminiGenerateResult = {
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      type: typeof parsed.type === 'string' ? parsed.type : undefined,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t).trim()).filter(Boolean) : undefined,
      mediaPrompts: parsed.mediaPrompts && typeof parsed.mediaPrompts === 'object'
        ? {
            cover: typeof parsed.mediaPrompts.cover === 'string' ? parsed.mediaPrompts.cover : undefined,
            screenshots: Array.isArray(parsed.mediaPrompts.screenshots)
              ? parsed.mediaPrompts.screenshots.map((s: any) => String(s).trim()).filter(Boolean)
              : undefined,
            video: typeof parsed.mediaPrompts.video === 'string' ? parsed.mediaPrompts.video : undefined,
          }
        : undefined,
    };

    return out;
  }

  async generateTemplateDraft(params: { description: string; notes?: string }) {
    const prompt =
      `You generate metadata for a Unity game template in a marketplace.\n` +
      `Return ONLY strict minified JSON with keys: name (string), description (string), category (string), tags (string[]), type (string), mediaPrompts (object).\n` +
      `mediaPrompts keys: cover (string), screenshots (string[] of 4 items), video (string).\n` +
      `Constraints: name <= 60 chars; description <= 400 chars; category <= 60 chars; tags 3-8 items, each <= 20 chars, lowercase.\n` +
      `Input description: ${JSON.stringify(params.description || '')}\n` +
      `Notes: ${JSON.stringify(params.notes || '')}`;

    const strictSuffix =
      `\nIMPORTANT: Output must be valid minified JSON only (no markdown, no comments, no trailing commas, no extra text).` +
      ` Ensure the JSON is complete and properly closed.` +
      ` Do not include raw newlines inside JSON strings (use \\n).`;

    let text = await this._generateWithFallback({ prompt });
    let parsed: any;
    try {
      parsed = this._parseModelJson(text);
    } catch (e: any) {
      const msg = (e?.message || '').toString();
      if (!msg.toLowerCase().includes('invalid json')) throw e;
      text = await this._generateWithFallback({ prompt: prompt + strictSuffix });
      parsed = this._parseModelJson(text);
    }
    return {
      success: true,
      data: {
        name: typeof parsed.name === 'string' ? parsed.name : undefined,
        description: typeof parsed.description === 'string' ? parsed.description : undefined,
        category: typeof parsed.category === 'string' ? parsed.category : undefined,
        type: typeof parsed.type === 'string' ? parsed.type : undefined,
        tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t).trim()).filter(Boolean) : undefined,
        mediaPrompts: parsed.mediaPrompts && typeof parsed.mediaPrompts === 'object'
          ? {
              cover: typeof parsed.mediaPrompts.cover === 'string' ? parsed.mediaPrompts.cover : undefined,
              screenshots: Array.isArray(parsed.mediaPrompts.screenshots)
                ? parsed.mediaPrompts.screenshots.map((s: any) => String(s).trim()).filter(Boolean)
                : undefined,
              video: typeof parsed.mediaPrompts.video === 'string' ? parsed.mediaPrompts.video : undefined,
            }
          : undefined,
      },
    };
  }

  async generateProjectDraft(params: { description: string; notes?: string }) {
    const prompt =
      `You generate metadata for a game project created from a Unity template.\n` +
      `Return ONLY strict minified JSON with keys: name (string), description (string), tags (string[]), type (string), mediaPrompts (object).\n` +
      `mediaPrompts keys: cover (string), screenshots (string[] of 4 items), video (string).\n` +
      `Constraints: name <= 60 chars; description <= 400 chars; tags 3-8 items, each <= 20 chars, lowercase.\n` +
      `Input description: ${JSON.stringify(params.description || '')}\n` +
      `Notes: ${JSON.stringify(params.notes || '')}`;

    const strictSuffix =
      `\nIMPORTANT: Output must be valid minified JSON only (no markdown, no comments, no trailing commas, no extra text).` +
      ` Ensure the JSON is complete and properly closed.` +
      ` Do not include raw newlines inside JSON strings (use \\n).`;

    let text = await this._generateWithFallback({ prompt });
    let parsed: any;
    try {
      parsed = this._parseModelJson(text);
    } catch (e: any) {
      const msg = (e?.message || '').toString();
      if (!msg.toLowerCase().includes('invalid json')) throw e;
      text = await this._generateWithFallback({ prompt: prompt + strictSuffix });
      parsed = this._parseModelJson(text);
    }
    return {
      success: true,
      data: {
        name: typeof parsed.name === 'string' ? parsed.name : undefined,
        description: typeof parsed.description === 'string' ? parsed.description : undefined,
        type: typeof parsed.type === 'string' ? parsed.type : undefined,
        tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t).trim()).filter(Boolean) : undefined,
        mediaPrompts: parsed.mediaPrompts && typeof parsed.mediaPrompts === 'object'
          ? {
              cover: typeof parsed.mediaPrompts.cover === 'string' ? parsed.mediaPrompts.cover : undefined,
              screenshots: Array.isArray(parsed.mediaPrompts.screenshots)
                ? parsed.mediaPrompts.screenshots.map((s: any) => String(s).trim()).filter(Boolean)
                : undefined,
              video: typeof parsed.mediaPrompts.video === 'string' ? parsed.mediaPrompts.video : undefined,
            }
          : undefined,
      },
    };
  }

  async generateUnityConfig(params: { prompt: string; templateName?: string }) {
    const prompt =
      `You generate a SAFE configuration object for a Unity game template.\n` +
      `Return ONLY strict minified JSON with keys:\n` +
      `timeScale (number 0.5-2.0), difficulty (number 0-1), theme (string <= 40), notes (string <= 200),\n` +
      `speed (number 0-20), genre (string <= 30), assetsType (string <= 30), mechanics (string[] max 12 items, each <= 20),\n` +
      `primaryColor (string hex #RRGGBB), secondaryColor (string hex #RRGGBB), accentColor (string hex #RRGGBB).\n` +
      `Do NOT include any other keys.\n` +
      `Template name: ${JSON.stringify(params.templateName || '')}\n` +
      `User prompt: ${JSON.stringify(params.prompt || '')}`;

    const strictSuffix =
      `\nIMPORTANT: Output must be valid minified JSON only (no markdown, no comments, no trailing commas, no extra text).` +
      ` Ensure the JSON is complete and properly closed.` +
      ` Do not include raw newlines inside JSON strings (use \\n).`;

    let text = await this._generateWithFallback({ prompt });
    let parsed: any;
    try {
      parsed = this._parseModelJson(text);
    } catch (e: any) {
      const msg = (e?.message || '').toString();
      if (!msg.toLowerCase().includes('invalid json')) throw e;
      text = await this._generateWithFallback({ prompt: prompt + strictSuffix });
      parsed = this._parseModelJson(text);
    }

    const clamp = (n: any, min: number, max: number, fallback: number) => {
      const v = typeof n === 'number' ? n : Number(n);
      if (!Number.isFinite(v)) return fallback;
      return Math.max(min, Math.min(max, v));
    };

    const asShortString = (v: any, maxLen: number, fallback: string) => {
      if (typeof v !== 'string') return fallback;
      const s = v.trim();
      if (!s) return fallback;
      return s.slice(0, maxLen);
    };

    const asStringArray = (v: any, maxItems: number, maxLen: number) => {
      if (!Array.isArray(v)) return undefined;
      const out = v
        .map((x: any) => (x == null ? '' : String(x)).trim())
        .filter((x: string) => x.length > 0)
        .map((x: string) => x.slice(0, maxLen))
        .slice(0, maxItems);
      return out.length ? out : undefined;
    };

    const asHexColor = (v: any, fallback: string) => {
      if (typeof v !== 'string') return fallback;
      let s = v.trim();
      if (!s) return fallback;
      if (!s.startsWith('#')) s = `#${s}`;
      if (!/^#[0-9a-fA-F]{6}$/.test(s)) return fallback;
      return s.toUpperCase();
    };

    return {
      success: true,
      data: {
        timeScale: clamp(parsed.timeScale, 0.5, 2.0, 1.0),
        difficulty: clamp(parsed.difficulty, 0, 1, 0.5),
        theme: asShortString(parsed.theme, 40, 'default'),
        notes: asShortString(parsed.notes, 200, ''),
        speed: clamp((parsed as any).speed, 0, 20, 5.0),
        genre: asShortString((parsed as any).genre, 30, 'platformer'),
        assetsType: asShortString((parsed as any).assetsType, 30, 'lowpoly'),
        mechanics: asStringArray((parsed as any).mechanics, 12, 20),
        primaryColor: asHexColor((parsed as any).primaryColor, '#22C55E'),
        secondaryColor: asHexColor((parsed as any).secondaryColor, '#3B82F6'),
        accentColor: asHexColor((parsed as any).accentColor, '#F59E0B'),
      },
    };
  }
}
