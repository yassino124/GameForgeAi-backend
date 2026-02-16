import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async listForUser(userId: string) {
    const items = await this.notificationModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    return { success: true, data: items };
  }

  async markRead(params: { userId: string; notificationId: string; isRead: boolean }) {
    await this.notificationModel.updateOne(
      { _id: params.notificationId, userId: params.userId },
      { $set: { isRead: params.isRead } },
    );
    return { success: true };
  }

  async markAllRead(userId: string) {
    await this.notificationModel.updateMany({ userId, isRead: false }, { $set: { isRead: true } });
    return { success: true };
  }

  async clearAll(userId: string) {
    await this.notificationModel.deleteMany({ userId });
    return { success: true };
  }

  async createForUsers(params: {
    userIds: string[];
    title: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    data?: any;
  }) {
    const ids = Array.isArray(params.userIds) ? params.userIds.filter(Boolean) : [];
    if (!ids.length) return { success: true, data: { created: 0 } };

    const docs = ids.map((userId) => ({
      userId,
      title: params.title,
      message: params.message,
      type: params.type ?? 'info',
      data: params.data ?? null,
      isRead: false,
    }));

    await this.notificationModel.insertMany(docs, { ordered: false });
    return { success: true, data: { created: docs.length } };
  }
}
