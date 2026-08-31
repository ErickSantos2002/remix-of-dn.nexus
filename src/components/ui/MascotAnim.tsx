import { cn } from "@/lib/utils";

interface MascotAnimProps {
  className?: string;
}

const MascotAnim = ({ className }: MascotAnimProps) => {
  return (
    <div className={cn("mascot-container w-full max-w-[200px] mx-auto", className)}>
      <style>{`
        @keyframes body-travel-left {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(-450px); }
        }
        @keyframes step-leg-lead {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          15% { transform: translateY(220px) rotate(-8deg); }
          35%, 50% { transform: translateY(0) rotate(0deg); }
        }
        @keyframes step-leg-trail {
          0%, 50%, 100% { transform: translateY(0) rotate(0deg); }
          65% { transform: translateY(180px) rotate(5deg); }
          85% { transform: translateY(0) rotate(0deg); }
        }

        .mascot-container #head-group,
        .mascot-container #torso-group,
        .mascot-container #full-arm-right,
        .mascot-container #full-arm-left,
        .mascot-container #leg-left,
        .mascot-container #leg-right,
        .mascot-container #foot-left,
        .mascot-container #foot-right {
          animation: body-travel-left 2.5s ease-in-out infinite;
        }

        .mascot-container #leg-left,
        .mascot-container #foot-left {
          animation: body-travel-left 2.5s ease-in-out infinite,
                     step-leg-lead 2.5s ease-in-out infinite !important;
          transform-origin: center top;
          transform-box: fill-box;
        }

        .mascot-container #leg-right,
        .mascot-container #foot-right {
          animation: body-travel-left 2.5s ease-in-out infinite,
                     step-leg-trail 2.5s ease-in-out infinite !important;
          transform-origin: center top;
          transform-box: fill-box;
        }

        .mascot-container svg g,
        .mascot-container svg path {
          animation-duration: 2.5s !important;
          animation-timing-function: ease-in-out !important;
          animation-iteration-count: infinite !important;
        }
      `}</style>
      <svg
        version="1.0"
        xmlns="http://www.w3.org/2000/svg"
        width="100%"
        height="100%"
        viewBox="0 0 1024 1024"
        preserveAspectRatio="xMidYMid meet"
      >
        <g
          transform="translate(100, 950) scale(0.08, -0.08)"
          stroke="hsl(var(--foreground))"
          strokeWidth="50"
        >
          {/* Head and Eyes */}
          <g id="head-group">
            <path
              id="head-part-1"
              fill="currentColor"
              d="M3612 8028 l-702 -702 0 -330 0 -331 702 -702 703 -703 352 0 353 0 0 345 0 345 -198 0 -197 0 -508 508 c-475 475 -507 509 -507 542 0 32 32 67 498 535 l497 500 205 5 205 5 3 343 2 342 -353 0 -354 0 -701 -702z"
            />
            <path
              id="head-part-2"
              fill="currentColor"
              d="M5250 8385 l0 -345 208 0 207 0 498 -498 497 -499 0 -44 0 -44 -503 -503 -502 -502 -203 0 -202 0 0 -345 0 -345 358 0 357 0 698 698 697 697 0 340 0 340 -698 698 -697 697 -358 0 -357 0 0 -345z"
            />
            <path
              id="eye-left"
              fill="var(--brand-primary)"
              stroke="none"
              d="M4452 7335 c-139 -38 -219 -116 -257 -249 -45 -154 35 -329 182 -402 51 -25 69 -28 148 -29 108 0 160 21 237 93 88 82 126 188 108 299 -33 200 -233 338 -418 288z"
            />
            <path
              id="eye-right"
              fill="var(--brand-accent)"
              stroke="none"
              d="M5650 7333 c-8 -3 -22 -7 -30 -10 -8 -4 -17 -7 -20 -8 -53 -13 -131 -94 -169 -174 -35 -76 -37 -212 -4 -281 31 -66 98 -137 157 -168 46 -24 61 -27 162 -27 97 0 116 3 157 24 60 31 130 102 159 161 19 38 23 62 23 150 0 103 -1 106 -37 165 -45 73 -81 109 -144 142 -41 21 -65 26 -144 28 -52 1 -102 1 -110 -2z"
            />
          </g>

          {/* Body */}
          <g id="torso-group">
            <path
              id="chest-left"
              fill="currentColor"
              d="M4000 4593 l0 -713 355 -2 355 -3 0 603 0 602 -242 0 -243 0 -112 112 -113 113 0 -712z"
            />
            <path
              id="chest-right"
              fill="currentColor"
              d="M6140 5185 l-105 -105 -247 0 -248 0 0 -600 0 -600 355 -2 355 -3 0 708 c0 389 -1 707 -3 707 -1 0 -49 -47 -107 -105z"
            />
          </g>

          {/* Right Arm */}
          <g id="full-arm-right">
            <path
              id="upper-arm-right"
              fill="currentColor"
              d="M7540 6873 l0 -288 -150 -150 -150 -150 152 -252 c83 -139 155 -253 159 -253 4 0 81 44 171 98 90 54 223 133 296 176 72 43 132 81 132 85 0 8 -140 247 -345 591 -87 146 -180 302 -207 348 -27 45 -51 82 -53 82 -3 0 -5 -129 -5 -287z"
            />
            <g id="forearm-group-right">
              <path
                id="forearm-right"
                fill="currentColor"
                d="M7990 5847 c-124 -74 -273 -162 -332 -197 l-108 -64 0 -443 0 -443 340 0 340 0 0 640 c0 352 -3 640 -7 640 -5 0 -109 -60 -233 -133z"
              />
              <g id="hand-group-right">
                <path
                  id="hand-part1-right"
                  fill="currentColor"
                  d="M7428 4491 l-98 -56 0 -172 0 -173 105 0 105 0 0 230 c0 127 -3 229 -7 229 -5 -1 -52 -27 -105 -58z"
                />
                <path
                  id="hand-part2-right"
                  fill="currentColor"
                  d="M7707 4533 c-4 -3 -7 -110 -7 -237 l0 -231 -90 -90 c-49 -49 -90 -94 -90 -100 0 -5 43 -51 97 -100 l96 -91 203 206 203 205 1 223 0 222 -203 0 c-112 0 -207 -3 -210 -7z"
                />
              </g>
            </g>
          </g>

          {/* Left Arm */}
          <g id="full-arm-left">
            <path
              id="upper-arm-left"
              fill="currentColor"
              d="M2629 7034 c-42 -71 -176 -297 -299 -503 -122 -206 -223 -380 -224 -387 -2 -19 594 -368 606 -356 5 5 77 122 159 258 l149 249 -155 150 -156 150 -2 284 -2 285 -76 -130z"
            />
            <g id="forearm-group-left">
              <path
                id="forearm-left"
                fill="currentColor"
                d="M2020 5341 l0 -641 340 0 340 0 0 443 0 442 -97 59 c-193 116 -552 326 -567 332 -14 6 -16 -56 -16 -635z"
              />
              <g id="hand-group-left">
                <path
                  id="hand-part1-left"
                  fill="currentColor"
                  d="M2720 4321 l0 -232 103 3 102 3 0 169 0 170 -50 29 c-27 16 -74 43 -102 59 l-53 30 0 -231z"
                />
                <path
                  id="hand-part2-left"
                  fill="currentColor"
                  d="M2130 4317 l0 -222 208 -208 207 -207 98 98 97 97 -95 95 -95 95 0 237 0 238 -210 0 -210 0 0 -223z"
                />
              </g>
            </g>
          </g>

          {/* Legs */}
          <path
            id="leg-left"
            fill="currentColor"
            d="M4000 3120 l0 -590 355 0 355 0 0 590 0 590 -355 0 -355 0 0 -590z"
          />
          <path
            id="leg-right"
            fill="currentColor"
            d="M5540 3120 l0 -590 355 0 355 0 0 590 0 590 -355 0 -355 0 0 -590z"
          />
          <path
            id="foot-left"
            fill="currentColor"
            d="M3862 2253 l-132 -108 0 -92 0 -93 265 0 265 0 0 70 0 70 85 0 85 0 0 -70 0 -71 143 3 c128 3 142 5 141 21 0 9 -1 98 -2 197 l-2 180 -358 0 -358 0 -132 -107z"
          />
          <path
            id="foot-right"
            fill="currentColor"
            d="M5540 2160 l0 -200 140 0 139 0 3 68 3 67 85 0 85 0 3 -67 3 -68 259 0 260 0 0 94 0 95 -130 105 -129 106 -361 0 -360 0 0 -200z"
          />
        </g>
      </svg>
    </div>
  );
};

export default MascotAnim;
