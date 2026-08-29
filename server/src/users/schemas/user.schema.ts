import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { User as IUser } from '@prolific/shared-types';

@Schema({ collection: 'users', timestamps: true, autoIndex: true })
export class User extends Document implements Omit<IUser, 'id' | 'createdAt' | 'updatedAt'> {
  @Prop({ type: String, unique: true, required: true, index: true, lowercase: true })
  email!: string;

  @Prop({ type: String, required: true })
  hashedPassword!: string;

  @Prop({ type: String, required: true })
  firstName!: string;

  @Prop({ type: String, required: true })
  lastName!: string;

  @Prop({ type: String })
  phone?: string;

  @Prop({
    type: {
      line1: { type: String },
      line2: { type: String },
      city: { type: String },
      state: { type: String },
      country: { type: String },
      postalCode: { type: String },
    },
    _id: false,
  })
  address?: IUser['address'];

  @Prop({
    type: {
      name: { type: String },
      phone: { type: String },
      relationship: { type: String },
    },
    _id: false,
  })
  emergencyContact?: IUser['emergencyContact'];

  @Prop({ type: String })
  avatarUrl?: string;

  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, required: true, default: false })
  isEmailVerified!: boolean;

  @Prop({ type: Date })
  emailVerifiedAt?: Date;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  @Prop({ type: Number, required: true, default: 0 })
  failedLoginAttempts!: number;

  @Prop({ type: Date })
  lockedUntil?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ email: 1 });
UserSchema.index({ isActive: 1 });
