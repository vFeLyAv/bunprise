export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_feeds: {
        Row: {
          created_at: string
          lang: string
          last_fetched_at: string | null
          profile_id: string
          token_hash: string
          window_count: number
          window_start: string | null
        }
        Insert: {
          created_at?: string
          lang: string
          last_fetched_at?: string | null
          profile_id: string
          token_hash: string
          window_count?: number
          window_start?: string | null
        }
        Update: {
          created_at?: string
          lang?: string
          last_fetched_at?: string | null
          profile_id?: string
          token_hash?: string
          window_count?: number
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feeds_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          accepted_at: string
          kind: string
          locale: string
          profile_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          kind: string
          locale: string
          profile_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          kind?: string
          locale?: string
          profile_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_cooldowns: {
        Row: {
          followee_id: string
          follower_id: string
          until: string
        }
        Insert: {
          followee_id: string
          follower_id: string
          until: string
        }
        Update: {
          followee_id?: string
          follower_id?: string
          until?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_cooldowns_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_cooldowns_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_links: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          owner_id: string
          revoked_at: string | null
          token_hash: string
          use_count: number
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          owner_id: string
          revoked_at?: string | null
          token_hash: string
          use_count?: number
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          owner_id?: string
          revoked_at?: string | null
          token_hash?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "follow_links_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          accepted_at: string | null
          expires_at: string | null
          followee_id: string
          follower_id: string
          requested_at: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          expires_at?: string | null
          followee_id: string
          follower_id: string
          requested_at?: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          expires_at?: string | null
          followee_id?: string
          follower_id?: string
          requested_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friend_code_misses: {
        Row: {
          missed_at: string
          profile_id: string
        }
        Insert: {
          missed_at?: string
          profile_id: string
        }
        Update: {
          missed_at?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_code_misses_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friend_codes: {
        Row: {
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          owner_id: string
          revoked_at: string | null
          use_count: number
        }
        Insert: {
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          owner_id: string
          revoked_at?: string | null
          use_count?: number
        }
        Update: {
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          owner_id?: string
          revoked_at?: string | null
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "friend_codes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation_attempts: {
        Row: {
          attempted_at: string
          sender_id: string
        }
        Insert: {
          attempted_at?: string
          sender_id: string
        }
        Update: {
          attempted_at?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitation_attempts_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation_cooldowns: {
        Row: {
          invitee_id: string
          inviter_id: string
          until: string
        }
        Insert: {
          invitee_id: string
          inviter_id: string
          until: string
        }
        Update: {
          invitee_id?: string
          inviter_id?: string
          until?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitation_cooldowns_invitee_id_fkey"
            columns: ["invitee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_cooldowns_inviter_id_fkey"
            columns: ["inviter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          max_uses: number
          occasion_id: string
          revoked_at: string | null
          token_hash: string
          use_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          max_uses?: number
          occasion_id: string
          revoked_at?: string | null
          token_hash: string
          use_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          max_uses?: number
          occasion_id?: string
          revoked_at?: string | null
          token_hash?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_occasion_id_fkey"
            columns: ["occasion_id"]
            isOneToOne: false
            referencedRelation: "occasions"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_versions: {
        Row: {
          kind: string
          published_at: string
          version: string
        }
        Insert: {
          kind: string
          published_at?: string
          version: string
        }
        Update: {
          kind?: string
          published_at?: string
          version?: string
        }
        Relationships: []
      }
      list_photos: {
        Row: {
          bytes: string
          height: number
          mime: string
          updated_at: string
          updated_by: string
          width: number
          wishlist_id: string
        }
        Insert: {
          bytes: string
          height: number
          mime: string
          updated_at?: string
          updated_by: string
          width: number
          wishlist_id: string
        }
        Update: {
          bytes?: string
          height?: number
          mime?: string
          updated_at?: string
          updated_by?: string
          width?: number
          wishlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_photos_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_photos_wishlist_id_fkey"
            columns: ["wishlist_id"]
            isOneToOne: true
            referencedRelation: "wishlists"
            referencedColumns: ["id"]
          },
        ]
      }
      member_invited_by: {
        Row: {
          inviter_id: string
          occasion_id: string
          profile_id: string
        }
        Insert: {
          inviter_id: string
          occasion_id: string
          profile_id: string
        }
        Update: {
          inviter_id?: string
          occasion_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_invited_by_inviter_id_fkey"
            columns: ["inviter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_invited_by_occasion_id_profile_id_fkey"
            columns: ["occasion_id", "profile_id"]
            isOneToOne: true
            referencedRelation: "occasion_members"
            referencedColumns: ["occasion_id", "profile_id"]
          },
        ]
      }
      occasion_addresses: {
        Row: {
          address: string
          occasion_id: string
          updated_at: string
        }
        Insert: {
          address: string
          occasion_id: string
          updated_at?: string
        }
        Update: {
          address?: string
          occasion_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "occasion_addresses_occasion_id_fkey"
            columns: ["occasion_id"]
            isOneToOne: true
            referencedRelation: "occasions"
            referencedColumns: ["id"]
          },
        ]
      }
      occasion_invitations: {
        Row: {
          created_at: string
          decided_at: string | null
          delivered: boolean
          expires_at: string
          id: string
          invitee_id: string
          inviter_id: string
          live: boolean
          occasion_id: string
          outcome: string
          withdrawn_at: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          delivered: boolean
          expires_at: string
          id?: string
          invitee_id: string
          inviter_id: string
          live?: boolean
          occasion_id: string
          outcome?: string
          withdrawn_at?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          delivered?: boolean
          expires_at?: string
          id?: string
          invitee_id?: string
          inviter_id?: string
          live?: boolean
          occasion_id?: string
          outcome?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "occasion_invitations_invitee_id_fkey"
            columns: ["invitee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occasion_invitations_inviter_id_fkey"
            columns: ["inviter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occasion_invitations_occasion_id_fkey"
            columns: ["occasion_id"]
            isOneToOne: false
            referencedRelation: "occasions"
            referencedColumns: ["id"]
          },
        ]
      }
      occasion_invite_refusals: {
        Row: {
          created_at: string
          invitee_id: string
          occasion_id: string
          occasion_title: string
        }
        Insert: {
          created_at?: string
          invitee_id: string
          occasion_id: string
          occasion_title: string
        }
        Update: {
          created_at?: string
          invitee_id?: string
          occasion_id?: string
          occasion_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "occasion_invite_refusals_invitee_id_fkey"
            columns: ["invitee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occasion_invite_refusals_occasion_id_fkey"
            columns: ["occasion_id"]
            isOneToOne: false
            referencedRelation: "occasions"
            referencedColumns: ["id"]
          },
        ]
      }
      occasion_members: {
        Row: {
          invited_via: string | null
          joined_at: string
          occasion_id: string
          profile_id: string
          role: string
          rsvp: string
          status: string
          updated_at: string
        }
        Insert: {
          invited_via?: string | null
          joined_at?: string
          occasion_id: string
          profile_id: string
          role?: string
          rsvp?: string
          status?: string
          updated_at?: string
        }
        Update: {
          invited_via?: string | null
          joined_at?: string
          occasion_id?: string
          profile_id?: string
          role?: string
          rsvp?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "occasion_members_invited_via_fkey"
            columns: ["invited_via"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occasion_members_occasion_id_fkey"
            columns: ["occasion_id"]
            isOneToOne: false
            referencedRelation: "occasions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occasion_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      occasion_photos: {
        Row: {
          bytes: string
          height: number
          mime: string
          occasion_id: string
          updated_at: string
          updated_by: string
          width: number
        }
        Insert: {
          bytes: string
          height: number
          mime: string
          occasion_id: string
          updated_at?: string
          updated_by: string
          width: number
        }
        Update: {
          bytes?: string
          height?: number
          mime?: string
          occasion_id?: string
          updated_at?: string
          updated_by?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "occasion_photos_occasion_id_fkey"
            columns: ["occasion_id"]
            isOneToOne: true
            referencedRelation: "occasions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occasion_photos_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      occasions: {
        Row: {
          all_day: boolean
          cancelled_at: string | null
          cover_theme: string | null
          created_at: string
          description: string | null
          ends_at: string | null
          guests_can_invite: boolean
          host_id: string
          id: string
          place_lat: number | null
          place_lon: number | null
          place_text: string | null
          sections: string
          starts_at: string
          title: string
          tz: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          cancelled_at?: string | null
          cover_theme?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          guests_can_invite?: boolean
          host_id: string
          id?: string
          place_lat?: number | null
          place_lon?: number | null
          place_text?: string | null
          sections?: string
          starts_at: string
          title: string
          tz?: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          cancelled_at?: string | null
          cover_theme?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          guests_can_invite?: boolean
          host_id?: string
          id?: string
          place_lat?: number | null
          place_lon?: number | null
          place_text?: string | null
          sections?: string
          starts_at?: string
          title?: string
          tz?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "occasions_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      potluck_items: {
        Row: {
          claimed_by: string | null
          created_at: string
          created_by: string
          id: string
          occasion_id: string
          title: string
        }
        Insert: {
          claimed_by?: string | null
          created_at?: string
          created_by: string
          id?: string
          occasion_id: string
          title: string
        }
        Update: {
          claimed_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          occasion_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "potluck_items_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "potluck_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "potluck_items_occasion_id_fkey"
            columns: ["occasion_id"]
            isOneToOne: false
            referencedRelation: "occasions"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_photos: {
        Row: {
          bytes: string
          height: number
          kind: string
          mime: string
          profile_id: string
          updated_at: string
          width: number
        }
        Insert: {
          bytes: string
          height: number
          kind: string
          mime: string
          profile_id: string
          updated_at?: string
          width: number
        }
        Update: {
          bytes?: string
          height?: number
          kind?: string
          mime?: string
          profile_id?: string
          updated_at?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_photos_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          banner: string | null
          created_at: string
          display_name: string | null
          id: string
          in_suggestions: boolean
          invitations_from: string
          locale: string
          onboarding_done_at: string | null
          updated_at: string
        }
        Insert: {
          banner?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          in_suggestions?: boolean
          invitations_from?: string
          locale?: string
          onboarding_done_at?: string | null
          updated_at?: string
        }
        Update: {
          banner?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          in_suggestions?: boolean
          invitations_from?: string
          locale?: string
          onboarding_done_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_preferences: {
        Row: {
          invitations: boolean
          profile_id: string
          updated_at: string
        }
        Insert: {
          invitations?: boolean
          profile_id: string
          updated_at?: string
        }
        Update: {
          invitations?: boolean
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          consent: string
          consented_at: string
          created_at: string
          endpoint: string
          id: string
          lang: string
          p256dh: string
          profile_id: string
          session_id: string
        }
        Insert: {
          auth: string
          consent: string
          consented_at?: string
          created_at?: string
          endpoint: string
          id?: string
          lang: string
          p256dh: string
          profile_id: string
          session_id: string
        }
        Update: {
          auth?: string
          consent?: string
          consented_at?: string
          created_at?: string
          endpoint?: string
          id?: string
          lang?: string
          p256dh?: string
          profile_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          handled_at: string | null
          id: string
          outcome: string | null
          reason: string
          reporter_id: string
          target_id: string
          target_kind: string
        }
        Insert: {
          created_at?: string
          handled_at?: string | null
          id?: string
          outcome?: string | null
          reason: string
          reporter_id: string
          target_id: string
          target_kind: string
        }
        Update: {
          created_at?: string
          handled_at?: string | null
          id?: string
          outcome?: string | null
          reason?: string
          reporter_id?: string
          target_id?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          created_at: string
          end_reason: string | null
          ended_at: string | null
          id: string
          recipient_id: string
          reserver_id: string
          status: string
          wish_id: string | null
          wish_title_snapshot: string
          wishlist_id: string | null
        }
        Insert: {
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          recipient_id: string
          reserver_id: string
          status?: string
          wish_id?: string | null
          wish_title_snapshot: string
          wishlist_id?: string | null
        }
        Update: {
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          recipient_id?: string
          reserver_id?: string
          status?: string
          wish_id?: string | null
          wish_title_snapshot?: string
          wishlist_id?: string | null
        }
        Relationships: []
      }
      wish_photos: {
        Row: {
          bytes: string
          height: number
          mime: string
          updated_at: string
          updated_by: string
          width: number
          wish_id: string
        }
        Insert: {
          bytes: string
          height: number
          mime: string
          updated_at?: string
          updated_by: string
          width: number
          wish_id: string
        }
        Update: {
          bytes?: string
          height?: number
          mime?: string
          updated_at?: string
          updated_by?: string
          width?: number
          wish_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wish_photos_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wish_photos_wish_id_fkey"
            columns: ["wish_id"]
            isOneToOne: true
            referencedRelation: "wishes"
            referencedColumns: ["id"]
          },
        ]
      }
      wishes: {
        Row: {
          brand: string | null
          color: string | null
          created_at: string
          currency: string
          description: string | null
          gtin: string | null
          id: string
          note: string | null
          price_cents: number | null
          priority: number
          quantity: number
          received_at: string | null
          shop_name: string | null
          title: string
          updated_at: string
          url: string | null
          wishlist_id: string
        }
        Insert: {
          brand?: string | null
          color?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          gtin?: string | null
          id?: string
          note?: string | null
          price_cents?: number | null
          priority?: number
          quantity?: number
          received_at?: string | null
          shop_name?: string | null
          title: string
          updated_at?: string
          url?: string | null
          wishlist_id: string
        }
        Update: {
          brand?: string | null
          color?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          gtin?: string | null
          id?: string
          note?: string | null
          price_cents?: number | null
          priority?: number
          quantity?: number
          received_at?: string | null
          shop_name?: string | null
          title?: string
          updated_at?: string
          url?: string | null
          wishlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishes_wishlist_id_fkey"
            columns: ["wishlist_id"]
            isOneToOne: false
            referencedRelation: "wishlists"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlists: {
        Row: {
          cover_icon: string | null
          cover_tone: number | null
          created_at: string
          due_on: string | null
          id: string
          occasion_id: string | null
          owner_id: string
          recipient_id: string
          title: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          cover_icon?: string | null
          cover_tone?: number | null
          created_at?: string
          due_on?: string | null
          id?: string
          occasion_id?: string | null
          owner_id: string
          recipient_id: string
          title?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          cover_icon?: string | null
          cover_tone?: number | null
          created_at?: string
          due_on?: string | null
          id?: string
          occasion_id?: string | null
          owner_id?: string
          recipient_id?: string
          title?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlists_occasion_id_fkey"
            columns: ["occasion_id"]
            isOneToOne: false
            referencedRelation: "occasions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlists_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlists_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: Json }
      add_potluck_item: {
        Args: { p_claim?: boolean; p_occasion_id: string; p_title: string }
        Returns: Json
      }
      add_wishes_to_list: {
        Args: { p_list_id: string; p_wish_ids: string[] }
        Returns: Json
      }
      block_user: { Args: { p_profile_id: string }; Returns: Json }
      calendar_feed: { Args: { p_token: string }; Returns: Json }
      cancel_reservation: { Args: { p_wish_id: string }; Returns: Json }
      claim_potluck_item: { Args: { p_item_id: string }; Returns: Json }
      create_calendar_feed: { Args: { p_lang: string }; Returns: Json }
      create_follow_link: { Args: never; Returns: Json }
      create_friend_code: { Args: { p_replace: boolean }; Returns: Json }
      create_invite: { Args: { p_occasion_id: string }; Returns: Json }
      delete_my_account: { Args: never; Returns: Json }
      delete_potluck_item: { Args: { p_item_id: string }; Returns: Json }
      delete_wish_everywhere: { Args: { p_wish_id: string }; Returns: Json }
      dismiss_received_prompt: {
        Args: { p_occasion_id: string }
        Returns: Json
      }
      export_my_calendar_feed: { Args: never; Returns: Json }
      export_my_data: { Args: never; Returns: Json }
      export_my_invitations: { Args: never; Returns: Json }
      export_my_list_photos: { Args: never; Returns: Json }
      export_my_occasion_photos: { Args: never; Returns: Json }
      export_my_potluck: { Args: never; Returns: Json }
      export_my_profile_photos: { Args: never; Returns: Json }
      export_my_push: { Args: never; Returns: Json }
      export_my_wish_photos: { Args: never; Returns: Json }
      get_anniversary_suggestions: { Args: never; Returns: Json }
      get_calendar_feed: { Args: never; Returns: Json }
      get_feed: { Args: never; Returns: Json }
      get_free_wishes: {
        Args: { p_max_cents?: number; p_profile_id: string }
        Returns: Json
      }
      get_invite_candidates: { Args: { p_occasion_id: string }; Returns: Json }
      get_list_photo: { Args: { p_list_id: string }; Returns: Json }
      get_list_screen: { Args: { p_list_id: string }; Returns: Json }
      get_lists_overview: { Args: never; Returns: Json }
      get_me: { Args: never; Returns: Json }
      get_my_invitations: { Args: never; Returns: Json }
      get_occasion_invite_info: {
        Args: { p_occasion_id: string }
        Returns: Json
      }
      get_occasion_photo: { Args: { p_occasion_id: string }; Returns: Json }
      get_occasion_screen: { Args: { p_occasion_id: string }; Returns: Json }
      get_people_screen: { Args: never; Returns: Json }
      get_profile_card: { Args: { p_profile_id: string }; Returns: Json }
      get_profile_photo: {
        Args: { p_kind: string; p_profile_id: string }
        Returns: Json
      }
      get_push_settings: { Args: { p_endpoint: string }; Returns: Json }
      get_sent_invitations: { Args: { p_occasion_id: string }; Returns: Json }
      get_wish_photo: { Args: { p_wish_id: string }; Returns: Json }
      leave_occasion: { Args: { p_occasion_id: string }; Returns: Json }
      move_wish: {
        Args: { p_target_list_id: string; p_wish_id: string }
        Returns: Json
      }
      my_reservations: { Args: never; Returns: Json }
      peek_follow_link: { Args: { p_token: string }; Returns: Json }
      peek_friend_code: { Args: { p_code: string }; Returns: Json }
      push_subscribe: {
        Args: {
          p_auth: string
          p_consent: string
          p_endpoint: string
          p_lang: string
          p_p256dh: string
        }
        Returns: Json
      }
      push_unsubscribe: { Args: { p_endpoint: string }; Returns: Json }
      remove_follower: { Args: { p_profile_id: string }; Returns: Json }
      remove_list_photo: { Args: { p_list_id: string }; Returns: Json }
      remove_member: {
        Args: { p_occasion_id: string; p_profile_id: string }
        Returns: Json
      }
      remove_occasion_photo: { Args: { p_occasion_id: string }; Returns: Json }
      remove_profile_photo: { Args: { p_kind: string }; Returns: Json }
      remove_wish_from_list: {
        Args: { p_list_id: string; p_wish_id: string }
        Returns: Json
      }
      remove_wish_photo: { Args: { p_wish_id: string }; Returns: Json }
      rename_potluck_item: {
        Args: { p_item_id: string; p_title: string }
        Returns: Json
      }
      request_follow: { Args: { p_profile_id: string }; Returns: Json }
      request_follow_via_code: { Args: { p_code: string }; Returns: Json }
      request_follow_via_link: { Args: { p_token: string }; Returns: Json }
      reserve_together: {
        Args: { p_wish_id: string; p_with_ids: string[] }
        Returns: Json
      }
      reserve_wish: { Args: { p_wish_id: string }; Returns: Json }
      respond_follow: {
        Args: { p_accept: boolean; p_profile_id: string }
        Returns: Json
      }
      respond_occasion_invite: {
        Args: { p_accept: boolean; p_invitation_id: string }
        Returns: Json
      }
      revoke_calendar_feed: { Args: never; Returns: Json }
      revoke_follow_links: { Args: never; Returns: Json }
      revoke_friend_codes: { Args: never; Returns: Json }
      send_occasion_invites: {
        Args: { p_occasion_id: string; p_profile_ids: string[] }
        Returns: Json
      }
      set_list_photo: {
        Args: {
          p_data_base64: string
          p_height: number
          p_list_id: string
          p_mime: string
          p_width: number
        }
        Returns: Json
      }
      set_list_visibility: {
        Args: { p_list_id: string; p_visibility: string }
        Returns: Json
      }
      set_occasion_photo: {
        Args: {
          p_data_base64: string
          p_height: number
          p_mime: string
          p_occasion_id: string
          p_width: number
        }
        Returns: Json
      }
      set_profile_photo: {
        Args: {
          p_data_base64: string
          p_height: number
          p_kind: string
          p_mime: string
          p_width: number
        }
        Returns: Json
      }
      set_push_settings: { Args: { p_invitations: boolean }; Returns: Json }
      set_wish_links: {
        Args: { p_linked_ids: string[]; p_wish_id: string }
        Returns: Json
      }
      set_wish_photo: {
        Args: {
          p_data_base64: string
          p_height: number
          p_mime: string
          p_width: number
          p_wish_id: string
        }
        Returns: Json
      }
      set_wish_received: {
        Args: { p_received: boolean; p_wish_id: string }
        Returns: Json
      }
      unblock_user: { Args: { p_profile_id: string }; Returns: Json }
      unclaim_potluck_item: { Args: { p_item_id: string }; Returns: Json }
      unfollow: { Args: { p_profile_id: string }; Returns: Json }
      withdraw_occasion_invite: {
        Args: { p_occasion_id: string; p_profile_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
