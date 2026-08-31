import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Search, ArrowRightLeft, Bot, User, Clock, Check, Loader2, PlusCircle, Power, MessageSquare, RefreshCw, Lock, AlertTriangle, UserCheck, Undo2, Tag, X, Plus, Archive, MoreVertical, LogOut, Menu, ChevronLeft, Info, FlaskConical, Trash2, Building2, Brain, Reply, Globe, WifiOff, QrCode, LinkIcon, FileText } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerTrigger, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { useIsMobile } from "@/hooks/use-mobile";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { Tables } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";
import { MessageContent } from "@/components/chat/MessageContent";
import { MediaMessage } from "@/components/chat/MediaMessage";
import { LeadInsights } from "@/components/chat/LeadInsights";
import { MessageStatusIndicator } from "@/components/chat/MessageStatusIndicator";
import { QuotedMessage } from "@/components/chat/QuotedMessage";
import { TransferDialog } from "@/components/chat/TransferDialog";
import { ChangeChannelDialog } from "@/components/chat/ChangeChannelDialog";
import { UnreadBadge } from "@/components/chat/UnreadBadge";

import { ChatInput } from "@/components/chat/ChatInput";
import { SendTemplateDialog } from "@/components/chat/SendTemplateDialog";
import { useWhatsappWindow, formatWindowRemaining } from "@/hooks/useWhatsappWindow";
import { friendlyWhatsappError } from "@/lib/whatsappErrors";
import { NewTestDialog } from "@/components/simulation/NewTestDialog";
import { DebugInsights } from "@/components/simulation/DebugInsights";
import { DNIABadge } from "@/components/crm/DNIABadge";
import { PsychologyModal } from "@/components/crm/PsychologyModal";
import { NewLeadDialog } from "@/components/crm/NewLeadDialog";
import { Json } from "@/integrations/supabase/types";
import { normalizePhone } from "@/lib/phone";
import { useCompany } from "@/contexts/CompanyContext";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

type Lead = Tables<"leads"> & { 
  tags?: string[] | null; 
  is_test?: boolean | null;
  contact_id?: string | null;
  contact?: {
    name: string;
    phone: string;
    email: string | null;
    company: string | null;
    is_active?: boolean | null;
  } | null;
};
type Message = Tables<"messages"> & {
  media_url?: string | null;
  media_type?: string | null;
  reply_to_content?: string | null;
  reply_to_sender_type?: 'lead' | 'ai' | 'human_agent' | null;
  external_message_id?: string | null;
};
type Agent = { id: string; name: string; category: string | null };
type AgentTransfer = { 
  id: string; 
  from_agent_id: string | null; 
  to_agent_id: string; 
  reason: string; 
  to_intent: string | null;
  created_at: string;
};
type LeadPsychology = {
  id: string;
  dna_code: string | null;
  temperatura: string | null;
  propensity_score: number | null;
  risk_score: number | null;
  opportunity_score: number | null;
  crm_lead_id: string | null;
};

const FAILED_AUDIO_MARKERS = [
  // With accents (legacy)
  "[Audio não transcrito]",
  "[Audio não disponível]",
  "[Audio - transcrição falhou]",
  "[Audio vazio ou em silêncio]",
  "[Audio não compreendido]",
  "[Audio - erro na transcrição]",
  // Without accents (from edge functions)
  "[Audio nao transcrito]",
  "[Audio nao disponivel]",
  "[Audio vazio ou em silencio]",
  // Fallback when transcription throws error
  "[Audio]",
  "AUDIO_VAZIO",
];

const isFailedAudioTranscription = (content: string | null): boolean => {
  if (!content) return true; // No content means transcription likely failed
  // Check for failure markers
  if (FAILED_AUDIO_MARKERS.some(marker => content.includes(marker))) return true;
  // If content is just "[Audio]" exactly, it's a failure
  if (content.trim() === "[Audio]") return true;
  // Audio messages should have "[Audio transcrito]:" prefix with actual text
  // If it has the prefix but the text is a failure marker, it's still a failure
  if (content.includes("[Audio transcrito]:")) {
    const afterPrefix = content.split("[Audio transcrito]:")[1]?.trim() || "";
    // Check if what follows is a failure marker
    return FAILED_AUDIO_MARKERS.some(marker => afterPrefix.includes(marker));
  }
  return false;
};

const statusConfig = {
  new: { label: "NOVO", className: "bg-primary/20 text-primary border-primary/30" },
  ai_talking: { label: "AI TALKING", className: "bg-success/20 text-success border-success/30" },
  needs_human: { label: "ATENÇÃO", className: "bg-destructive/20 text-destructive border-destructive/30" },
  human_talking: { label: "HUMANO", className: "bg-series-4/20 text-series-4 border-series-4/30" },
  closed: { label: "FECHADO", className: "bg-muted text-muted-foreground border-border" },
};

type ConnectionStatus = {
  is_active: boolean;
  zapi_connected: boolean | null;
  connection_id: string;
  connection_type: 'zapi' | 'whatsapp_official';
} | null;

