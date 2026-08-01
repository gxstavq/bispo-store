export type SellableProductCategory = string;
export type ArchivedProductCategory = "camisetas" | "moletons" | "calcas-shorts";
export type ProductCategory = SellableProductCategory | ArchivedProductCategory;
export type ProductStatus = "active" | "inactive" | "draft" | "archived";
export type PackagingCategory = "caixa-tenis" | "pacote-roupa" | "caixa-conjunto" | "a-definir";

export interface Product {
  id: string;
  name: string;
  slug: string;
  code: string;
  category: ProductCategory;
  description: string;
  price: number;
  promotionalPrice?: number;
  images: string[];
  thumbnails?: string[];
  coverImage?: string;
  imageType?: "photo" | "placeholder";
  sizes: string[];
  colors: string[];
  stock: number;
  variants?: ProductVariant[];
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  packagingCategory?: PackagingCategory;
  shippingEnabled?: boolean;
  featured: boolean;
  isNew: boolean;
  active: boolean;
  status?: ProductStatus;
  needsReview?: boolean;
  imagesConfirmed?: boolean;
  archivedAt?: string;
  archiveReason?: string;
  demo: true;
  visual: {
    accent: string;
    secondary: string;
    type: "shoe" | "shirt" | "hoodie" | "bottom";
  };
}

export interface ProductVariant {
  id?: string;
  sku: string;
  size: string;
  color: string;
  stock: number;
  active: boolean;
}

export interface ProductCategoryRecord {
  id: string;
  slug: string;
  name: string;
  description?: string;
  imageUrl?: string;
  active: boolean;
  sortOrder: number;
  productCount?: number;
}

export interface HomeBannerSettings {
  desktopImageUrl: string;
  mobileImageUrl?: string;
  altText: string;
  title?: string;
  link?: string;
  active: boolean;
}

export interface CartItem {
  productId: string;
  size: string;
  color: string;
  quantity: number;
  productName?: string;
  productCode?: string;
  unitPrice?: number;
}

export type DeliveryChoice = "local_delivery_review" | "shipping_quote";

export type OrderStatus =
  | "awaiting_local_delivery_review"
  | "local_delivery_approved"
  | "local_delivery_rejected"
  | "awaiting_shipping_selection"
  | "awaiting_payment"
  | "paid"
  | "preparing"
  | "shipped"
  | "delivered"
  | "cancelled";

export type LocalDeliveryReviewStatus = "not_requested" | "pending" | "approved" | "rejected";
export type PaymentStatus =
  | "not_generated"
  | "awaiting_payment"
  | "in_analysis"
  | "paid"
  | "declined"
  | "expired"
  | "cancelled";
export type ShippingStatus =
  | "awaiting_review"
  | "awaiting_selection"
  | "free_approved"
  | "selected"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface CheckoutData {
  fullName: string;
  whatsapp: string;
  email: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  reference: string;
  notes: string;
  deliveryChoice: DeliveryChoice;
  selectedShippingQuoteId?: string;
}

export interface ShippingQuote {
  id: string;
  carrier: string;
  serviceId: string;
  service: string;
  amount: number;
  deliveryDays: number;
  expiresAt: string;
}

export interface PaymentEventView {
  id: string;
  type?: string;
  status?: string;
  verified: boolean;
  date: string;
  error?: string;
}

export interface OrderPaymentView {
  checkoutId?: string;
  providerOrderId?: string;
  providerChargeId?: string;
  paymentUrl?: string;
  method?: string;
  providerStatus?: string;
  confirmedAt?: string;
  createdAt?: string;
  expiresAt?: string;
  events: PaymentEventView[];
}

export interface ShipmentLabelView {
  providerOrderId?: string;
  carrier?: string;
  service?: string;
  status: string;
  trackingCode?: string;
  printUrl?: string;
  lastError?: string;
}

export interface OrderHistoryEntry {
  date: string;
  label: string;
  actor?: string;
  note?: string;
}

export interface LocalDeliveryReview {
  status: LocalDeliveryReviewStatus;
  note?: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface StoreOrder {
  id: string;
  createdAt: string;
  createdAtIso?: string;
  customer: CheckoutData;
  items: CartItem[];
  subtotal: number;
  deliveryChoice: DeliveryChoice;
  shippingAmount: number | null;
  shippingStatus: ShippingStatus;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentReference?: string;
  payment?: OrderPaymentView;
  shippingQuote?: ShippingQuote;
  shipmentLabel?: ShipmentLabelView;
  localDeliveryReview: LocalDeliveryReview;
  reservation?: {
    status: "active" | "consumed" | "released" | "expired";
    quantity: number;
    expiresAt?: string;
  };
  history: OrderHistoryEntry[];
}

export interface StoreSettings {
  storeName: string;
  ownerName: string;
  originAddress: string;
  originPostalCode: string;
  whatsapp: string;
  commercialEmail: string;
  stateRegistration: string;
  economicActivityCode: string;
  fiscalNotes: string;
  originDistrict: string;
  originCity: string;
  originState: string;
  senderPhone: string;
  cnpjEnvVar: "STORE_CNPJ";
}
