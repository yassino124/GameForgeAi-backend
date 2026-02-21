import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { CommonModule } from '../common/common.module';
import { User, UserSchema } from '../users/entities/user.entity';

@Module({
  imports: [
    CommonModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [AdminController, AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminModule {}
