export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      project_assignments: {
        Row: {
          assigned_at: string;
          assigned_by: string;
          id: string;
          is_active: boolean;
          project_id: string;
          user_id: string;
        };
        Insert: {
          assigned_at?: string;
          assigned_by?: string;
          id?: string;
          is_active?: boolean;
          project_id: string;
          user_id: string;
        };
        Update: {
          assigned_at?: string;
          assigned_by?: string;
          id?: string;
          is_active?: boolean;
          project_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_assignments_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_assignment_audit_log: {
        Row: {
          action: string;
          assignment_id: string;
          changed_at: string;
          changed_by: string;
          id: string;
          new_values: Json;
          old_values: Json | null;
        };
        Insert: {
          action: string;
          assignment_id: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values: Json;
          old_values?: Json | null;
        };
        Update: {
          action?: string;
          assignment_id?: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values?: Json;
          old_values?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "project_assignment_audit_log_assignment_id_fkey";
            columns: ["assignment_id"];
            isOneToOne: false;
            referencedRelation: "project_assignments";
            referencedColumns: ["id"];
          },
        ];
      };
      user_role_audit_log: {
        Row: {
          action: string;
          changed_at: string;
          changed_by: string | null;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          action: string;
          changed_at?: string;
          changed_by?: string | null;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          action?: string;
          changed_at?: string;
          changed_by?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      financial_accounts: {
        Row: {
          account_type: string;
          created_at: string;
          created_by: string;
          currency: string;
          id: string;
          name: string;
          notes: string;
          opening_balance: number;
          opening_balance_date: string;
          provider: string | null;
        };
        Insert: {
          account_type: string;
          created_at?: string;
          created_by?: string;
          currency: string;
          id?: string;
          name: string;
          notes: string;
          opening_balance?: number;
          opening_balance_date: string;
          provider?: string | null;
        };
        Update: {
          account_type?: string;
          created_at?: string;
          created_by?: string;
          currency?: string;
          id?: string;
          name?: string;
          notes?: string;
          opening_balance?: number;
          opening_balance_date?: string;
          provider?: string | null;
        };
        Relationships: [];
      };
      financial_audit_log: {
        Row: {
          action: string;
          changed_at: string;
          changed_by: string;
          id: string;
          new_values: Json;
          old_values: Json | null;
          reason: string;
          record_id: string;
          table_name: string;
        };
        Insert: {
          action: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values: Json;
          old_values?: Json | null;
          reason: string;
          record_id: string;
          table_name: string;
        };
        Update: {
          action?: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values?: Json;
          old_values?: Json | null;
          reason?: string;
          record_id?: string;
          table_name?: string;
        };
        Relationships: [];
      };
      financial_transactions: {
        Row: {
          account_id: string;
          amount: number;
          amount_ugx: number;
          category: string;
          cost_type: string | null;
          created_at: string;
          created_by: string;
          currency: string;
          description: string;
          direction: string;
          exchange_rate: number;
          exchange_rate_date: string;
          exchange_rate_source: string;
          id: string;
          payroll_run_id: string | null;
          reason: string;
          reference: string | null;
          project_id: string | null;
          transaction_date: string;
          transaction_type: string;
          transfer_to_account_id: string | null;
          transfer_to_amount: number | null;
          transfer_to_exchange_rate: number | null;
          transfer_to_exchange_rate_date: string | null;
          transfer_to_exchange_rate_source: string | null;
          counterparty: string | null;
        };
        Insert: {
          account_id: string;
          amount: number;
          category: string;
          cost_type?: string | null;
          created_at?: string;
          created_by?: string;
          currency: string;
          description: string;
          direction: string;
          exchange_rate: number;
          exchange_rate_date: string;
          exchange_rate_source: string;
          id?: string;
          payroll_run_id?: string | null;
          reason: string;
          reference?: string | null;
          project_id?: string | null;
          transaction_date: string;
          transaction_type: string;
          transfer_to_account_id?: string | null;
          transfer_to_amount?: number | null;
          transfer_to_exchange_rate?: number | null;
          transfer_to_exchange_rate_date?: string | null;
          transfer_to_exchange_rate_source?: string | null;
          counterparty?: string | null;
        };
        Update: {
          account_id?: string;
          amount?: number;
          category?: string;
          cost_type?: string | null;
          created_at?: string;
          created_by?: string;
          currency?: string;
          description?: string;
          direction?: string;
          exchange_rate?: number;
          exchange_rate_date?: string;
          exchange_rate_source?: string;
          id?: string;
          payroll_run_id?: string | null;
          reason?: string;
          reference?: string | null;
          project_id?: string | null;
          transaction_date?: string;
          transaction_type?: string;
          transfer_to_account_id?: string | null;
          transfer_to_amount?: number | null;
          transfer_to_exchange_rate?: number | null;
          transfer_to_exchange_rate_date?: string | null;
          transfer_to_exchange_rate_source?: string | null;
          counterparty?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "financial_transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "financial_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "financial_transactions_transfer_to_account_id_fkey";
            columns: ["transfer_to_account_id"];
            isOneToOne: false;
            referencedRelation: "financial_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      financial_reconciliations: {
        Row: {
          account_id: string;
          created_at: string;
          created_by: string;
          id: string;
          notes: string;
          period_end: string;
          period_start: string;
          reconciled_at: string | null;
          reconciled_by: string | null;
          statement_closing_balance: number;
          statement_opening_balance: number;
          status: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          notes: string;
          period_end: string;
          period_start: string;
          reconciled_at?: string | null;
          reconciled_by?: string | null;
          statement_closing_balance: number;
          statement_opening_balance: number;
          status?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          notes?: string;
          period_end?: string;
          period_start?: string;
          reconciled_at?: string | null;
          reconciled_by?: string | null;
          statement_closing_balance?: number;
          statement_opening_balance?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "financial_reconciliations_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "financial_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      financial_reconciliation_items: {
        Row: {
          id: string;
          matched_at: string;
          matched_by: string;
          reconciliation_id: string;
          statement_amount: number;
          statement_date: string;
          statement_reference: string | null;
          transaction_id: string;
        };
        Insert: {
          id?: string;
          matched_at?: string;
          matched_by?: string;
          reconciliation_id: string;
          statement_amount: number;
          statement_date: string;
          statement_reference?: string | null;
          transaction_id: string;
        };
        Update: {
          id?: string;
          matched_at?: string;
          matched_by?: string;
          reconciliation_id?: string;
          statement_amount?: number;
          statement_date?: string;
          statement_reference?: string | null;
          transaction_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "financial_reconciliation_items_reconciliation_id_fkey";
            columns: ["reconciliation_id"];
            isOneToOne: false;
            referencedRelation: "financial_reconciliations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "financial_reconciliation_items_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "financial_transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      business_parties: {
        Row: {
          billing_address: string | null;
          contact_person: string | null;
          created_at: string;
          created_by: string;
          email: string | null;
          id: string;
          is_active: boolean;
          name: string;
          notes: string;
          party_type: string;
          payment_terms_days: number;
          phone: string | null;
          preferred_currency: string | null;
          tax_identifier: string | null;
          updated_at: string;
        };
        Insert: {
          billing_address?: string | null;
          contact_person?: string | null;
          created_at?: string;
          created_by?: string;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          notes?: string;
          party_type: string;
          payment_terms_days?: number;
          phone?: string | null;
          preferred_currency?: string | null;
          tax_identifier?: string | null;
          updated_at?: string;
        };
        Update: {
          billing_address?: string | null;
          contact_person?: string | null;
          created_at?: string;
          created_by?: string;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          notes?: string;
          party_type?: string;
          payment_terms_days?: number;
          phone?: string | null;
          preferred_currency?: string | null;
          tax_identifier?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          budget_amount: number | null;
          budget_currency: string;
          client_id: string;
          contract_currency: string;
          contract_value: number | null;
          created_at: string;
          created_by: string;
          due_on: string | null;
          id: string;
          notes: string;
          project_code: string;
          responsible_person: string | null;
          scope_description: string;
          service: string;
          starts_on: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          budget_amount?: number | null;
          budget_currency?: string;
          client_id: string;
          contract_currency?: string;
          contract_value?: number | null;
          created_at?: string;
          created_by?: string;
          due_on?: string | null;
          id?: string;
          notes?: string;
          project_code: string;
          responsible_person?: string | null;
          scope_description?: string;
          service: string;
          starts_on?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          budget_amount?: number | null;
          budget_currency?: string;
          client_id?: string;
          contract_currency?: string;
          contract_value?: number | null;
          created_at?: string;
          created_by?: string;
          due_on?: string | null;
          id?: string;
          notes?: string;
          project_code?: string;
          responsible_person?: string | null;
          scope_description?: string;
          service?: string;
          starts_on?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "business_parties";
            referencedColumns: ["id"];
          },
        ];
      };
      business_audit_log: {
        Row: {
          action: string;
          changed_at: string;
          changed_by: string;
          id: string;
          new_values: Json;
          old_values: Json | null;
          record_id: string;
          table_name: string;
        };
        Insert: {
          action: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values: Json;
          old_values?: Json | null;
          record_id: string;
          table_name: string;
        };
        Update: {
          action?: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values?: Json;
          old_values?: Json | null;
          record_id?: string;
          table_name?: string;
        };
        Relationships: [];
      };
      invoices: {
        Row: {
          client_id: string;
          created_at: string;
          created_by: string;
          currency: string;
          due_date: string;
          id: string;
          invoice_number: string;
          issue_date: string;
          notes: string;
          project_id: string | null;
          quotation_id: string | null;
          status: string;
          tax_amount: number;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          created_by?: string;
          currency: string;
          due_date: string;
          id?: string;
          invoice_number: string;
          issue_date: string;
          notes?: string;
          project_id?: string | null;
          quotation_id?: string | null;
          status?: string;
          tax_amount?: number;
          updated_at?: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          created_by?: string;
          currency?: string;
          due_date?: string;
          id?: string;
          invoice_number?: string;
          issue_date?: string;
          notes?: string;
          project_id?: string | null;
          quotation_id?: string | null;
          status?: string;
          tax_amount?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "business_parties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_line_items: {
        Row: {
          description: string;
          id: string;
          invoice_id: string;
          line_total: number;
          quantity: number;
          unit_price: number;
        };
        Insert: {
          description: string;
          id?: string;
          invoice_id: string;
          quantity: number;
          unit_price: number;
        };
        Update: {
          description?: string;
          id?: string;
          invoice_id?: string;
          quantity?: number;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      sales_quotations: {
        Row: {
          client_id: string;
          created_at: string;
          created_by: string;
          currency: string;
          id: string;
          issue_date: string;
          notes: string;
          project_id: string | null;
          quotation_number: string;
          status: string;
          status_reason: string;
          tax_amount: number;
          updated_at: string;
          valid_until: string;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          created_by?: string;
          currency: string;
          id?: string;
          issue_date: string;
          notes?: string;
          project_id?: string | null;
          quotation_number: string;
          status?: string;
          status_reason?: string;
          tax_amount?: number;
          updated_at?: string;
          valid_until: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          created_by?: string;
          currency?: string;
          id?: string;
          issue_date?: string;
          notes?: string;
          project_id?: string | null;
          quotation_number?: string;
          status?: string;
          status_reason?: string;
          tax_amount?: number;
          updated_at?: string;
          valid_until?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sales_quotations_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "business_parties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_quotations_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      quotation_line_items: {
        Row: {
          description: string;
          id: string;
          line_total: number;
          quantity: number;
          quotation_id: string;
          unit_price: number;
        };
        Insert: {
          description: string;
          id?: string;
          quantity: number;
          quotation_id: string;
          unit_price: number;
        };
        Update: {
          description?: string;
          id?: string;
          quantity?: number;
          quotation_id?: string;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "quotation_line_items_quotation_id_fkey";
            columns: ["quotation_id"];
            isOneToOne: false;
            referencedRelation: "sales_quotations";
            referencedColumns: ["id"];
          },
        ];
      };
      quotation_audit_log: {
        Row: {
          action: string;
          changed_at: string;
          changed_by: string;
          id: string;
          new_values: Json;
          old_values: Json | null;
          quotation_id: string;
          record_id: string;
          table_name: string;
        };
        Insert: {
          action: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values: Json;
          old_values?: Json | null;
          quotation_id: string;
          record_id: string;
          table_name: string;
        };
        Update: {
          action?: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values?: Json;
          old_values?: Json | null;
          quotation_id?: string;
          record_id?: string;
          table_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quotation_audit_log_quotation_id_fkey";
            columns: ["quotation_id"];
            isOneToOne: false;
            referencedRelation: "sales_quotations";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_payments: {
        Row: {
          account_id: string;
          amount: number;
          created_at: string;
          created_by: string;
          exchange_rate: number;
          exchange_rate_date: string;
          exchange_rate_source: string;
          id: string;
          invoice_id: string;
          payment_date: string;
          reason: string;
          reference: string | null;
        };
        Insert: {
          account_id: string;
          amount: number;
          created_at?: string;
          created_by?: string;
          exchange_rate: number;
          exchange_rate_date: string;
          exchange_rate_source: string;
          id?: string;
          invoice_id: string;
          payment_date: string;
          reason: string;
          reference?: string | null;
        };
        Update: {
          account_id?: string;
          amount?: number;
          created_at?: string;
          created_by?: string;
          exchange_rate?: number;
          exchange_rate_date?: string;
          exchange_rate_source?: string;
          id?: string;
          invoice_id?: string;
          payment_date?: string;
          reason?: string;
          reference?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_payments_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "financial_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_audit_log: {
        Row: {
          action: string;
          changed_at: string;
          changed_by: string;
          id: string;
          new_values: Json;
          old_values: Json | null;
          record_id: string;
          table_name: string;
        };
        Insert: {
          action: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values: Json;
          old_values?: Json | null;
          record_id: string;
          table_name: string;
        };
        Update: {
          action?: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values?: Json;
          old_values?: Json | null;
          record_id?: string;
          table_name?: string;
        };
        Relationships: [];
      };
      expense_requests: {
        Row: {
          amount: number;
          category: string;
          cost_type: string;
          created_at: string;
          currency: string;
          description: string;
          expected_payment_date: string | null;
          id: string;
          manager_note: string | null;
          paid_at: string | null;
          paid_by: string | null;
          payment_transaction_id: string | null;
          project_id: string | null;
          receipt_reference: string | null;
          requested_at: string;
          requested_by: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          supplier_id: string | null;
        };
        Insert: {
          amount: number;
          category: string;
          cost_type: string;
          created_at?: string;
          currency: string;
          description: string;
          expected_payment_date?: string | null;
          id?: string;
          manager_note?: string | null;
          paid_at?: string | null;
          paid_by?: string | null;
          payment_transaction_id?: string | null;
          project_id?: string | null;
          receipt_reference?: string | null;
          requested_at?: string;
          requested_by?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          supplier_id?: string | null;
        };
        Update: {
          amount?: number;
          category?: string;
          cost_type?: string;
          created_at?: string;
          currency?: string;
          description?: string;
          expected_payment_date?: string | null;
          id?: string;
          manager_note?: string | null;
          paid_at?: string | null;
          paid_by?: string | null;
          payment_transaction_id?: string | null;
          project_id?: string | null;
          receipt_reference?: string | null;
          requested_at?: string;
          requested_by?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          supplier_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expense_requests_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_requests_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "business_parties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_requests_payment_transaction_id_fkey";
            columns: ["payment_transaction_id"];
            isOneToOne: true;
            referencedRelation: "financial_transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_request_audit_log: {
        Row: {
          action: string;
          changed_at: string;
          changed_by: string;
          expense_request_id: string;
          id: string;
          new_values: Json;
          old_values: Json | null;
        };
        Insert: {
          action: string;
          changed_at?: string;
          changed_by?: string;
          expense_request_id: string;
          id?: string;
          new_values: Json;
          old_values?: Json | null;
        };
        Update: {
          action?: string;
          changed_at?: string;
          changed_by?: string;
          expense_request_id?: string;
          id?: string;
          new_values?: Json;
          old_values?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "expense_request_audit_log_expense_request_id_fkey";
            columns: ["expense_request_id"];
            isOneToOne: false;
            referencedRelation: "expense_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      financial_budgets: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          category: string;
          created_at: string;
          created_by: string;
          currency: string;
          id: string;
          notes: string;
          period_start: string;
          planned_amount: number;
          project_id: string | null;
          status: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          category: string;
          created_at?: string;
          created_by?: string;
          currency: string;
          id?: string;
          notes?: string;
          period_start: string;
          planned_amount: number;
          project_id?: string | null;
          status?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          category?: string;
          created_at?: string;
          created_by?: string;
          currency?: string;
          id?: string;
          notes?: string;
          period_start?: string;
          planned_amount?: number;
          project_id?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "financial_budgets_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      financial_budget_audit_log: {
        Row: {
          action: string;
          budget_id: string;
          changed_at: string;
          changed_by: string;
          id: string;
          new_values: Json;
          old_values: Json | null;
        };
        Insert: {
          action: string;
          budget_id: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values: Json;
          old_values?: Json | null;
        };
        Update: {
          action?: string;
          budget_id?: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values?: Json;
          old_values?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "financial_budget_audit_log_budget_id_fkey";
            columns: ["budget_id"];
            isOneToOne: false;
            referencedRelation: "financial_budgets";
            referencedColumns: ["id"];
          },
        ];
      };
      vendor_bills: {
        Row: {
          amount: number;
          bill_date: string;
          bill_number: string;
          category: string;
          cost_type: string;
          created_at: string;
          currency: string;
          description: string;
          due_date: string;
          id: string;
          manager_note: string | null;
          notes: string;
          project_id: string | null;
          requested_at: string;
          requested_by: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          supplier_id: string;
        };
        Insert: {
          amount: number;
          bill_date: string;
          bill_number: string;
          category: string;
          cost_type: string;
          created_at?: string;
          currency: string;
          description: string;
          due_date: string;
          id?: string;
          manager_note?: string | null;
          notes?: string;
          project_id?: string | null;
          requested_at?: string;
          requested_by?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          supplier_id: string;
        };
        Update: {
          amount?: number;
          bill_date?: string;
          bill_number?: string;
          category?: string;
          cost_type?: string;
          created_at?: string;
          currency?: string;
          description?: string;
          due_date?: string;
          id?: string;
          manager_note?: string | null;
          notes?: string;
          project_id?: string | null;
          requested_at?: string;
          requested_by?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          supplier_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendor_bills_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendor_bills_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "business_parties";
            referencedColumns: ["id"];
          },
        ];
      };
      vendor_bill_payments: {
        Row: {
          amount: number;
          created_at: string;
          created_by: string;
          financial_transaction_id: string;
          id: string;
          payment_date: string;
          vendor_bill_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          created_by?: string;
          financial_transaction_id: string;
          id?: string;
          payment_date: string;
          vendor_bill_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          created_by?: string;
          financial_transaction_id?: string;
          id?: string;
          payment_date?: string;
          vendor_bill_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendor_bill_payments_vendor_bill_id_fkey";
            columns: ["vendor_bill_id"];
            isOneToOne: false;
            referencedRelation: "vendor_bills";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendor_bill_payments_financial_transaction_id_fkey";
            columns: ["financial_transaction_id"];
            isOneToOne: true;
            referencedRelation: "financial_transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      vendor_bill_audit_log: {
        Row: {
          action: string;
          changed_at: string;
          changed_by: string;
          id: string;
          new_values: Json;
          old_values: Json | null;
          vendor_bill_id: string;
        };
        Insert: {
          action: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values: Json;
          old_values?: Json | null;
          vendor_bill_id: string;
        };
        Update: {
          action?: string;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_values?: Json;
          old_values?: Json | null;
          vendor_bill_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendor_bill_audit_log_vendor_bill_id_fkey";
            columns: ["vendor_bill_id"];
            isOneToOne: false;
            referencedRelation: "vendor_bills";
            referencedColumns: ["id"];
          },
        ];
      };
      employees: {
        Row: {
          account_no: string | null;
          allowances: number;
          auth_user_id: string | null;
          bank_name: string | null;
          base_salary: number;
          created_at: string;
          cv_path: string | null;
          department: string;
          daily_rate: number | null;
          employment_type: string;
          employee_no: string;
          full_name: string;
          hired_on: string;
          id: string;
          application_letter_path: string | null;
          nssf_no: string | null;
          other_documents: Json;
          phone: string | null;
          photo_path: string | null;
          position: string;
          status: string;
        };
        Insert: {
          account_no?: string | null;
          allowances?: number;
          auth_user_id?: string | null;
          bank_name?: string | null;
          base_salary?: number;
          created_at?: string;
          cv_path?: string | null;
          department: string;
          daily_rate?: number | null;
          employment_type?: string;
          employee_no: string;
          full_name: string;
          hired_on?: string;
          id?: string;
          application_letter_path?: string | null;
          nssf_no?: string | null;
          other_documents?: Json;
          phone?: string | null;
          photo_path?: string | null;
          position: string;
          status?: string;
        };
        Update: {
          account_no?: string | null;
          allowances?: number;
          auth_user_id?: string | null;
          bank_name?: string | null;
          base_salary?: number;
          created_at?: string;
          cv_path?: string | null;
          department?: string;
          daily_rate?: number | null;
          employment_type?: string;
          employee_no?: string;
          full_name?: string;
          hired_on?: string;
          id?: string;
          application_letter_path?: string | null;
          nssf_no?: string | null;
          other_documents?: Json;
          phone?: string | null;
          photo_path?: string | null;
          position?: string;
          status?: string;
        };
        Relationships: [];
      };
      employee_contracts: {
        Row: {
          contract_type: string;
          contract_terms: Json;
          created_at: string;
          created_by: string;
          document_path: string | null;
          employee_id: string;
          end_date: string | null;
          id: string;
          is_primary: boolean;
          notes: string;
          start_date: string;
          status: string;
          signed_document_path: string | null;
          updated_at: string;
        };
        Insert: {
          contract_type: string;
          contract_terms?: Json;
          created_at?: string;
          created_by?: string;
          document_path?: string | null;
          employee_id: string;
          end_date?: string | null;
          id?: string;
          is_primary?: boolean;
          notes?: string;
          start_date: string;
          status?: string;
          signed_document_path?: string | null;
          updated_at?: string;
        };
        Update: {
          contract_type?: string;
          contract_terms?: Json;
          created_at?: string;
          created_by?: string;
          document_path?: string | null;
          employee_id?: string;
          end_date?: string | null;
          id?: string;
          is_primary?: boolean;
          notes?: string;
          start_date?: string;
          status?: string;
          signed_document_path?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employee_contracts_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      contract_expiry_email_log: {
        Row: {
          contract_end_date: string;
          contract_id: string;
          recipient_user_id: string;
          sent_at: string;
        };
        Insert: {
          contract_end_date: string;
          contract_id: string;
          recipient_user_id: string;
          sent_at?: string;
        };
        Update: {
          contract_end_date?: string;
          contract_id?: string;
          recipient_user_id?: string;
          sent_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contract_expiry_email_log_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "employee_contracts";
            referencedColumns: ["id"];
          },
        ];
      };
      payroll_runs: {
        Row: {
          created_at: string;
          created_by: string;
          cancelled_at: string | null;
          cancelled_by: string | null;
          id: string;
          period: string;
          period_end: string | null;
          period_start: string | null;
          run_type: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          id?: string;
          period: string;
          period_end?: string | null;
          period_start?: string | null;
          run_type?: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          id?: string;
          period?: string;
          period_end?: string | null;
          period_start?: string | null;
          run_type?: string;
          status?: string;
        };
        Relationships: [];
      };
      payslips: {
        Row: {
          attendance_days: number;
          attendance_hours: number;
          allowances: number | null;
          basic_pay: number | null;
          created_at: string;
          employee_id: string;
          gross: number;
          id: string;
          net: number;
          nssf_employee: number;
          nssf_employer: number;
          overtime_hours: number;
          overtime_pay: number;
          paye: number;
          rate_used: number | null;
          run_id: string;
        };
        Insert: {
          attendance_days?: number;
          attendance_hours?: number;
          allowances?: number | null;
          basic_pay?: number | null;
          created_at?: string;
          employee_id: string;
          gross: number;
          id?: string;
          net: number;
          nssf_employee: number;
          nssf_employer: number;
          overtime_hours?: number;
          overtime_pay?: number;
          paye: number;
          rate_used?: number | null;
          run_id: string;
        };
        Update: {
          attendance_days?: number;
          attendance_hours?: number;
          allowances?: number | null;
          basic_pay?: number | null;
          created_at?: string;
          employee_id?: string;
          gross?: number;
          id?: string;
          net?: number;
          nssf_employee?: number;
          nssf_employer?: number;
          overtime_hours?: number;
          overtime_pay?: number;
          paye?: number;
          rate_used?: number | null;
          run_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payslips_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payslips_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "payroll_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance_logs: {
        Row: {
          created_at: string;
          cancelled_at: string | null;
          cancelled_by: string | null;
          device_serial: string;
          employee_id: string;
          event_type: string;
          id: string;
          imported_by: string;
          occurred_at: string;
          raw_event: Json;
          source_file: string | null;
        };
        Insert: {
          created_at?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          device_serial?: string;
          employee_id: string;
          event_type?: string;
          id?: string;
          imported_by?: string;
          occurred_at: string;
          raw_event?: Json;
          source_file?: string | null;
        };
        Update: {
          created_at?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          device_serial?: string;
          employee_id?: string;
          event_type?: string;
          id?: string;
          imported_by?: string;
          occurred_at?: string;
          raw_event?: Json;
          source_file?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_logs_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      casual_overtime_entries: {
        Row: {
          amount: number | null;
          created_at: string;
          created_by: string;
          employee_id: string;
          hourly_rate: number | null;
          id: string;
          method: string;
          overtime_hours: number | null;
          work_date: string;
        };
        Insert: {
          amount?: number | null;
          created_at?: string;
          created_by?: string;
          employee_id: string;
          hourly_rate?: number | null;
          id?: string;
          method: string;
          overtime_hours?: number | null;
          work_date: string;
        };
        Update: {
          amount?: number | null;
          created_at?: string;
          created_by?: string;
          employee_id?: string;
          hourly_rate?: number | null;
          id?: string;
          method?: string;
          overtime_hours?: number | null;
          work_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "casual_overtime_entries_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_requests: {
        Row: {
          created_at: string;
          employee_id: string;
          end_date: string;
          hours: number | null;
          id: string;
          manager_note: string | null;
          reason: string;
          request_type: string;
          requested_by: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          start_date: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          employee_id: string;
          end_date: string;
          hours?: number | null;
          id?: string;
          manager_note?: string | null;
          reason: string;
          request_type: string;
          requested_by?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          start_date: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          employee_id?: string;
          end_date?: string;
          hours?: number | null;
          id?: string;
          manager_note?: string | null;
          reason?: string;
          request_type?: string;
          requested_by?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          start_date?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employee_requests_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_id_cards: {
        Row: {
          employee_id: string;
          id: string;
          issued_at: string;
          issued_by: string;
        };
        Insert: {
          employee_id: string;
          id?: string;
          issued_at?: string;
          issued_by?: string;
        };
        Update: {
          employee_id?: string;
          id?: string;
          issued_at?: string;
          issued_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employee_id_cards_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: true;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      payroll_compilations: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          period: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          id?: string;
          period: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          period?: string;
          status?: string;
        };
        Relationships: [];
      };
      payroll_compilation_runs: {
        Row: {
          compilation_id: string;
          run_id: string;
        };
        Insert: {
          compilation_id: string;
          run_id: string;
        };
        Update: {
          compilation_id?: string;
          run_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payroll_compilation_runs_compilation_id_fkey";
            columns: ["compilation_id"];
            isOneToOne: false;
            referencedRelation: "payroll_compilations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payroll_compilation_runs_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: true;
            referencedRelation: "payroll_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      financial_account_balances: {
        Row: {
          account_type: string;
          created_at: string;
          created_by: string;
          currency: string;
          current_balance: number | null;
          id: string | null;
          name: string | null;
          opening_balance: number | null;
          opening_balance_date: string | null;
          provider: string | null;
        };
        Relationships: [];
      };
      invoice_balances: {
        Row: {
          amount_paid: number | null;
          balance_due: number | null;
          client_id: string;
          created_at: string;
          created_by: string;
          currency: string;
          due_date: string;
          id: string;
          invoice_number: string;
          issue_date: string;
          notes: string;
          payment_status: string | null;
          project_id: string | null;
          status: string;
          subtotal: number | null;
          tax_amount: number;
          total_amount: number | null;
          updated_at: string;
        };
        Relationships: [];
      };
      quotation_totals: {
        Row: {
          client_id: string;
          converted_invoice_number: string | null;
          created_at: string;
          created_by: string;
          currency: string;
          id: string;
          invoice_id: string | null;
          issue_date: string;
          notes: string;
          project_id: string | null;
          quotation_number: string;
          status: string;
          status_reason: string;
          subtotal: number | null;
          tax_amount: number;
          total_amount: number | null;
          updated_at: string;
          valid_until: string;
        };
        Relationships: [];
      };
      financial_budget_vs_actual: {
        Row: {
          actual_amount: number | null;
          category: string;
          currency: string;
          id: string | null;
          notes: string | null;
          period_start: string;
          planned_amount: number | null;
          project_id: string | null;
          remaining_amount: number | null;
          status: string | null;
        };
        Relationships: [];
      };
      financial_monthly_summary: {
        Row: {
          currency: string;
          expense_amount: number | null;
          expense_ugx: number | null;
          income_amount: number | null;
          income_ugx: number | null;
          net_ugx: number | null;
          period_start: string;
        };
        Relationships: [];
      };
      financial_project_profitability: {
        Row: {
          client_id: string;
          collected_margin_ugx: number | null;
          collected_revenue_ugx: number | null;
          contract_currency: string;
          contract_value: number | null;
          direct_cost_ugx: number | null;
          project_code: string;
          project_id: string;
          service: string;
          status: string;
        };
        Relationships: [];
      };
      financial_upcoming_commitments: {
        Row: {
          amount: number;
          category: string;
          currency: string;
          description: string;
          expected_payment_date: string;
          id: string;
          project_id: string | null;
          requested_by: string;
          supplier_id: string | null;
        };
        Relationships: [];
      };
      vendor_bill_balances: {
        Row: {
          amount_paid: number | null;
          bill_date: string;
          bill_number: string;
          balance_due: number | null;
          category: string;
          cost_type: string;
          currency: string;
          description: string;
          due_date: string;
          id: string;
          manager_note: string | null;
          payment_status: string | null;
          project_id: string | null;
          requested_by: string;
          reviewed_by: string | null;
          status: string;
          supplier_id: string;
          total_amount: number;
        };
        Relationships: [];
      };
      financial_receivables_aging: {
        Row: {
          aging_bucket: string;
          amount_due: number | null;
          client_id: string;
          days_past_due: number;
          due_date: string;
          currency: string;
          id: string;
          invoice_number: string;
          project_id: string | null;
        };
        Relationships: [];
      };
      financial_payables_aging: {
        Row: {
          aging_bucket: string;
          amount_due: number | null;
          bill_number: string;
          currency: string;
          days_past_due: number;
          due_date: string;
          id: string;
          project_id: string | null;
          supplier_id: string;
        };
        Relationships: [];
      };
      financial_cash_flow_forecast: {
        Row: {
          amount: number | null;
          currency: string;
          direction: string;
          expected_date: string | null;
          project_id: string | null;
          reference: string;
          source_id: string;
          source_type: string;
        };
        Relationships: [];
      };
      accounting_account_balances: {
        Row: {
          account_code: string;
          account_type: string;
          balance: number | null;
          currency: string;
          id: string;
          name: string;
        };
        Relationships: [];
      };
      accounting_journal_summary: {
        Row: {
          created_at: string;
          created_by: string | null;
          currency: string;
          description: string;
          entry_date: string;
          id: string;
          source_id: string;
          source_type: string;
          total_credits: number | null;
          total_debits: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_staff: { Args: { _user_id: string }; Returns: boolean };
      is_finance_staff: { Args: { _user_id: string }; Returns: boolean };
      post_cross_currency_transfer: {
        Args: {
          p_destination_account_id: string;
          p_destination_amount: number;
          p_destination_exchange_rate: number;
          p_destination_exchange_rate_date: string;
          p_destination_exchange_rate_source: string;
          p_description: string;
          p_fee_amount: number;
          p_reason: string;
          p_reference: string | null;
          p_source_account_id: string;
          p_source_amount: number;
          p_source_exchange_rate: number;
          p_source_exchange_rate_date: string;
          p_source_exchange_rate_source: string;
          p_transfer_date: string;
        };
        Returns: string;
      };
      post_payroll_run: {
        Args: {
          p_financial_account_id: string;
          p_payment_date: string;
          p_reason: string;
          p_reference: string | null;
          p_run_id: string;
        };
        Returns: string;
      };
      admin_list_user_access: {
        Args: Record<PropertyKey, never>;
        Returns: {
          email: string | null;
          full_name: string;
          roles: Database["public"]["Enums"]["app_role"][];
          user_id: string;
        }[];
      };
      admin_set_user_role: {
        Args: {
          p_enabled: boolean;
          p_role: Database["public"]["Enums"]["app_role"];
          p_user_id: string;
        };
        Returns: undefined;
      };
      attach_expense_receipt: {
        Args: { p_request_id: string; p_storage_key: string };
        Returns: undefined;
      };
      create_vendor_bill: {
        Args: {
          p_amount: number;
          p_bill_date: string;
          p_bill_number: string;
          p_category: string;
          p_cost_type: string;
          p_currency: string;
          p_description: string;
          p_due_date: string;
          p_notes: string;
          p_project_id: string | null;
          p_supplier_id: string;
        };
        Returns: string;
      };
      review_vendor_bill: {
        Args: { p_bill_id: string; p_decision: string; p_manager_note: string };
        Returns: undefined;
      };
      record_vendor_bill_payment: {
        Args: {
          p_amount: number;
          p_account_id: string;
          p_bill_id: string;
          p_exchange_rate: number;
          p_exchange_rate_date: string;
          p_exchange_rate_source: string;
          p_payment_date: string;
          p_reason: string;
          p_reference: string | null;
        };
        Returns: string;
      };
      finalize_financial_reconciliation: {
        Args: { p_reconciliation_id: string };
        Returns: undefined;
      };
      create_sales_invoice: {
        Args: {
          p_client_id: string;
          p_currency: string;
          p_due_date: string;
          p_invoice_number: string;
          p_issue_date: string;
          p_line_items: Json;
          p_notes: string;
          p_project_id: string | null;
          p_tax_amount: number;
        };
        Returns: string;
      };
      create_sales_quotation: {
        Args: {
          p_client_id: string;
          p_currency: string;
          p_line_items: Json;
          p_notes: string;
          p_project_id: string | null;
          p_quotation_number: string;
          p_issue_date: string;
          p_tax_amount: number;
          p_valid_until: string;
        };
        Returns: string;
      };
      update_sales_quotation_status: {
        Args: { p_quotation_id: string; p_reason: string; p_status: string };
        Returns: undefined;
      };
      convert_sales_quotation_to_invoice: {
        Args: {
          p_due_date: string;
          p_invoice_number: string;
          p_issue_date: string;
          p_quotation_id: string;
        };
        Returns: string;
      };
      mark_sales_invoice_sent: {
        Args: { p_invoice_id: string };
        Returns: undefined;
      };
      add_sales_invoice_payment: {
        Args: {
          p_account_id: string;
          p_amount: number;
          p_exchange_rate: number;
          p_exchange_rate_date: string;
          p_exchange_rate_source: string;
          p_invoice_id: string;
          p_payment_date: string;
          p_reason: string;
          p_reference: string | null;
        };
        Returns: string;
      };
      review_expense_request: {
        Args: { p_decision: string; p_manager_note: string; p_request_id: string };
        Returns: undefined;
      };
      settle_expense_request: {
        Args: {
          p_account_id: string;
          p_exchange_rate: number;
          p_exchange_rate_date: string;
          p_exchange_rate_source: string;
          p_payment_date: string;
          p_reason: string;
          p_reference: string | null;
          p_request_id: string;
        };
        Returns: string;
      };
      approve_financial_budget: {
        Args: { p_budget_id: string };
        Returns: undefined;
      };
      import_casual_payroll: {
        Args: {
          p_period_end: string;
          p_period_start: string;
          p_period: string;
          p_rows: Json;
        };
        Returns: string;
      };
      admin_cancel_payroll_run: {
        Args: { p_run_id: string };
        Returns: undefined;
      };
      admin_cancel_manual_attendance: {
        Args: { p_log_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "hr" | "accountant" | "producer";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "hr", "accountant", "producer"],
    },
  },
} as const;
