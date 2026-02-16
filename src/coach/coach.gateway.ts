import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CoachService, type CoachChatMessage } from './coach.service';

type CoachStartPayload = {
  token?: string;
  text?: string;
  projectId?: string;
  locale?: string;
};

@WebSocketGateway({
  namespace: '/coach',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class CoachGateway {
  @WebSocketServer()
  server: Server;

  private readonly _sessions = new Map<string, CoachChatMessage[]>();

  constructor(
    private readonly coachService: CoachService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  private _jwtSecret(): string {
    return (this.configService.get<string>('jwt.secret') || 'default-secret').trim();
  }

  private async _verifyToken(token: string): Promise<any> {
    const t = (token || '').trim();
    if (!t) throw new Error('Missing token');
    return this.jwtService.verifyAsync(t, { secret: this._jwtSecret() });
  }

  private _systemPrompt(locale?: string, projectId?: string): string {
    const lang = (locale || '').toLowerCase();
    const isTn = lang === 'tn' || lang.includes('darija') || lang.includes('tunis');
    const langHint = isTn
      ? 'جاوب بالدارجة التونسية. كان المستخدم يكتب بالعربي جاوب بالعربي، وكان يكتب عربيزى (latin) جاوب عربيزى. خليك واضح وقصير وعملي.'
      : lang.includes('fr')
        ? 'Réponds en français si l’utilisateur parle français.'
        : lang.includes('en')
          ? 'Reply in English if the user speaks English.'
          : 'جاوب بنفس لغة المستخدم (تونسي/عربي/فرنسي/انجليزي) حسب السياق.';

    const base =
      'You are GameForge Coach, the built-in assistant inside the GameForge mobile app. ' +
      'You help users create and tune Unity/WebGL games generated from templates or AI. ' +
      'Always be specific to GameForge features and UI.';

    const gameforgeContext =
      'GameForge capabilities you can reference:\n' +
      '- Create flow: Choose a Template -> AI Configuration -> Generate -> Generation Progress -> Project Detail -> Play WebGL.\n' +
      '- AI Create: user can generate a project from a prompt (Create with AI).\n' +
      '- Runtime tuning parameters (project settings): speed, primaryColor, secondaryColor, accentColor, playerColor, fogEnabled, fogDensity, cameraZoom, gravityY, jumpForce.\n' +
      '- In Play WebGL screen there is an in-game Settings drawer to adjust runtime settings.\n' +
      '- Users can rebuild/regenerate and then play the WebGL preview.';

    const styleRules =
      'Response rules:\n' +
      '- Give step-by-step instructions using GameForge screen names (Dashboard, Create Project, AI Configuration, Project Detail, Play WebGL).\n' +
      '- Prefer concrete numbers and hex colors.\n' +
      '- When relevant, propose 2-3 presets (e.g., Chill/Normal/Hardcore) and explain the tradeoffs.\n' +
      '- If user asks "what should I do next?", answer with a short checklist.';

    const ctx = projectId ? `ProjectId: ${projectId}.` : '';
    return `${base}\n${langHint}\n${gameforgeContext}\n${styleRules}\n${ctx}`;
  }

  @SubscribeMessage('coach:start')
  async onStart(@ConnectedSocket() socket: Socket, @MessageBody() payload: CoachStartPayload) {
    try {
      const token = (payload?.token || (socket.handshake?.auth as any)?.token || (socket.handshake?.query as any)?.token || '').toString();
      const userText = (payload?.text || '').toString().trim();
      if (!userText) throw new Error('Empty message');

      const verified = await this._verifyToken(token);
      const ownerId = verified?.sub;
      if (!ownerId) throw new Error('Invalid token');

      const sid = socket.id;
      const history = this._sessions.get(sid) ?? [];

      const messages: CoachChatMessage[] = [
        { role: 'system', content: this._systemPrompt(payload?.locale, payload?.projectId) },
        ...history,
        { role: 'user', content: userText },
      ];

      socket.emit('coach:started', { success: true });

      let full = '';
      for await (const chunk of this.coachService.streamCoachReply({ messages })) {
        full += chunk;
        socket.emit('coach:token', { t: chunk });
      }

      const nextHistory: CoachChatMessage[] = [
        ...history,
        { role: 'user', content: userText },
        { role: 'assistant', content: full },
      ].slice(-24) as CoachChatMessage[];
      this._sessions.set(sid, nextHistory);

      socket.emit('coach:done', { success: true });
    } catch (e: any) {
      socket.emit('coach:error', {
        success: false,
        message: (e?.message || e?.toString?.() || 'Coach error').toString(),
      });
    }
  }

  @SubscribeMessage('coach:reset')
  async onReset(@ConnectedSocket() socket: Socket) {
    this._sessions.delete(socket.id);
    socket.emit('coach:reset:done', { success: true });
  }
}
