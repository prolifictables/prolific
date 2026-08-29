import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { Restaurant as IRestaurant } from '@prolific/shared-types';

@Schema({ collection: 'restaurants', timestamps: true, autoIndex: true })
export class Restaurant
  extends Document
  implements Omit<IRestaurant, 'id' | 'createdAt' | 'updatedAt'>
{
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String })
  legalName?: string;

  @Prop({ type: String })
  logoUrl?: string;

  @Prop({ type: String })
  bannerUrl?: string;

  @Prop({ type: String, required: true })
  address!: string;

  @Prop({ type: String, required: true })
  city!: string;

  @Prop({ type: String, required: true })
  country!: string;

  @Prop({ type: String, required: true })
  phone!: string;

  @Prop({ type: String, required: true })
  email!: string;

  @Prop({ type: String, required: true, default: 'USD' })
  currency!: string;

  @Prop({ type: String, required: true, default: 'en-US' })
  locale!: string;

  @Prop({ type: String })
  taxId?: string;

  @Prop({ type: String })
  registrationNumber?: string;
}

export const RestaurantSchema = SchemaFactory.createForClass(Restaurant);
