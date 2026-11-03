export type Role = "super_admin" | "admin" | "treasurer" | "member";

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  role: Role;
  approved: boolean;
  member_id: string | null;
  created_at: string;
}

/** Row of the privacy-filtered `member_directory` view (masked fields come back null). */
export interface DirectoryMember {
  id: string;
  member_no: number;
  full_name: string;
  photo_path: string | null;
  profession: string | null;
  status: "active" | "inactive";
  joining_date: string | null;
  bio: string | null;
  birth_day: number | null;
  birth_month: number | null;
  birth_year: number | null;
  anniv_day: number | null;
  anniv_month: number | null;
  anniv_year: number | null;
  phone: string | null;
  email: string | null;
  is_public: boolean;
  user_id: string | null;
}

/** Full `members` row (admins and the member themself). */
export interface Member extends DirectoryMember {
  married: boolean | null;
  address: string | null;
  show_birthday: boolean;
  show_anniversary: boolean;
  show_phone: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Album {
  id: string;
  name: string;
  description: string | null;
  cover_photo_id: string | null;
  is_public: boolean;
  sort_order: number;
  created_at: string;
}

export interface Photo {
  id: string;
  album_id: string | null;
  event_id: string | null;
  media_type: "image" | "video" | "youtube";
  storage_path: string | null;
  thumb_path: string | null;
  original_path: string | null;
  video_url: string | null;
  caption: string | null;
  taken_on: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number;
  file_hash: string | null;
  file_name: string | null;
  mime_type: string | null;
  status: "pending" | "approved" | "hidden";
  is_public: boolean;
  uploaded_by: string | null;
  created_at: string;
  deleted_at: string | null;
}

export const EVENT_CATEGORIES = {
  yoga: { hi: "योग", en: "Yoga", emoji: "🧘" },
  meeting: { hi: "बैठक", en: "Community meeting", emoji: "🤝" },
  picnic: { hi: "पिकनिक", en: "Picnic", emoji: "🧺" },
  pool_party: { hi: "पूल पार्टी", en: "Pool party", emoji: "🏊" },
  festival: { hi: "त्योहार", en: "Festival", emoji: "🪔" },
  birthday: { hi: "जन्मदिन", en: "Birthday", emoji: "🎂" },
  anniversary: { hi: "सालगिरह", en: "Anniversary", emoji: "💐" },
  outing: { hi: "सैर", en: "Outing", emoji: "🚌" },
  other: { hi: "अन्य", en: "Other", emoji: "✨" },
} as const;
export type EventCategory = keyof typeof EVENT_CATEGORIES;

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  category: EventCategory;
  event_date: string; // YYYY-MM-DD (Asia/Kolkata calendar date)
  start_time: string | null; // HH:MM:SS
  end_time: string | null;
  venue: string | null;
  cover_path: string | null;
  organizer: string | null;
  registration_info: string | null;
  max_capacity: number | null;
  rsvp_enabled: boolean;
  instructions: string | null;
  status: "scheduled" | "cancelled" | "postponed";
  is_public: boolean;
  album_id: string | null;
  created_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  image_path: string | null;
  published_at: string;
  expires_at: string | null;
  priority: "normal" | "important" | "urgent";
  pinned: boolean;
  visibility: "public" | "members";
  require_read: boolean;
  created_by: string | null;
  created_at: string;
}

export interface ThemeSong {
  id: number;
  title: string;
  description: string | null;
  audio_path: string | null;
  artwork_path: string | null;
  lyrics: string | null;
  lrc: string | null;
  updated_at: string;
}

export type TxnKind = "contribution" | "other_income" | "expense" | "opening_balance";
export interface Txn {
  id: string;
  txn_no: number;
  kind: TxnKind;
  amount: number;
  txn_date: string;
  period_month: string | null;
  member_id: string | null;
  title: string | null;
  category: string | null;
  description: string | null;
  payment_method: "cash" | "upi" | "bank" | "cheque" | "other" | null;
  reference_no: string | null;
  paid_by: string | null;
  receipt_path: string | null;
  remarks: string | null;
  is_reversal: boolean;
  reverses_id: string | null;
  reversal_reason: string | null;
  source: "native" | "excel_import" | "salesforce_import";
  external_ref: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}
/** Row of the `fin_ledger` view. */
export interface LedgerRow extends Txn {
  signed_amount: number;
  is_reversed: boolean;
  member_name: string | null;
}

export interface SiteSettings {
  name_hi: string;
  name_en: string;
  family_hi: string;
  tagline: string;
  subtagline: string;
  message: string;
  intro: string;
  hero_path: string | null;
  group_photo_path: string | null;
  contact_phone: string;
  contact_email: string;
  address: string;
  session_time: string;
  whatsapp_group: string;
}

export interface Permissions {
  members_can_upload: boolean;
  photos_need_approval: boolean;
  keep_originals: boolean;
  uploads_per_hour: number;
  max_batch: number;
  max_image_mb: number;
  max_video_mb: number;
  finance_visible_to_members: boolean;
  members_edit_own_profile: boolean;
  allow_comments: boolean;
}

export interface HisaabSettings {
  legacy_url: string;
  legacy_name: string;
  currency: string;
}
