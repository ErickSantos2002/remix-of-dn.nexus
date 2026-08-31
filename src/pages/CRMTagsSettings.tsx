import { useState, useEffect } from "react";
import { Search, Pencil, Trash2, Loader2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Json } from "@/integrations/supabase/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { ContactTagBadge, TagColorPicker } from "@/components/crm/tags";
import { parseTags, TAG_COLOR_PALETTE } from "@/types/tags";
import type { ContactTag } from "@/types/tags";

interface TagWithCount extends ContactTag {
  usage_count: number;
}

export default function CRMTagsSettings() {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagWithCount | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<TagWithCount | null>(null);
  const [saving, setSaving] = useState(false);

  // Form states
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState<string>(TAG_COLOR_PALETTE[0]);

  useEffect(() => {
    if (workspaceId) {
      fetchTags();
    }
  }, [workspaceId]);

  const fetchTags = async () => {
    if (!workspaceId) return;
    setLoading(true);

    try {
      // Fetch all contacts with tags
      const { data: contacts, error } = await supabase
        .from("crm_contacts")
        .select("tags")
        .eq("workspace_id", workspaceId)
        .not("tags", "is", null);

      if (error) throw error;

      // Aggregate tags with usage count
      const tagMap = new Map<string, TagWithCount>();

      contacts?.forEach((contact) => {
        const contactTags = parseTags(contact.tags);
        contactTags.forEach((tag) => {
          const key = tag.name.toLowerCase();
          const existing = tagMap.get(key);
          if (existing) {
            existing.usage_count += 1;
          } else {
            tagMap.set(key, { ...tag, usage_count: 1 });
          }
        });
      });

      // Sort by usage count descending
      const sortedTags = Array.from(tagMap.values()).sort(
        (a, b) => b.usage_count - a.usage_count
      );

      setTags(sortedTags);
    } catch (error) {
      console.error("Error fetching tags:", error);
      toast({
        variant: "destructive",
        title: "Erro ao carregar tags",
      });
    } finally {
      setLoading(false);
    }
  };

  const openEditDialog = (tag: TagWithCount) => {
    setEditingTag(tag);
    setFormName(tag.name);
    setFormColor(tag.color);
    setEditDialogOpen(true);
  };

  const handleSave = async () => {
    if (!workspaceId || !editingTag) return;
    setSaving(true);

    try {
      // Fetch all contacts that have the old tag
      const { data: contacts, error: fetchError } = await supabase
        .from("crm_contacts")
        .select("id, tags")
        .eq("workspace_id", workspaceId)
        .not("tags", "is", null);

      if (fetchError) throw fetchError;

      // Update each contact that has the tag
      const updates = contacts
        ?.filter((contact) => {
          const contactTags = parseTags(contact.tags);
          return contactTags.some(
            (t) => t.name.toLowerCase() === editingTag.name.toLowerCase()
          );
        })
        .map(async (contact) => {
          const contactTags = parseTags(contact.tags);
          const updatedTags = contactTags.map((t) =>
            t.name.toLowerCase() === editingTag.name.toLowerCase()
              ? { name: formName.trim(), color: formColor }
              : t
          );

          return supabase
            .from("crm_contacts")
            .update({ tags: updatedTags as unknown as Json })
            .eq("id", contact.id);
        });

      if (updates) {
        await Promise.all(updates);
      }

      toast({ title: "Tag atualizada em todos os contatos" });
      setEditDialogOpen(false);
      setEditingTag(null);
      fetchTags();
    } catch (error) {
      console.error("Error updating tag:", error);
      toast({
        variant: "destructive",
        title: "Erro ao atualizar tag",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!workspaceId || !tagToDelete) return;
    setSaving(true);

    try {
      // Fetch all contacts that have the tag
      const { data: contacts, error: fetchError } = await supabase
        .from("crm_contacts")
        .select("id, tags")
        .eq("workspace_id", workspaceId)
        .not("tags", "is", null);

      if (fetchError) throw fetchError;

      // Remove tag from each contact
      const updates = contacts
        ?.filter((contact) => {
          const contactTags = parseTags(contact.tags);
          return contactTags.some(
            (t) => t.name.toLowerCase() === tagToDelete.name.toLowerCase()
          );
        })
        .map(async (contact) => {
          const contactTags = parseTags(contact.tags);
          const updatedTags = contactTags.filter(
            (t) => t.name.toLowerCase() !== tagToDelete.name.toLowerCase()
          );

          return supabase
            .from("crm_contacts")
            .update({ tags: updatedTags as unknown as Json })
            .eq("id", contact.id);
        });

      if (updates) {
        await Promise.all(updates);
      }

      toast({ title: "Tag removida de todos os contatos" });
      setDeleteDialogOpen(false);
      setTagToDelete(null);
      fetchTags();
    } catch (error) {
      console.error("Error deleting tag:", error);
      toast({
        variant: "destructive",
        title: "Erro ao excluir tag",
      });
    } finally {
      setSaving(false);
    }
  };

  const filteredTags = tags.filter((tag) =>
    tag.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Tag className="h-6 w-6" />
            Tags de Contatos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie as tags utilizadas nos contatos do workspace
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Buscar tags..."
          className="pl-10"
        />
      </div>

      {/* Tags Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredTags.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Tag className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground">
            {searchTerm ? "Nenhuma tag encontrada" : "Nenhuma tag cadastrada"}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {searchTerm
              ? "Tente buscar por outro termo"
              : "Tags serao criadas ao adiciona-las nos contatos"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredTags.map((tag) => (
            <div
              key={tag.name}
              className="glass-card p-4 flex items-center justify-between group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <ContactTagBadge tag={tag} size="md" />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {tag.usage_count} contato{tag.usage_count !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => openEditDialog(tag)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => {
                    setTagToDelete(tag);
                    setDeleteDialogOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="glass-card border-border">
          <DialogHeader>
            <DialogTitle>Editar Tag</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nome da tag"
              />
            </div>

            <div className="space-y-2">
              <Label>Cor</Label>
              <TagColorPicker value={formColor} onChange={setFormColor} />
            </div>

            {formName.trim() && (
              <div className="pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground block mb-2">
                  Preview
                </span>
                <ContactTagBadge
                  tag={{ name: formName.trim(), color: formColor }}
                  size="md"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !formName.trim()}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Salvando...
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="glass-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a tag "{tagToDelete?.name}"?
              <span className="block mt-2 text-warning">
                Esta tag sera removida de {tagToDelete?.usage_count} contato
                {tagToDelete?.usage_count !== 1 ? "s" : ""}.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Excluindo...
                </>
              ) : (
                "Excluir"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
