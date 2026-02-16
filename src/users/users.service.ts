import { Injectable, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './entities/user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(userData: any): Promise<UserDocument> {
    const { email, username, password } = userData;
    
    const existingUser = await this.userModel.findOne({
      $or: [{ email }, { username }]
    });
    
    if (existingUser) {
      if (existingUser.email === email) {
        throw new ConflictException('User with this email already exists');
      }
      if (existingUser.username === username) {
        throw new ConflictException('Username already taken');
      }
    }

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = new this.userModel({
      email,
      username,
      password: hashedPassword,
    });

    return newUser.save();
  }

  async findOne(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async validatePassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  async getUserProfile(userId: string): Promise<UserDocument> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateProfile(userId: string, updateData: any): Promise<UserDocument> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (updateData.username) {
      const existingUser = await this.userModel.findOne({
        username: updateData.username,
        _id: { $ne: userId },
      });
      
      if (existingUser) {
        throw new ConflictException('Username already taken');
      }
    }

    Object.assign(user, updateData);
    return user.save();
  }

  async deleteAccount(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userModel.findByIdAndDelete(userId);
  }

  async listUserIdsByRoles(roles: string[]) {
    const normalized = Array.isArray(roles)
      ? roles
          .map((r) => String(r || '').trim().toLowerCase())
          .filter(Boolean)
      : [];

    if (!normalized.length) return [];

    const items = await this.userModel
      .find({ role: { $in: normalized }, isActive: true })
      .select({ _id: 1 })
      .lean();

    return items.map((u: any) => u._id?.toString()).filter(Boolean);
  }
}
