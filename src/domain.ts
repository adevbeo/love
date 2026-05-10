export const HOME_FEATURE_ROUTES = [
  "journal",
  "mailbox",
  "memories",
  "map",
  "gallery",
  "promises",
  "daily",
  "capsule",
  "mood",
  "countdown",
  "voice",
  "random"
] as const;

export const ARTWORK_OPTION_IDS = [
  "window",
  "portrait",
  "sunset",
  "spark",
  "cafe",
  "flowers",
  "movie",
  "candles",
  "letter",
  "jar"
] as const;

export const SECRET_REACTION_IDS = ["miss", "hug", "proud", "cherish"] as const;
export const GALLERY_STAGE_VALUES = ["before", "after", "moment"] as const;

export const SUPPORTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const SUPPORTED_AUDIO_MIME_TYPES = [
  "audio/m4a",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg"
] as const;

export interface HomeFeature {
  label: string;
  subtitle: string;
  route: (typeof HOME_FEATURE_ROUTES)[number];
  icon: string;
}

export interface MoodOption {
  id: string;
  label: string;
  icon: string;
  score: number;
}

export interface SecretReaction {
  id: (typeof SECRET_REACTION_IDS)[number];
  label: string;
  icon: string;
}

export interface GalleryStageOption {
  label: string;
  value: (typeof GALLERY_STAGE_VALUES)[number];
}

export interface AppContentCatalog {
  people: string[];
  homeFeatures: HomeFeature[];
  artworkOptions: Array<(typeof ARTWORK_OPTION_IDS)[number]>;
  moodOptions: MoodOption[];
  secretReactions: SecretReaction[];
  galleryStageOptions: GalleryStageOption[];
  capsuleOptions: string[];
  dailyPrompts: string[];
}

export interface CoupleAccount {
  id: string;
  primaryEmail: string;
  secondaryEmail: string;
  label: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CoupleMember {
  id: string;
  coupleId: string;
  email: string;
  emailNormalized: string;
  displayName: string | null;
  passwordHash: string;
  requiresPasswordChange: boolean;
  status: string;
  passwordIssuedAt: string;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefreshTokenRecord {
  id: string;
  memberId: string;
  coupleId: string;
  jwtId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface SnapshotRecord {
  id: string;
  coupleId: string;
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  updatedByMemberId: string | null;
  content: Record<string, unknown>;
}

export interface AppContentRecord {
  id: string;
  version: number;
  status: string;
  content: AppContentCatalog;
  updatedAt: string;
  updatedBy: string;
}

export interface MediaAssetRecord {
  id: string;
  coupleId: string;
  uploadedByMemberId: string;
  kind: "image" | "audio";
  storageKey: string;
  publicUrl: string;
  contentType: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export interface EmailJobRecord {
  id: string;
  memberId: string | null;
  coupleId: string | null;
  recipientEmail: string;
  template: string;
  payload: Record<string, unknown>;
  status: "queued" | "sent" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_APP_CONTENT: AppContentCatalog = {
  people: ["Anh", "Em"],
  homeFeatures: [
    {
      label: "Nhat ky doi",
      subtitle: "Ghi lai dieu nho xinh",
      route: "journal",
      icon: "notebook-outline"
    },
    {
      label: "Hop thu",
      subtitle: "Nhung la thu tham kin",
      route: "mailbox",
      icon: "email-outline"
    },
    {
      label: "Ky niem",
      subtitle: "Luu lai nhung lan ben nhau",
      route: "memories",
      icon: "image-outline"
    },
    {
      label: "Tam trang",
      subtitle: "Hom nay hai dua thay sao",
      route: "mood",
      icon: "heart-outline"
    }
  ],
  artworkOptions: ["portrait", "sunset", "cafe", "candles", "spark", "flowers", "movie", "letter", "jar", "window"],
  moodOptions: [
    {
      id: "happy",
      label: "Vui ve",
      icon: "emoticon-happy-outline",
      score: 86
    },
    {
      id: "miss",
      label: "Nho nhau",
      icon: "heart-outline",
      score: 65
    }
  ],
  secretReactions: [
    {
      id: "miss",
      label: "Nho",
      icon: "heart-outline"
    },
    {
      id: "hug",
      label: "Om",
      icon: "hand-heart-outline"
    }
  ],
  galleryStageOptions: [
    {
      label: "Before",
      value: "before"
    },
    {
      label: "After",
      value: "after"
    },
    {
      label: "Khoanh khac",
      value: "moment"
    }
  ],
  capsuleOptions: ["1 thang", "6 thang", "1 nam", "Tuy chon"],
  dailyPrompts: [
    "Dieu gi khien ban thay biet on nguoi ay hom nay?",
    "Khoanh khac nao hom nay lam ban nghi den hai dua?"
  ]
};
