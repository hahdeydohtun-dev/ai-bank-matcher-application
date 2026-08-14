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
          company_id: string
          created_at: string
          doc_date: string | null
          doc_number: string
          doc_type: string | null
          id: string
          import_batch_id: string | null
          match_group_id: string | null
          meta: Json
          party_name: string | null
          party_type: string | null
          reconciled_txn_id: string | null
          resolved_at: string | null
          resolved_by_email: string | null
          side: string
          status: string
        }
        Insert: {
          amount?: number
          balance?: number | null
          company_id: string
          created_at?: string
          doc_date?: string | null
          doc_number: string
          doc_type?: string | null
          id?: string
          import_batch_id?: string | null
          match_group_id?: string | null
          meta?: Json
          party_name?: string | null
          party_type?: string | null
          reconciled_txn_id?: string | null
          resolved_at?: string | null
          resolved_by_email?: string | null
          side?: string
          status?: string
        }
        Update: {
          amount?: number
          balance?: number | null
          company_id?: string
          created_at?: string
          doc_date?: string | null
          doc_number?: string
          doc_type?: string | null
          id?: string
          import_batch_id?: string | null
          match_group_id?: string | null
          meta?: Json
          party_name?: string | null
          party_type?: string | null
          reconciled_txn_id?: string | null
          resolved_at?: string | null
          resolved_by_email?: string | null
          side?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_records_company_id_fkey"
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
      bank_transactions: {
        Row: {
          ai_confidence: number | null
          amount: number
          balance: number | null
          bank_account_id: string
          category: string | null
          company_id: string
          created_at: string
          direction: string
          id: string
          import_batch_id: string | null
          manually_reconciled: boolean
          match_group_id: string | null
          meta: Json
          narration: string | null
          reconciled_record_id: string | null
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
          direction?: string
          id?: string
          import_batch_id?: string | null
          manually_reconciled?: boolean
          match_group_id?: string | null
          meta?: Json
          narration?: string | null
          reconciled_record_id?: string | null
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
          direction?: string
          id?: string
          import_batch_id?: string | null
          manually_reconciled?: boolean
          match_group_id?: string | null
          meta?: Json
          narration?: string | null
          reconciled_record_id?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_company_member: { Args: { _company_id: string }; Returns: boolean }
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
