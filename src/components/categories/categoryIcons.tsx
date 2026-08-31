import { 
  Briefcase, 
  HeadphonesIcon, 
  Users, 
  Megaphone, 
  Globe,
  ShoppingCart,
  CreditCard,
  HelpCircle,
  MessageSquare,
  Settings,
  Star,
  Heart,
  Shield,
  Zap,
  Tag,
  LucideIcon
} from "lucide-react";

export const CATEGORY_ICONS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "briefcase", label: "Vendas", icon: Briefcase },
  { value: "headphones", label: "Suporte", icon: HeadphonesIcon },
  { value: "users", label: "RH", icon: Users },
  { value: "megaphone", label: "Marketing", icon: Megaphone },
  { value: "globe", label: "Geral", icon: Globe },
  { value: "shopping-cart", label: "E-commerce", icon: ShoppingCart },
  { value: "credit-card", label: "Financeiro", icon: CreditCard },
  { value: "help-circle", label: "FAQ", icon: HelpCircle },
  { value: "message-square", label: "Chat", icon: MessageSquare },
  { value: "settings", label: "Técnico", icon: Settings },
  { value: "star", label: "Premium", icon: Star },
  { value: "heart", label: "Fidelização", icon: Heart },
  { value: "shield", label: "Segurança", icon: Shield },
  { value: "zap", label: "Urgente", icon: Zap },
  { value: "tag", label: "Promoções", icon: Tag },
];

export const CATEGORY_COLORS = [
  { value: "#f97316", label: "Laranja" },
  { value: "#22c55e", label: "Verde" },
  { value: "#3b82f6", label: "Azul" },
  { value: "#8b5cf6", label: "Roxo" },
  { value: "#ef4444", label: "Vermelho" },
  { value: "#eab308", label: "Amarelo" },
  { value: "#ec4899", label: "Rosa" },
  { value: "#06b6d4", label: "Ciano" },
];

export function getCategoryIcon(iconValue: string | null): LucideIcon {
  const found = CATEGORY_ICONS.find(i => i.value === iconValue);
  return found?.icon || Globe;
}
