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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      accounting_records: {
        Row: {
          amount: number
          balance: number | null
          bank_account_id: string | null
          company_id: string
          created_at: string
          data_set_id: string | null
          doc_date: string | null
          doc_number: string
          doc_type: string | null
          id: string
          import_batch_id: string | null
          match_group_id: string | null
          meta: Json
          party_name: string | null
          party_type: string | null
          period_end: string | null
          period_start: string | null
          reconciled_txn_id: string | null
          resolved_at: string | null
          resolved_by_email: string | null
          side: string
          status: string
        }
        Insert: {
          amount?: number
          balance?: number | null
          bank_account_id?: string | null
          company_id: string
          created_at?: string
          data_set_id?: string | null
          doc_date?: string | null
          doc_number: string
          doc_type?: string | null
          id?: string
          import_batch_id?: string | null
          match_group_id?: string | null
          meta?: Json
          party_name?: string | null
          party_type?: string | null
          period_end?: string | null
          period_start?: string | null
          reconciled_txn_id?: string | null
          resolved_at?: string | null
          resolved_by_email?: string | null
          side?: string
          status?: string
        }
        Update: {
          amount?: number
          balance?: number | null
          bank_account_id?: string | null
          company_id?: string
          created_at?: string
          data_set_id?: string | null
          doc_date?: string | null
          doc_number?: string
          doc_type?: string | null
          id?: string
          import_batch_id?: string | null
          match_group_id?: string | null
          meta?: Json
          party_name?: string | null
          party_type?: string | null
          period_end?: string | null
          period_start?: string | null
          reconciled_txn_id?: string | null
          resolved_at?: string | null
          resolved_by_email?: string | null
          side?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_records_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_records_data_set_id_fkey"
            columns: ["data_set_id"]
            isOneToOne: false
            referencedRelation: "data_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_account_companies: {
        Row: {
          bank_account_id: string
          company_id: string
          created_at: string
          id: string
        }
        Insert: {
          bank_account_id: string
          company_id: string
          created_at?: string
          id?: string
        }
        Update: {
          bank_account_id?: string
          company_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_account_companies_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_account_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_name: string | null
          account_number: string
          bank_name: string
          company_id: string | null
          created_at: string
          currency: string
          id: string
          opening_balance_date: string | null
          opening_balance_ledger: number
          opening_balance_statement: number
        }
        Insert: {
          account_name?: string | null
          account_number: string
          bank_name: string
          company_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          opening_balance_date?: string | null
          opening_balance_ledger?: number
          opening_balance_statement?: number
        }
        Update: {
          account_name?: string | null
          account_number?: string
          bank_name?: string
          company_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          opening_balance_date?: string | null
          opening_balance_ledger?: number
          opening_balance_statement?: number
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_api_connections: {
        Row: {
          api_key: string | null
          api_secret: string | null
          auth_type: string
          bank_account_id: string
          company_id: string
          created_at: string
          enabled: boolean
          endpoint_url: string
          extra_headers: Json
          id: string
          last_fetched_at: string | null
          provider_label: string | null
          updated_at: string
        }
        Insert: {
          api_key?: string | null
          api_secret?: string | null
          auth_type?: string
          bank_account_id: string
          company_id: string
          created_at?: string
          enabled?: boolean
          endpoint_url: string
          extra_headers?: Json
          id?: string
          last_fetched_at?: string | null
          provider_label?: string | null
          updated_at?: string
        }
        Update: {
          api_key?: string | null
          api_secret?: string | null
          auth_type?: string
          bank_account_id?: string
          company_id?: string
          created_at?: string
          enabled?: boolean
          endpoint_url?: string
          extra_headers?: Json
          id?: string
          last_fetched_at?: string | null
          provider_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_api_connections_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_api_connections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          ai_confidence: number | null
          amount: number
          balance: number | null
          bank_account_id: string
          category: string | null
          company_id: string
          created_at: string
          data_set_id: string | null
          direction: string
          id: string
          import_batch_id: string | null
          manually_reconciled: boolean
          match_group_id: string | null
          meta: Json
          narration: string | null
          period_end: string | null
          period_start: string | null
          reconciled_record_id: string | null
          rejection_reason: string | null
          resolved_at: string | null
          resolved_by_email: string | null
          status: string
          txn_date: string | null
          txn_ref: string
          value_date: string | null
        }
        Insert: {
          ai_confidence?: number | null
          amount?: number
          balance?: number | null
          bank_account_id: string
          category?: string | null
          company_id: string
          created_at?: string
          data_set_id?: string | null
          direction?: string
          id?: string
          import_batch_id?: string | null
          manually_reconciled?: boolean
          match_group_id?: string | null
          meta?: Json
          narration?: string | null
          period_end?: string | null
          period_start?: string | null
          reconciled_record_id?: string | null
          rejection_reason?: string | null
          resolved_at?: string | null
          resolved_by_email?: string | null
          status?: string
          txn_date?: string | null
          txn_ref: string
          value_date?: string | null
        }
        Update: {
          ai_confidence?: number | null
          amount?: number
          balance?: number | null
          bank_account_id?: string
          category?: string | null
          company_id?: string
          created_at?: string
          data_set_id?: string | null
          direction?: string
          id?: string
          import_batch_id?: string | null
          manually_reconciled?: boolean
          match_group_id?: string | null
          meta?: Json
          narration?: string | null
          period_end?: string | null
          period_start?: string | null
          reconciled_record_id?: string | null
          rejection_reason?: string | null
          resolved_at?: string | null
          resolved_by_email?: string | null
          status?: string
          txn_date?: string | null
          txn_ref?: string
          value_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_data_set_id_fkey"
            columns: ["data_set_id"]
            isOneToOne: false
            referencedRelation: "data_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_reconciled_record_id_fkey"
            columns: ["reconciled_record_id"]
            isOneToOne: false
            referencedRelation: "accounting_records"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          currency: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      company_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: string
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: string
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          aging_days: number
          auto_threshold: number
          bank_charge_auto_match: boolean
          bank_charge_keywords: string[]
          charge_tolerance: number
          company_id: string
          high_value_threshold: number
          review_threshold: number
          theme: string
          updated_at: string
          updated_by_email: string | null
        }
        Insert: {
          aging_days?: number
          auto_threshold?: number
          bank_charge_auto_match?: boolean
          bank_charge_keywords?: string[]
          charge_tolerance?: number
          company_id: string
          high_value_threshold?: number
          review_threshold?: number
          theme?: string
          updated_at?: string
          updated_by_email?: string | null
        }
        Update: {
          aging_days?: number
          auto_threshold?: number
          bank_charge_auto_match?: boolean
          bank_charge_keywords?: string[]
          charge_tolerance?: number
          company_id?: string
          high_value_threshold?: number
          review_threshold?: number
          theme?: string
          updated_at?: string
          updated_by_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      data_sets: {
        Row: {
          bank_account_id: string
          company_id: string
          created_at: string
          created_by_email: string | null
          id: string
          idempotency_key: string | null
          label: string
          period_end: string | null
          period_start: string | null
          row_count: number
          source: string
          upload_timestamp: string
        }
        Insert: {
          bank_account_id: string
          company_id: string
          created_at?: string
          created_by_email?: string | null
          id?: string
          idempotency_key?: string | null
          label: string
          period_end?: string | null
          period_start?: string | null
          row_count?: number
          source: string
          upload_timestamp?: string
        }
        Update: {
          bank_account_id?: string
          company_id?: string
          created_at?: string
          created_by_email?: string | null
          id?: string
          idempotency_key?: string | null
          label?: string
          period_end?: string | null
          period_start?: string | null
          row_count?: number
          source?: string
          upload_timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_sets_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_sets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_api_connections: {
        Row: {
          api_key: string | null
          api_secret: string | null
          auth_type: string
          bank_account_id: string
          company_id: string
          created_at: string
          enabled: boolean
          endpoint_url: string
          erp_system: string | null
          extra_headers: Json
          gl_account_code: string | null
          id: string
          last_fetched_at: string | null
          updated_at: string
        }
        Insert: {
          api_key?: string | null
          api_secret?: string | null
          auth_type?: string
          bank_account_id: string
          company_id: string
          created_at?: string
          enabled?: boolean
          endpoint_url: string
          erp_system?: string | null
          extra_headers?: Json
          gl_account_code?: string | null
          id?: string
          last_fetched_at?: string | null
          updated_at?: string
        }
        Update: {
          api_key?: string | null
          api_secret?: string | null
          auth_type?: string
          bank_account_id?: string
          company_id?: string
          created_at?: string
          enabled?: boolean
          endpoint_url?: string
          erp_system?: string | null
          extra_headers?: Json
          gl_account_code?: string | null
          id?: string
          last_fetched_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          bank_account_id: string | null
          company_id: string
          created_at: string
          created_by_email: string | null
          id: string
          label: string
          row_count: number
          source: string
          updated_at: string
        }
        Insert: {
          bank_account_id?: string | null
          company_id: string
          created_at?: string
          created_by_email?: string | null
          id?: string
          label: string
          row_count?: number
          source?: string
          updated_at?: string
        }
        Update: {
          bank_account_id?: string | null
          company_id?: string
          created_at?: string
          created_by_email?: string | null
          id?: string
          label?: string
          row_count?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_mapping_presets: {
        Row: {
          company_id: string
          created_at: string
          created_by_email: string | null
          id: string
          kind: string
          mapping: Json
          name: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by_email?: string | null
          id?: string
          kind?: string
          mapping?: Json
          name: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by_email?: string | null
          id?: string
          kind?: string
          mapping?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_mapping_presets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      match_decisions: {
        Row: {
          accepted: boolean
          accounting_record_id: string | null
          amount_score: number
          bank_transaction_id: string | null
          company_id: string
          confidence: number
          created_at: string
          date_score: number
          decided_by_email: string | null
          id: string
          party_score: number
          reference_score: number
          side_score: number
          source: string
        }
        Insert: {
          accepted: boolean
          accounting_record_id?: string | null
          amount_score?: number
          bank_transaction_id?: string | null
          company_id: string
          confidence?: number
          created_at?: string
          date_score?: number
          decided_by_email?: string | null
          id?: string
          party_score?: number
          reference_score?: number
          side_score?: number
          source?: string
        }
        Update: {
          accepted?: boolean
          accounting_record_id?: string | null
          amount_score?: number
          bank_transaction_id?: string | null
          company_id?: string
          confidence?: number
          created_at?: string
          date_score?: number
          decided_by_email?: string | null
          id?: string
          party_score?: number
          reference_score?: number
          side_score?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_decisions_accounting_record_id_fkey"
            columns: ["accounting_record_id"]
            isOneToOne: false
            referencedRelation: "accounting_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_decisions_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_decisions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      match_groups: {
        Row: {
          accounting_record_ids: string[]
          bank_total: number
          bank_transaction_ids: string[]
          company_id: string
          created_at: string
          created_by_email: string | null
          difference: number
          id: string
          ledger_total: number
          note: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accounting_record_ids?: string[]
          bank_total?: number
          bank_transaction_ids?: string[]
          company_id: string
          created_at?: string
          created_by_email?: string | null
          difference?: number
          id?: string
          ledger_total?: number
          note?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accounting_record_ids?: string[]
          bank_total?: number
          bank_transaction_ids?: string[]
          company_id?: string
          created_at?: string
          created_by_email?: string | null
          difference?: number
          id?: string
          ledger_total?: number
          note?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      match_suggestions: {
        Row: {
          accounting_record_id: string | null
          amount_score: number
          bank_transaction_id: string
          company_id: string
          confidence: number
          created_at: string
          date_score: number
          id: string
          party_score: number
          reference_score: number
          rejection_reason: string | null
          side_score: number
          status: string
        }
        Insert: {
          accounting_record_id?: string | null
          amount_score?: number
          bank_transaction_id: string
          company_id: string
          confidence?: number
          created_at?: string
          date_score?: number
          id?: string
          party_score?: number
          reference_score?: number
          rejection_reason?: string | null
          side_score?: number
          status?: string
        }
        Update: {
          accounting_record_id?: string | null
          amount_score?: number
          bank_transaction_id?: string
          company_id?: string
          confidence?: number
          created_at?: string
          date_score?: number
          id?: string
          party_score?: number
          reference_score?: number
          rejection_reason?: string | null
          side_score?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_suggestions_accounting_record_id_fkey"
            columns: ["accounting_record_id"]
            isOneToOne: false
            referencedRelation: "accounting_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_suggestions_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: true
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_suggestions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      matching_weights: {
        Row: {
          amount_weight: number
          company_id: string
          date_weight: number
          party_weight: number
          recalibrated_at: string
          reference_weight: number
          sample_size: number
          side_weight: number
          suggested_auto_threshold: number | null
          suggested_review_threshold: number | null
        }
        Insert: {
          amount_weight?: number
          company_id: string
          date_weight?: number
          party_weight?: number
          recalibrated_at?: string
          reference_weight?: number
          sample_size?: number
          side_weight?: number
          suggested_auto_threshold?: number | null
          suggested_review_threshold?: number | null
        }
        Update: {
          amount_weight?: number
          company_id?: string
          date_weight?: number
          party_weight?: number
          recalibrated_at?: string
          reference_weight?: number
          sample_size?: number
          side_weight?: number
          suggested_auto_threshold?: number | null
          suggested_review_threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "matching_weights_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      open_items: {
        Row: {
          amount: number
          as_at_date: string
          bank_account_id: string
          company_id: string
          created_at: string
          direction: string
          doc_ref: string | null
          id: string
          meta: Json
          narration: string | null
          party_name: string | null
          source: string
          status: string
        }
        Insert: {
          amount?: number
          as_at_date: string
          bank_account_id: string
          company_id: string
          created_at?: string
          direction?: string
          doc_ref?: string | null
          id?: string
          meta?: Json
          narration?: string | null
          party_name?: string | null
          source: string
          status?: string
        }
        Update: {
          amount?: number
          as_at_date?: string
          bank_account_id?: string
          company_id?: string
          created_at?: string
          direction?: string
          doc_ref?: string | null
          id?: string
          meta?: Json
          narration?: string | null
          party_name?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_items_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_company_invite: { Args: { _token: string }; Returns: string }
      create_company_with_owner: {
        Args: { _currency?: string; _name: string }
        Returns: string
      }
      has_bank_account_access: {
        Args: { _bank_account_id: string }
        Returns: boolean
      }
      is_company_member: { Args: { _company_id: string }; Returns: boolean }
      set_company_member_role: {
        Args: { _member_id: string; _role: string }
        Returns: undefined
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
