import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'refresh_tokens', timestamps: false, autoIndex: true })
export class RefreshToken extends Document {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String })
  employeeId?: string;

  @Prop({ type: String, required: true, unique: true })
  tokenHash!: string;

  @Prop({ type: String, required: true, index: true })
  family!: string;

  @Prop({ type: Date, required: true, expires: 0 })
  expiresAt!: Date;

  @Prop({ type: Boolean, required: true, default: false, index: true })
  revoked!: boolean;

  @Prop({ type: Date })
  revokedAt?: Date;

  @Prop({ type: Date, required: true, default: () => new Date() })
  createdAt!: Date;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
RefreshTokenSchema.index({ userId: 1, revoked: 1, createdAt: -1 });
