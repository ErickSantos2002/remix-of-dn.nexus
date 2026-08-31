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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_analysis_results: {
        Row: {
          activity_id: string | null
          company_id: string
          corrected: Json
          created_at: string
          criteria_results: Json
          disregarded_at: string | null
          disregarded_by: string | null
          error_message: string | null
          habits: Json
          id: string
          improvements: Json
          lead_id: string | null
          model: string | null
          occurred_at: string
          playbook_id: string | null
          points_applied: boolean
          recurrences: Json
          rubric_version_id: string | null
          score: number | null
          seller_id: string | null
          seller_name: string | null
          source_id: string
          source_type: string
          status: string
          strengths: Json
          summary_md: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activity_id?: string | null
          company_id: string
          corrected?: Json
          created_at?: string
          criteria_results?: Json
          disregarded_at?: string | null
          disregarded_by?: string | null
          error_message?: string | null
          habits?: Json
          id?: string
          improvements?: Json
          lead_id?: string | null
          model?: string | null
          occurred_at?: string
          playbook_id?: string | null
          points_applied?: boolean
          recurrences?: Json
          rubric_version_id?: string | null
          score?: number | null
          seller_id?: string | null
          seller_name?: string | null
          source_id: string
          source_type: string
          status?: string
          strengths?: Json
          summary_md?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activity_id?: string | null
          company_id?: string
          corrected?: Json
          created_at?: string
          criteria_results?: Json
          disregarded_at?: string | null
          disregarded_by?: string | null
          error_message?: string | null
          habits?: Json
          id?: string
          improvements?: Json
          lead_id?: string | null
          model?: string | null
          occurred_at?: string
          playbook_id?: string | null
          points_applied?: boolean
          recurrences?: Json
          rubric_version_id?: string | null
          score?: number | null
          seller_id?: string | null
          seller_name?: string | null
          source_id?: string
          source_type?: string
          status?: string
          strengths?: Json
          summary_md?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_analysis_results_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "crm_lead_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_analysis_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_analysis_results_disregarded_by_fkey"
            columns: ["disregarded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_analysis_results_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_analysis_results_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "analysis_playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_analysis_results_rubric_version_id_fkey"
            columns: ["rubric_version_id"]
            isOneToOne: false
            referencedRelation: "analysis_rubric_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_analysis_results_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_analysis_results_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_availability: {
        Row: {
          id: string
          is_accepting_leads: boolean | null
          last_activity_at: string | null
          max_concurrent_leads: number | null
          updated_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          is_accepting_leads?: boolean | null
          last_activity_at?: string | null
          max_concurrent_leads?: number | null
          updated_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          is_accepting_leads?: boolean | null
          last_activity_at?: string | null
          max_concurrent_leads?: number | null
          updated_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_availability_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_availability_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_categories: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          is_system: boolean | null
          name: string
          slug: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name: string
          slug: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name?: string
          slug?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_categories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_instances: {
        Row: {
          activation_description: string | null
          category: string | null
          category_id: string | null
          created_at: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          is_archived: boolean | null
          is_customized: boolean | null
          is_default_for_category: boolean | null
          keywords: string[] | null
          knowledge_base_id: string | null
          live_chat_enabled: boolean
          message_debounce_seconds: number
          name: string
          split_messages: boolean | null
          system_prompt: string
          template_id: string | null
          tone: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          activation_description?: string | null
          category?: string | null
          category_id?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_archived?: boolean | null
          is_customized?: boolean | null
          is_default_for_category?: boolean | null
          keywords?: string[] | null
          knowledge_base_id?: string | null
          live_chat_enabled?: boolean
          message_debounce_seconds?: number
          name: string
          split_messages?: boolean | null
          system_prompt: string
          template_id?: string | null
          tone: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          activation_description?: string | null
          category?: string | null
          category_id?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_archived?: boolean | null
          is_customized?: boolean | null
          is_default_for_category?: boolean | null
          keywords?: string[] | null
          knowledge_base_id?: string | null
          live_chat_enabled?: boolean
          message_debounce_seconds?: number
          name?: string
          split_messages?: boolean | null
          system_prompt?: string
          template_id?: string | null
          tone?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_instances_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "agent_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_instances_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_instances_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agent_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_instances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_knowledge_bases: {
        Row: {
          agent_id: string
          created_at: string | null
          id: string
          knowledge_base_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string | null
          id?: string
          knowledge_base_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string | null
          id?: string
          knowledge_base_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_knowledge_bases_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_templates: {
        Row: {
          category: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_published: boolean | null
          name: string
          rating: number | null
          system_prompt: string
          tone: string
          updated_at: string | null
          usage_count: number | null
          version: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_published?: boolean | null
          name: string
          rating?: number | null
          system_prompt: string
          tone: string
          updated_at?: string | null
          usage_count?: number | null
          version?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_published?: boolean | null
          name?: string
          rating?: number | null
          system_prompt?: string
          tone?: string
          updated_at?: string | null
          usage_count?: number | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tools: {
        Row: {
          agent_id: string
          config: Json | null
          created_at: string | null
          id: string
          is_enabled: boolean | null
          tool_id: string | null
          tool_name: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          agent_id: string
          config?: Json | null
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          tool_id?: string | null
          tool_name: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          agent_id?: string
          config?: Json | null
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          tool_id?: string | null
          tool_name?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tools_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tool_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tools_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_transfers: {
        Row: {
          created_at: string
          from_agent_id: string | null
          from_intent: string | null
          id: string
          lead_id: string
          reason: string
          to_agent_id: string
          to_intent: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          from_agent_id?: string | null
          from_intent?: string | null
          id?: string
          lead_id: string
          reason: string
          to_agent_id: string
          to_intent?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          from_agent_id?: string | null
          from_intent?: string | null
          id?: string
          lead_id?: string
          reason?: string
          to_agent_id?: string
          to_intent?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_transfers_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_transfers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          activation_description: string | null
          category: string | null
          category_id: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          is_archived: boolean | null
          is_default_for_category: boolean | null
          keywords: string[] | null
          live_chat_enabled: boolean
          message_debounce_seconds: number
          name: string
          persona_prompt: string | null
          split_messages: boolean | null
          template_id: string | null
          tone: Database["public"]["Enums"]["agent_tone"] | null
          workspace_id: string
        }
        Insert: {
          activation_description?: string | null
          category?: string | null
          category_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_archived?: boolean | null
          is_default_for_category?: boolean | null
          keywords?: string[] | null
          live_chat_enabled?: boolean
          message_debounce_seconds?: number
          name: string
          persona_prompt?: string | null
          split_messages?: boolean | null
          template_id?: string | null
          tone?: Database["public"]["Enums"]["agent_tone"] | null
          workspace_id: string
        }
        Update: {
          activation_description?: string | null
          category?: string | null
          category_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_archived?: boolean | null
          is_default_for_category?: boolean | null
          keywords?: string[] | null
          live_chat_enabled?: boolean
          message_debounce_seconds?: number
          name?: string
          persona_prompt?: string | null
          split_messages?: boolean | null
          template_id?: string | null
          tone?: Database["public"]["Enums"]["agent_tone"] | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "agent_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agent_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_playbooks: {
        Row: {
          activity_types: string[]
          ai_model: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          guidelines: string | null
          id: string
          is_default: boolean
          md_approved_at: string | null
          name: string
          playbook_filename: string | null
          playbook_md: string | null
          status: string
          updated_at: string
        }
        Insert: {
          activity_types?: string[]
          ai_model?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          guidelines?: string | null
          id?: string
          is_default?: boolean
          md_approved_at?: string | null
          name: string
          playbook_filename?: string | null
          playbook_md?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          activity_types?: string[]
          ai_model?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          guidelines?: string | null
          id?: string
          is_default?: boolean
          md_approved_at?: string | null
          name?: string
          playbook_filename?: string | null
          playbook_md?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_playbooks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_playbooks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_rubric_criteria: {
        Row: {
          company_id: string
          created_at: string
          criterion_key: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          stage: string | null
          updated_at: string
          version_id: string
          weight: number
        }
        Insert: {
          company_id: string
          created_at?: string
          criterion_key: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          stage?: string | null
          updated_at?: string
          version_id: string
          weight?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          criterion_key?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          stage?: string | null
          updated_at?: string
          version_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "analysis_rubric_criteria_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_rubric_criteria_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "analysis_rubric_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_rubric_versions: {
        Row: {
          company_id: string
          coverage_report: Json | null
          created_at: string
          id: string
          playbook_id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          company_id: string
          coverage_report?: Json | null
          created_at?: string
          id?: string
          playbook_id: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          company_id?: string
          coverage_report?: Json | null
          created_at?: string
          id?: string
          playbook_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "analysis_rubric_versions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_rubric_versions_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "analysis_playbooks"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          permissions: Json | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          created_by: string
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          permissions?: Json | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          permissions?: Json | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_rules: {
        Row: {
          activity_type: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string | null
          stage_id: string | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          activity_type?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string | null
          stage_id?: string | null
          trigger_type: string
          updated_at?: string
        }
        Update: {
          activity_type?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string | null
          stage_id?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_rules_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_scheduled_messages: {
        Row: {
          activity_id: string | null
          channel: string
          company_id: string
          created_at: string
          error: string | null
          id: string
          lead_id: string
          message_id: number | null
          rule_id: string
          send_at: string
          sent_at: string | null
          status: string
          template_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activity_id?: string | null
          channel: string
          company_id: string
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          message_id?: number | null
          rule_id: string
          send_at: string
          sent_at?: string | null
          status?: string
          template_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activity_id?: string | null
          channel?: string
          company_id?: string
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          message_id?: number | null
          rule_id?: string
          send_at?: string
          sent_at?: string | null
          status?: string
          template_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_scheduled_messages_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "crm_lead_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_scheduled_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_scheduled_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_scheduled_messages_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_scheduled_messages_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "cadence_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_scheduled_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "cadence_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_scheduled_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_templates: {
        Row: {
          agent_id: string | null
          agent_source: string | null
          ai_rewrite_enabled: boolean
          channel: string
          content: string
          created_at: string
          day_period: string
          from_name: string | null
          hsm_language: string | null
          hsm_template_name: string | null
          hsm_variables: Json | null
          id: string
          is_active: boolean
          media_type: string | null
          media_url: string | null
          offset_unit: string
          offset_value: number
          order: number
          rule_id: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          agent_source?: string | null
          ai_rewrite_enabled?: boolean
          channel: string
          content: string
          created_at?: string
          day_period?: string
          from_name?: string | null
          hsm_language?: string | null
          hsm_template_name?: string | null
          hsm_variables?: Json | null
          id?: string
          is_active?: boolean
          media_type?: string | null
          media_url?: string | null
          offset_unit: string
          offset_value: number
          order?: number
          rule_id: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          agent_source?: string | null
          ai_rewrite_enabled?: boolean
          channel?: string
          content?: string
          created_at?: string
          day_period?: string
          from_name?: string | null
          hsm_language?: string | null
          hsm_template_name?: string | null
          hsm_variables?: Json | null
          id?: string
          is_active?: boolean
          media_type?: string | null
          media_url?: string | null
          offset_unit?: string
          offset_value?: number
          order?: number
          rule_id?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_templates_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "cadence_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          activity_id: string | null
          ai_analysis: Json | null
          ai_analyzed_at: string | null
          answered_at: string | null
          api4com_call_id: string | null
          call_outcome_label: string | null
          company_id: string
          contact_id: string | null
          created_at: string
          dialer_response_id: string | null
          duration_seconds: number | null
          ended_at: string | null
          extension: string | null
          hangup_cause: string | null
          hangup_cause_code: number | null
          id: string
          lead_id: string | null
          metadata: Json | null
          phone_called: string
          record_url: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["call_status"]
          transcribed_at: string | null
          transcription_model: string | null
          transcription_provider: string | null
          transcription_status:
            | Database["public"]["Enums"]["call_transcription_status"]
            | null
          transcription_text: string | null
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          activity_id?: string | null
          ai_analysis?: Json | null
          ai_analyzed_at?: string | null
          answered_at?: string | null
          api4com_call_id?: string | null
          call_outcome_label?: string | null
          company_id: string
          contact_id?: string | null
          created_at?: string
          dialer_response_id?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          extension?: string | null
          hangup_cause?: string | null
          hangup_cause_code?: number | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          phone_called: string
          record_url?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["call_status"]
          transcribed_at?: string | null
          transcription_model?: string | null
          transcription_provider?: string | null
          transcription_status?:
            | Database["public"]["Enums"]["call_transcription_status"]
            | null
          transcription_text?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          activity_id?: string | null
          ai_analysis?: Json | null
          ai_analyzed_at?: string | null
          answered_at?: string | null
          api4com_call_id?: string | null
          call_outcome_label?: string | null
          company_id?: string
          contact_id?: string | null
          created_at?: string
          dialer_response_id?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          extension?: string | null
          hangup_cause?: string | null
          hangup_cause_code?: number | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          phone_called?: string
          record_url?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["call_status"]
          transcribed_at?: string | null
          transcription_model?: string | null
          transcription_provider?: string | null
          transcription_status?:
            | Database["public"]["Enums"]["call_transcription_status"]
            | null
          transcription_text?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "crm_lead_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      category_agent_assignments: {
        Row: {
          agent_id: string
          category_id: string
          created_at: string | null
          id: string
          is_primary: boolean | null
          workspace_id: string
        }
        Insert: {
          agent_id: string
          category_id: string
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          workspace_id: string
        }
        Update: {
          agent_id?: string
          category_id?: string
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_agent_assignments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_agent_assignments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chat_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_agent_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_categories: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          priority: number | null
          sla_minutes: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          priority?: number | null
          sla_minutes?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          priority?: number | null
          sla_minutes?: number | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_categories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_excluded_leads: {
        Row: {
          excluded_at: string
          excluded_by: string | null
          lead_id: string
          reason: string | null
          workspace_id: string
        }
        Insert: {
          excluded_at?: string
          excluded_by?: string | null
          lead_id: string
          reason?: string | null
          workspace_id: string
        }
        Update: {
          excluded_at?: string
          excluded_by?: string | null
          lead_id?: string
          reason?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cohort_excluded_leads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_excluded_leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          analysis_guidelines: string | null
          api4com_domain: string | null
          api4com_is_active: boolean | null
          api4com_token_encrypted: string | null
          api4com_webhook_configured_at: string | null
          api4com_webhook_gateway_id: string | null
          api4com_webhook_secret: string | null
          clarity_project_id: string | null
          created_at: string | null
          daily_api_key: string | null
          description: string | null
          dnmarketing_base_url: string | null
          dnmarketing_is_active: boolean
          dnmarketing_token_encrypted: string | null
          dnmarketing_validated_at: string | null
          ga4_measurement_id: string | null
          gemini_api_key: string | null
          gemini_enabled: boolean
          gemini_last_test: Json | null
          gemini_validated_at: string | null
          google_ads_send_to: string | null
          google_client_id: string | null
          google_client_secret: string | null
          google_oauth_enabled: boolean
          google_oauth_validated_at: string | null
          gtm_container_id: string | null
          has_api4com_token: boolean | null
          has_api4com_webhook_secret: boolean | null
          has_daily_api_key: boolean | null
          has_dnmarketing_token: boolean | null
          has_gemini_api_key: boolean | null
          has_google_credentials: boolean | null
          has_meta_access_token: boolean | null
          has_openai_api_key: boolean | null
          has_resend_api_key: boolean | null
          has_zapi_account_token: boolean | null
          icon: string | null
          id: string
          meta_access_token: string | null
          meta_pixel_id: string | null
          name: string
          openai_api_key: string | null
          openai_enabled: boolean
          openai_model_default: string | null
          openai_validated_at: string | null
          owner_id: string | null
          resend_api_key: string | null
          resend_enabled: boolean
          resend_from_email: string | null
          resend_validated_at: string | null
          zapi_account_token: string | null
          zapi_token_status: string | null
          zapi_token_validated_at: string | null
        }
        Insert: {
          analysis_guidelines?: string | null
          api4com_domain?: string | null
          api4com_is_active?: boolean | null
          api4com_token_encrypted?: string | null
          api4com_webhook_configured_at?: string | null
          api4com_webhook_gateway_id?: string | null
          api4com_webhook_secret?: string | null
          clarity_project_id?: string | null
          created_at?: string | null
          daily_api_key?: string | null
          description?: string | null
          dnmarketing_base_url?: string | null
          dnmarketing_is_active?: boolean
          dnmarketing_token_encrypted?: string | null
          dnmarketing_validated_at?: string | null
          ga4_measurement_id?: string | null
          gemini_api_key?: string | null
          gemini_enabled?: boolean
          gemini_last_test?: Json | null
          gemini_validated_at?: string | null
          google_ads_send_to?: string | null
          google_client_id?: string | null
          google_client_secret?: string | null
          google_oauth_enabled?: boolean
          google_oauth_validated_at?: string | null
          gtm_container_id?: string | null
          has_api4com_token?: boolean | null
          has_api4com_webhook_secret?: boolean | null
          has_daily_api_key?: boolean | null
          has_dnmarketing_token?: boolean | null
          has_gemini_api_key?: boolean | null
          has_google_credentials?: boolean | null
          has_meta_access_token?: boolean | null
          has_openai_api_key?: boolean | null
          has_resend_api_key?: boolean | null
          has_zapi_account_token?: boolean | null
          icon?: string | null
          id?: string
          meta_access_token?: string | null
          meta_pixel_id?: string | null
          name: string
          openai_api_key?: string | null
          openai_enabled?: boolean
          openai_model_default?: string | null
          openai_validated_at?: string | null
          owner_id?: string | null
          resend_api_key?: string | null
          resend_enabled?: boolean
          resend_from_email?: string | null
          resend_validated_at?: string | null
          zapi_account_token?: string | null
          zapi_token_status?: string | null
          zapi_token_validated_at?: string | null
        }
        Update: {
          analysis_guidelines?: string | null
          api4com_domain?: string | null
          api4com_is_active?: boolean | null
          api4com_token_encrypted?: string | null
          api4com_webhook_configured_at?: string | null
          api4com_webhook_gateway_id?: string | null
          api4com_webhook_secret?: string | null
          clarity_project_id?: string | null
          created_at?: string | null
          daily_api_key?: string | null
          description?: string | null
          dnmarketing_base_url?: string | null
          dnmarketing_is_active?: boolean
          dnmarketing_token_encrypted?: string | null
          dnmarketing_validated_at?: string | null
          ga4_measurement_id?: string | null
          gemini_api_key?: string | null
          gemini_enabled?: boolean
          gemini_last_test?: Json | null
          gemini_validated_at?: string | null
          google_ads_send_to?: string | null
          google_client_id?: string | null
          google_client_secret?: string | null
          google_oauth_enabled?: boolean
          google_oauth_validated_at?: string | null
          gtm_container_id?: string | null
          has_api4com_token?: boolean | null
          has_api4com_webhook_secret?: boolean | null
          has_daily_api_key?: boolean | null
          has_dnmarketing_token?: boolean | null
          has_gemini_api_key?: boolean | null
          has_google_credentials?: boolean | null
          has_meta_access_token?: boolean | null
          has_openai_api_key?: boolean | null
          has_resend_api_key?: boolean | null
          has_zapi_account_token?: boolean | null
          icon?: string | null
          id?: string
          meta_access_token?: string | null
          meta_pixel_id?: string | null
          name?: string
          openai_api_key?: string | null
          openai_enabled?: boolean
          openai_model_default?: string | null
          openai_validated_at?: string | null
          owner_id?: string | null
          resend_api_key?: string | null
          resend_enabled?: boolean
          resend_from_email?: string | null
          resend_validated_at?: string | null
          zapi_account_token?: string | null
          zapi_token_status?: string | null
          zapi_token_validated_at?: string | null
        }
        Relationships: []
      }
      company_invites: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string | null
          email: string
          expires_at: string | null
          id: string
          invitee_name: string | null
          invitee_phone: string | null
          role: string
          status: string
          token: string
          workspace_ids: string[] | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          created_by?: string | null
          email: string
          expires_at?: string | null
          id?: string
          invitee_name?: string | null
          invitee_phone?: string | null
          role?: string
          status?: string
          token?: string
          workspace_ids?: string[] | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          invitee_name?: string | null
          invitee_phone?: string | null
          role?: string
          status?: string
          token?: string
          workspace_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "company_invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          id: string
          invited_by: string | null
          joined_at: string | null
          role: string
          status: string
          user_id: string
        }
        Insert: {
          company_id: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          role?: string
          status?: string
          user_id: string
        }
        Update: {
          company_id?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          role?: string
          status?: string
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
          {
            foreignKeyName: "company_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_sending_window: {
        Row: {
          company_id: string
          created_at: string
          end_time: string
          start_time: string
          updated_at: string
          weekdays: number[]
        }
        Insert: {
          company_id: string
          created_at?: string
          end_time?: string
          start_time?: string
          updated_at?: string
          weekdays?: number[]
        }
        Update: {
          company_id?: string
          created_at?: string
          end_time?: string
          start_time?: string
          updated_at?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "company_sending_window_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      connection_health_daily: {
        Row: {
          connection_id: string
          connection_type: string
          created_at: string
          date: string
          delivery_rate: number
          id: string
          messages_delivered: number
          messages_failed: number
          messages_read: number
          messages_sent: number
          read_rate: number
          unique_contacts: number
        }
        Insert: {
          connection_id: string
          connection_type?: string
          created_at?: string
          date: string
          delivery_rate?: number
          id?: string
          messages_delivered?: number
          messages_failed?: number
          messages_read?: number
          messages_sent?: number
          read_rate?: number
          unique_contacts?: number
        }
        Update: {
          connection_id?: string
          connection_type?: string
          created_at?: string
          date?: string
          delivery_rate?: number
          id?: string
          messages_delivered?: number
          messages_failed?: number
          messages_read?: number
          messages_sent?: number
          read_rate?: number
          unique_contacts?: number
        }
        Relationships: []
      }
      connection_workspaces: {
        Row: {
          connection_id: string
          connection_type: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          keywords: string[] | null
          priority: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          connection_id: string
          connection_type: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          keywords?: string[] | null
          priority?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          connection_id?: string
          connection_type?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          keywords?: string[] | null
          priority?: number | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connection_workspaces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_agent_calendars: {
        Row: {
          agent_id: string
          created_at: string | null
          default_appointment_duration: number | null
          id: string
          min_interval_between_appointments: number | null
          timezone: string | null
          updated_at: string | null
          work_days: string[] | null
          work_end_time: string | null
          work_start_time: string | null
          workspace_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string | null
          default_appointment_duration?: number | null
          id?: string
          min_interval_between_appointments?: number | null
          timezone?: string | null
          updated_at?: string | null
          work_days?: string[] | null
          work_end_time?: string | null
          work_start_time?: string | null
          workspace_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string | null
          default_appointment_duration?: number | null
          id?: string
          min_interval_between_appointments?: number | null
          timezone?: string | null
          updated_at?: string | null
          work_days?: string[] | null
          work_end_time?: string | null
          work_start_time?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_agent_calendars_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_agent_calendars_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_appointment_reminders: {
        Row: {
          appointment_id: string
          created_at: string | null
          error_message: string | null
          id: string
          reminder_type: string | null
          scheduled_time: string
          sent_at: string | null
          status: string | null
        }
        Insert: {
          appointment_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          reminder_type?: string | null
          scheduled_time: string
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          appointment_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          reminder_type?: string | null
          scheduled_time?: string
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_appointment_reminders_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "crm_appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_appointments: {
        Row: {
          actual_duration_seconds: number | null
          additional_attendees: string[] | null
          analysis_playbook_id: string | null
          assigned_to: string | null
          attendees: string[] | null
          contact_id: string
          contact_joined: boolean | null
          contact_joined_at: string | null
          created_at: string | null
          created_by: string | null
          daily_room_name: string | null
          daily_room_url: string | null
          description: string | null
          duration_minutes: number | null
          end_time: string
          google_event_id: string | null
          id: string
          is_synced_to_google: boolean | null
          lead_id: string
          location: string | null
          meeting_ended_at: string | null
          meeting_link: string | null
          meeting_started_at: string | null
          meeting_type: string | null
          notes: string | null
          recording_id: string | null
          reminder_1_hours: number | null
          reminder_1_sent: boolean | null
          reminder_2_hours: number | null
          reminder_2_sent: boolean | null
          scheduling_widget_id: string | null
          start_time: string
          status: string | null
          title: string
          updated_at: string | null
          widget_qualification: Json | null
          workspace_id: string
        }
        Insert: {
          actual_duration_seconds?: number | null
          additional_attendees?: string[] | null
          analysis_playbook_id?: string | null
          assigned_to?: string | null
          attendees?: string[] | null
          contact_id: string
          contact_joined?: boolean | null
          contact_joined_at?: string | null
          created_at?: string | null
          created_by?: string | null
          daily_room_name?: string | null
          daily_room_url?: string | null
          description?: string | null
          duration_minutes?: number | null
          end_time: string
          google_event_id?: string | null
          id?: string
          is_synced_to_google?: boolean | null
          lead_id: string
          location?: string | null
          meeting_ended_at?: string | null
          meeting_link?: string | null
          meeting_started_at?: string | null
          meeting_type?: string | null
          notes?: string | null
          recording_id?: string | null
          reminder_1_hours?: number | null
          reminder_1_sent?: boolean | null
          reminder_2_hours?: number | null
          reminder_2_sent?: boolean | null
          scheduling_widget_id?: string | null
          start_time: string
          status?: string | null
          title: string
          updated_at?: string | null
          widget_qualification?: Json | null
          workspace_id: string
        }
        Update: {
          actual_duration_seconds?: number | null
          additional_attendees?: string[] | null
          analysis_playbook_id?: string | null
          assigned_to?: string | null
          attendees?: string[] | null
          contact_id?: string
          contact_joined?: boolean | null
          contact_joined_at?: string | null
          created_at?: string | null
          created_by?: string | null
          daily_room_name?: string | null
          daily_room_url?: string | null
          description?: string | null
          duration_minutes?: number | null
          end_time?: string
          google_event_id?: string | null
          id?: string
          is_synced_to_google?: boolean | null
          lead_id?: string
          location?: string | null
          meeting_ended_at?: string | null
          meeting_link?: string | null
          meeting_started_at?: string | null
          meeting_type?: string | null
          notes?: string | null
          recording_id?: string | null
          reminder_1_hours?: number | null
          reminder_1_sent?: boolean | null
          reminder_2_hours?: number | null
          reminder_2_sent?: boolean | null
          scheduling_widget_id?: string | null
          start_time?: string
          status?: string | null
          title?: string
          updated_at?: string | null
          widget_qualification?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_appointments_analysis_playbook_id_fkey"
            columns: ["analysis_playbook_id"]
            isOneToOne: false
            referencedRelation: "analysis_playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_appointments_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_appointments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_appointments_scheduling_widget_id_fkey"
            columns: ["scheduling_widget_id"]
            isOneToOne: false
            referencedRelation: "scheduling_widgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_appointments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automove_log: {
        Row: {
          created_at: string | null
          from_stage_id: string | null
          id: string
          lead_id: string
          psychology_snapshot: Json | null
          reason: string | null
          rule_id: string | null
          to_stage_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          from_stage_id?: string | null
          id?: string
          lead_id: string
          psychology_snapshot?: Json | null
          reason?: string | null
          rule_id?: string | null
          to_stage_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          from_stage_id?: string | null
          id?: string
          lead_id?: string
          psychology_snapshot?: Json | null
          reason?: string | null
          rule_id?: string | null
          to_stage_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automove_log_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automove_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automove_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "crm_automove_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automove_log_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automove_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automove_rules: {
        Row: {
          condition_operator: string
          condition_type: string
          condition_value: string
          created_at: string | null
          created_by: string | null
          description: string | null
          from_stage_id: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          priority: number | null
          to_stage_id: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          condition_operator: string
          condition_type: string
          condition_value: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          from_stage_id?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          priority?: number | null
          to_stage_id?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          condition_operator?: string
          condition_type?: string
          condition_value?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          from_stage_id?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          priority?: number | null
          to_stage_id?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automove_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automove_rules_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automove_rules_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automove_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_field_history: {
        Row: {
          changed_by: string | null
          changed_by_kind: string
          contact_id: string
          created_at: string
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          source: string | null
          workspace_id: string
        }
        Insert: {
          changed_by?: string | null
          changed_by_kind: string
          contact_id: string
          created_at?: string
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string | null
          workspace_id: string
        }
        Update: {
          changed_by?: string | null
          changed_by_kind?: string
          contact_id?: string
          created_at?: string
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_field_history_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_sources: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_sources_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          ab_test: string | null
          ab_var: string | null
          ab_vid: string | null
          anonymized_at: string | null
          company: string | null
          created_at: string | null
          created_by: string | null
          custom_fields: Json | null
          deactivated_at: string | null
          deactivated_by: string | null
          dnia_id: string | null
          email: string | null
          employee_count: string | null
          id: string
          is_active: boolean | null
          is_anonymized: boolean | null
          job_title: string | null
          lead_id: string | null
          name: string
          notes: string | null
          opted_out: boolean | null
          opted_out_at: string | null
          phone: string | null
          position: string | null
          reactivated_at: string | null
          reactivated_by: string | null
          revenue: string | null
          scheduling_blocked: boolean
          source: string | null
          status: string | null
          tags: Json | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          ab_test?: string | null
          ab_var?: string | null
          ab_vid?: string | null
          anonymized_at?: string | null
          company?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_fields?: Json | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          dnia_id?: string | null
          email?: string | null
          employee_count?: string | null
          id?: string
          is_active?: boolean | null
          is_anonymized?: boolean | null
          job_title?: string | null
          lead_id?: string | null
          name: string
          notes?: string | null
          opted_out?: boolean | null
          opted_out_at?: string | null
          phone?: string | null
          position?: string | null
          reactivated_at?: string | null
          reactivated_by?: string | null
          revenue?: string | null
          scheduling_blocked?: boolean
          source?: string | null
          status?: string | null
          tags?: Json | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          ab_test?: string | null
          ab_var?: string | null
          ab_vid?: string | null
          anonymized_at?: string | null
          company?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_fields?: Json | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          dnia_id?: string | null
          email?: string | null
          employee_count?: string | null
          id?: string
          is_active?: boolean | null
          is_anonymized?: boolean | null
          job_title?: string | null
          lead_id?: string | null
          name?: string
          notes?: string | null
          opted_out?: boolean | null
          opted_out_at?: string | null
          phone?: string | null
          position?: string | null
          reactivated_at?: string | null
          reactivated_by?: string | null
          revenue?: string | null
          scheduling_blocked?: boolean
          source?: string | null
          status?: string | null
          tags?: Json | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_flow_runs: {
        Row: {
          context: Json
          current_node_id: string | null
          entered_at: string
          exit_reason: string | null
          flow_id: string
          id: string
          lead_id: string
          lock_token: string | null
          locked_until: string | null
          state: string
          updated_at: string
          wakeup_at: string
          workspace_id: string
        }
        Insert: {
          context?: Json
          current_node_id?: string | null
          entered_at?: string
          exit_reason?: string | null
          flow_id: string
          id?: string
          lead_id: string
          lock_token?: string | null
          locked_until?: string | null
          state?: string
          updated_at?: string
          wakeup_at?: string
          workspace_id: string
        }
        Update: {
          context?: Json
          current_node_id?: string | null
          entered_at?: string
          exit_reason?: string | null
          flow_id?: string
          id?: string
          lead_id?: string
          lock_token?: string | null
          locked_until?: string | null
          state?: string
          updated_at?: string
          wakeup_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_flow_runs_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "crm_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_flow_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_flow_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_flow_step_log: {
        Row: {
          detail: Json
          flow_id: string
          id: string
          lead_id: string | null
          node_id: string
          node_type: string
          occurred_at: string
          result: string
          run_id: string
        }
        Insert: {
          detail?: Json
          flow_id: string
          id?: string
          lead_id?: string | null
          node_id: string
          node_type: string
          occurred_at?: string
          result: string
          run_id: string
        }
        Update: {
          detail?: Json
          flow_id?: string
          id?: string
          lead_id?: string | null
          node_id?: string
          node_type?: string
          occurred_at?: string
          result?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_flow_step_log_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "crm_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_flow_step_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_flow_step_log_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "crm_flow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_flows: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          entry_node_id: string | null
          exit_on_stage_change: boolean
          id: string
          name: string
          nodes: Json
          reentry: string
          reentry_cooldown_hours: number
          stage_id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          entry_node_id?: string | null
          exit_on_stage_change?: boolean
          id?: string
          name: string
          nodes?: Json
          reentry?: string
          reentry_cooldown_hours?: number
          stage_id: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          entry_node_id?: string | null
          exit_on_stage_change?: boolean
          id?: string
          name?: string
          nodes?: Json
          reentry?: string
          reentry_cooldown_hours?: number
          stage_id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_flows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_flows_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_flows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_google_calendar_integration: {
        Row: {
          auto_create_events: boolean | null
          auto_sync_events: boolean | null
          created_at: string | null
          google_access_token: string | null
          google_calendar_id: string | null
          google_email: string | null
          google_refresh_token: string | null
          id: string
          is_enabled: boolean | null
          last_sync_at: string | null
          token_expires_at: string | null
          updated_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          auto_create_events?: boolean | null
          auto_sync_events?: boolean | null
          created_at?: string | null
          google_access_token?: string | null
          google_calendar_id?: string | null
          google_email?: string | null
          google_refresh_token?: string | null
          id?: string
          is_enabled?: boolean | null
          last_sync_at?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          auto_create_events?: boolean | null
          auto_sync_events?: boolean | null
          created_at?: string | null
          google_access_token?: string | null
          google_calendar_id?: string | null
          google_email?: string | null
          google_refresh_token?: string | null
          id?: string
          is_enabled?: boolean | null
          last_sync_at?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_google_calendar_integration_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_google_calendar_integration_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_holidays: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_holidays_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_activities: {
        Row: {
          analysis_playbook_id: string | null
          appointment_id: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          duration_minutes: number | null
          id: string
          last_call_id: string | null
          lead_id: string
          no_show_reason: string | null
          scheduled_at: string
          status: string | null
          title: string
          type: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          analysis_playbook_id?: string | null
          appointment_id?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          duration_minutes?: number | null
          id?: string
          last_call_id?: string | null
          lead_id: string
          no_show_reason?: string | null
          scheduled_at: string
          status?: string | null
          title: string
          type: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          analysis_playbook_id?: string | null
          appointment_id?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          duration_minutes?: number | null
          id?: string
          last_call_id?: string | null
          lead_id?: string
          no_show_reason?: string | null
          scheduled_at?: string
          status?: string | null
          title?: string
          type?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_activities_analysis_playbook_id_fkey"
            columns: ["analysis_playbook_id"]
            isOneToOne: false
            referencedRelation: "analysis_playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_activities_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "crm_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_activities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_activities_last_call_id_fkey"
            columns: ["last_call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_activities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_attribute_sections: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          section_key: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          section_key: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          section_key?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_attribute_sections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_history: {
        Row: {
          action: string | null
          created_at: string | null
          created_by: string | null
          from_stage_id: string | null
          id: string
          lead_id: string
          moved_by: string
          notes: string | null
          reason: string | null
          to_stage_id: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          created_by?: string | null
          from_stage_id?: string | null
          id?: string
          lead_id: string
          moved_by: string
          notes?: string | null
          reason?: string | null
          to_stage_id?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          created_by?: string | null
          from_stage_id?: string | null
          id?: string
          lead_id?: string
          moved_by?: string
          notes?: string | null
          reason?: string | null
          to_stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_history_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_history_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_objections: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          lead_id: string
          objection_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id: string
          objection_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string
          objection_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_objections_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_objections_objection_id_fkey"
            columns: ["objection_id"]
            isOneToOne: false
            referencedRelation: "crm_objections"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_pains: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          lead_id: string
          pain_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id: string
          pain_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string
          pain_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_pains_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_pains_pain_id_fkey"
            columns: ["pain_id"]
            isOneToOne: false
            referencedRelation: "crm_pains"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_psychology: {
        Row: {
          ai_insights: string | null
          analysis_text: string | null
          analyzed_at: string | null
          analyzed_by: string | null
          created_at: string | null
          decision_process: Json | null
          dimension_decisao: number | null
          dimension_engajamento: number | null
          dimension_inteligencia: number | null
          dimension_intencao: number | null
          dimension_investimento: number | null
          dimension_potencial: number | null
          dna_code: string | null
          emotional_keywords: string[] | null
          id: string
          lead_id: string
          opportunity_score: number | null
          propensity_score: number | null
          risk_score: number | null
          sales_strategy: Json | null
          self_sabotage_patterns: string[] | null
          selling_playbook: Json | null
          sources_used: Json | null
          temperatura: string | null
          top_desires: Json | null
          top_pains: Json | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          ai_insights?: string | null
          analysis_text?: string | null
          analyzed_at?: string | null
          analyzed_by?: string | null
          created_at?: string | null
          decision_process?: Json | null
          dimension_decisao?: number | null
          dimension_engajamento?: number | null
          dimension_inteligencia?: number | null
          dimension_intencao?: number | null
          dimension_investimento?: number | null
          dimension_potencial?: number | null
          dna_code?: string | null
          emotional_keywords?: string[] | null
          id?: string
          lead_id: string
          opportunity_score?: number | null
          propensity_score?: number | null
          risk_score?: number | null
          sales_strategy?: Json | null
          self_sabotage_patterns?: string[] | null
          selling_playbook?: Json | null
          sources_used?: Json | null
          temperatura?: string | null
          top_desires?: Json | null
          top_pains?: Json | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          ai_insights?: string | null
          analysis_text?: string | null
          analyzed_at?: string | null
          analyzed_by?: string | null
          created_at?: string | null
          decision_process?: Json | null
          dimension_decisao?: number | null
          dimension_engajamento?: number | null
          dimension_inteligencia?: number | null
          dimension_intencao?: number | null
          dimension_investimento?: number | null
          dimension_potencial?: number | null
          dna_code?: string | null
          emotional_keywords?: string[] | null
          id?: string
          lead_id?: string
          opportunity_score?: number | null
          propensity_score?: number | null
          risk_score?: number | null
          sales_strategy?: Json | null
          self_sabotage_patterns?: string[] | null
          selling_playbook?: Json | null
          sources_used?: Json | null
          temperatura?: string | null
          top_desires?: Json | null
          top_pains?: Json | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_psychology_analyzed_by_fkey"
            columns: ["analyzed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_psychology_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_psychology_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          agent_id: string | null
          alert_notified_at: string | null
          assigned_to: string | null
          closed_at: string | null
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          is_icp: boolean | null
          loss_reason_id: string | null
          moved_at: string | null
          notes: string | null
          position: number | null
          product_id: string | null
          segment_id: string | null
          stage_id: string
          status: string | null
          title: string | null
          updated_at: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          value: number | null
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          alert_notified_at?: string | null
          assigned_to?: string | null
          closed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_icp?: boolean | null
          loss_reason_id?: string | null
          moved_at?: string | null
          notes?: string | null
          position?: number | null
          product_id?: string | null
          segment_id?: string | null
          stage_id: string
          status?: string | null
          title?: string | null
          updated_at?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          value?: number | null
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          alert_notified_at?: string | null
          assigned_to?: string | null
          closed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_icp?: boolean | null
          loss_reason_id?: string | null
          moved_at?: string | null
          notes?: string | null
          position?: number | null
          product_id?: string | null
          segment_id?: string | null
          stage_id?: string
          status?: string | null
          title?: string | null
          updated_at?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          value?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_loss_reason_id_fkey"
            columns: ["loss_reason_id"]
            isOneToOne: false
            referencedRelation: "crm_loss_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "crm_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "crm_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_loss_reasons: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_loss_reasons_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_objections: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      crm_pains: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      crm_pipeline_stages: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          danger_after_hours: number
          description: string | null
          id: string
          is_default: boolean | null
          meta_event_is_custom: boolean
          meta_event_name: string | null
          name: string
          order: number
          position: number | null
          updated_at: string | null
          warning_after_hours: number
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          danger_after_hours?: number
          description?: string | null
          id?: string
          is_default?: boolean | null
          meta_event_is_custom?: boolean
          meta_event_name?: string | null
          name: string
          order: number
          position?: number | null
          updated_at?: string | null
          warning_after_hours?: number
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          danger_after_hours?: number
          description?: string | null
          id?: string
          is_default?: boolean | null
          meta_event_is_custom?: boolean
          meta_event_name?: string | null
          name?: string
          order?: number
          position?: number | null
          updated_at?: string | null
          warning_after_hours?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipeline_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_products: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          price: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          price?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_segments: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_segments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_stage_loss_reasons: {
        Row: {
          created_at: string
          loss_reason_id: string
          stage_id: string
        }
        Insert: {
          created_at?: string
          loss_reason_id: string
          stage_id: string
        }
        Update: {
          created_at?: string
          loss_reason_id?: string
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_stage_loss_reasons_loss_reason_id_fkey"
            columns: ["loss_reason_id"]
            isOneToOne: false
            referencedRelation: "crm_loss_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_stage_loss_reasons_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_meeting_participants: {
        Row: {
          appointment_id: string
          created_at: string
          id: string
          is_owner: boolean
          joined_at: string
          participant_id: string
          user_name: string | null
        }
        Insert: {
          appointment_id: string
          created_at?: string
          id?: string
          is_owner?: boolean
          joined_at?: string
          participant_id: string
          user_name?: string | null
        }
        Update: {
          appointment_id?: string
          created_at?: string
          id?: string
          is_owner?: boolean
          joined_at?: string
          participant_id?: string
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_meeting_participants_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "crm_appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_recording_recovery_jobs: {
        Row: {
          appointment_id: string
          attempts: number
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          recovery_type: string
          requested_by: string
          result: Json | null
          started_at: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          appointment_id: string
          attempts?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          recovery_type?: string
          requested_by: string
          result?: Json | null
          started_at?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          appointment_id?: string
          attempts?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          recovery_type?: string
          requested_by?: string
          result?: Json | null
          started_at?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_recording_recovery_jobs_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "crm_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_recording_recovery_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_recordings: {
        Row: {
          ai_analysis: string | null
          appointment_id: string
          chat_messages: Json
          created_at: string
          duration_seconds: number | null
          id: string
          recording_url: string | null
          status: string
          transcription_text: string | null
          transcription_url: string | null
          workspace_id: string
        }
        Insert: {
          ai_analysis?: string | null
          appointment_id: string
          chat_messages?: Json
          created_at?: string
          duration_seconds?: number | null
          id?: string
          recording_url?: string | null
          status?: string
          transcription_text?: string | null
          transcription_url?: string | null
          workspace_id: string
        }
        Update: {
          ai_analysis?: string | null
          appointment_id?: string
          chat_messages?: Json
          created_at?: string
          duration_seconds?: number | null
          id?: string
          recording_url?: string | null
          status?: string
          transcription_text?: string | null
          transcription_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_recordings_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "crm_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_recordings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_webhook_health: {
        Row: {
          consecutive_failures: number
          created_at: string
          last_failure_at: string | null
          last_recreated_at: string | null
          last_state: string | null
          last_success_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          last_failure_at?: string | null
          last_recreated_at?: string | null
          last_state?: string | null
          last_success_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          last_failure_at?: string | null
          last_recreated_at?: string | null
          last_state?: string | null
          last_success_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      data_deletion_log: {
        Row: {
          action_type: string
          customer_identifier_hash: string
          error_details: string | null
          executed_at: string
          id: string
          records_affected_count: number
          requested_by: string
          status: string
          tables_affected: Json
          workspace_id: string
        }
        Insert: {
          action_type: string
          customer_identifier_hash: string
          error_details?: string | null
          executed_at?: string
          id?: string
          records_affected_count?: number
          requested_by: string
          status?: string
          tables_affected?: Json
          workspace_id: string
        }
        Update: {
          action_type?: string
          customer_identifier_hash?: string
          error_details?: string | null
          executed_at?: string
          id?: string
          records_affected_count?: number
          requested_by?: string
          status?: string
          tables_affected?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_deletion_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      document_processing_jobs: {
        Row: {
          chunks_created: number | null
          created_at: string
          embedding_status: string | null
          embeddings_generated: number | null
          embeddings_total: number | null
          error_message: string | null
          file_size: number
          filename: string
          id: string
          knowledge_base_id: string
          max_pages: number | null
          started_at: string | null
          status: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          chunks_created?: number | null
          created_at?: string
          embedding_status?: string | null
          embeddings_generated?: number | null
          embeddings_total?: number | null
          error_message?: string | null
          file_size: number
          filename: string
          id?: string
          knowledge_base_id: string
          max_pages?: number | null
          started_at?: string | null
          status?: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          chunks_created?: number | null
          created_at?: string
          embedding_status?: string | null
          embeddings_generated?: number | null
          embeddings_total?: number | null
          error_message?: string | null
          file_size?: number
          filename?: string
          id?: string
          knowledge_base_id?: string
          max_pages?: number | null
          started_at?: string | null
          status?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_processing_jobs_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          content: string
          created_at: string | null
          embedding: string | null
          id: number
          knowledge_base_id: string
          metadata: Json | null
        }
        Insert: {
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: never
          knowledge_base_id: string
          metadata?: Json | null
        }
        Update: {
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: never
          knowledge_base_id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_bases: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_bases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by_agent_id: string | null
          assigned_to_user_id: string
          category_id: string | null
          completed_at: string | null
          created_at: string | null
          id: string
          lead_id: string
          notes: string | null
          priority: string | null
          reason: string | null
          result: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by_agent_id?: string | null
          assigned_to_user_id: string
          category_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          lead_id: string
          notes?: string | null
          priority?: string | null
          reason?: string | null
          result?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by_agent_id?: string | null
          assigned_to_user_id?: string
          category_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string
          notes?: string | null
          priority?: string | null
          reason?: string | null
          result?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_assignments_assigned_by_agent_id_fkey"
            columns: ["assigned_by_agent_id"]
            isOneToOne: false
            referencedRelation: "agent_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chat_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_history: {
        Row: {
          agent_id: string
          assigned_to_user_id: string | null
          category_id: string | null
          conversation_summary: string | null
          created_at: string | null
          id: string
          lead_id: string
          lead_name: string | null
          lead_phone: string
          result: string | null
          status: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          agent_id: string
          assigned_to_user_id?: string | null
          category_id?: string | null
          conversation_summary?: string | null
          created_at?: string | null
          id?: string
          lead_id: string
          lead_name?: string | null
          lead_phone: string
          result?: string | null
          status: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          agent_id?: string
          assigned_to_user_id?: string | null
          category_id?: string | null
          conversation_summary?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string
          lead_name?: string | null
          lead_phone?: string
          result?: string | null
          status?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_history_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_history_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_history_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chat_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_queues: {
        Row: {
          agent_id: string | null
          assigned_at: string | null
          assigned_to_user_id: string | null
          category_id: string | null
          completed_at: string | null
          created_at: string | null
          id: string
          lead_id: string
          lead_name: string | null
          lead_phone: string
          priority: number | null
          status: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          assigned_at?: string | null
          assigned_to_user_id?: string | null
          category_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          lead_id: string
          lead_name?: string | null
          lead_phone: string
          priority?: number | null
          status?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          assigned_at?: string | null
          assigned_to_user_id?: string | null
          category_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string
          lead_name?: string | null
          lead_phone?: string
          priority?: number | null
          status?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_queues_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_queues_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_queues_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chat_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_queues_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_read_state: {
        Row: {
          last_read_at: string
          lead_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          last_read_at?: string
          lead_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          last_read_at?: string
          lead_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_read_state_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          ai_summary: string | null
          anonymized_at: string | null
          assigned_agent_id: string | null
          assigned_at: string | null
          assigned_to_user_id: string | null
          contact_id: string | null
          created_at: string | null
          id: string
          insights: Json | null
          is_anonymized: boolean | null
          is_test: boolean | null
          last_message_at: string | null
          merged_into_lead_id: string | null
          name: string | null
          notes: string | null
          pending_email_confirmation: string | null
          pending_scheduling_action: Json | null
          phone: string | null
          source: string | null
          status: Database["public"]["Enums"]["lead_status"] | null
          tags: string[] | null
          workspace_id: string
        }
        Insert: {
          ai_summary?: string | null
          anonymized_at?: string | null
          assigned_agent_id?: string | null
          assigned_at?: string | null
          assigned_to_user_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          id?: string
          insights?: Json | null
          is_anonymized?: boolean | null
          is_test?: boolean | null
          last_message_at?: string | null
          merged_into_lead_id?: string | null
          name?: string | null
          notes?: string | null
          pending_email_confirmation?: string | null
          pending_scheduling_action?: Json | null
          phone?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          tags?: string[] | null
          workspace_id: string
        }
        Update: {
          ai_summary?: string | null
          anonymized_at?: string | null
          assigned_agent_id?: string | null
          assigned_at?: string | null
          assigned_to_user_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          id?: string
          insights?: Json | null
          is_anonymized?: boolean | null
          is_test?: boolean | null
          last_message_at?: string | null
          merged_into_lead_id?: string | null
          name?: string | null
          notes?: string | null
          pending_email_confirmation?: string | null
          pending_scheduling_action?: Json | null
          phone?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          tags?: string[] | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_merged_into_lead_id_fkey"
            columns: ["merged_into_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_analysis_prompts: {
        Row: {
          activity_type: string
          company_id: string
          created_at: string | null
          id: string
          prompt_text: string
          updated_at: string | null
        }
        Insert: {
          activity_type: string
          company_id: string
          created_at?: string | null
          id?: string
          prompt_text: string
          updated_at?: string | null
        }
        Update: {
          activity_type?: string
          company_id?: string
          created_at?: string | null
          id?: string
          prompt_text?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_analysis_prompts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_transcript_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          embedding: string | null
          end_ts: string
          id: string
          meeting_id: string
          speakers: string[]
          start_ts: string
          workspace_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          embedding?: string | null
          end_ts: string
          id?: string
          meeting_id: string
          speakers?: string[]
          start_ts: string
          workspace_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          embedding?: string | null
          end_ts?: string
          id?: string
          meeting_id?: string
          speakers?: string[]
          start_ts?: string
          workspace_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          agent_id: string | null
          content: string
          created_at: string | null
          delivered_at: string | null
          delivery_error: string | null
          delivery_status: string | null
          external_message_id: string | null
          id: number
          lead_id: string
          media_type: string | null
          media_url: string | null
          read_at: string | null
          reply_to_content: string | null
          reply_to_external_id: string | null
          reply_to_sender_type:
            | Database["public"]["Enums"]["sender_type"]
            | null
          responding_agent_id: string | null
          sender_type: Database["public"]["Enums"]["sender_type"]
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          content: string
          created_at?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          delivery_status?: string | null
          external_message_id?: string | null
          id?: never
          lead_id: string
          media_type?: string | null
          media_url?: string | null
          read_at?: string | null
          reply_to_content?: string | null
          reply_to_external_id?: string | null
          reply_to_sender_type?:
            | Database["public"]["Enums"]["sender_type"]
            | null
          responding_agent_id?: string | null
          sender_type: Database["public"]["Enums"]["sender_type"]
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          content?: string
          created_at?: string | null
          delivered_at?: string | null
          delivery_error?: string | null
          delivery_status?: string | null
          external_message_id?: string | null
          id?: never
          lead_id?: string
          media_type?: string | null
          media_url?: string | null
          read_at?: string | null
          reply_to_content?: string | null
          reply_to_external_id?: string | null
          reply_to_sender_type?:
            | Database["public"]["Enums"]["sender_type"]
            | null
          responding_agent_id?: string | null
          sender_type?: Database["public"]["Enums"]["sender_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_capi_events: {
        Row: {
          contact_id: string | null
          custom_data: Json | null
          event_id: string
          event_name: string
          id: string
          lead_id: string | null
          pixel_id: string
          response_body: string | null
          response_status: number | null
          sent_at: string | null
          user_data: Json | null
          workspace_id: string
        }
        Insert: {
          contact_id?: string | null
          custom_data?: Json | null
          event_id: string
          event_name: string
          id?: string
          lead_id?: string | null
          pixel_id: string
          response_body?: string | null
          response_status?: number | null
          sent_at?: string | null
          user_data?: Json | null
          workspace_id: string
        }
        Update: {
          contact_id?: string | null
          custom_data?: Json | null
          event_id?: string
          event_name?: string
          id?: string
          lead_id?: string | null
          pixel_id?: string
          response_body?: string | null
          response_status?: number | null
          sent_at?: string | null
          user_data?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_capi_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_capi_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_capi_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          api4com_extension: string | null
          api4com_synced_at: string | null
          availability_status: string | null
          company_name: string | null
          created_at: string | null
          email: string
          id: string
          is_human: boolean | null
          max_concurrent_leads: number | null
          name: string | null
          phone: string | null
          resolution_rate: number | null
          specialties: string[] | null
          total_leads_handled: number | null
          user_type: string | null
        }
        Insert: {
          api4com_extension?: string | null
          api4com_synced_at?: string | null
          availability_status?: string | null
          company_name?: string | null
          created_at?: string | null
          email: string
          id: string
          is_human?: boolean | null
          max_concurrent_leads?: number | null
          name?: string | null
          phone?: string | null
          resolution_rate?: number | null
          specialties?: string[] | null
          total_leads_handled?: number | null
          user_type?: string | null
        }
        Update: {
          api4com_extension?: string | null
          api4com_synced_at?: string | null
          availability_status?: string | null
          company_name?: string | null
          created_at?: string | null
          email?: string
          id?: string
          is_human?: boolean | null
          max_concurrent_leads?: number | null
          name?: string | null
          phone?: string | null
          resolution_rate?: number | null
          specialties?: string[] | null
          total_leads_handled?: number | null
          user_type?: string | null
        }
        Relationships: []
      }
      scheduling_blocked_attempts: {
        Row: {
          answers: Json
          contact_id: string | null
          created_at: string
          failed_dimensions: string[]
          icp_config_snapshot: Json | null
          id: string
          lead_id: string | null
          widget_id: string
          workspace_id: string
        }
        Insert: {
          answers: Json
          contact_id?: string | null
          created_at?: string
          failed_dimensions?: string[]
          icp_config_snapshot?: Json | null
          id?: string
          lead_id?: string | null
          widget_id: string
          workspace_id: string
        }
        Update: {
          answers?: Json
          contact_id?: string | null
          created_at?: string
          failed_dimensions?: string[]
          icp_config_snapshot?: Json | null
          id?: string
          lead_id?: string | null
          widget_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduling_blocked_attempts_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "scheduling_widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduling_widget_members: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          user_id: string
          widget_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          user_id: string
          widget_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          user_id?: string
          widget_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduling_widget_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_widget_members_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "scheduling_widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduling_widgets: {
        Row: {
          analysis_playbook_id: string | null
          booking_window_days: number
          calendar_event_description_template: string | null
          calendar_event_title_template: string | null
          confirmation_email_enabled: boolean
          confirmation_email_subject: string | null
          confirmation_email_template: string | null
          confirmation_whatsapp_enabled: boolean
          confirmation_whatsapp_template: string
          created_at: string
          created_by: string | null
          description: string | null
          duration_minutes: number
          google_ads_conversions: Json | null
          google_ads_send_to: string | null
          icp_block_message: string
          icp_employee_counts: string[]
          icp_enabled: boolean
          icp_job_titles: string[]
          icp_revenue_ranges: string[]
          id: string
          is_active: boolean
          meta_pixel_id: string | null
          name: string
          style: Json
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          analysis_playbook_id?: string | null
          booking_window_days?: number
          calendar_event_description_template?: string | null
          calendar_event_title_template?: string | null
          confirmation_email_enabled?: boolean
          confirmation_email_subject?: string | null
          confirmation_email_template?: string | null
          confirmation_whatsapp_enabled?: boolean
          confirmation_whatsapp_template?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          google_ads_conversions?: Json | null
          google_ads_send_to?: string | null
          icp_block_message?: string
          icp_employee_counts?: string[]
          icp_enabled?: boolean
          icp_job_titles?: string[]
          icp_revenue_ranges?: string[]
          id?: string
          is_active?: boolean
          meta_pixel_id?: string | null
          name: string
          style?: Json
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          analysis_playbook_id?: string | null
          booking_window_days?: number
          calendar_event_description_template?: string | null
          calendar_event_title_template?: string | null
          confirmation_email_enabled?: boolean
          confirmation_email_subject?: string | null
          confirmation_email_template?: string | null
          confirmation_whatsapp_enabled?: boolean
          confirmation_whatsapp_template?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          google_ads_conversions?: Json | null
          google_ads_send_to?: string | null
          icp_block_message?: string
          icp_employee_counts?: string[]
          icp_enabled?: boolean
          icp_job_titles?: string[]
          icp_revenue_ranges?: string[]
          id?: string
          is_active?: boolean
          meta_pixel_id?: string | null
          name?: string
          style?: Json
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduling_widgets_analysis_playbook_id_fkey"
            columns: ["analysis_playbook_id"]
            isOneToOne: false
            referencedRelation: "analysis_playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_widgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_widgets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_achievements: {
        Row: {
          achievement_key: string
          company_id: string
          earned_at: string
          id: string
          meta: Json
          seller_id: string
        }
        Insert: {
          achievement_key: string
          company_id: string
          earned_at?: string
          id?: string
          meta?: Json
          seller_id: string
        }
        Update: {
          achievement_key?: string
          company_id?: string
          earned_at?: string
          id?: string
          meta?: Json
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_achievements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_achievements_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_coaching_briefs: {
        Row: {
          brief_md: string
          company_id: string
          generated_at: string
          generated_by: string | null
          id: string
          model: string | null
          seller_id: string
        }
        Insert: {
          brief_md: string
          company_id: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          model?: string | null
          seller_id: string
        }
        Update: {
          brief_md?: string
          company_id?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          model?: string | null
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_coaching_briefs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_coaching_briefs_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_coaching_briefs_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_development_points: {
        Row: {
          company_id: string
          corrected_at: string | null
          created_at: string
          first_seen_at: string
          id: string
          label: string | null
          last_seen_at: string
          occurrences: number
          playbook_id: string | null
          point_key: string
          point_type: string
          seller_id: string
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          corrected_at?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          label?: string | null
          last_seen_at?: string
          occurrences?: number
          playbook_id?: string | null
          point_key: string
          point_type: string
          seller_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          corrected_at?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          label?: string | null
          last_seen_at?: string
          occurrences?: number
          playbook_id?: string | null
          point_key?: string
          point_type?: string
          seller_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_development_points_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_development_points_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "analysis_playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_development_points_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_agent_templates: {
        Row: {
          created_at: string | null
          id: string
          template_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          template_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          template_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_agent_templates_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agent_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_agent_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_catalog: {
        Row: {
          category: string | null
          created_at: string | null
          default_config: Json | null
          description: string | null
          display_order: number | null
          function_schema: Json
          icon_name: string | null
          id: string
          is_active: boolean | null
          label: string
          name: string
          requires_setup: string[] | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          default_config?: Json | null
          description?: string | null
          display_order?: number | null
          function_schema: Json
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          label: string
          name: string
          requires_setup?: string[] | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          default_config?: Json | null
          description?: string | null
          display_order?: number | null
          function_schema?: Json
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          label?: string
          name?: string
          requires_setup?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_notifications: {
        Row: {
          action_url: string | null
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          read_at: string | null
          related_lead_id: string | null
          related_user_id: string | null
          title: string
          type: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          action_url?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          read_at?: string | null
          related_lead_id?: string | null
          related_user_id?: string | null
          title: string
          type: string
          user_id: string
          workspace_id: string
        }
        Update: {
          action_url?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          read_at?: string | null
          related_lead_id?: string | null
          related_user_id?: string | null
          title?: string
          type?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_related_user_id_fkey"
            columns: ["related_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_connections: {
        Row: {
          access_token: string
          business_account_id: string
          circuit_failure_count: number | null
          circuit_opened_at: string | null
          circuit_state: string | null
          created_at: string | null
          display_phone_number: string | null
          id: string
          is_active: boolean | null
          phone_number_id: string
          provider: string | null
          updated_at: string | null
          verified_name: string | null
          webhook_verify_token: string
          workspace_id: string
        }
        Insert: {
          access_token: string
          business_account_id: string
          circuit_failure_count?: number | null
          circuit_opened_at?: string | null
          circuit_state?: string | null
          created_at?: string | null
          display_phone_number?: string | null
          id?: string
          is_active?: boolean | null
          phone_number_id: string
          provider?: string | null
          updated_at?: string | null
          verified_name?: string | null
          webhook_verify_token?: string
          workspace_id: string
        }
        Update: {
          access_token?: string
          business_account_id?: string
          circuit_failure_count?: number | null
          circuit_opened_at?: string | null
          circuit_state?: string | null
          created_at?: string | null
          display_phone_number?: string | null
          id?: string
          is_active?: boolean | null
          phone_number_id?: string
          provider?: string | null
          updated_at?: string | null
          verified_name?: string | null
          webhook_verify_token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          connection_id: string
          contact_name: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          last_message_at: string | null
          lead_id: string | null
          phone_number: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          connection_id: string
          contact_name?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_message_at?: string | null
          lead_id?: string | null
          phone_number: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          connection_id?: string
          contact_name?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_message_at?: string | null
          lead_id?: string | null
          phone_number?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_message_templates: {
        Row: {
          category: string
          components: Json
          connection_id: string
          created_at: string
          id: string
          language: string
          meta_template_id: string | null
          name: string
          rejection_reason: string | null
          status: string
          synced_at: string | null
          updated_at: string
          variable_examples: Json | null
          variable_map: Json | null
          workspace_id: string
        }
        Insert: {
          category: string
          components?: Json
          connection_id: string
          created_at?: string
          id?: string
          language: string
          meta_template_id?: string | null
          name: string
          rejection_reason?: string | null
          status?: string
          synced_at?: string | null
          updated_at?: string
          variable_examples?: Json | null
          variable_map?: Json | null
          workspace_id: string
        }
        Update: {
          category?: string
          components?: Json
          connection_id?: string
          created_at?: string
          id?: string
          language?: string
          meta_template_id?: string | null
          name?: string
          rejection_reason?: string | null
          status?: string
          synced_at?: string | null
          updated_at?: string
          variable_examples?: Json | null
          variable_map?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_message_templates_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_message_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          id: string
          media_type: string | null
          media_url: string | null
          sender_type: string
          status: string | null
          whatsapp_message_id: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          sender_type: string
          status?: string | null
          whatsapp_message_id?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          sender_type?: string
          status?: string | null
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_send_log: {
        Row: {
          connection_id: string
          connection_type: string
          id: string
          lead_phone: string
          sent_at: string
        }
        Insert: {
          connection_id: string
          connection_type?: string
          id?: string
          lead_phone: string
          sent_at?: string
        }
        Update: {
          connection_id?: string
          connection_type?: string
          id?: string
          lead_phone?: string
          sent_at?: string
        }
        Relationships: []
      }
      widget_configs: {
        Row: {
          agent_id: string | null
          allowed_origins: string[] | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          settings: Json
          slug: string
          type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          allowed_origins?: string[] | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          settings?: Json
          slug: string
          type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          allowed_origins?: string[] | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          settings?: Json
          slug?: string
          type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "widget_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      widget_sessions: {
        Row: {
          created_at: string
          id: string
          last_activity_at: string
          lead_id: string | null
          meta_events_fired: Json | null
          session_token: string
          visitor_info: Json | null
          widget_config_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_activity_at?: string
          lead_id?: string | null
          meta_events_fired?: Json | null
          session_token: string
          visitor_info?: Json | null
          widget_config_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_activity_at?: string
          lead_id?: string | null
          meta_events_fired?: Json | null
          session_token?: string
          visitor_info?: Json | null
          widget_config_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "widget_sessions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "widget_sessions_widget_config_id_fkey"
            columns: ["widget_config_id"]
            isOneToOne: false
            referencedRelation: "widget_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          role: string
          status: string
          token: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          role?: string
          status?: string
          token?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          role?: string
          status?: string
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_meeting_settings: {
        Row: {
          agent_id: string | null
          agent_source: string
          ai_model: string
          auto_insights_delay_ms: number
          auto_insights_enabled: boolean
          created_at: string
          default_analysis_playbook_id: string | null
          enabled: boolean
          slot_step_minutes: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          agent_source?: string
          ai_model?: string
          auto_insights_delay_ms?: number
          auto_insights_enabled?: boolean
          created_at?: string
          default_analysis_playbook_id?: string | null
          enabled?: boolean
          slot_step_minutes?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          agent_source?: string
          ai_model?: string
          auto_insights_delay_ms?: number
          auto_insights_enabled?: boolean
          created_at?: string
          default_analysis_playbook_id?: string | null
          enabled?: boolean
          slot_step_minutes?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_meeting_settings_default_analysis_playbook_id_fkey"
            columns: ["default_analysis_playbook_id"]
            isOneToOne: false
            referencedRelation: "analysis_playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_meeting_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          id: string
          invited_by: string | null
          joined_at: string
          role: string
          status: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: string
          status?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: string
          status?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_routing_config: {
        Row: {
          auto_assign: boolean | null
          category_matching: boolean | null
          created_at: string | null
          fallback_strategy: string | null
          id: string
          max_leads_per_agent: number | null
          queue_timeout_minutes: number | null
          require_approval: boolean | null
          respect_card_owner: boolean
          scheduling_load_window_days: number
          scheduling_strategy: string
          skill_matching: boolean | null
          strategy: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          auto_assign?: boolean | null
          category_matching?: boolean | null
          created_at?: string | null
          fallback_strategy?: string | null
          id?: string
          max_leads_per_agent?: number | null
          queue_timeout_minutes?: number | null
          require_approval?: boolean | null
          respect_card_owner?: boolean
          scheduling_load_window_days?: number
          scheduling_strategy?: string
          skill_matching?: boolean | null
          strategy?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          auto_assign?: boolean | null
          category_matching?: boolean | null
          created_at?: string | null
          fallback_strategy?: string | null
          id?: string
          max_leads_per_agent?: number | null
          queue_timeout_minutes?: number | null
          require_approval?: boolean | null
          respect_card_owner?: boolean
          scheduling_load_window_days?: number
          scheduling_strategy?: string
          skill_matching?: boolean | null
          strategy?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_routing_config_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          company_id: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_default: boolean | null
          name: string
          owner_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          owner_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          owner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      zapi_connections: {
        Row: {
          api_token: string
          call_reject_auto: boolean | null
          call_reject_message: string | null
          circuit_failure_count: number | null
          circuit_opened_at: string | null
          circuit_state: string | null
          client_token: string | null
          created_at: string | null
          id: string
          instance_id: string
          instance_name: string | null
          is_active: boolean | null
          phone_number: string | null
          updated_at: string | null
          workspace_id: string
          zapi_connected: boolean | null
          zapi_created_at: string | null
          zapi_due: string | null
          zapi_instance_name: string | null
          zapi_payment_status: string | null
          zapi_validated_at: string | null
        }
        Insert: {
          api_token: string
          call_reject_auto?: boolean | null
          call_reject_message?: string | null
          circuit_failure_count?: number | null
          circuit_opened_at?: string | null
          circuit_state?: string | null
          client_token?: string | null
          created_at?: string | null
          id?: string
          instance_id: string
          instance_name?: string | null
          is_active?: boolean | null
          phone_number?: string | null
          updated_at?: string | null
          workspace_id: string
          zapi_connected?: boolean | null
          zapi_created_at?: string | null
          zapi_due?: string | null
          zapi_instance_name?: string | null
          zapi_payment_status?: string | null
          zapi_validated_at?: string | null
        }
        Update: {
          api_token?: string
          call_reject_auto?: boolean | null
          call_reject_message?: string | null
          circuit_failure_count?: number | null
          circuit_opened_at?: string | null
          circuit_state?: string | null
          client_token?: string | null
          created_at?: string | null
          id?: string
          instance_id?: string
          instance_name?: string | null
          is_active?: boolean | null
          phone_number?: string | null
          updated_at?: string | null
          workspace_id?: string
          zapi_connected?: boolean | null
          zapi_created_at?: string | null
          zapi_due?: string | null
          zapi_instance_name?: string | null
          zapi_payment_status?: string | null
          zapi_validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zapi_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      zapi_conversations: {
        Row: {
          connection_id: string
          contact_name: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          last_message_at: string | null
          lead_id: string | null
          phone_number: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          connection_id: string
          contact_name?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_message_at?: string | null
          lead_id?: string | null
          phone_number: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          connection_id?: string
          contact_name?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_message_at?: string | null
          lead_id?: string | null
          phone_number?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zapi_conversations_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "zapi_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zapi_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zapi_conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      zapi_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          delivered_at: string | null
          delivery_status: string | null
          id: string
          media_type: string | null
          media_url: string | null
          read_at: string | null
          sender_type: Database["public"]["Enums"]["zapi_sender_type"]
          status: string | null
          zapi_message_id: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          delivered_at?: string | null
          delivery_status?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          read_at?: string | null
          sender_type: Database["public"]["Enums"]["zapi_sender_type"]
          status?: string | null
          zapi_message_id?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          delivered_at?: string | null
          delivery_status?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          read_at?: string | null
          sender_type?: Database["public"]["Enums"]["zapi_sender_type"]
          status?: string | null
          zapi_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zapi_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "zapi_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      crm_lead_stage_durations: {
        Row: {
          entered_at: string | null
          exited_at: string | null
          is_current: boolean | null
          lead_id: string | null
          moved_by: string | null
          reason: string | null
          seconds: number | null
          stage_id: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _cadence_jitter: { Args: { p_unit: string }; Returns: string }
      _cadence_offset_interval: {
        Args: { p_unit: string; p_value: number }
        Returns: string
      }
      chat_load_by_user: {
        Args: { p_user_ids: string[]; p_workspace_id: string }
        Returns: {
          load: number
          user_id: string
        }[]
      }
      cleanup_old_send_logs: { Args: never; Returns: undefined }
      create_default_automove_rules: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      enqueue_activity_cadence: {
        Args: { p_activity_id: string }
        Returns: undefined
      }
      enqueue_stage_cadence: {
        Args: { p_entered_at: string; p_lead_id: string; p_stage_id: string }
        Returns: undefined
      }
      flow_claim_due_runs: {
        Args: { p_flow_id?: string; p_lease_seconds?: number; p_limit?: number }
        Returns: {
          company_id: string
          context: Json
          current_node_id: string
          entered_at: string
          flow_id: string
          lead_id: string
          lock_token: string
          nodes: Json
          run_id: string
          state: string
          workspace_id: string
        }[]
      }
      get_company_for_invite: {
        Args: { _company_id: string }
        Returns: {
          icon: string
          id: string
          name: string
        }[]
      }
      get_company_name_for_invite: {
        Args: { p_token: string }
        Returns: {
          company_id: string
          company_name: string
        }[]
      }
      get_company_secret_encrypted: {
        Args: { p_company_id: string; p_field: string }
        Returns: string
      }
      get_invite_by_token: {
        Args: { p_token: string }
        Returns: {
          company_id: string
          email: string
          expires_at: string
          id: string
          invitee_name: string
          role: string
          status: string
          workspace_ids: string[]
        }[]
      }
      get_unread_counts: {
        Args: { p_user_id: string; p_workspace_id: string }
        Returns: {
          lead_id: string
          unread_count: number
        }[]
      }
      get_workspace_invite_by_token: {
        Args: { _token: string }
        Returns: {
          email: string
          expires_at: string
          id: string
          role: string
          status: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_company_admin: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_company_invited: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_company_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_company_owner: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_workspace_admin_or_owner: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      match_documents: {
        Args: {
          filter_knowledge_base_ids?: string[]
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          content: string
          id: number
          knowledge_base_id: string
          metadata: Json
          similarity: number
        }[]
      }
      match_meeting_chunks: {
        Args: {
          p_exclude_after?: string
          p_match_count?: number
          p_meeting_id: string
          p_query_embedding: string
        }
        Returns: {
          content: string
          end_ts: string
          id: string
          similarity: number
          speakers: string[]
          start_ts: string
        }[]
      }
      meeting_ids_with_chunks: {
        Args: { p_meeting_ids: string[] }
        Returns: {
          meeting_id: string
        }[]
      }
      normalize_phone: { Args: { phone: string }; Returns: string }
      notify_stage_alerts: { Args: never; Returns: undefined }
      scheduling_load_by_user: {
        Args: {
          p_user_ids: string[]
          p_window_days: number
          p_workspace_id: string
        }
        Returns: {
          load: number
          user_id: string
        }[]
      }
      search_contacts_unaccent:
        | {
            Args: { p_search: string; p_workspace_id: string }
            Returns: {
              ab_test: string | null
              ab_var: string | null
              ab_vid: string | null
              anonymized_at: string | null
              company: string | null
              created_at: string | null
              created_by: string | null
              custom_fields: Json | null
              deactivated_at: string | null
              deactivated_by: string | null
              dnia_id: string | null
              email: string | null
              employee_count: string | null
              id: string
              is_active: boolean | null
              is_anonymized: boolean | null
              job_title: string | null
              lead_id: string | null
              name: string
              notes: string | null
              opted_out: boolean | null
              opted_out_at: string | null
              phone: string | null
              position: string | null
              reactivated_at: string | null
              reactivated_by: string | null
              revenue: string | null
              scheduling_blocked: boolean
              source: string | null
              status: string | null
              tags: Json | null
              updated_at: string | null
              workspace_id: string
            }[]
            SetofOptions: {
              from: "*"
              to: "crm_contacts"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              p_company?: string
              p_has_conversation?: string
              p_limit?: number
              p_offset?: number
              p_search: string
              p_sort_by?: string
              p_sort_order?: string
              p_source?: string
              p_workspace_id: string
            }
            Returns: {
              company: string
              created_at: string
              created_by: string
              custom_fields: Json
              email: string
              employee_count: string
              id: string
              is_active: boolean
              job_title: string
              lead_id: string
              name: string
              notes: string
              opted_out: boolean
              opted_out_at: string
              phone: string
              position: string
              revenue: string
              source: string
              status: string
              tags: Json
              updated_at: string
              workspace_id: string
            }[]
          }
        | {
            Args: {
              p_company?: string
              p_deleted_status?: string
              p_has_conversation?: string
              p_limit?: number
              p_offset?: number
              p_search: string
              p_sort_by?: string
              p_sort_order?: string
              p_source?: string
              p_workspace_id: string
            }
            Returns: {
              company: string
              created_at: string
              created_by: string
              custom_fields: Json
              email: string
              employee_count: string
              id: string
              is_active: boolean
              job_title: string
              lead_id: string
              name: string
              notes: string
              opted_out: boolean
              opted_out_at: string
              phone: string
              position: string
              revenue: string
              source: string
              status: string
              tags: Json
              updated_at: string
              workspace_id: string
            }[]
          }
      set_analysis_result_disregarded: {
        Args: { p_disregarded: boolean; p_result_id: string }
        Returns: {
          activity_id: string | null
          company_id: string
          corrected: Json
          created_at: string
          criteria_results: Json
          disregarded_at: string | null
          disregarded_by: string | null
          error_message: string | null
          habits: Json
          id: string
          improvements: Json
          lead_id: string | null
          model: string | null
          occurred_at: string
          playbook_id: string | null
          points_applied: boolean
          recurrences: Json
          rubric_version_id: string | null
          score: number | null
          seller_id: string | null
          seller_name: string | null
          source_id: string
          source_type: string
          status: string
          strengths: Json
          summary_md: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "activity_analysis_results"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      trigger_dnia_analysis: {
        Args: { p_lead_id: string; p_origin: string; p_workspace_id: string }
        Returns: undefined
      }
      unaccent: { Args: { "": string }; Returns: string }
      validate_crm_flow_graph: {
        Args: { p_entry_node_id: string; p_nodes: Json }
        Returns: undefined
      }
    }
    Enums: {
      agent_tone: "friendly" | "professional" | "aggressive"
      app_role: "super_admin" | "admin" | "member"
      call_status:
        | "initiated"
        | "ringing"
        | "answered"
        | "completed"
        | "no_answer"
        | "busy"
        | "failed"
        | "cancelled"
      call_transcription_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "skipped"
      lead_status:
        | "new"
        | "ai_talking"
        | "needs_human"
        | "closed"
        | "human_talking"
      sender_type: "ai" | "lead" | "human_agent"
      zapi_sender_type: "user" | "agent"
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
    Enums: {
      agent_tone: ["friendly", "professional", "aggressive"],
      app_role: ["super_admin", "admin", "member"],
      call_status: [
        "initiated",
        "ringing",
        "answered",
        "completed",
        "no_answer",
        "busy",
        "failed",
        "cancelled",
      ],
      call_transcription_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "skipped",
      ],
      lead_status: [
        "new",
        "ai_talking",
        "needs_human",
        "closed",
        "human_talking",
      ],
      sender_type: ["ai", "lead", "human_agent"],
      zapi_sender_type: ["user", "agent"],
    },
  },
} as const