const Inbox = () => {
  const { workspaceId, currentWorkspace } = useWorkspace();
  const { companyId } = useCompany();
  const { toast } = useToast();
  const { isAdmin } = useUserRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [transfers, setTransfers] = useState<AgentTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('lead') || null;
  });
  const selectedLeadIdRef = useRef<string | null>(selectedLeadId);
  // Unread message counts per lead (for chats linked to humans)
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const unreadMapRef = useRef<Record<string, number>>({});
  useEffect(() => { unreadMapRef.current = unreadMap; }, [unreadMap]);

  // Helper: select a lead and sync URL. Fetches the lead if missing from local state.
  const selectLead = useCallback(async (leadId: string | null) => {
    const finalLeadId = leadId;

    if (finalLeadId) {
      // If lead is not in local list (e.g. closed, beyond top 1000, filtered out),
      // fetch it directly so the chat panel can render.
      setLeads((prev) => {
        const exists = prev.some((l) => l.id === finalLeadId);
        if (!exists) {
          supabase
            .from("leads")
            .select(`*, contact:crm_contacts!contact_id(name, phone, email, company, is_active)`)
            .eq("id", finalLeadId!)
            .single()
            .then(({ data }) => {
              if (!data) return;
              if (data.merged_into_lead_id) {
                // Recursively resolve to the canonical (merged) lead
                selectLead(data.merged_into_lead_id);
                return;
              }
              setLeads((curr) =>
                curr.some((l) => l.id === data.id)
                  ? curr
                  : [data, ...curr]
              );
            });
        }
        return prev;
      });
    }

    setSelectedLeadId(finalLeadId);
    selectedLeadIdRef.current = finalLeadId;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (finalLeadId) {
        next.set('lead', finalLeadId);
      } else {
        next.delete('lead');
      }
      return next;
    }, { replace: true });

    // Mark as read: zera contador local e persiste last_read_at para o usuario atual
    if (finalLeadId) {
      setUnreadMap((prev) => {
        if (!prev[finalLeadId!]) return prev;
        const next = { ...prev };
        delete next[finalLeadId!];
        return next;
      });
      (async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          const { data: leadRow } = await supabase
            .from("leads")
            .select("workspace_id")
            .eq("id", finalLeadId!)
            .maybeSingle();
          if (!leadRow?.workspace_id) return;
          await supabase.from("lead_read_state").upsert({
            user_id: user.id,
            lead_id: finalLeadId!,
            workspace_id: leadRow.workspace_id,
            last_read_at: new Date().toISOString(),
          }, { onConflict: "user_id,lead_id" });
        } catch (e) {
          console.warn("Failed to upsert lead_read_state:", e);
        }
      })();
    }
  }, [setSearchParams]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterQualification, setFilterQualification] = useState<"qualified" | "all" | "unqualified">("qualified");
  // message state moved to ChatInput sub-component
  const [notes, setNotes] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Media upload state
  const [isSendingMedia, setIsSendingMedia] = useState(false);
  const [zapiConversationId, setZapiConversationId] = useState<string | null>(null);
  // isRecordingAudio, imageInputRef, videoInputRef, documentInputRef moved to ChatInput

  // Select Lead Dialog state
  const [isSelectLeadOpen, setIsSelectLeadOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [crmContacts, setCrmContacts] = useState<Array<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    company: string | null;
    lead_id: string | null;
  }>>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [isCreatingLead, setIsCreatingLead] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  
  // Transfer dialog and Handoff states
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [isChangeChannelOpen, setIsChangeChannelOpen] = useState(false);
  const [isHandoffLoading, setIsHandoffLoading] = useState(false);

  // VCard to Lead dialog state
  const [isNewLeadDialogOpen, setIsNewLeadDialogOpen] = useState(false);
  const [vcardLeadData, setVcardLeadData] = useState<{
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
    job_title?: string;
    description?: string;
  } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [assignedUserName, setAssignedUserName] = useState<string | null>(null);
  
  // Tags state
  const [newTag, setNewTag] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  
  // Lead Psychology state
  const [leadPsychology, setLeadPsychology] = useState<LeadPsychology | null>(null);
  const [isPsychologyModalOpen, setIsPsychologyModalOpen] = useState(false);
  
  // Mobile state
  const isMobile = useIsMobile();
  const [isMobileLeadListOpen, setIsMobileLeadListOpen] = useState(false);
  const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState(false);
  
  // Simulation state
  const [isNewTestDialogOpen, setIsNewTestDialogOpen] = useState(false);
  const [isClearingTests, setIsClearingTests] = useState(false);
  
  // Audio retranscription state
  const [reprocessingMessageId, setReprocessingMessageId] = useState<string | null>(null);

  // Connection status state
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(null);
  const [isReconnectModalOpen, setIsReconnectModalOpen] = useState(false);
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [isLoadingQRCode, setIsLoadingQRCode] = useState(false);
  const qrCodePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Get current user ID on mount
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id || null);
    };
    getUser();
  }, []);

  // Scroll to bottom when messages change - instant on load, smooth on new messages
  const isInitialLoad = useRef(true);
  
  useEffect(() => {
    if (isLoadingMessages) return;
    
    const scrollToBottom = () => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ 
          behavior: isInitialLoad.current ? "instant" : "smooth", 
          block: "end" 
        });
        isInitialLoad.current = false;
      }
    };
    const timeoutId = setTimeout(scrollToBottom, 50);
    return () => clearTimeout(timeoutId);
  }, [messages, isLoadingMessages]);
  
  // Reset initial load flag when lead changes
  useEffect(() => {
    isInitialLoad.current = true;
  }, [selectedLeadId]);

  // Fetch agents for workspace
  useEffect(() => {
    if (!workspaceId) {
      setAgents({});
      return;
    }

    const fetchAgents = async () => {
      // Fetch from both legacy agents and agent_instances tables
      const [legacyResult, instancesResult] = await Promise.all([
        supabase
          .from("agents")
          .select("id, name, category")
          .eq("workspace_id", workspaceId),
        supabase
          .from("agent_instances")
          .select("id, name, category")
          .eq("workspace_id", workspaceId)
      ]);

      if (legacyResult.error) {
        console.error("Error fetching legacy agents:", legacyResult.error);
      }
      if (instancesResult.error) {
        console.error("Error fetching agent instances:", instancesResult.error);
      }

      const agentsMap: Record<string, Agent> = {};
      
      // Add legacy agents
      (legacyResult.data || []).forEach((agent) => {
        agentsMap[agent.id] = agent;
      });
      
      // Add agent instances (templates) - these take priority if same ID exists
      (instancesResult.data || []).forEach((agent) => {
        agentsMap[agent.id] = agent;
      });
      
      setAgents(agentsMap);
    };

    fetchAgents();
  }, [workspaceId]);

  // Clear replyingTo when selected lead changes
  useEffect(() => {
    setReplyingTo(null);
  }, [selectedLeadId]);

  // Fetch Z-API conversation ID and connection status when selected lead changes
  useEffect(() => {
    const fetchZapiConversation = async () => {
      if (!selectedLeadId) {
        setZapiConversationId(null);
        setConnectionStatus(null);
        return;
      }

      // Check if this is a WhatsApp lead (source null or "whatsapp")
      const currentLead = leads.find(l => l.id === selectedLeadId);
      const isWhatsAppLead = !currentLead?.source || currentLead?.source === "whatsapp";

      if (!isWhatsAppLead) {
        // Widget/other channel leads don't need connection check
        setConnectionStatus(null);
      }

      const { data } = await supabase
        .from("zapi_conversations")
        .select("id, connection_id, workspace_id")
        .eq("lead_id", selectedLeadId)
        .eq("is_active", true)
        .maybeSingle();

      console.log("[Inbox] fetchZapiConversation:", {
        selectedLeadId,
        found: !!data,
        conversationId: data?.id || null,
        connectionId: data?.connection_id || null,
        workspaceId: data?.workspace_id || null,
      });

      setZapiConversationId(data?.id || null);

      // Fetch connection status if we have a connection_id and it's a WhatsApp lead
      if (data?.connection_id && isWhatsAppLead) {
        const { data: connData } = await supabase
          .from("zapi_connections")
          .select("id, is_active, zapi_connected")
          .eq("id", data.connection_id)
          .maybeSingle();

        if (connData) {
          setConnectionStatus({
            is_active: connData.is_active ?? true,
            zapi_connected: connData.zapi_connected,
            connection_id: connData.id,
            connection_type: 'zapi',
          });
          console.log("[Inbox] Connection status:", {
            connection_id: connData.id,
            is_active: connData.is_active,
            zapi_connected: connData.zapi_connected,
          });
        } else {
          setConnectionStatus(null);
        }
      } else if (!data?.connection_id && isWhatsAppLead) {
        // No active Z-API conversation — check for WhatsApp Official conversation
        const { data: waConv } = await supabase
          .from("whatsapp_conversations")
          .select("id, connection_id")
          .eq("lead_id", selectedLeadId)
          .eq("is_active", true)
          .maybeSingle();

        if (waConv?.connection_id) {
          const { data: waConn } = await supabase
            .from("whatsapp_connections")
            .select("id, is_active")
            .eq("id", waConv.connection_id)
            .maybeSingle();
          if (waConn) {
            setConnectionStatus({
              is_active: waConn.is_active ?? true,
              zapi_connected: true,
              connection_id: waConn.id,
              connection_type: 'whatsapp_official',
            });
          } else {
            setConnectionStatus(null);
          }
        } else {
          setConnectionStatus(null);
        }
      }
    };

    fetchZapiConversation();
  }, [selectedLeadId, leads]);

  // Fetch leads when workspace changes and subscribe to realtime updates
  useEffect(() => {
    if (!workspaceId) {
      setLeads([]);
      selectLead(null);
      return;
    }

    const fetchLeads = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("leads")
        .select(`
          *,
          contact:crm_contacts!contact_id(name, phone, email, company, is_active)
        `)
        .eq("workspace_id", workspaceId)
        .is("merged_into_lead_id", null)
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (error) {
        console.error("Error fetching leads:", error);
      } else {
        // Keep active conversations visible even if linked contact is inactive
        const activeLeads = (data || []).filter(l => l.contact?.is_active !== false || l.status !== "closed");
        setLeads(activeLeads);
        
        // Check for lead param in URL first
        const currentSelectedId = selectedLeadIdRef.current;
        const leadIdFromUrl = searchParams.get('lead');
        if (leadIdFromUrl && data?.some(l => l.id === leadIdFromUrl)) {
          selectLead(leadIdFromUrl);
          const targetLead = data.find(l => l.id === leadIdFromUrl);
          setNotes(targetLead?.notes || "");
        } else if (leadIdFromUrl && !data?.some(l => l.id === leadIdFromUrl)) {
          // Lead not in fetched batch (position 1001+) — fetch individually
          const { data: singleLead } = await supabase
            .from("leads")
            .select(`*, contact:crm_contacts!contact_id(name, phone, email, company, is_active)`)
            .eq("id", leadIdFromUrl)
            .single();
          
          if (singleLead && !singleLead.merged_into_lead_id) {
            activeLeads.unshift(singleLead);
            setLeads([...activeLeads]);
            selectLead(leadIdFromUrl);
            setNotes(singleLead.notes || "");
          } else if (singleLead?.merged_into_lead_id) {
            selectLead(singleLead.merged_into_lead_id);
          }
        } else if (!currentSelectedId && data && data.length > 0) {
          // Only select first lead if no lead is currently selected
          selectLead(data[0].id);
          setNotes(data[0].notes || "");
        } else if (!data || data.length === 0) {
          selectLead(null);
          setNotes("");
        }
      }
      setIsLoading(false);
    };

    fetchLeads();

    // Subscribe to realtime updates for ALL leads in this workspace
    const leadsChannel = supabase
      .channel(`leads_workspace_${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "leads",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          // Add new lead at the top
          setLeads((current) => [payload.new as Lead, ...current.filter(l => l.id !== (payload.new as Lead).id)]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leads",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const updatedLead = payload.new as Lead;
          
          // Filter out merged leads from the list
          if (updatedLead.merged_into_lead_id) {
            setLeads((current) => current.filter(l => l.id !== updatedLead.id));
            return;
          }
          
          setLeads((current) => {
            const existingLead = current.find(l => l.id === updatedLead.id);
            
            if (existingLead) {
              // If last_message_at changed, move to top
              if (updatedLead.last_message_at !== existingLead.last_message_at) {
                const filtered = current.filter(l => l.id !== updatedLead.id);
                return [{ ...existingLead, ...updatedLead }, ...filtered];
              }
              // Otherwise update in place
              return current.map(l => l.id === updatedLead.id ? { ...l, ...updatedLead } : l);
            }
            
            // Lead not in list — will be fetched separately
            return current;
          });
          
          // If lead wasn't in the list, fetch it with contact data and add to top
          setLeads((current) => {
            const existsInState = current.some(l => l.id === updatedLead.id);
            if (!existsInState && !updatedLead.merged_into_lead_id) {
              supabase
                .from("leads")
                .select(`*, contact:crm_contacts!contact_id(name, phone, email, company, is_active)`)
                .eq("id", updatedLead.id)
                .is("merged_into_lead_id", null)
                .single()
                .then(({ data }) => {
                  if (data && (data.contact?.is_active !== false || data.status !== "closed")) {
                    setLeads((prev) => {
                      if (prev.some(l => l.id === data.id)) return prev;
                      return [data, ...prev];
                    });
                  }
                });
            }
            return current;
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "leads",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          setLeads((current) => current.filter((lead) => lead.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(leadsChannel);
    };
  }, [workspaceId]);

  // Unread message tracking for human-linked chats (Inbox sidebar badges)
  useEffect(() => {
    if (!workspaceId || !currentUserId) {
      setUnreadMap({});
      return;
    }

    let cancelled = false;
    const loadUnread = async () => {
      const { data, error } = await supabase.rpc("get_unread_counts", {
        p_user_id: currentUserId,
        p_workspace_id: workspaceId,
      });
      if (cancelled) return;
      if (error) {
        console.warn("get_unread_counts failed:", error);
        return;
      }
      const map: Record<string, number> = {};
      (data || []).forEach((row: { lead_id: string; unread_count: number }) => {
        map[row.lead_id] = Number(row.unread_count) || 0;
      });
      setUnreadMap(map);
    };
    loadUnread();

    // Realtime: increment counter on incoming lead messages, skip if chat is open
    const channel = supabase
      .channel(`unread_${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const msg = payload.new as { lead_id: string; sender_type: string };
          if (msg.sender_type !== "lead") return;
          if (selectedLeadIdRef.current === msg.lead_id) return;
          setUnreadMap((prev) => ({
            ...prev,
            [msg.lead_id]: (prev[msg.lead_id] || 0) + 1,
          }));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [workspaceId, currentUserId]);


  // Handle URL lead parameter changes (when navigating from CRMContacts or shared link)
  useEffect(() => {
    const leadIdFromUrl = searchParams.get('lead');
    const inList = leads.some(l => l.id === leadIdFromUrl);
    if (leadIdFromUrl && (leadIdFromUrl !== selectedLeadIdRef.current || !inList)) {
      const targetLead = leads.find(l => l.id === leadIdFromUrl);
      if (targetLead) {
        setSelectedLeadId(leadIdFromUrl);
        selectedLeadIdRef.current = leadIdFromUrl;
        setNotes(targetLead.notes || "");
      } else {
        // Lead not in local state (outside top 1000) — fetch directly
        supabase
          .from("leads")
          .select(`*, contact:crm_contacts!contact_id(name, phone, email, company, is_active)`)
          .eq("id", leadIdFromUrl)
          .single()
          .then(({ data }) => {
            if (data && !data.merged_into_lead_id) {
              setLeads(prev => [data, ...prev.filter(l => l.id !== data.id)]);
              setSelectedLeadId(leadIdFromUrl);
              selectedLeadIdRef.current = leadIdFromUrl;
              setNotes(data.notes || "");
            } else if (data?.merged_into_lead_id) {
              selectLead(data.merged_into_lead_id);
            }
          });
      }
    }
  }, [searchParams.get('lead'), leads]);

  // Count pending leads: human-linked chats (needs_human or human_talking) with unread messages
  const pendingHumanCount = useMemo(() => {
    return leads.filter((lead) =>
      !lead.is_test &&
      (lead.status === "needs_human" || lead.status === "human_talking") &&
      (unreadMap[lead.id] || 0) > 0
    ).length;
  }, [leads, unreadMap]);

  // Total unread messages across human-linked chats
  const totalUnreadHuman = useMemo(() => {
    let total = 0;
    for (const lead of leads) {
      if (lead.is_test) continue;
      if (lead.status === "human_talking" || lead.status === "needs_human") {
        total += unreadMap[lead.id] || 0;
      }
    }
    return total;
  }, [leads, unreadMap]);

  // Count test leads (for simulation tab)
  const testLeadsCount = useMemo(() => {
    return leads.filter((lead) => lead.is_test === true).length;
  }, [leads]);

  // Fetch messages, transfers, and subscribe to realtime when lead changes
  useEffect(() => {
    if (!selectedLeadId) {
      setMessages([]);
      setTransfers([]);
      return;
    }

    const fetchMessagesAndTransfers = async () => {
      setIsLoadingMessages(true);
      
      // Fetch messages
      const { data: messagesData, error: messagesError } = await supabase
        .from("messages")
        .select("*")
        .eq("lead_id", selectedLeadId)
        .order("created_at", { ascending: true });

      if (messagesError) {
        console.error("Error fetching messages:", messagesError);
      } else {
        setMessages(messagesData || []);
      }

      // Fetch transfers for this lead
      const { data: transfersData, error: transfersError } = await supabase
        .from("agent_transfers")
        .select("id, from_agent_id, to_agent_id, reason, to_intent, created_at")
        .eq("lead_id", selectedLeadId)
        .order("created_at", { ascending: true });

      if (transfersError) {
        console.error("Error fetching transfers:", transfersError);
      } else {
        setTransfers(transfersData || []);
      }

      setIsLoadingMessages(false);
    };

    fetchMessagesAndTransfers();

    // Subscribe to realtime updates for messages (INSERT and UPDATE for delivery status)
    const messagesChannel = supabase
      .channel(`messages_${selectedLeadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `lead_id=eq.${selectedLeadId}`,
        },
        (payload) => {
          setMessages((currentMessages) => [...currentMessages, payload.new as Message]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `lead_id=eq.${selectedLeadId}`,
        },
        (payload) => {
          // Update message delivery status in real-time
          setMessages((currentMessages) =>
            currentMessages.map((msg) =>
              msg.id === payload.new.id ? { ...msg, ...payload.new as Message } : msg
            )
          );
        }
      )
      .subscribe();

    // Subscribe to realtime updates for transfers
    const transfersChannel = supabase
      .channel(`transfers_${selectedLeadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_transfers",
          filter: `lead_id=eq.${selectedLeadId}`,
        },
        (payload) => {
          console.log("Transfer received via realtime:", payload.new);
          setTransfers((currentTransfers) => [...currentTransfers, payload.new as AgentTransfer]);
          // Force re-render of messages to update transfer tags
          setMessages((currentMessages) => [...currentMessages]);
        }
      )
      .subscribe();

    // Subscribe to realtime updates for lead insights
    const leadsChannel = supabase
      .channel(`lead_insights_${selectedLeadId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leads",
          filter: `id=eq.${selectedLeadId}`,
        },
        (payload) => {
          // Update the lead in local state with new insights/ai_summary
          setLeads((currentLeads) =>
            currentLeads.map((lead) =>
              lead.id === payload.new.id ? { ...lead, ...payload.new as Lead } : lead
            )
          );
        }
      )
      .subscribe();

    // Cleanup subscriptions
    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(transfersChannel);
      supabase.removeChannel(leadsChannel);
    };
  }, [selectedLeadId]);

  // Update notes when selected lead changes
  useEffect(() => {
    const selectedLead = leads.find((l) => l.id === selectedLeadId);
    if (selectedLead) {
      setNotes(selectedLead.notes || "");
    }
  }, [selectedLeadId, leads]);

  // Fetch lead psychology when selected lead changes
  useEffect(() => {
    if (!selectedLeadId || !workspaceId) {
      setLeadPsychology(null);
      return;
    }

    const fetchPsychology = async () => {
      // Get the selected lead to find its CRM pipeline card
      const selectedLead = leads.find(l => l.id === selectedLeadId);
      
      let crmLeadId: string | null = null;

      // Strategy 1: use contact_id directly if available on the conversation lead
      if (selectedLead?.contact_id) {
        const { data: crmLead } = await supabase
          .from("crm_leads")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("contact_id", selectedLead.contact_id)
          .is("deleted_at", null)
          .maybeSingle();
        crmLeadId = crmLead?.id ?? null;
      }

      // Strategy 2: find crm_contacts linked via lead_id (trigger-created contacts)

      if (!crmLeadId) {
        const { data: crmContact } = await supabase
          .from("crm_contacts")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("lead_id", selectedLeadId)
          .maybeSingle();

        if (crmContact?.id) {
          const { data: crmLead } = await supabase
            .from("crm_leads")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("contact_id", crmContact.id)
            .is("deleted_at", null)
            .maybeSingle();
          crmLeadId = crmLead?.id ?? null;
        }
      }

      if (!crmLeadId) {
        setLeadPsychology(null);
        return;
      }

      const crmLead = { id: crmLeadId };

      if (crmLead?.id) {
        const { data: psychology } = await supabase
          .from("crm_lead_psychology")
          .select("id, dna_code, temperatura, propensity_score, risk_score, opportunity_score, lead_id")
          .eq("lead_id", crmLead.id)
          .maybeSingle();

        if (psychology) {
          setLeadPsychology({
            ...psychology,
            crm_lead_id: crmLead.id,
          });
        } else {
          setLeadPsychology({ 
            id: "", 
            dna_code: null, 
            temperatura: null, 
            propensity_score: null,
            risk_score: null,
            opportunity_score: null,
            crm_lead_id: crmLead.id 
          });
        }
      } else {
        setLeadPsychology(null);
      }
    };

    fetchPsychology();
  }, [selectedLeadId, workspaceId, leads]);

  const selectedLead = leads.find((l) => l.id === selectedLeadId);

  // Fetch assigned user name when lead is assigned to another human
  useEffect(() => {
    const fetchAssignedUserName = async () => {
      if (
        selectedLead?.status === 'human_talking' &&
        selectedLead?.assigned_to_user_id &&
        selectedLead.assigned_to_user_id !== currentUserId
      ) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('name, email')
          .eq('id', selectedLead.assigned_to_user_id)
          .single();

        setAssignedUserName(profile?.name || profile?.email || 'Agente');
      } else {
        setAssignedUserName(null);
      }
    };

    fetchAssignedUserName();
  }, [selectedLead?.id, selectedLead?.assigned_to_user_id, selectedLead?.status, currentUserId]);

  const availableSources = useMemo(() => {
    // Filter leads by active tab first, then extract sources
    const leadsInTab = leads.filter(lead => {
      if (activeTab === "simulation") return lead.is_test === true;
      
      const isNotTest = lead.is_test !== true;
      
      // Minimum info filter
      const leadName = lead.contact?.name || lead.name;
      const leadEmail = lead.contact?.email;
      const leadPhone = lead.contact?.phone || lead.phone;
      const hasName = !!leadName && leadName.trim() !== "";
      const hasContact = (!!leadEmail && leadEmail.trim() !== "") || (!!leadPhone && leadPhone.trim() !== "");
      const hasMinimumInfo = hasName && hasContact;
      
      if (!isNotTest) return false;

      // Apply qualification filter for availableSources
      if (filterQualification === "qualified" && !hasMinimumInfo) return false;
      if (filterQualification === "unqualified" && hasMinimumInfo) return false;
      
      const matchesTab =
        activeTab === "all" ||
        (activeTab === "new" && lead.status === "new") ||
        (activeTab === "human" && lead.status === "needs_human");
      return matchesTab;
    });

    const sources = new Set<string>();
    let hasWhatsApp = false;
    
    leadsInTab.forEach(l => {
      if (l.source) {
        sources.add(l.source);
      } else {
        hasWhatsApp = true;
      }
    });
    
    const result = Array.from(sources).sort();
    if (hasWhatsApp) {
      result.unshift("whatsapp");
    }
    return result;
  }, [leads, activeTab, filterQualification]);

  const normalize = (str: string) =>
    str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const filteredLeads = useMemo(() => leads.filter((lead) => {
    const query = normalize(searchQuery).trim();
    const queryDigits = query.replace(/\D/g, "");
    const leadName = lead.contact?.name || lead.name || "";
    const leadEmail = lead.contact?.email || "";
    const leadPhone = lead.contact?.phone || lead.phone || "";
    const leadPhoneDigits = leadPhone.replace(/\D/g, "");

    const matchesSearch = !query ||
      normalize(leadName).includes(query) ||
      normalize(leadEmail).includes(query) ||
      (queryDigits.length > 0 && leadPhoneDigits.includes(queryDigits));
    
    
    // Simulation tab: show only test leads
    if (activeTab === "simulation") {
      return matchesSearch && lead.is_test === true;
    }
    
    // Other tabs: exclude test leads
    const isNotTest = lead.is_test !== true;

    // Minimum info filter: require name + (email or phone)
    // Check both lead and linked contact data
    const infoName = lead.contact?.name || lead.name;
    const infoEmail = lead.contact?.email;
    const infoPhone = lead.contact?.phone || lead.phone;
    const hasName = !!infoName && infoName.trim() !== "";
    const hasContact = (!!infoEmail && infoEmail.trim() !== "") || (!!infoPhone && infoPhone.trim() !== "");
    const hasMinimumInfo = hasName && hasContact;

    const matchesSource =
      filterSource === "all" ||
      (filterSource === "whatsapp" && !lead.source) ||
      lead.source === filterSource;

    const matchesTab =
      activeTab === "all" ||
      (activeTab === "new" && lead.status === "new") ||
      (activeTab === "human" &&
        (lead.status === "needs_human" || lead.status === "human_talking") &&
        (unreadMap[lead.id] || 0) > 0);
    // Apply qualification filter
    const isWidgetLead = lead.source?.startsWith("Widget") ?? false;
    const matchesQualification =
      activeTab === "human" ||
      filterQualification === "all" ||
      isWidgetLead ||
      (filterQualification === "qualified" && hasMinimumInfo) ||
      (filterQualification === "unqualified" && !hasMinimumInfo);

    return matchesSearch && matchesTab && matchesSource && isNotTest && matchesQualification;
  }), [leads, searchQuery, activeTab, filterSource, filterQualification, unreadMap]);

  // Check if connection is blocked (disabled or disconnected)
  const isConnectionBlocked = connectionStatus && (!connectionStatus.is_active || connectionStatus.zapi_connected === false);
  const isWhatsappOfficial = connectionStatus?.connection_type === 'whatsapp_official';

  // WhatsApp 24h window (only meaningful for WhatsApp Official)
  const whatsappWindow = useWhatsappWindow(selectedLeadId, !!isWhatsappOfficial);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);

  // Reconnect modal functions
  const handleOpenReconnectModal = useCallback(async () => {
    if (!connectionStatus?.connection_id || !companyId) return;
    setIsReconnectModalOpen(true);
    setIsLoadingQRCode(true);
    setQrCodeData(null);

    try {
      const { data, error } = await supabase.functions.invoke('zapi-instance-control', {
        body: {
          connection_id: connectionStatus.connection_id,
          company_id: companyId,
          action: 'qrcode',
        },
      });

      if (error) throw error;

      if (!data.success) {
        if (data.alreadyConnected) {
          toast({ title: "Instancia ja esta conectada!" });
          setConnectionStatus(prev => prev ? { ...prev, zapi_connected: true } : null);
          handleCloseReconnectModal();
          return;
        }
        toast({ variant: "destructive", title: "Erro ao gerar QR Code", description: data.error });
        setQrCodeData(null);
        return;
      }

      if (typeof data.qrcode === 'string') {
        setQrCodeData(data.qrcode);
      } else {
        toast({ variant: "destructive", title: "Formato de QR Code inesperado" });
        setQrCodeData(null);
      }
    } catch (err: unknown) {
      console.error('Error fetching QR code:', err);
      toast({ variant: "destructive", title: "Erro ao gerar QR Code", description: err instanceof Error ? err.message : "Erro desconhecido" });
      setQrCodeData(null);
    } finally {
      setIsLoadingQRCode(false);
    }

    // Start polling for connection status
    if (qrCodePollingRef.current) clearInterval(qrCodePollingRef.current);
    qrCodePollingRef.current = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('zapi-instance-control', {
          body: {
            connection_id: connectionStatus.connection_id,
            company_id: companyId,
            action: 'status',
          },
        });
        if (!error && data?.success && data?.connected) {
          setConnectionStatus(prev => prev ? { ...prev, zapi_connected: true } : null);
          toast({ title: "WhatsApp conectado com sucesso!" });
          handleCloseReconnectModal();
        }
      } catch (e) {
        console.error('Error polling status:', e);
      }
    }, 5000);
  }, [connectionStatus, companyId, toast]);

  const handleCloseReconnectModal = useCallback(() => {
    setIsReconnectModalOpen(false);
    setQrCodeData(null);
    if (qrCodePollingRef.current) {
      clearInterval(qrCodePollingRef.current);
      qrCodePollingRef.current = null;
    }
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (qrCodePollingRef.current) {
        clearInterval(qrCodePollingRef.current);
      }
    };
  }, []);

  const handleSendMessage = useCallback(async (msg: string) => {
    if (!msg.trim() || !selectedLeadId || !workspaceId) return;
    if (isConnectionBlocked) return;
    if (isWhatsappOfficial && !whatsappWindow.windowOpen) {
      toast({
        variant: "destructive",
        title: "Janela de 24h fechada",
        description: "Envie um modelo aprovado (HSM) para reabrir a conversa.",
      });
      return;
    }


    setIsSending(true);
    
    const isTestLead = selectedLead?.is_test === true;
    const senderType = isTestLead ? "lead" : "human_agent";

    console.log("[Inbox] handleSendMessage:", {
      selectedLeadId,
      workspaceId,
      zapiConversationId,
      senderType,
      leadPhone: selectedLead?.phone,
      leadContactId: selectedLead?.contact_id,
    });

    const { data: insertedMessage, error } = await supabase.from("messages").insert({
      lead_id: selectedLeadId,
      workspace_id: workspaceId,
      content: msg.trim(),
      sender_type: senderType,
      reply_to_external_id: replyingTo?.external_message_id || null,
      reply_to_content: replyingTo?.content?.substring(0, 200) || null,
      reply_to_sender_type: replyingTo?.sender_type || null,
    }).select().single();

    console.log("[Inbox] Message insert result:", {
      success: !error,
      messageId: insertedMessage?.id,
      error: error?.message,
    });

    if (error) {
      console.error("Error sending message:", error);
      toast({
        variant: "destructive",
        title: "Erro ao enviar mensagem",
        description: error.message,
      });
      setIsSending(false);
      return;
    }
    
    setReplyingTo(null);
    setIsSending(false);
  }, [selectedLeadId, workspaceId, isConnectionBlocked, isWhatsappOfficial, whatsappWindow.windowOpen, selectedLead, zapiConversationId, replyingTo, toast]);

  const handleSendTemplate = useCallback(
    async (payload: {
      templateName: string;
      languageCode: string;
      variables: string[];
      renderedText: string;
    }) => {
      if (!selectedLeadId || !workspaceId || !connectionStatus?.connection_id) return;

      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          type: "template",
          lead_id: selectedLeadId,
          workspace_id: workspaceId,
          connection_id: connectionStatus.connection_id,
          phone_number: selectedLead?.phone,
          template_name: payload.templateName,
          language_code: payload.languageCode,
          variables: payload.variables,
          rendered_text: payload.renderedText,
        },
      });

      const { data: refreshedMessages, error: refreshError } = await supabase
        .from("messages")
        .select("*")
        .eq("lead_id", selectedLeadId)
        .order("created_at", { ascending: true });

      if (refreshError) {
        console.error("Error refreshing messages after template send:", refreshError);
      } else {
        setMessages(refreshedMessages || []);
      }

      const dataObj = (data ?? {}) as { error?: string; code?: string; details?: unknown };
      if (error || dataObj.error) {
        const friendly = friendlyWhatsappError(
          dataObj.error ? dataObj : { error: error?.message },
          "Erro ao enviar modelo"
        );
        toast({
          variant: "destructive",
          title: friendly.title,
          description: friendly.description,
        });
        throw new Error(friendly.description);
      }


      toast({ title: "Modelo enviado com sucesso" });
      whatsappWindow.refresh();
    },
    [selectedLeadId, workspaceId, connectionStatus, selectedLead, whatsappWindow, toast]
  );


  // WhatsApp file size limits
  const MEDIA_LIMITS = {
    image: { maxSize: 16 * 1024 * 1024, extensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"] },
    video: { maxSize: 16 * 1024 * 1024, extensions: [".mp4", ".3gp"] },
    document: { maxSize: 100 * 1024 * 1024, extensions: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt"] },
  };

  const handleMediaSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    mediaType: "image" | "video" | "document"
  ) => {
    const file = e.target.files?.[0];
    if (!file || !selectedLeadId || !zapiConversationId || !workspaceId) return;
    if (isConnectionBlocked) return;

    // Reset input to allow selecting the same file again
    e.target.value = "";

    const limits = MEDIA_LIMITS[mediaType];

    // Validate file size
    if (file.size > limits.maxSize) {
      toast({
        variant: "destructive",
        title: "Arquivo muito grande",
        description: `O limite para ${mediaType === "image" ? "imagens" : mediaType === "video" ? "videos" : "documentos"} e de ${limits.maxSize / 1024 / 1024}MB.`,
      });
      return;
    }

    // Validate extension
    const fileName = file.name.toLowerCase();
    const isValidExt = limits.extensions.some(ext => fileName.endsWith(ext));
    if (!isValidExt) {
      toast({
        variant: "destructive",
        title: "Formato nao suportado",
        description: `Formatos aceitos: ${limits.extensions.join(", ")}`,
      });
      return;
    }

    setIsSendingMedia(true);

    try {
      // Convert file to base64
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Caption not available since message state moved to ChatInput
      const caption = undefined;

      // 1. Insert message FIRST to get the ID for delivery tracking
      const { data: insertedMsg, error: insertError } = await supabase
        .from("messages")
        .insert({
          lead_id: selectedLeadId,
          workspace_id: workspaceId,
          content: caption || (mediaType === "document" ? `[Documento: ${file.name}]` : `[${mediaType === "image" ? "Imagem" : "Video"}]`),
          sender_type: "human_agent",
          media_type: mediaType,
          media_url: dataUrl,
          delivery_status: "pending",
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      // 2. Call zapi-send and capture messageId for delivery tracking
      const { data: sendData, error: sendError } = await supabase.functions.invoke("zapi-send", {
        body: {
          conversation_id: zapiConversationId,
          media_url: dataUrl,
          media_type: mediaType,
          message: caption,
          file_name: file.name,
        },
      });

      if (sendError) throw sendError;

      // 3. Update message with external_message_id for status tracking
      const zapiMessageId = sendData?.zapiMessageId || sendData?.messageId;
      if (zapiMessageId && insertedMsg?.id) {
        await supabase
          .from("messages")
          .update({
            external_message_id: zapiMessageId,
            delivery_status: "sent",
          })
          .eq("id", insertedMsg.id);
      }

      // Caption cleared automatically in ChatInput sub-component

      toast({
        title: "Midia enviada!",
        description: `${mediaType === "image" ? "Imagem" : mediaType === "video" ? "Video" : "Documento"} enviado com sucesso.`,
      });
    } catch (err) {
      console.error("Error sending media:", err);
      toast({
        variant: "destructive",
        title: "Erro ao enviar midia",
        description: err instanceof Error ? err.message : "Falha ao enviar arquivo.",
      });
    } finally {
      setIsSendingMedia(false);
    }
  };

  // Handle sending audio recording
  const handleSendAudio = async (
    audioBlob: Blob,
    options: { waveform: boolean; viewOnce: boolean; duration: number }
  ) => {
    if (!selectedLeadId || !zapiConversationId || !workspaceId) return;
    if (isConnectionBlocked) return;

    setIsSendingMedia(true);
    // isRecordingAudio managed inside ChatInput

    try {
      // 1. Convert blob to base64
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      });

      // 2. Transcribe audio via Gemini
      let transcription = "[Audio]";
      try {
        const { data: transcribeData } = await supabase.functions.invoke("transcribe-audio", {
          body: { audio_base64: dataUrl },
        });
        if (transcribeData?.transcription) {
          transcription = `[Audio transcrito]: ${transcribeData.transcription}`;
        }
      } catch (transcribeError) {
        console.error("Transcription failed:", transcribeError);
        // Continue even if transcription fails - just won't have transcription
      }

      // 3. Insert message with transcription
      const { data: insertedMsg, error: insertError } = await supabase
        .from("messages")
        .insert({
          lead_id: selectedLeadId,
          workspace_id: workspaceId,
          content: transcription,
          sender_type: "human_agent",
          media_type: "audio",
          media_url: dataUrl,
          delivery_status: "pending",
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      // 4. Call zapi-send and capture messageId for delivery tracking
      const { data: sendData, error: sendError } = await supabase.functions.invoke("zapi-send", {
        body: {
          conversation_id: zapiConversationId,
          media_url: dataUrl,
          media_type: "audio",
          waveform: options.waveform,
          viewOnce: options.viewOnce,
          audio_duration: options.duration,
        },
      });

      if (sendError) throw sendError;

      // 5. Update message with external_message_id for status tracking
      const zapiMessageId = sendData?.zapiMessageId || sendData?.messageId;
      if (zapiMessageId && insertedMsg?.id) {
        await supabase
          .from("messages")
          .update({
            external_message_id: zapiMessageId,
            delivery_status: "sent",
          })
          .eq("id", insertedMsg.id);
      }

      toast({
        title: "Audio enviado!",
        description: "Mensagem de audio enviada com sucesso.",
      });
    } catch (err) {
      console.error("Error sending audio:", err);
      toast({
        variant: "destructive",
        title: "Erro ao enviar audio",
        description: err instanceof Error ? err.message : "Falha ao enviar audio.",
      });
    } finally {
      setIsSendingMedia(false);
    }
  };

  // Handle assuming control of the conversation (handoff to human)
  const handleAssumeControl = async () => {
    if (!selectedLeadId || !workspaceId) return;
    
    setIsHandoffLoading(true);
    
    const { data: { user } } = await supabase.auth.getUser();
    const selectedLead = leads.find(l => l.id === selectedLeadId);
    
    const { error } = await supabase
      .from("leads")
      .update({
        status: "human_talking",
        assigned_to_user_id: user?.id || null,
        assigned_at: new Date().toISOString(),
      })
      .eq("id", selectedLeadId);

    if (error) {
      console.error("Error assuming control:", error);
      toast({
        variant: "destructive",
        title: "Erro ao assumir atendimento",
        description: error.message,
      });
    } else {
      // Sync with lead_queues table for agent availability tracking
      const { error: queueError } = await supabase
        .from("lead_queues")
        .upsert({
          workspace_id: workspaceId,
          lead_id: selectedLeadId,
          lead_phone: selectedLead?.phone || '',
          lead_name: selectedLead?.name || null,
          assigned_to_user_id: user?.id,
          agent_id: selectedLead?.assigned_agent_id || null,
          status: 'in_progress',
          priority: 1,
          assigned_at: new Date().toISOString()
        }, {
          onConflict: 'workspace_id,lead_id'
        });

      if (queueError) {
        console.error("Error syncing lead_queues:", queueError);
      }

      // Update local state immediately
      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === selectedLeadId
            ? { ...lead, status: "human_talking" as const, assigned_to_user_id: user?.id || null, assigned_at: new Date().toISOString() }
            : lead
        )
      );
      toast({
        title: "Atendimento assumido",
        description: "Você está no controle agora. A IA não responderá automaticamente.",
      });
    }
    
    setIsHandoffLoading(false);
  };

  // Handle returning control to AI
  const handleReturnToAI = async () => {
    if (!selectedLeadId || !workspaceId) return;
    
    setIsHandoffLoading(true);
    
    const { error } = await supabase
      .from("leads")
      .update({
        status: "ai_talking",
        assigned_to_user_id: null,
        assigned_at: null,
      })
      .eq("id", selectedLeadId);

    if (error) {
      console.error("Error returning to AI:", error);
      toast({
        variant: "destructive",
        title: "Erro ao devolver para IA",
        description: error.message,
      });
    } else {
      // Mark as completed in lead_queues
      await supabase
        .from("lead_queues")
        .update({ 
          status: 'completed', 
          completed_at: new Date().toISOString() 
        })
        .eq("lead_id", selectedLeadId)
        .eq("workspace_id", workspaceId);

      // Update local state immediately
      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === selectedLeadId
            ? { ...lead, status: "ai_talking" as const, assigned_to_user_id: null, assigned_at: null }
            : lead
        )
      );
      toast({
        title: "Devolvido para IA",
        description: "A IA voltou a responder automaticamente.",
      });
    }
    
    setIsHandoffLoading(false);
  };

  // Retranscribe audio message
  const handleRetranscribeAudio = async (messageId: string) => {
    setReprocessingMessageId(messageId);
    try {
      const { data, error } = await supabase.functions.invoke('transcribe-audio', {
        body: { message_id: messageId }
      });

      console.log("[RETRANSCRIBE] Response:", { data, error, messageId });

      if (error) {
        toast({ variant: "destructive", title: "Erro ao reprocessar", description: error.message });
      } else if (data?.content) {
        // Update local state
        setMessages(prev => prev.map(m =>
          String(m.id) === messageId ? { ...m, content: data.content } : m
        ));
        toast({ title: "Audio reprocessado com sucesso", description: data.transcription?.substring(0, 50) + "..." });
      } else if (data?.error) {
        toast({ variant: "destructive", title: "Erro ao reprocessar", description: data.error });
      } else {
        toast({ variant: "destructive", title: "Erro ao reprocessar", description: "Resposta inesperada do servidor" });
      }
    } catch (err) {
      console.error("[RETRANSCRIBE] Error:", err);
      toast({ variant: "destructive", title: "Erro ao reprocessar", description: "Falha na comunicacao com o servidor" });
    }
    setReprocessingMessageId(null);
  };

  // Add VCard contact to leads - opens the NewLeadDialog with pre-filled data
  const handleAddVCardToLeads = (data: { name: string; phone: string; email?: string; company?: string; job_title?: string; description?: string }) => {
    setVcardLeadData(data);
    setIsNewLeadDialogOpen(true);
  };

  // Archive a lead (close the conversation)
  const handleArchiveLead = async (leadId: string) => {
    const { error } = await supabase
      .from("leads")
      .update({ status: "closed" })
      .eq("id", leadId);

    if (error) {
      console.error("Error archiving lead:", error);
      toast({
        variant: "destructive",
        title: "Erro ao arquivar conversa",
        description: error.message,
      });
    } else {
      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId ? { ...lead, status: "closed" as const } : lead
        )
      );
      toast({
        title: "Conversa arquivada",
        description: "A conversa foi fechada com sucesso.",
      });
    }
  };

  // Delete a lead entirely
  const handleDeleteLead = async (leadId: string) => {
    const { error } = await supabase
      .from("leads")
      .delete()
      .eq("id", leadId);

    if (error) {
      console.error("Error deleting lead:", error);
      toast({
        variant: "destructive",
        title: "Erro ao apagar conversa",
        description: error.message,
      });
    } else {
      setLeads((prev) => prev.filter((lead) => lead.id !== leadId));
      if (selectedLeadId === leadId) {
        selectLead(null);
      }
      toast({
        title: "Conversa apagada",
        description: "A conversa foi removida permanentemente.",
      });
    }
  };

  // Leave the conversation (unassign yourself)
  const handleLeaveConversation = async () => {
    if (!selectedLeadId || !workspaceId) return;
    
    const { error } = await supabase
      .from("leads")
      .update({
        status: "ai_talking",
        assigned_to_user_id: null,
        assigned_at: null,
      })
      .eq("id", selectedLeadId);

    if (error) {
      console.error("Error leaving conversation:", error);
      toast({
        variant: "destructive",
        title: "Erro ao sair da conversa",
        description: error.message,
      });
    } else {
      // Mark as completed in lead_queues
      await supabase
        .from("lead_queues")
        .update({ 
          status: 'completed', 
          completed_at: new Date().toISOString() 
        })
        .eq("lead_id", selectedLeadId)
        .eq("workspace_id", workspaceId);

      // Update local state immediately
      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === selectedLeadId
            ? { ...lead, status: "ai_talking" as const, assigned_to_user_id: null, assigned_at: null }
            : lead
        )
      );
      toast({
        title: "Você saiu da conversa",
        description: "A IA assumirá o atendimento.",
      });
    }
  };

  // Add a tag to the lead
  const handleAddTag = async () => {
    if (!selectedLeadId || !newTag.trim()) return;
    
    setIsAddingTag(true);
    const currentTags = selectedLead?.tags || [];
    const updatedTags = [...currentTags, newTag.trim()];
    
    const { error } = await supabase
      .from("leads")
      .update({ tags: updatedTags })
      .eq("id", selectedLeadId);

    if (error) {
      console.error("Error adding tag:", error);
      toast({
        variant: "destructive",
        title: "Erro ao adicionar tag",
        description: error.message,
      });
    } else {
      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === selectedLeadId ? { ...lead, tags: updatedTags } : lead
        )
      );
      setNewTag("");
      toast({
        title: "Tag adicionada",
      });
    }
    setIsAddingTag(false);
  };

  // Remove a tag from the lead
  const handleRemoveTag = async (tagToRemove: string) => {
    if (!selectedLeadId) return;
    
    const currentTags = selectedLead?.tags || [];
    const updatedTags = currentTags.filter((t) => t !== tagToRemove);
    
    const { error } = await supabase
      .from("leads")
      .update({ tags: updatedTags })
      .eq("id", selectedLeadId);

    if (error) {
      console.error("Error removing tag:", error);
      toast({
        variant: "destructive",
        title: "Erro ao remover tag",
        description: error.message,
      });
    } else {
      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === selectedLeadId ? { ...lead, tags: updatedTags } : lead
        )
      );
    }
  };

  const formatTime = (dateString: string | null, includeDate = false) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (!includeDate) {
      const today = new Date();
      const isToday = date.toDateString() === today.toDateString();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday = date.toDateString() === yesterday.toDateString();
      if (isToday) return time;
      if (isYesterday) return `Ontem ${time}`;
      return `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${time}`;
    }
    return `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${time}`;
  };

  const getInitials = (name: string | null) => {
    if (!name) return "?";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const getSenderLabel = (senderType: string) => {
    switch (senderType) {
      case "ai":
        return "IA";
      case "human_agent":
        return "Agente";
      case "lead":
        return "Lead";
      default:
        return senderType;
    }
  };

  const getAgentDisplayName = (agentId: string | null) => {
    if (!agentId) return null;
    const agent = agents[agentId];
    if (!agent) return "Agente";
    return `${agent.name} (${agent.category || 'Geral'})`;
  };

  const getRespondingAgentName = (msg: Message) => {
    const agentId = msg.responding_agent_id || msg.agent_id;
    return getAgentDisplayName(agentId);
  };

  // Helper to check if there was a transfer before this message
  // Uses a Set to track displayed transfers and avoid duplicates when AI sends split messages
  const displayedTransferIds = new Set<string>();
  
  const getTransferBeforeMessage = (msgCreatedAt: string) => {
    const msgTime = new Date(msgCreatedAt).getTime();
    const transfer = transfers.find(t => {
      const transferTime = new Date(t.created_at).getTime();
      // Within 5 seconds AND not already displayed
      return transferTime <= msgTime && 
             msgTime - transferTime < 5000 && 
             !displayedTransferIds.has(t.id);
    });
    
    // Mark as displayed to avoid duplicates
    if (transfer) {
      displayedTransferIds.add(transfer.id);
    }
    
    return transfer;
  };

  // Fetch CRM contacts when dialog opens
  const fetchCrmContacts = async () => {
    if (!workspaceId) return;
    setIsLoadingContacts(true);
    
    const { data, error } = await supabase
      .from("crm_contacts")
      .select("id, name, phone, email, company, lead_id")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true });
    
    if (error) {
      console.error("Error fetching CRM contacts:", error);
    } else {
      setCrmContacts(data || []);
    }
    setIsLoadingContacts(false);
  };

  // Handle contact selection for starting a conversation
  const handleSelectContact = async (contact: typeof crmContacts[0]) => {
    if (!workspaceId) return;
    
    // Se ja tem lead_id, apenas seleciona a conversa existente
    if (contact.lead_id) {
      selectLead(contact.lead_id);
      setIsSelectLeadOpen(false);
      setContactSearch("");
      // Close mobile drawer if open
      if (isMobile) {
        setIsMobileLeadListOpen(false);
      }
      return;
    }
    
    // Verifica se precisa de telefone para conversa
    if (!contact.phone) {
      toast({
        variant: "destructive",
        title: "Telefone obrigatorio",
        description: "O contato precisa ter um telefone para iniciar uma conversa.",
      });
      return;
    }
    
    setIsCreatingLead(true);
    
    // Verificar se ja existe um lead com este telefone
    const { data: existingLead } = await supabase
      .from("leads")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("phone", contact.phone)
      .maybeSingle();
    
    if (existingLead) {
      // Atualizar crm_contacts com o lead_id
      await supabase
        .from("crm_contacts")
        .update({ lead_id: existingLead.id })
        .eq("id", contact.id);
      
      selectLead(existingLead.id);
      setIsSelectLeadOpen(false);
      setContactSearch("");
      setIsCreatingLead(false);
      return;
    }
    
    // Cria lead na tabela leads para o chat
    const { data: newLead, error } = await supabase
      .from("leads")
      .insert({
        workspace_id: workspaceId,
        name: contact.name,
        phone: contact.phone,
        status: "new",
        contact_id: contact.id,
      })
      .select("id")
      .single();
    
    if (error) {
      console.error("Error creating lead:", error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: error.message
      });
      setIsCreatingLead(false);
      return;
    }

    // Criar zapi_conversations para permitir envio outbound via Z-API
    // Usa connection_workspaces (junction table) como fonte de verdade
    const { data: connLink } = await supabase
      .from("connection_workspaces")
      .select("connection_id")
      .eq("workspace_id", workspaceId)
      .eq("connection_type", "zapi")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const zapiConnection = connLink ? { id: connLink.connection_id } : null;

    if (zapiConnection && contact.phone) {
      const { error: zapiConvError } = await supabase
        .from("zapi_conversations")
        .insert({
          workspace_id: workspaceId,
          connection_id: zapiConnection.id,
          lead_id: newLead.id,
          phone_number: normalizePhone(contact.phone) || contact.phone.replace(/\D/g, ""),
          contact_name: contact.name || null,
          last_message_at: new Date().toISOString(),
          is_active: true,
        });

      if (zapiConvError) {
        console.error("[Inbox] Error creating zapi_conversations:", zapiConvError);
      } else {
        console.log("[Inbox] zapi_conversations created for outbound messaging");
      }
    }

    // Atualiza crm_contacts com o lead_id
    await supabase
      .from("crm_contacts")
      .update({ lead_id: newLead.id })
      .eq("id", contact.id);

    // Adiciona o novo lead ao estado local
    const { data: fullLead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", newLead.id)
      .single();
    
    if (fullLead) {
      setLeads((prev) => [fullLead, ...prev]);
    }
    
    selectLead(newLead.id);
    setIsSelectLeadOpen(false);
    setContactSearch("");
    setIsCreatingLead(false);
    
    toast({ 
      title: "Conversa iniciada", 
      description: `Conversa com ${contact.name} aberta.` 
    });
  };

  // Filtered contacts based on search (case-insensitive, accent-insensitive)
  const normalizeContact = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const filteredCrmContacts = crmContacts.filter(c => {
    const term = normalizeContact(contactSearch);
    return normalizeContact(c.name).includes(term) ||
      (c.phone && c.phone.includes(contactSearch)) ||
      (c.company && normalizeContact(c.company).includes(term));
  });

  const handleSaveNotes = async () => {
    if (!selectedLeadId) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Nenhum lead selecionado.",
      });
      return;
    }

    setIsSavingNotes(true);
    const { error } = await supabase
      .from("leads")
      .update({ notes })
      .eq("id", selectedLeadId);

    if (error) {
      console.error("Error saving notes:", error);
      toast({
        variant: "destructive",
        title: "Erro ao salvar notas",
        description: error.message,
      });
    } else {
      toast({
        title: "Notas salvas",
        description: "As notas foram atualizadas com sucesso.",
      });
      // Update local state to reflect saved notes
      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === selectedLeadId ? { ...lead, notes } : lead
        )
      );
    }
    setIsSavingNotes(false);
  };

  // Clear all test leads
  const handleClearTests = async () => {
    if (!workspaceId) return;
    
    setIsClearingTests(true);
    
    const { error } = await supabase
      .from("leads")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("is_test", true);

    if (error) {
      console.error("Error clearing tests:", error);
      toast({
        variant: "destructive",
        title: "Erro ao limpar testes",
        description: error.message,
      });
    } else {
      setLeads((prev) => prev.filter((lead) => !lead.is_test));
      if (selectedLead?.is_test) {
        selectLead(null);
      }
      toast({
        title: "Testes limpos",
        description: "Todos os leads de teste foram removidos.",
      });
    }
    
    setIsClearingTests(false);
  };

  if (!workspaceId) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">Selecione um workspace para ver os leads</p>
        </div>
      </div>
    );
  }

  // Lead List Content - reusable for both desktop and mobile
  const renderLeadList = (onSelectLead?: (id: string) => void) => (
    <div className="flex flex-col h-full bg-background">
      {/* Search + Source Filter */}
      <div className="p-2 space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar leads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs bg-card border-border rounded-lg"
          />
        </div>
        {availableSources.length > 0 && (
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="h-7 text-[10px] bg-card border-border rounded-lg">
              <Globe className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
              <SelectValue placeholder="Todas origens" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border z-50">
              <SelectItem value="all" className="text-xs">Todas origens</SelectItem>
              {availableSources.map((source) => (
                <SelectItem key={source} value={source} className="text-xs">
                  {source === "whatsapp" ? "WhatsApp" : source}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={filterQualification} onValueChange={(val: "qualified" | "all" | "unqualified") => setFilterQualification(val)}>
          <SelectTrigger className="h-7 text-[10px] bg-card border-border rounded-lg">
            <UserCheck className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border z-50">
            <SelectItem value="qualified" className="text-xs">Qualificados</SelectItem>
            <SelectItem value="all" className="text-xs">Todos os chats</SelectItem>
            <SelectItem value="unqualified" className="text-xs">Sem qualificacao</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Filters */}
      <div className="px-2 pb-2 space-y-1.5">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground px-1">
          <span className="flex items-center gap-1">
            <Lock className="h-3 w-3 opacity-50" /> {currentWorkspace?.name || "Somente este workspace"}
          </span>
        </div>
        <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val); setFilterSource("all"); setFilterQualification("qualified"); }}>
          <TabsList className="w-full">
            <TabsTrigger value="all" className="flex-1 justify-center text-[10px]">
              Todos
            </TabsTrigger>
            <TabsTrigger 
              value="human" 
              className={cn(
                "flex-1 justify-center text-[10px] relative",
                pendingHumanCount > 0 && "text-warning"
              )}
            >
              <span className="flex items-center gap-1">
                {pendingHumanCount > 0 && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-warning"></span>
                  </span>
                )}
                Pendentes
                {pendingHumanCount > 0 && (
                  <Badge 
                    variant="outline" 
                    className="text-[8px] px-1 py-0 h-3.5 min-w-[18px] border-warning bg-warning/20 text-warning font-bold"
                  >
                    {pendingHumanCount}
                  </Badge>
                )}
              </span>
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger 
                value="simulation" 
                className="flex-1 justify-center text-[10px]"
              >
                <span className="flex items-center gap-1">
                  <FlaskConical className="h-2.5 w-2.5" />
                  Testes
                  {testLeadsCount > 0 && (
                    <Badge 
                      variant="outline" 
                      className="text-[8px] px-1 py-0 h-3.5 min-w-[18px] border-primary bg-primary/20 text-primary font-bold"
                    >
                      {testLeadsCount}
                    </Badge>
                  )}
                </span>
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
      </div>

      {/* New Lead / New Test Button */}
      <div className="px-2 pb-2">
        {activeTab === "simulation" ? (
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1 rounded-lg gap-1.5 text-xs h-8 border-dashed border-primary/30 text-primary hover:bg-primary/10 hover:text-primary"
              onClick={() => setIsNewTestDialogOpen(true)}
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Novo Teste
            </Button>
            {testLeadsCount > 0 && (
              <Button 
                variant="outline" 
                size="sm" 
                className="rounded-lg gap-1.5 text-xs h-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleClearTests}
                disabled={isClearingTests}
              >
                {isClearingTests ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
        ) : (
          <Dialog 
            open={isSelectLeadOpen} 
            onOpenChange={(open) => {
              setIsSelectLeadOpen(open);
              if (open) fetchCrmContacts();
              else setContactSearch("");
            }}
          >
            <DialogTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full rounded-lg gap-1.5 text-xs h-8 border-dashed border-primary/30 text-primary hover:bg-primary/10 hover:text-primary"
              >
                <Search className="h-3.5 w-3.5" />
                Selecionar Lead
              </Button>
            </DialogTrigger>
            <DialogContent className="glass-card border-border sm:max-w-[480px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <Search className="h-4 w-4 text-primary" />
                  Selecionar Lead
                </DialogTitle>
                <DialogDescription className="text-muted-foreground text-xs">
                  Busque um contato cadastrado no Pipeline ou Contatos.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Buscar Contato</Label>
                  <Input
                    placeholder="Nome, telefone ou empresa..."
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    className="bg-secondary border-border rounded-lg h-8 text-xs"
                  />
                </div>
                
                <ScrollArea className="max-h-[280px] rounded-md border border-border">
                  {isLoadingContacts ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredCrmContacts.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      {contactSearch ? "Nenhum contato encontrado" : "Nenhum contato cadastrado"}
                    </div>
                  ) : (
                    <div className="p-1">
                      {filteredCrmContacts.map((contact) => (
                        <div 
                          key={contact.id}
                          className={cn(
                            "p-2 hover:bg-muted/50 rounded cursor-pointer flex items-center justify-between gap-2",
                            isCreatingLead && "opacity-50 pointer-events-none"
                          )}
                          onClick={() => handleSelectContact(contact)}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{contact.name}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {contact.phone && <span>{contact.phone}</span>}
                              {contact.company && (
                                <span className="flex items-center gap-1">
                                  <Building2 className="h-3 w-3" />
                                  {contact.company}
                                </span>
                              )}
                            </div>
                          </div>
                          {contact.lead_id ? (
                            <Badge variant="outline" className="text-[9px] shrink-0">
                              Ja no chat
                            </Badge>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]">
                              Abrir
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
                
                <p className="text-xs text-muted-foreground text-center pt-2 border-t border-border">
                  Lead nao encontrado?{" "}
                  <Button 
                    variant="link" 
                    className="h-auto p-0 text-xs text-primary" 
                    onClick={() => {
                      setIsSelectLeadOpen(false);
                      window.location.href = "/crm/pipeline";
                    }}
                  >
                    Criar no Pipeline
                  </Button>
                </p>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Separator />

      {/* Lead List */}
      <ScrollArea className="flex-1 w-full">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="p-3 text-center text-xs text-muted-foreground">
            Nenhum lead encontrado
          </div>
        ) : (
          <div className="w-full px-2 pr-4 py-1.5 space-y-0.5">
            {filteredLeads.map((lead) => {
              const needsHuman = lead.status === "needs_human";
              const isHumanLinked = lead.status === "human_talking" || lead.status === "needs_human";
              const unread = isHumanLinked && selectedLeadId !== lead.id ? (unreadMap[lead.id] || 0) : 0;
              const hasUnread = unread > 0;
              return (
                <div
                  key={lead.id}
                  onClick={() => {
                    selectLead(lead.id);
                    onSelectLead?.(lead.id);
                  }}
                  className={cn(
                    "flex flex-col gap-1 p-2 rounded-md cursor-pointer transition-all group overflow-hidden w-full",
                    selectedLeadId === lead.id
                      ? "bg-secondary border border-primary/30"
                      : "hover:bg-card/50",
                    needsHuman && selectedLeadId !== lead.id && "border border-warning/50 bg-warning/5 animate-pulse",
                    hasUnread && selectedLeadId !== lead.id && !needsHuman && "bg-primary/5 border border-primary/20"
                  )}
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      {lead.is_test && (
                        <FlaskConical className="h-3 w-3 text-primary shrink-0" />
                      )}
                      {needsHuman && !lead.is_test && (
                        <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
                      )}
                      <span className={cn(
                        "text-xs truncate flex-1 min-w-0",
                        hasUnread ? "font-bold text-foreground" : "font-medium"
                      )}>{lead.contact?.name || lead.name || "Sem nome"}</span>
                      {(() => {
                        const ln = lead.contact?.name || lead.name;
                        const lp = lead.contact?.phone || lead.phone;
                        const le = lead.contact?.email;
                        const qualified = (!!ln && ln.trim() !== "") && ((!!le && le.trim() !== "") || (!!lp && lp.trim() !== ""));
                        return !qualified ? (
                          <Badge variant="outline" className="text-[7px] px-1 py-0 shrink-0 border-warning/30 bg-warning/10 text-warning">
                            Sem dados
                          </Badge>
                        ) : null;
                      })()}
                      <span className={cn(
                        "text-[10px] shrink-0",
                        hasUnread ? "text-primary font-semibold" : "text-muted-foreground"
                      )}>
                        {formatTime(lead.last_message_at)}
                      </span>
                      <UnreadBadge count={unread} urgent={needsHuman} />
                      {/* Actions dropdown */}
                      {/* Actions dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <button className="p-1.5 hover:bg-muted rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <MoreVertical className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleArchiveLead(lead.id);
                            }}
                            className="text-xs gap-2"
                          >
                            <Archive className="h-3 w-3" />
                            Arquivar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteLead(lead.id);
                            }}
                            className="text-xs gap-2 text-destructive focus:text-destructive"
                          >
                            <X className="h-3 w-3" />
                            Apagar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex items-center justify-between gap-1 overflow-hidden">
                      <p className="text-[10px] text-muted-foreground truncate flex-1 min-w-0">{lead.contact?.company || lead.phone || "Sem telefone"}</p>
                      {/* Source badge */}
                      {(!lead.source || lead.source === "whatsapp") ? (
                        <Badge variant="outline" className="text-[7px] px-1 py-0 shrink-0 border-success/30 bg-success/10 text-success">
                          <MessageSquare className="h-2 w-2 mr-0.5" />
                          WhatsApp
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[7px] px-1 py-0 shrink-0 border-primary/30 bg-primary/10 text-primary max-w-[70px] truncate">
                          <Globe className="h-2 w-2 mr-0.5 shrink-0" />
                          {lead.source}
                        </Badge>
                      )}
                      {lead.status && (
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-[7px] px-1 py-0 uppercase font-medium border shrink-0 max-w-[70px] truncate", 
                            statusConfig[lead.status as keyof typeof statusConfig]?.className
                          )}
                        >
                          {statusConfig[lead.status as keyof typeof statusConfig]?.label || lead.status}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {/* Agent badge */}
                  {lead.assigned_agent_id && getAgentDisplayName(lead.assigned_agent_id) && (
                    <div className="flex items-center gap-1">
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-muted/50">
                        <Bot className="h-2.5 w-2.5 mr-0.5" />
                        {getAgentDisplayName(lead.assigned_agent_id)}
                      </Badge>
                    </div>
                  )}
                  {/* Tags display */}
                  {lead.tags && lead.tags.length > 0 && (
                    <div className="flex flex-wrap gap-0.5">
                      {lead.tags.slice(0, 3).map((tag) => (
                        <Badge 
                          key={tag} 
                          variant="outline" 
                          className="text-[8px] px-1 py-0 bg-primary/5 text-primary border-primary/20"
                        >
                          {tag}
                        </Badge>
                      ))}
                      {lead.tags.length > 3 && (
                        <Badge 
                          variant="outline" 
                          className="text-[8px] px-1 py-0 bg-muted text-muted-foreground"
                        >
                          +{lead.tags.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );

  // Render Lead Details - reusable for desktop column and mobile drawer
  const renderLeadDetails = () => (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border shrink-0">
        <span className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[var(--subtle)]">Detalhes do lead</span>
      </div>
      <ScrollArea className="flex-1">
        {selectedLead ? (
          <div className="p-3 space-y-4">
            {/* Lead Header */}
            <div className="text-center space-y-2">
              <Avatar className="h-14 w-14 mx-auto border-2 border-primary/20">
                <AvatarFallback className="bg-card text-foreground font-semibold text-lg">
                  {getInitials(selectedLead.contact?.name || selectedLead.name)}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="font-semibold text-sm">{selectedLead.contact?.name || selectedLead.name || "Sem nome"}</h3>
                <p className="text-[11px] text-muted-foreground font-mono">{selectedLead.contact?.phone || selectedLead.phone || "Sem telefone"}</p>
                {selectedLead.contact?.company && (
                  <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1 mt-1">
                    <Building2 className="h-3 w-3" />
                    {selectedLead.contact.company}
                  </p>
                )}
                {selectedLead.contact?.email && (
                  <p className="text-[10px] text-muted-foreground">{selectedLead.contact.email}</p>
                )}
              </div>
            </div>

            <Separator />

            {/* Quick Info */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Visto por último
                </span>
                <span className="text-[11px]">{selectedLead.last_message_at ? new Date(selectedLead.last_message_at).toLocaleDateString('pt-BR') : "—"}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Check className="h-3 w-3" />
                  Status
                </span>
                {selectedLead.status && (
                  <Badge 
                    variant="outline" 
                    className={cn(
                      "text-[9px] px-1.5 py-0 uppercase", 
                      statusConfig[selectedLead.status as keyof typeof statusConfig]?.className
                    )}
                  >
                    {statusConfig[selectedLead.status as keyof typeof statusConfig]?.label}
                  </Badge>
                )}
              </div>
              {selectedLead.source && (
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Tag className="h-3 w-3" />
                    Origem
                  </span>
                  <span className="text-[11px] text-foreground">{selectedLead.source}</span>
                </div>
              )}
            </div>

            {leadPsychology?.crm_lead_id && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 text-xs"
                asChild
              >
                <Link to={`/crm/pipeline?lead=${leadPsychology.crm_lead_id}`}>
                  <ArrowRightLeft className="h-3 w-3" />
                  Ver no Pipeline
                </Link>
              </Button>
            )}

            <Separator />

            {/* AI Analysis */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-medium text-primary uppercase tracking-wider flex items-center gap-1.5">
                <Bot className="h-3 w-3" />
                ANÁLISE DA IA
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed bg-background/50 p-2 rounded-lg whitespace-pre-wrap">
                {selectedLead.ai_summary || '"Nenhuma análise disponível."'}
              </p>
            </div>

            <Separator />

            {/* DNIA Section - Psychology Summary */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-medium text-primary uppercase tracking-wider flex items-center gap-1.5">
                <Brain className="h-3 w-3" />
                DNIA DO LEAD
              </h4>
              <div className="bg-background/50 p-3 rounded-lg space-y-3">
                {leadPsychology && (leadPsychology.dna_code || leadPsychology.temperatura) ? (
                  <>
                    <DNIABadge
                      dnaCode={leadPsychology.dna_code}
                      temperatura={leadPsychology.temperatura}
                      propensityScore={leadPsychology.propensity_score}
                      size="medium"
                      showPropensity={true}
                    />
                    
                    {/* Scores row */}
                    {(leadPsychology.risk_score !== null || leadPsychology.opportunity_score !== null) && (
                      <div className="flex gap-3 text-xs">
                        {leadPsychology.risk_score !== null && (
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">Risco:</span>
                            <span className={cn(
                              "font-mono font-medium",
                              leadPsychology.risk_score >= 70 ? "text-destructive" :
                              leadPsychology.risk_score >= 40 ? "text-warning" : "text-success"
                            )}>
                              {leadPsychology.risk_score}%
                            </span>
                          </div>
                        )}
                        {leadPsychology.opportunity_score !== null && (
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">Oportunidade:</span>
                            <span className={cn(
                              "font-mono font-medium",
                              leadPsychology.opportunity_score >= 70 ? "text-success" :
                              leadPsychology.opportunity_score >= 40 ? "text-warning" : "text-muted-foreground"
                            )}>
                              {leadPsychology.opportunity_score}%
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Link to full analysis */}
                    {leadPsychology.crm_lead_id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full gap-2 text-xs h-7 text-primary hover:text-primary hover:bg-primary/10"
                        onClick={() => setIsPsychologyModalOpen(true)}
                      >
                        <Brain className="h-3 w-3" />
                        Ver Analise Completa
                      </Button>
                    )}
                  </>
                ) : leadPsychology?.crm_lead_id ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Nenhuma analise realizada ainda.
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full gap-2 text-xs h-7 text-primary hover:text-primary hover:bg-primary/10"
                      onClick={() => setIsPsychologyModalOpen(true)}
                    >
                      <Brain className="h-3 w-3" />
                      Analisar Agora
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Lead ainda nao esta no CRM Pipeline.
                  </p>
                )}
              </div>
            </div>

            <Separator />

            {/* Real-time Insights OR Debug Insights for test leads */}
            {selectedLead.is_test ? (
              <DebugInsights debugData={null} />
            ) : (
              <LeadInsights 
                insights={selectedLead.insights as any} 
                status={selectedLead.status} 
              />
            )}

            <Separator />

            {/* Tags Section */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Tag className="h-3 w-3" />
                TAGS
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {(selectedLead.tags || []).map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary border-primary/20 gap-1"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-destructive transition-colors"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Nova tag..."
                  className="h-7 text-xs bg-background border-border rounded-lg flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 rounded-lg"
                  onClick={handleAddTag}
                  disabled={isAddingTag || !newTag.trim()}
                >
                  {isAddingTag ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>

            <Separator />

            {/* Internal Notes */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                NOTAS INTERNAS
              </h4>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Adicione notas..."
                className="min-h-[60px] resize-none text-xs bg-background border-border rounded-lg"
              />
            </div>

            {/* Save Button */}
            <Button
              className="w-full rounded-lg h-8 text-xs"
              variant="secondary"
              disabled={!selectedLead || isSavingNotes}
              onClick={handleSaveNotes}
            >
              {isSavingNotes ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar Notas"
              )}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-muted-foreground">Selecione um lead</p>
          </div>
        )}
      </ScrollArea>
    </div>
  );

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Mobile Lead List Sheet */}
      <Sheet open={isMobileLeadListOpen} onOpenChange={setIsMobileLeadListOpen}>
        <SheetContent side="left" className="w-[280px] p-0">
          <VisuallyHidden.Root>
            <SheetTitle>Lista de Leads</SheetTitle>
            <SheetDescription>Navegue pelos leads disponíveis</SheetDescription>
          </VisuallyHidden.Root>
          {renderLeadList(() => setIsMobileLeadListOpen(false))}
        </SheetContent>
      </Sheet>

      {/* Mobile Lead Details Drawer */}
      <Drawer open={isMobileDetailsOpen} onOpenChange={setIsMobileDetailsOpen}>
        <DrawerContent className="max-h-[85vh] p-0">
          <VisuallyHidden.Root>
            <DrawerTitle>Detalhes do Lead</DrawerTitle>
            <DrawerDescription>Informações e contexto do lead selecionado</DrawerDescription>
          </VisuallyHidden.Root>
          <div className="h-full overflow-auto">
            {renderLeadDetails()}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Column 1: Lead List - Hidden on mobile/tablet */}
      <div className="hidden lg:flex w-[280px] min-w-[240px] max-w-[320px] shrink-0 border-r border-border flex-col bg-background">
        {renderLeadList()}
      </div>

      {/* Column 2: Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Chat Header - fixed height */}
        <div className="h-12 shrink-0 border-b border-border flex items-center justify-between px-3 bg-background">
          {selectedLead ? (
            <>
              <div className="flex items-center gap-2">
                {/* Mobile/Tablet menu button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden h-7 w-7 shrink-0"
                  onClick={() => setIsMobileLeadListOpen(true)}
                >
                  <Menu className="h-4 w-4" />
                </Button>
                <Avatar className="h-7 w-7 border border-primary/20">
                  <AvatarFallback className="bg-card text-foreground font-medium text-xs">
                    {getInitials(selectedLead.name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h2 className="font-medium text-xs">{selectedLead.name || "Sem nome"}</h2>
                    {selectedLead.is_test && (
                      <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-primary/50 bg-primary/20 text-primary">
                        <FlaskConical className="h-2 w-2 mr-0.5" />
                        TESTE
                      </Badge>
                    )}
                    {/* Source badge in header */}
                    {(!selectedLead.source || selectedLead.source === "whatsapp") ? (
                      <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-success/30 bg-success/10 text-success">
                        <MessageSquare className="h-2.5 w-2.5 mr-0.5" />
                        WhatsApp
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-primary/30 bg-primary/10 text-primary">
                        <Globe className="h-2.5 w-2.5 mr-0.5" />
                        {selectedLead.source}
                      </Badge>
                    )}
                    {selectedLead.status === 'human_talking' ? (
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        Atendido por: <span className="text-foreground">{selectedLead.assigned_to_user_id === currentUserId ? "Você" : (assignedUserName || "Agente")}</span>
                      </span>
                    ) : selectedLead.assigned_agent_id && getAgentDisplayName(selectedLead.assigned_agent_id) ? (
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        Assigned: <span className="text-primary">{getAgentDisplayName(selectedLead.assigned_agent_id)}</span>
                      </span>
                    ) : null}
                    {transfers.length > 0 && (
                      <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-warning/50 text-warning">
                        <RefreshCw className="h-2 w-2 mr-0.5" />
                        {transfers.length} transfer{transfers.length > 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">

                {/* Transfer Dialog */}
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="rounded-lg gap-1.5 text-[10px] h-7 px-2"
                  onClick={() => setIsTransferDialogOpen(true)}
                >
                  <ArrowRightLeft className="h-3 w-3" />
                  Transferir
                </Button>
                
                {currentUserId && selectedLead && (
                  <TransferDialog
                    open={isTransferDialogOpen}
                    onOpenChange={setIsTransferDialogOpen}
                    leadId={selectedLead.id}
                    leadName={selectedLead.name}
                    workspaceId={workspaceId}
                    currentUserId={currentUserId}
                    onTransferComplete={() => {
                      // Optionally refresh leads or show notification
                    }}
                  />
                )}

                {/* Change Channel Dialog - available when lead has phone */}
                {selectedLead?.phone && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg gap-1.5 text-[10px] h-7 px-2"
                      onClick={() => setIsChangeChannelOpen(true)}
                      disabled={selectedLead?.status !== 'human_talking'}
                      title={selectedLead?.status !== 'human_talking' ? 'Disponivel apenas durante atendimento humano' : 'Trocar canal de conexao'}
                    >
                      <LinkIcon className="h-3 w-3" />
                      Trocar Canal
                    </Button>

                    {currentUserId && (
                      <ChangeChannelDialog
                        open={isChangeChannelOpen}
                        onOpenChange={setIsChangeChannelOpen}
                        leadId={selectedLead.id}
                        leadName={selectedLead.name}
                        leadPhone={selectedLead.phone}
                        workspaceId={workspaceId}
                        currentConnectionId={connectionStatus?.connection_id || null}
                        currentSource={selectedLead.source}
                        onChannelChanged={(newConnectionId, connectionName, connectionType) => {
                          setConnectionStatus({
                            is_active: true,
                            zapi_connected: true,
                            connection_id: newConnectionId,
                            connection_type: connectionType,
                          });
                          if (connectionType === 'zapi') {
                            supabase
                              .from("zapi_conversations")
                              .select("id")
                              .eq("lead_id", selectedLead.id)
                              .eq("is_active", true)
                              .maybeSingle()
                              .then(({ data }) => {
                                setZapiConversationId(data?.id || null);
                              });
                          } else {
                            setZapiConversationId(null);
                          }
                        }}
                      />
                    )}
                  </>
                )}

                {/* NewLeadDialog for VCard contacts */}
                <NewLeadDialog
                  isOpen={isNewLeadDialogOpen}
                  onClose={() => {
                    setIsNewLeadDialogOpen(false);
                    setVcardLeadData(null);
                  }}
                  initialData={vcardLeadData || undefined}
                  onSuccess={() => {
                    toast({ title: "Lead criado com sucesso!" });
                  }}
                />

                {/* Botão Contextual: Assumir Atendimento ou Devolver para IA */}
                {selectedLead?.status !== 'human_talking' && selectedLead?.status !== 'closed' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "rounded-lg gap-1.5 text-xs h-8 px-3 transition-all font-medium",
                      selectedLead?.status === 'needs_human'
                        ? "animate-pulse border-warning text-warning hover:bg-warning/10 hover:text-warning shadow-[0_0_12px_rgba(245,158,11,0.4)]"
                        : "border-primary text-primary hover:bg-primary/10 hover:text-primary shadow-[0_0_12px_rgba(61,97,255,0.3)] hover:shadow-[0_0_16px_rgba(61,97,255,0.5)]"
                    )}
                    onClick={handleAssumeControl}
                    disabled={isHandoffLoading}
                  >
                    {isHandoffLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UserCheck className="h-3.5 w-3.5" />
                    )}
                    Assumir Atendimento
                  </Button>
                )}
                
                {selectedLead?.status === 'human_talking' && (
                  <Button 
                    variant="outline"
                    size="sm" 
                    className="rounded-lg gap-1 text-[10px] h-7 px-2 border-success text-success hover:bg-success/10 hover:text-success"
                    onClick={handleReturnToAI}
                    disabled={isHandoffLoading}
                  >
                    {isHandoffLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Bot className="h-3 w-3" />
                    )}
                    Devolver para IA
                  </Button>
                )}

                {/* Mobile/Tablet details button - visible when lead details column is hidden */}
                <Button
                  variant="outline"
                  size="sm"
                  className="xl:hidden h-7 px-2 shrink-0 gap-1 text-[10px]"
                  onClick={() => setIsMobileDetailsOpen(true)}
                >
                  <Info className="h-3 w-3" />
                  <span className="hidden sm:inline">Detalhes</span>
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              {/* Mobile/Tablet menu button */}
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden h-7 w-7 shrink-0"
                onClick={() => setIsMobileLeadListOpen(true)}
              >
                <Menu className="h-4 w-4" />
              </Button>
              <p className="text-xs text-muted-foreground">Selecione um lead</p>
            </div>
          )}
        </div>

        {/* Chat Body - scrollable area */}
        <div className="flex-1 overflow-y-auto bg-background">
          {selectedLead ? (
            isLoadingMessages ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-muted-foreground">Nenhuma mensagem ainda</p>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {messages
                  .filter(msg => !msg.content?.includes("__INIT_GREETING__"))
                  .map((msg, index, filteredArr) => {
                  // System message banner
                  if (msg.content?.startsWith("__SYSTEM__:")) {
                    const systemText = msg.content.replace("__SYSTEM__:", "");
                    return (
                      <div key={msg.id} className="flex items-center justify-center gap-2 py-2 my-1">
                        <div className="h-px flex-1 bg-primary/20" />
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
                          <Info className="h-3 w-3 text-primary" />
                          <span className="text-[10px] text-primary font-medium">{systemText}</span>
                        </div>
                        <div className="h-px flex-1 bg-primary/20" />
                      </div>
                    );
                  }

                  const transfer = msg.sender_type === "ai" ? getTransferBeforeMessage(msg.created_at) : null;
                  const agentName = getRespondingAgentName(msg);
                  const agentInitial = agentName ? agentName.charAt(0).toUpperCase() : "A";

                  // Date separator logic
                  const msgDate = new Date(msg.created_at);
                  const prevMsg = index > 0 ? filteredArr[index - 1] : null;
                  const prevDate = prevMsg ? new Date(prevMsg.created_at) : null;
                  const showDateSeparator = !prevDate || msgDate.toDateString() !== prevDate.toDateString();

                  let dateLabel = "";
                  if (showDateSeparator) {
                    const today = new Date();
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    if (msgDate.toDateString() === today.toDateString()) {
                      dateLabel = "Hoje";
                    } else if (msgDate.toDateString() === yesterday.toDateString()) {
                      dateLabel = "Ontem";
                    } else {
                      dateLabel = msgDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
                    }
                  }

                  return (
                    <div key={msg.id}>
                      {showDateSeparator && (
                        <div className="flex items-center justify-center my-3">
                          <span className="px-3 py-1 rounded-full bg-muted/50 border border-border/50 text-[10px] text-muted-foreground font-medium">
                            {dateLabel}
                          </span>
                        </div>
                      )}
                      {/* Transfer indicator */}
                      {transfer && (
                        <div className="flex items-center justify-center gap-2 py-2 mb-2">
                          <div className="h-px flex-1 bg-warning/30" />
                          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning/10 border border-warning/20">
                            <RefreshCw className="h-3 w-3 text-warning" />
                            <span className="text-[10px] text-warning font-medium">
                              Transferido para {transfer.to_intent || 'novo departamento'}
                            </span>
                          </div>
                          <div className="h-px flex-1 bg-warning/30" />
                        </div>
                      )}
                      
                      <div
                        className={cn(
                          "flex gap-2 group",
                          msg.sender_type === "lead" ? "justify-start" : "justify-end"
                        )}
                      >
                        {msg.sender_type === "lead" && (
                          <Avatar className="h-6 w-6 mt-1">
                            <AvatarFallback className="bg-card text-muted-foreground text-[10px]">
                              <User className="h-3 w-3" />
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div className={cn("max-w-[60%]", msg.sender_type !== "lead" && "flex flex-col items-end")}>
                          {msg.sender_type === "lead" && (
                            <span className="text-[9px] text-muted-foreground font-semibold mb-0.5 uppercase tracking-wide">
                              {selectedLead?.name || "Lead"}
                            </span>
                          )}
                          {msg.sender_type !== "lead" && (
                            <span className="text-[9px] text-primary font-semibold mb-0.5 uppercase tracking-wide">
                              {msg.sender_type === "ai" && agentName ? agentName.toUpperCase() : (msg.sender_type === "ai" ? "IA" : "AGENTE")}
                            </span>
                          )}
                          <div
                            className={cn(
                              "px-3 py-2 rounded-xl",
                              msg.sender_type === "lead"
                                ? "bg-muted dark:bg-[hsl(220,20%,18%)] text-foreground"
                                : "bg-primary dark:bg-[hsl(215,50%,23%)] text-primary-foreground dark:text-foreground"
                            )}
                          >
                            {msg.reply_to_content && (
                              <QuotedMessage
                                content={msg.reply_to_content}
                                senderType={msg.reply_to_sender_type || null}
                                leadName={selectedLead?.name}
                                isOutgoing={msg.sender_type !== "lead"}
                              />
                            )}
                            {msg.media_url && msg.media_type && (
                              <MediaMessage
                                url={msg.media_url}
                                type={msg.media_type}
                                className="mb-2"
                                onAddVCardToLeads={handleAddVCardToLeads}
                              />
                            )}
                            {msg.content && msg.content !== "[Imagem]" && msg.content !== "[Audio]" && msg.content !== "[Video]" && msg.content !== "[Recado de vídeo]" && msg.content !== "[Figurinha]" && !msg.content.startsWith("[Documento") && !msg.content.startsWith("[Contato:") && !msg.content.startsWith("[Localização") && (
                              <MessageContent content={msg.content} />
                            )}
                            {msg.media_type === "audio" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className={`mt-1 h-6 px-2 text-[10px] gap-1 ${
                                  isFailedAudioTranscription(msg.content)
                                    ? "text-warning hover:text-warning hover:bg-warning/10"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                }`}
                                onClick={() => handleRetranscribeAudio(String(msg.id))}
                                disabled={reprocessingMessageId === String(msg.id)}
                              >
                                {reprocessingMessageId === String(msg.id) ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3 w-3" />
                                )}
                                {isFailedAudioTranscription(msg.content) ? "Reprocessar audio" : "Re-transcrever"}
                              </Button>
                            )}
                            <div className="flex items-center gap-1 mt-1 opacity-60">
                              <span className="text-[9px]">
                                {formatTime(msg.created_at)}
                              </span>
                              {msg.sender_type !== "lead" && (
                                <MessageStatusIndicator
                                  status={(msg as Message & { delivery_status?: string }).delivery_status as 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | null}
                                  title={(msg as Message & { delivery_error?: string }).delivery_error || undefined}
                                />
                              )}
                            </div>
                            {msg.sender_type !== "lead" &&
                              !msg.media_url &&
                              msg.content &&
                              !msg.content.startsWith("[E-mail]") &&
                              !msg.content.startsWith("[Email]") &&
                              ((msg as Message & { delivery_status?: string }).delivery_status === 'failed' ||
                                (((msg as Message & { delivery_status?: string }).delivery_status === 'sent' ||
                                  (msg as Message & { delivery_status?: string }).delivery_status === 'pending') &&
                                  (Date.now() - new Date(msg.created_at).getTime()) > 60_000)) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="mt-1 h-6 px-2 text-[10px] gap-1 text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
                                  onClick={() => handleSendMessage(msg.content)}
                                  disabled={isSending || isConnectionBlocked}
                                  title={
                                    (msg as Message & { delivery_status?: string }).delivery_status === 'failed'
                                      ? `Falha no envio${(msg as Message & { delivery_error?: string }).delivery_error ? ': ' + (msg as Message & { delivery_error?: string }).delivery_error : ''}`
                                      : "Reenviar mensagem (não confirmada como entregue pelo WhatsApp após 1 minuto)"
                                  }
                                >
                                  <RefreshCw className="h-3 w-3" />
                                  Reenviar
                                </Button>
                              )}

                          </div>
                        </div>
                        {/* Reply button for lead messages */}
                        {msg.sender_type === "lead" && msg.external_message_id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity self-center"
                            onClick={() => setReplyingTo(msg)}
                            title="Responder"
                          >
                            <Reply className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        )}
                        {msg.sender_type !== "lead" && (
                          <Avatar className="h-6 w-6 mt-1 bg-primary/20">
                            <AvatarFallback className="bg-primary text-primary-foreground text-[10px]">
                              {agentInitial}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-muted-foreground">Selecione um lead para ver as mensagens</p>
            </div>
          )}
        </div>

        {/* Chat Footer - fixed at bottom */}
        <div className={cn(
          "shrink-0 p-3 border-t bg-card",
          selectedLead?.is_test ? "border-primary/50 bg-primary/5" : "border-border"
        )}>
          {selectedLead?.is_test && (
            <div className="flex items-center gap-1.5 mb-2 text-[10px] text-primary">
              <FlaskConical className="h-3 w-3" />
              <span className="font-medium">Modo Simulação</span>
              <span className="text-muted-foreground">- Suas mensagens serão enviadas como lead para testar o agente</span>
            </div>
          )}
          {/* Reply preview */}
          {replyingTo && (
            <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-muted/50 rounded-lg">
              <div className="flex-1 border-l-2 border-primary pl-2 min-w-0">
                <span className="text-[8px] text-muted-foreground uppercase font-medium">
                  Respondendo a {selectedLead?.name || "Lead"}
                </span>
                <p className="text-[10px] text-foreground truncate">
                  {replyingTo.content}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0"
                onClick={() => setReplyingTo(null)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
          {/* Shadow ban warning - mensagens recentes falharam por shadow ban */}
          {(() => {
            const recentShadowBan = messages.some((m) => {
              const mm = m as Message & { delivery_status?: string; delivery_error?: string };
              if (mm.delivery_status !== 'failed' || !mm.delivery_error) return false;
              if (!/shadow[_\s-]?ban/i.test(mm.delivery_error)) return false;
              return (Date.now() - new Date(m.created_at).getTime()) < 24 * 60 * 60 * 1000;
            });
            if (!recentShadowBan) return null;
            return (
              <div className="rounded-lg p-3 mb-2 border bg-destructive/10 border-destructive/30">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-destructive">Possível shadow ban no WhatsApp</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      O WhatsApp está silenciosamente descartando mensagens enviadas por esta conexão. Reenviar não resolve.
                      Recomendamos pausar envios automáticos, reduzir a cadência e considerar aquecer o número.{" "}
                      <Link to="/connections" className="text-primary underline hover:no-underline">
                        Ver conexão
                      </Link>
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}
          {/* Connection disabled/disconnected banner */}
          {isConnectionBlocked && selectedLead && (
            <div className={cn(
              "rounded-lg p-3 mb-2 border",
              !connectionStatus?.is_active
                ? "bg-destructive/10 border-destructive/30"
                : "bg-warning/10 border-warning/30"
            )}>
              <div className="flex items-center gap-2">
                {!connectionStatus?.is_active ? (
                  <>
                    <Power className="h-4 w-4 text-destructive shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-destructive">Conexao desabilitada</p>
                      <p className="text-[10px] text-muted-foreground">
                        A conexao utilizada por este chat esta desabilitada.{" "}
                        <Link to="/connections" className="text-primary underline hover:no-underline">
                          Ative nas configuracoes
                        </Link>
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-4 w-4 text-warning shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-warning">WhatsApp desconectado</p>
                      <p className="text-[10px] text-muted-foreground">
                        O WhatsApp desta conexao esta desconectado.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 h-7 text-[10px] border-warning/50 text-warning hover:bg-warning/10"
                      onClick={handleOpenReconnectModal}
                    >
                      <QrCode className="h-3 w-3 mr-1" />
                      Reconectar
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
          {/* Connection blocked has highest priority - no messages can be sent */}
          {isConnectionBlocked ? (
            <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              <span>Envio de mensagens bloqueado ate que a conexao seja restabelecida.</span>
            </div>
          ) : !selectedLead ? (
            null
          ) : !selectedLead.is_test && selectedLead.assigned_to_user_id !== currentUserId ? (
            <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              <span>Conversa sendo atendida pelo agente de IA. Assuma o controle para responder.</span>
            </div>
          ) : (
            <>
              {/* WhatsApp 24h window banner */}
              {isWhatsappOfficial && !whatsappWindow.loading && (
                whatsappWindow.windowOpen ? (
                  <div className="flex items-center justify-between gap-2 mb-2 rounded-md border border-success/30 bg-success/10 px-3 py-1.5">
                    <div className="flex items-center gap-2 text-[11px] text-success">
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>
                        Janela aberta · expira em {formatWindowRemaining(whatsappWindow.minutesRemaining)}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => setTemplateDialogOpen(true)}
                    >
                      <FileText className="h-3 w-3 mr-1" />
                      Enviar modelo
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5">
                    <div className="flex items-center gap-2 text-[11px] text-destructive">
                      <Lock className="h-3.5 w-3.5" />
                      <span>
                        Janela de 24h fechada · envie um modelo aprovado para reabrir
                      </span>
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => setTemplateDialogOpen(true)}
                    >
                      <FileText className="h-3 w-3 mr-1" />
                      Enviar modelo
                    </Button>
                  </div>
                )
              )}
              {(!isWhatsappOfficial || whatsappWindow.windowOpen) && (
                <ChatInput
                  onSendMessage={handleSendMessage}
                  onSendAudio={handleSendAudio}
                  onMediaSelect={handleMediaSelect}
                  isTest={selectedLead?.is_test === true}
                  disabled={!selectedLead}
                  isSending={isSending}
                  isSendingMedia={isSendingMedia}
                  hasZapiConversation={!!zapiConversationId}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Column 3: Lead Context - Hidden on mobile/tablet */}
      <div className="hidden xl:flex w-[220px] min-w-[180px] max-w-[260px] shrink-0 border-l border-border bg-card flex-col">
        {renderLeadDetails()}
      </div>

      {/* New Test Dialog */}
      {workspaceId && (
        <NewTestDialog
          open={isNewTestDialogOpen}
          onOpenChange={setIsNewTestDialogOpen}
          workspaceId={workspaceId}
          onTestCreated={(leadId) => {
            selectLead(leadId);
            setActiveTab("simulation");
          }}
        />
      )}

      {/* Psychology Modal */}
      {leadPsychology?.crm_lead_id && (
        <PsychologyModal
          open={isPsychologyModalOpen}
          onOpenChange={setIsPsychologyModalOpen}
          crmLeadId={leadPsychology.crm_lead_id}
        />
      )}

      {/* Z-API Reconnect QR Code Modal */}
      <Dialog open={isReconnectModalOpen} onOpenChange={(open) => {
        if (!open) handleCloseReconnectModal();
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" />
              Reconectar WhatsApp
            </DialogTitle>
            <DialogDescription>
              Escaneie o QR Code abaixo com seu WhatsApp para reconectar a instancia.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {isLoadingQRCode ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
              </div>
            ) : qrCodeData ? (
              <>
                <div className="p-3 bg-foreground rounded-xl">
                  <img
                    src={qrCodeData}
                    alt="QR Code WhatsApp"
                    className="w-64 h-64 object-contain"
                  />
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Aguardando leitura do QR Code...</span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 py-8">
                <WifiOff className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Nao foi possivel gerar o QR Code.</p>
                <Button variant="outline" size="sm" onClick={handleOpenReconnectModal}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Tentar novamente
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* WhatsApp Official — send approved template dialog */}
      {isWhatsappOfficial && connectionStatus?.connection_id && (
        <SendTemplateDialog
          open={templateDialogOpen}
          onOpenChange={setTemplateDialogOpen}
          connectionId={connectionStatus.connection_id}
          workspaceId={workspaceId}
          onSend={handleSendTemplate}
        />
      )}
    </div>
  );
};

export default Inbox;
