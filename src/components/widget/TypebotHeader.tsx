import { cn } from "@/lib/utils";

interface TypebotHeaderProps {
  bannerUrl?: string;
  logoUrl?: string;
  title?: string;
  subtitle?: string;
  primaryColor?: string;
  className?: string;
}

export function TypebotHeader({
  bannerUrl,
  logoUrl,
  title,
  subtitle,
  primaryColor = "#FF8000",
  className,
}: TypebotHeaderProps) {
  // If no banner and no title, don't render
  if (!bannerUrl && !title) return null;

  // Banner mode
  if (bannerUrl) {
    return (
      <div className={cn("w-full mb-6", className)}>
        <img
          src={bannerUrl}
          alt={title || "Banner"}
          className="w-full h-auto max-h-32 object-cover rounded-xl"
        />
        {(title || subtitle) && (
          <div className="px-6 py-4 text-center">
            {title && (
              <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            )}
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // Minimal mode with logo/title
  return (
    <div className={cn("px-6 py-6", className)}>
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={title || "Logo"}
            className="w-10 h-10 rounded-lg object-cover"
          />
        ) : title ? (
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-semibold"
            style={{ 
              backgroundColor: primaryColor,
              color: "#fff"
            }}
          >
            {title.charAt(0).toUpperCase()}
          </div>
        ) : null}
        <div>
          {title && (
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          )}
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );
}
