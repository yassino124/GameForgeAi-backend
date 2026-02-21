import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/entities/user.entity';

export interface AdminUsersListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  role?: string;
  subscription?: string;
  dateFrom?: string;
  dateTo?: string;
}

type ExportParams = Omit<AdminUsersListParams, 'page' | 'limit'>;

@Injectable()
export class AdminUsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async list(params: AdminUsersListParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const andConditions: Record<string, unknown>[] = [
      { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] },
    ];

    if (params.search && params.search.trim()) {
      const q = params.search.trim();
      andConditions.push({
        $or: [
          { username: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } },
          { fullName: { $regex: q, $options: 'i' } },
        ],
      });
    }

    if (params.status && ['active', 'suspended', 'banned'].includes(params.status)) {
      if (params.status === 'active') {
        andConditions.push({ $or: [{ status: 'active' }, { status: { $exists: false } }] });
      } else {
        andConditions.push({ status: params.status });
      }
    }

    if (params.role && ['user', 'dev', 'devl', 'admin'].includes(params.role)) {
      andConditions.push({ role: params.role });
    }

    if (params.subscription && ['free', 'pro', 'enterprise'].includes(params.subscription)) {
      andConditions.push({ subscription: params.subscription });
    }

    const dateFilter: Record<string, Date> = {};
    if (params.dateFrom) {
      const d = new Date(params.dateFrom);
      if (!isNaN(d.getTime())) dateFilter.$gte = d;
    }
    if (params.dateTo) {
      const d = new Date(params.dateTo);
      if (!isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        dateFilter.$lte = d;
      }
    }
    if (Object.keys(dateFilter).length > 0) {
      andConditions.push({ createdAt: dateFilter });
    }

    const filter = andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('_id username fullName email role status subscription avatar lastLogin createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.userModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      users: users.map((u: any) => ({
        _id: u._id?.toString(),
        id: u._id?.toString(),
        name: u.fullName || u.username || '',
        username: u.username,
        email: u.email,
        role: u.role,
        status: u.status || (u.isActive ? 'active' : 'suspended'),
        subscription: u.subscription,
        createdAt: u.createdAt,
        lastLogin: u.lastLogin,
        avatar: u.avatar || '',
      })),
      total,
      page,
      totalPages,
    };
  }

  async getById(id: string) {
    const user = await this.userModel
      .findOne({ _id: id, $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] })
      .lean();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const u = user as any;
    return {
      _id: u._id?.toString(),
      id: u._id?.toString(),
      username: u.username,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      status: u.status || (u.isActive ? 'active' : 'suspended'),
      subscription: u.subscription,
      avatar: u.avatar,
      bio: u.bio,
      location: u.location,
      website: u.website,
      isActive: u.isActive,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt,
      projects: u.projects || [],
    };
  }

  async updateStatus(id: string, status: 'active' | 'suspended' | 'banned') {
    const user = await this.userModel.findOne({ _id: id, $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.status = status;
    user.isActive = status === 'active';
    await user.save();
    const u = user.toObject() as any;
    return {
      _id: u._id?.toString(),
      id: u._id?.toString(),
      username: u.username,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      status: u.status,
      subscription: u.subscription,
      avatar: u.avatar,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt,
    };
  }

  async delete(id: string) {
    const user = await this.userModel.findOne({ _id: id, $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.deletedAt = new Date();
    user.isActive = false;
    user.status = 'suspended';
    await user.save();
    return { message: 'User deleted successfully' };
  }

  async exportCsv(params: ExportParams) {
    const andConditions: Record<string, unknown>[] = [
      { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] },
    ];
    if (params.search && params.search.trim()) {
      const q = params.search.trim();
      andConditions.push({
        $or: [
          { username: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } },
          { fullName: { $regex: q, $options: 'i' } },
        ],
      });
    }
    if (params.status && ['active', 'suspended', 'banned'].includes(params.status)) {
      if (params.status === 'active') {
        andConditions.push({ $or: [{ status: 'active' }, { status: { $exists: false } }] });
      } else {
        andConditions.push({ status: params.status });
      }
    }
    if (params.role && ['user', 'dev', 'devl', 'admin'].includes(params.role)) {
      andConditions.push({ role: params.role });
    }
    if (params.subscription && ['free', 'pro', 'enterprise'].includes(params.subscription)) {
      andConditions.push({ subscription: params.subscription });
    }
    const dateFilter: Record<string, Date> = {};
    if (params.dateFrom) {
      const d = new Date(params.dateFrom);
      if (!isNaN(d.getTime())) dateFilter.$gte = d;
    }
    if (params.dateTo) {
      const d = new Date(params.dateTo);
      if (!isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        dateFilter.$lte = d;
      }
    }
    if (Object.keys(dateFilter).length > 0) {
      andConditions.push({ createdAt: dateFilter });
    }
    const filter = andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

    const users = await this.userModel
      .find(filter)
      .select('_id username fullName email role status lastLogin createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const escapeCsv = (v: string) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = [
      'ID,Name,Email,Role,Status,Created At,Last Login',
      ...users.map((u: any) => {
        const name = u.fullName || u.username || '';
        const createdAt = u.createdAt ? new Date(u.createdAt).toISOString() : '';
        const lastLogin = u.lastLogin ? new Date(u.lastLogin).toISOString() : '';
        const status = u.status || (u.isActive ? 'active' : 'suspended');
        return [
          escapeCsv(u._id?.toString() ?? ''),
          escapeCsv(name),
          escapeCsv(u.email ?? ''),
          escapeCsv(u.role ?? ''),
          escapeCsv(status),
          escapeCsv(createdAt),
          escapeCsv(lastLogin),
        ].join(',');
      }),
    ];
    return rows.join('\n');
  }
}
