import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Inline enum values for DeviceType and DeviceStatus per user spec:
//   DeviceType:  POS_TERMINAL | KITCHEN_DISPLAY | CUSTOMER_DISPLAY |
//                TABLET | SELF_SERVICE_KIOSK
//   DeviceStatus: ACTIVE | INACTIVE | MAINTENANCE (default ACTIVE)
// ---------------------------------------------------------------------------

const DeviceType = [
  'POS_TERMINAL',
  'KITCHEN_DISPLAY',
  'CUSTOMER_DISPLAY',
  'TABLET',
  'SELF_SERVICE_KIOSK',
] as const;

const DeviceStatus = [
  'ACTIVE',
  'INACTIVE',
  'MAINTENANCE',
] as const;

// ---------------------------------------------------------------------------
// Main document: Device
// Represents a physical or logical POS/KDS device within a branch, including
// authentication keys (deviceKey), connection state, and display configuration
// ---------------------------------------------------------------------------

@Schema({ collection: 'devices', timestamps: true, autoIndex: true })
export class Device
  extends Document
  implements
    Omit<
      S.Device,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'type'
      | 'hardwareId'
      | 'terminalNumber'
      | 'lastConnectedAt'
      | 'lastSyncAt'
      | 'currentSyncStatus'
      | 'isActive'
    >
{
  // Tenant / location identifiers
  @Prop({ type: String, required: true })
  restaurantId!: string;

  @Prop({ type: String, required: true })
  branchId!: string;

  // Human-readable name (e.g. "Front Counter 1", "Kitchen #2")
  @Prop({ type: String, required: true })
  name!: string;

  // Hardware/role classification of this device
  @Prop({
    type: String,
    required: true,
    enum: DeviceType,
  })
  deviceType!:
    | 'POS_TERMINAL'
    | 'KITCHEN_DISPLAY'
    | 'CUSTOMER_DISPLAY'
    | 'TABLET'
    | 'SELF_SERVICE_KIOSK';

  // Operational status (default: ACTIVE)
  @Prop({
    type: String,
    required: true,
    enum: DeviceStatus,
    default: 'ACTIVE',
    index: true,
  })
  status!: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';

  // Secret key used by POS terminals to authenticate registration / tokens
  // Must be globally unique across the entire system
  @Prop({ type: String, unique: true })
  deviceKey?: string;

  // Hardware identifier (MAC address, motherboard serial, etc.) — used for
  // automatic re-authentication when the same device comes back online
  @Prop({ type: String, sparse: true, unique: true })
  hardwareId?: string;

  // Live socket.io session id for realtime push to this device
  @Prop({ type: String })
  socketId?: string;

  // Connection / health timestamps
  @Prop({ type: Date, index: true })
  lastSeenAt?: Date;

  // Last known IP address for audit / debugging
  @Prop({ type: String })
  lastIpAddress?: string;

  // Free-form location within the venue (e.g. "Front Counter", "Bar")
  @Prop({ type: String })
  location?: string;

  // For device health / compatibility checks — semver of the POS client app
  @Prop({ type: String })
  installedAppVersion?: string;

  // Multi-monitor ordering: lower index = leftmost / primary
  @Prop({ type: Number })
  displayIndex?: number;

  // Whether this device is the "main" one at its station (for UX defaults)
  @Prop({ type: Boolean, default: false })
  isPrimary?: boolean;
}

export const DeviceSchema = SchemaFactory.createForClass(Device);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Globally unique deviceKey for auth / registration lookups
DeviceSchema.index({ deviceKey: 1 }, { unique: true });

// List all devices in a branch filtered by status (common dashboard query)
DeviceSchema.index({ branchId: 1, status: 1 });
