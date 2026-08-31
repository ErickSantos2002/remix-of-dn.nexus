import { useEffect, useRef } from "react";

const CHARACTERS = ["D", "d", "N", "n", "I", "i", "A", "a"];
const FONT_SIZE = 20;
const COLUMN_WIDTH = 18; // Reduced from 22 for 20% more density

// Paleta de cores vermelhas da marca (tons escuros e sutis)
const COLORS = {
  leader: "#5C0A07",
  trail1: "rgba(92, 10, 7, 0.5)",
  trail2: "rgba(70, 8, 6, 0.3)",
  trail3: "rgba(50, 6, 4, 0.2)",
  trail4: "rgba(40, 4, 3, 0.1)",
  trail5: "rgba(40, 4, 3, 0.05)",
};

interface Column {
  x: number;
  y: number;
  speed: number;
  trail: string[];
  trailLength: number;
}

const getRandomChar = (): string => {
  return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
};

const getRandomSpeed = (): number => {
  return 1 + Math.random() * 2; // 1-3 (queda lenta)
};

const getRandomTrailLength = (): number => {
  return 10 + Math.floor(Math.random() * 6); // 10-15
};

const createColumn = (x: number, canvasHeight: number): Column => {
  const trailLength = getRandomTrailLength();
  const trail: string[] = [];
  for (let i = 0; i < trailLength; i++) {
    trail.push(getRandomChar());
  }
  return {
    x,
    y: Math.random() * canvasHeight * -1, // Start above screen
    speed: getRandomSpeed(),
    trail,
    trailLength,
  };
};

export const MatrixRainBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const columnsRef = useRef<Column[]>([]);
  const animationRef = useRef<number>(0);
  const isVisibleRef = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const setupCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.scale(dpr, dpr);

      // Initialize columns
      const columnCount = Math.ceil(width / COLUMN_WIDTH);
      const columns: Column[] = [];
      for (let i = 0; i < columnCount; i++) {
        columns.push(createColumn(i * COLUMN_WIDTH, height));
      }
      columnsRef.current = columns;
    };

    const getTrailColor = (index: number, trailLength: number): string => {
      const ratio = index / trailLength;
      if (ratio < 0.2) return COLORS.trail1;
      if (ratio < 0.4) return COLORS.trail2;
      if (ratio < 0.6) return COLORS.trail3;
      if (ratio < 0.8) return COLORS.trail4;
      return COLORS.trail5;
    };

    const draw = () => {
      if (!isVisibleRef.current || !ctx) return;

      const width = window.innerWidth;
      const height = window.innerHeight;

      // Fade effect - draw semi-transparent black overlay
      ctx.fillStyle = "rgba(10, 10, 10, 0.1)";
      ctx.fillRect(0, 0, width, height);

      ctx.font = `bold ${FONT_SIZE}px "JetBrains Mono", monospace`;
      ctx.textAlign = "center";

      const columns = columnsRef.current;
      const speedMultiplier = prefersReducedMotion ? 0.3 : 1;

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];

        // Draw trail (from oldest to newest)
        for (let j = col.trail.length - 1; j >= 0; j--) {
          const charY = col.y - j * FONT_SIZE;
          if (charY < -FONT_SIZE || charY > height + FONT_SIZE) continue;

          if (j === 0) {
            // Leader character - subtle glow
            ctx.shadowColor = COLORS.leader;
            ctx.shadowBlur = 5;
            ctx.fillStyle = COLORS.leader;
          } else {
            // Trail characters - fading
            ctx.shadowBlur = 0;
            ctx.fillStyle = getTrailColor(j, col.trailLength);
          }

          ctx.fillText(col.trail[j], col.x + COLUMN_WIDTH / 2, charY | 0);
        }

        // Reset shadow for next iteration
        ctx.shadowBlur = 0;

        // Update position
        col.y += col.speed * speedMultiplier;

        // Leader character changes frequently (60% chance)
        if (Math.random() < 0.6) {
          col.trail[0] = getRandomChar();
        }

        // Random trail character changes (multiple per frame for faster effect)
        const changesToMake = Math.floor(Math.random() * 3) + 2; // 2-4 changes per frame
        for (let c = 0; c < changesToMake; c++) {
          const randomIndex = 1 + Math.floor(Math.random() * (col.trail.length - 1));
          col.trail[randomIndex] = getRandomChar();
        }

        // Reset column when it goes off screen
        if (col.y - col.trailLength * FONT_SIZE > height) {
          col.y = -col.trailLength * FONT_SIZE;
          col.speed = getRandomSpeed();
          // Regenerate some trail characters
          for (let j = 0; j < col.trail.length; j++) {
            col.trail[j] = getRandomChar();
          }
        }
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    // Handle visibility change
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === "visible";
      if (isVisibleRef.current && !animationRef.current) {
        animationRef.current = requestAnimationFrame(draw);
      }
    };

    // Handle resize with debounce
    let resizeTimeout: number;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        setupCanvas();
      }, 150);
    };

    // Initial setup
    setupCanvas();

    // Start animation
    animationRef.current = requestAnimationFrame(draw);

    // Event listeners
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationRef.current);
      clearTimeout(resizeTimeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 z-0 pointer-events-none"
      style={{ background: "#0A0A0A" }}
    />
  );
};

export default MatrixRainBackground;
