import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Plus, MoreHorizontal, Pencil, Trash2, StickyNote, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface LeadNotesProps {
  leadId: string;
}

interface Note {
  id: string;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  profiles: {
    name: string | null;
    email: string;
  } | null;
}

export function LeadNotes({ leadId }: LeadNotesProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [newNote, setNewNote] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);
  
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [editNoteText, setEditNoteText] = useState("");
  
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  // Fetch notes
  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["crm-lead-notes", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_lead_history")
        .select(`id, notes, created_at, created_by`)
        .eq("lead_id", leadId)
        .eq("action", "note")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      
      // Fetch profiles separately
      const creatorIds = [...new Set(data?.map(n => n.created_by).filter(Boolean) || [])];
      const profilesMap: Record<string, { name: string | null; email: string }> = {};
      
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, name, email")
          .in("id", creatorIds);
        
        profiles?.forEach(p => {
          profilesMap[p.id] = { name: p.name, email: p.email };
        });
      }
      
      return (data || []).map(note => ({
        ...note,
        profiles: note.created_by ? profilesMap[note.created_by] || null : null,
      })) as Note[];
    },
  });

  // Create note
  const createNote = useMutation({
    mutationFn: async (noteText: string) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Usuário não autenticado");
      
      const { error } = await supabase.from("crm_lead_history").insert({
        lead_id: leadId,
        action: "note",
        notes: noteText,
        created_by: userData.user.id,
        moved_by: "user",
      });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-notes", leadId] });
      setNewNote("");
      setIsAddingNote(false);
      toast({ title: "Nota adicionada" });
    },
    onError: () => {
      toast({ title: "Erro ao adicionar nota", variant: "destructive" });
    },
  });

  // Update note
  const updateNote = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await supabase
        .from("crm_lead_history")
        .update({ notes })
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-notes", leadId] });
      setEditingNote(null);
      setEditNoteText("");
      toast({ title: "Nota atualizada" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar nota", variant: "destructive" });
    },
  });

  // Delete note
  const deleteNote = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("crm_lead_history")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-notes", leadId] });
      setDeletingNoteId(null);
      toast({ title: "Nota excluída" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir nota", variant: "destructive" });
    },
  });

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    createNote.mutate(newNote.trim());
  };

  const handleOpenEdit = (note: Note) => {
    setEditingNote(note);
    setEditNoteText(note.notes || "");
  };

  const handleSaveEdit = () => {
    if (!editingNote || !editNoteText.trim()) return;
    updateNote.mutate({ id: editingNote.id, notes: editNoteText.trim() });
  };

  const formatNoteDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffHours < 24) {
      return formatDistanceToNow(date, { addSuffix: true, locale: ptBR });
    }
    return format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-muted-foreground" />
          Notas e atualizações
        </h4>
        {!isAddingNote && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setIsAddingNote(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Adicionar
          </Button>
        )}
      </div>

      {/* Add Note Form */}
      {isAddingNote && (
        <div className="space-y-2 p-3 bg-card/50 rounded-lg border border-border">
          <Textarea
            placeholder="Escreva uma nota ou atualização sobre este lead..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="min-h-[80px] text-xs resize-none"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setIsAddingNote(false);
                setNewNote("");
              }}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleAddNote}
              disabled={!newNote.trim() || createNote.isPending}
            >
              {createNote.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : null}
              Salvar
            </Button>
          </div>
        </div>
      )}

      {/* Notes List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">
          Nenhuma nota registrada
        </p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className="p-3 bg-card/30 rounded-lg border border-border/50 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground">
                    <span className="font-medium text-foreground/80">
                      {note.profiles?.name || note.profiles?.email || "Usuário"}
                    </span>
                    {" • "}
                    {formatNoteDate(note.created_at)}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                      <MoreHorizontal className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleOpenEdit(note)}>
                      <Pencil className="h-3 w-3 mr-2" />
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setDeletingNoteId(note.id)}
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="text-xs text-foreground whitespace-pre-wrap">
                {note.notes}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingNote} onOpenChange={(open) => !open && setEditingNote(null)}>
        <DialogContent className="glass-card border-border">
          <DialogHeader>
            <DialogTitle>Editar Nota</DialogTitle>
          </DialogHeader>
          <Textarea
            value={editNoteText}
            onChange={(e) => setEditNoteText(e.target.value)}
            className="min-h-[120px] text-sm"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingNote(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={!editNoteText.trim() || updateNote.isPending}
            >
              {updateNote.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingNoteId} onOpenChange={(open) => !open && setDeletingNoteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Nota</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta nota? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingNoteId && deleteNote.mutate(deletingNoteId)}
            >
              {deleteNote.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
