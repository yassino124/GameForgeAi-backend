import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type CoachChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

@Injectable()
export class CoachService {
  constructor(private readonly configService: ConfigService) {}

  private _ollamaBaseUrl(): string {
    const raw = (this.configService.get<string>('ollama.baseUrl') || '').trim();
    return raw || 'http://127.0.0.1:11434';
  }

  private _ollamaModel(): string {
    const raw = (this.configService.get<string>('ollama.model') || '').trim();
    return raw || 'qwen2.5:7b';
  }

  async *streamCoachReply(params: {
    messages: CoachChatMessage[];
  }): AsyncGenerator<string, void, unknown> {
    const url = `${this._ollamaBaseUrl()}/api/chat`;
    const model = this._ollamaModel();

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        messages: params.messages,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama chat failed (${res.status}): ${(text || res.statusText || '').slice(0, 300)}`);
    }

    if (!res.body) {
      throw new Error('Ollama response body is empty');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        idx = buf.indexOf('\n');

        if (!line) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const content = parsed?.message?.content;
        if (typeof content === 'string' && content.length > 0) {
          yield content;
        }

        if (parsed?.done === true) {
          return;
        }
      }
    }
  }
}
