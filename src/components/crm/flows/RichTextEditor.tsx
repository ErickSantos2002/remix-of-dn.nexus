import { useEffect } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered,
  Link as LinkIcon, Image as ImageIcon, Braces, Undo, Redo, Quote, Minus,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Palette, Highlighter, RemoveFormatting,
} from "lucide-react";

const VARIABLES = ["nome_lead", "primeiro_nome", "empresa", "atendente"];

// Cores em HEX (o e-mail é HTML puro — tokens do tema não existem no cliente do destinatário)
const TEXT_COLORS: { label: string; value: string }[] = [
  { label: "Padrão", value: "#111111" },
  { label: "Cinza", value: "#6b7280" },
  { label: "Vermelho", value: "#dc2626" },
  { label: "Laranja", value: "#ea580c" },
  { label: "Amarelo", value: "#ca8a04" },
  { label: "Verde", value: "#16a34a" },
  { label: "Azul", value: "#2563eb" },
  { label: "Roxo", value: "#7c3aed" },
  { label: "Rosa", value: "#db2777" },
  { label: "Branco", value: "#ffffff" },
];

const HIGHLIGHT_COLORS: { label: string; value: string }[] = [
  { label: "Amarelo", value: "#fef08a" },
  { label: "Verde", value: "#bbf7d0" },
  { label: "Azul", value: "#bfdbfe" },
  { label: "Rosa", value: "#fbcfe8" },
  { label: "Laranja", value: "#fed7aa" },
  { label: "Cinza", value: "#e5e7eb" },
];

const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "30px", "36px"];

const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Times", value: "'Times New Roman', Times, serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Courier", value: "'Courier New', Courier, monospace" },
];

const BLOCKS = [
  { label: "Parágrafo", value: "paragraph" },
  { label: "Título 1", value: "h1" },
  { label: "Título 2", value: "h2" },
  { label: "Título 3", value: "h3" },
  { label: "Título 4", value: "h4" },
];

interface Props {
  value: string;
  onChange: (html: string) => void;
}

function currentBlock(editor: Editor): string {
  for (const level of [1, 2, 3, 4] as const) {
    if (editor.isActive("heading", { level })) return `h${level}`;
  }
  return "paragraph";
}

/**
 * Editor rich-text do corpo do e-mail (nó send_email dos Fluxos).
 * Saída: HTML com estilos inline (cor, tamanho, fonte, alinhamento, destaque),
 * que é o que sobrevive nos clientes de e-mail — o flow-worker interpola as
 * variáveis e envia o HTML pelo Resend.
 */
