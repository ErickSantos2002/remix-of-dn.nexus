import { useParams, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { WidgetChat } from "@/components/widget/WidgetChat";

export default function EmbedChat() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();

  // Allow configuration via query params
  const showHeader = searchParams.get("header") !== "false";
  const showPoweredBy = searchParams.get("powered") !== "false";

  // Extract UTM + source params
  const utmParams = {
    utm_source: searchParams.get("utm_source") || undefined,
    utm_medium: searchParams.get("utm_medium") || undefined,
    utm_campaign: searchParams.get("utm_campaign") || undefined,
    utm_term: searchParams.get("utm_term") || undefined,
    utm_content: searchParams.get("utm_content") || undefined,
    source: searchParams.get("source") || undefined,
  };

  // Prevent scroll propagation to parent page
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'contain';
    document.documentElement.style.overscrollBehavior = 'contain';
    
    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      document.body.style.overscrollBehavior = '';
      document.documentElement.style.overscrollBehavior = '';
    };
  }, []);

  if (!slug) {
    return (
      <div className="h-screen bg-background flex items-center justify-center p-4 overflow-hidden overscroll-none">
        <p className="text-sm text-muted-foreground">Widget nao encontrado</p>
      </div>
    );
  }

  return (
    <WidgetChat
      slug={slug}
      showHeader={showHeader}
      showPoweredBy={showPoweredBy}
      utmParams={utmParams}
      className="h-screen w-full rounded-none overflow-hidden overscroll-none"
    />
  );
}
