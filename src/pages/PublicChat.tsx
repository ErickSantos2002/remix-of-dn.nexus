import { useParams, useSearchParams } from "react-router-dom";
import { TypebotChat } from "@/components/widget/TypebotChat";

export default function PublicChat() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();

  const utmParams = {
    utm_source: searchParams.get("utm_source") || undefined,
    utm_medium: searchParams.get("utm_medium") || undefined,
    utm_campaign: searchParams.get("utm_campaign") || undefined,
    utm_term: searchParams.get("utm_term") || undefined,
    utm_content: searchParams.get("utm_content") || undefined,
  };

  if (!slug) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Chat nao encontrado
          </h1>
          <p className="text-muted-foreground">
            Verifique o link e tente novamente
          </p>
        </div>
      </div>
    );
  }

  return (
    <TypebotChat
      slug={slug}
      className="h-screen w-full"
      utmParams={utmParams}
    />
  );
}
