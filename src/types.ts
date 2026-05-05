export enum OrderStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  COMPLETED = 'completed'
}

export interface Order {
  id?: string;
  userId: string;
  customerEmail: string | null;
  customerName: string | null;
  name: string;
  phone: string;
  address: string;
  size: 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'XXXL';
  color: string;
  quantity: number;
  paymentProofUrl: string;
  status: OrderStatus;
  createdAt: any; // ServerTimestamp
  updatedAt: any; // ServerTimestamp
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}
