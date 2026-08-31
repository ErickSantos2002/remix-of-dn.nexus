import confetti from 'canvas-confetti';

// excecao DS: canvas-confetti pinta em <canvas> e nao resolve var(),
// entao os hex ficam. Sincronizados a mao com os primitivos do V3:
// --dn-blue / --dn-red / --dn-green / --dn-amber.
const DS_COLORS = ['#3D61FF', '#E41A11', '#20A878', '#C98A16'];
const DS_COLORS_EXTENDED = ['#3D61FF', '#E41A11', '#20A878', '#C98A16', '#F0F4FF'];

export const triggerConfetti = () => {
  // Primeiro disparo - lado esquerdo
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { x: 0.1, y: 0.6 },
    colors: DS_COLORS,
  });

  // Segundo disparo - lado direito
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { x: 0.9, y: 0.6 },
    colors: DS_COLORS,
  });

  // Disparo central com delay
  setTimeout(() => {
    confetti({
      particleCount: 150,
      spread: 100,
      origin: { x: 0.5, y: 0.5 },
      colors: DS_COLORS,
    });
  }, 200);
};

export const triggerFireworks = () => {
  const duration = 3000;
  const animationEnd = Date.now() + duration;

  const randomInRange = (min: number, max: number) =>
    Math.random() * (max - min) + min;

  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now();

    if (timeLeft <= 0) {
      clearInterval(interval);
      return;
    }

    confetti({
      particleCount: 50,
      startVelocity: 30,
      spread: 360,
      ticks: 60,
      origin: {
        x: randomInRange(0.1, 0.9),
        y: Math.random() - 0.2,
      },
      colors: DS_COLORS_EXTENDED,
    });
  }, 250);
};
