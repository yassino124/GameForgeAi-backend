import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from './notifications.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5000', 'http://localhost'],
    credentials: true,
  },
})
@Injectable()
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userSockets = new Map<string, Set<string>>(); // userId -> Set of socketIds

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(@ConnectedSocket() socket: AuthenticatedSocket) {
    try {
      const token = socket.handshake?.auth?.token || socket.handshake?.headers?.authorization;
      if (!token) {
        socket.disconnect();
        return;
      }

      const authToken = typeof token === 'string' && token.startsWith('Bearer ')
        ? token.slice(7)
        : token;

      try {
        const payload = this.jwtService.verify(authToken);
        socket.userId = payload.sub;

        if (!this.userSockets.has(payload.sub)) {
          this.userSockets.set(payload.sub, new Set());
        }
        this.userSockets.get(payload.sub)?.add(socket.id);

        socket.join(`user:${payload.sub}`);
        console.log(`[Notifications] User ${payload.sub} connected via socket ${socket.id}`);
      } catch (error) {
        console.error('[Notifications] JWT verification failed:', error.message);
        socket.disconnect();
      }
    } catch (error) {
      console.error('[Notifications] Connection error:', error.message);
      socket.disconnect();
    }
  }

  handleDisconnect(@ConnectedSocket() socket: AuthenticatedSocket) {
    if (socket.userId) {
      const sockets = this.userSockets.get(socket.userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          this.userSockets.delete(socket.userId);
        }
      }
      console.log(`[Notifications] User ${socket.userId} disconnected`);
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() socket: AuthenticatedSocket) {
    return { event: 'pong', data: { timestamp: Date.now() } };
  }

  // Called by admin to send notifications
  async sendNotificationToUser(userId: string, notification: any) {
    this.server.to(`user:${userId}`).emit('notification:received', {
      id: notification._id?.toString(),
      title: notification.title,
      message: notification.message,
      type: notification.type || 'info',
      data: notification.data,
      timestamp: new Date(),
      read: false,
    });
  }

  // Send to multiple users
  async sendNotificationToUsers(userIds: string[], notification: any) {
    const notifData = {
      id: notification._id?.toString(),
      title: notification.title,
      message: notification.message,
      type: notification.type || 'info',
      data: notification.data,
      timestamp: new Date(),
      read: false,
    };

    for (const userId of userIds) {
      this.server.to(`user:${userId}`).emit('notification:received', notifData);
    }
  }

  // Send to all connected users
  async sendNotificationToAll(notification: any) {
    this.server.emit('notification:received', {
      id: notification._id?.toString(),
      title: notification.title,
      message: notification.message,
      type: notification.type || 'info',
      data: notification.data,
      timestamp: new Date(),
      read: false,
    });
  }

  // Get connected users count
  getConnectedUsersCount(): number {
    return this.userSockets.size;
  }

  // Check if user is connected
  isUserConnected(userId: string): boolean {
    return this.userSockets.has(userId) && (this.userSockets.get(userId)?.size ?? 0) > 0;
  }

  // Get connected socket IDs for a user
  getUserSockets(userId: string): string[] {
    return Array.from(this.userSockets.get(userId) || []);
  }

  // Force disconnect a user (for ban/suspension)
  forceDisconnectUser(userId: string): void {
    const socketIds = this.userSockets.get(userId);
    if (socketIds && socketIds.size > 0) {
      for (const socketId of socketIds) {
        const socket = this.server.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
          console.log(`[Notifications] Force disconnected user ${userId} (socket ${socketId})`);
        }
      }
    }
  }
}