export function RichTextEditor({ value, onChange }: Props) {
  const editor = useEditor({
    // v3 não re-renderiza a cada transação por padrão; a toolbar depende disso
    // para mostrar o estado ativo (negrito, alinhamento, cor, título…)
    shouldRerenderOnTransaction: true,
    extensions: [
      // StarterKit v3 já traz link, sublinhado, tachado, citação e linha horizontal
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: { openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer" } },
      }),
      TextStyleKit,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ HTMLAttributes: { style: "max-width:100%;height:auto" } }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class:
          "max-w-none min-h-[220px] px-3 py-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset " +
          "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:my-2 " +
          "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:my-1.5 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:my-1.5 " +
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline " +
          "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic " +
          "[&_hr]:my-3 [&_hr]:border-border [&_p]:my-1 [&_img]:max-w-full",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Reidrata quando o diálogo reabre com outro nó
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) return null;

  const btn = (active: boolean) =>
    `h-7 w-7 p-0 ${active ? "bg-secondary text-foreground" : "text-muted-foreground"}`;

  const setBlock = (v: string) => {
    const chain = editor.chain().focus();
    if (v === "paragraph") chain.setParagraph().run();
    else chain.setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 }).run();
  };

  const addLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Endereço do link (https://...)", previous || "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const addImage = () => {
    const url = window.prompt("URL da imagem (https://...)");
    if (!url || !url.trim()) return;
    editor.chain().focus().setImage({ src: url.trim() }).run();
  };

  const activeColor = (editor.getAttributes("textStyle").color as string | undefined) || undefined;

  return (
    <div className="rounded-md border border-border bg-background/50">
      <div className="flex items-center gap-0.5 flex-wrap border-b border-border px-2 py-1">
        {/* Bloco (parágrafo / títulos) */}
        <Select value={currentBlock(editor)} onValueChange={setBlock}>
          <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {BLOCKS.map((b) => (
              <SelectItem key={b.value} value={b.value} className="text-xs">{b.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Fonte e tamanho */}
        <Select
          value={(editor.getAttributes("textStyle").fontFamily as string) || ""}
          onValueChange={(v) => editor.chain().focus().setFontFamily(v).run()}
        >
          <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue placeholder="Fonte" /></SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map((f) => (
              <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={(editor.getAttributes("textStyle").fontSize as string) || ""}
          onValueChange={(v) => editor.chain().focus().setFontSize(v).run()}
        >
          <SelectTrigger className="h-7 w-[76px] text-xs"><SelectValue placeholder="Tam." /></SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">{s.replace("px", "")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Separator orientation="vertical" className="h-5 mx-1" />

        <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive("bold"))}
          onClick={() => editor.chain().focus().toggleBold().run()} title="Negrito">
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive("italic"))}
          onClick={() => editor.chain().focus().toggleItalic().run()} title="Itálico">
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive("underline"))}
          onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sublinhado">
          <UnderlineIcon className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive("strike"))}
          onClick={() => editor.chain().focus().toggleStrike().run()} title="Tachado">
          <Strikethrough className="h-3.5 w-3.5" />
        </Button>

        {/* Cor do texto */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className={btn(!!activeColor)} title="Cor do texto">
              <Palette className="h-3.5 w-3.5" style={activeColor ? { color: activeColor } : undefined} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel className="text-xs">Cor do texto</DropdownMenuLabel>
            <div className="grid grid-cols-5 gap-1 p-2">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  onClick={() => editor.chain().focus().setColor(c.value).run()}
                  className="h-6 w-6 rounded border border-border"
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs" onClick={() => editor.chain().focus().unsetColor().run()}>
              Remover cor
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Destaque */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive("highlight"))} title="Destacar">
              <Highlighter className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel className="text-xs">Destaque</DropdownMenuLabel>
            <div className="grid grid-cols-6 gap-1 p-2">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  onClick={() => editor.chain().focus().toggleHighlight({ color: c.value }).run()}
                  className="h-6 w-6 rounded border border-border"
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs" onClick={() => editor.chain().focus().unsetHighlight().run()}>
              Remover destaque
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Alinhamento */}
        <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive({ textAlign: "left" }))}
          onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Alinhar à esquerda">
          <AlignLeft className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive({ textAlign: "center" }))}
          onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Centralizar">
          <AlignCenter className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive({ textAlign: "right" }))}
          onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Alinhar à direita">
          <AlignRight className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive({ textAlign: "justify" }))}
          onClick={() => editor.chain().focus().setTextAlign("justify").run()} title="Justificar">
          <AlignJustify className="h-3.5 w-3.5" />
        </Button>

        <Separator orientation="vertical" className="h-5 mx-1" />

        <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive("bulletList"))}
          onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista">
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive("orderedList"))}
          onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada">
          <ListOrdered className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive("blockquote"))}
          onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Citação">
          <Quote className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={btn(false)}
          onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Linha divisória">
          <Minus className="h-3.5 w-3.5" />
        </Button>

        <Separator orientation="vertical" className="h-5 mx-1" />

        <Button type="button" variant="ghost" size="icon" className={btn(editor.isActive("link"))}
          onClick={addLink} title="Link">
          <LinkIcon className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={btn(false)} onClick={addImage} title="Imagem por URL">
          <ImageIcon className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={btn(false)} title="Limpar formatação"
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          <RemoveFormatting className="h-3.5 w-3.5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-muted-foreground">
              <Braces className="h-3.5 w-3.5" /> Variáveis
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {VARIABLES.map((v) => (
              <DropdownMenuItem key={v} onClick={() => editor.chain().focus().insertContent(`{${v}}`).run()}>
                {`{${v}}`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex gap-0.5">
          <Button type="button" variant="ghost" size="icon" className={btn(false)}
            onClick={() => editor.chain().focus().undo().run()} title="Desfazer">
            <Undo className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className={btn(false)}
            onClick={() => editor.chain().focus().redo().run()} title="Refazer">
            <Redo className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
