/**
 * Nexus AI Widget Script
 * 
 * Usage:
 * <script src="https://your-domain.com/widget.js" data-widget-id="your-slug"></script>
 * 
 * Optional attributes:
 * - data-position: "bottom-right" (default), "bottom-left"
 * - data-primary-color: "#FF8000" (default, used as fallback)
 * - data-bubble-size: "60" (default, in pixels)
 */

(function() {
  'use strict';

  // Get script element and attributes
  const script = document.currentScript;
  if (!script) {
    console.error('Nexus Widget: Could not find script element');
    return;
  }

  const widgetSlug = script.getAttribute('data-widget-id');
  if (!widgetSlug) {
    console.error('Nexus Widget: data-widget-id attribute is required');
    return;
  }

  const position = script.getAttribute('data-position') || 'bottom-right';
  const fallbackColor = script.getAttribute('data-primary-color') || '#FF8000';
  const bubbleSize = parseInt(script.getAttribute('data-bubble-size') || '60', 10);
  
  // Get the base URL from script src (usando URL class para robustez)
  const scriptSrc = script.src;
  const scriptUrl = new URL(scriptSrc);
  const baseUrl = scriptUrl.origin;
  // Capture UTM + source params from parent page URL
  const parentParams = new URLSearchParams(window.location.search);
  const passKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source'];
  const embedParams = new URLSearchParams();
  passKeys.forEach(function(key) {
    const val = parentParams.get(key);
    if (val) embedParams.set(key, val);
  });
  const utmQuery = embedParams.toString();
  const embedUrl = `${baseUrl}/embed/${widgetSlug}${utmQuery ? '?' + utmQuery : ''}`;

  // API URL sempre aponta para producao (independente do origin do script)
  const apiUrl = 'https://apbvnbubxyaihygnxdev.supabase.co/functions/v1/widget-chat';

  // Create base styles with fallback color
  function createStyles(primaryColor) {
    return `
      .nexus-widget-container {
        position: fixed;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .nexus-widget-container.bottom-right {
        bottom: 20px;
        right: 20px;
      }
      .nexus-widget-container.bottom-left {
        bottom: 20px;
        left: 20px;
      }
      .nexus-widget-bubble {
        width: ${bubbleSize}px;
        height: ${bubbleSize}px;
        border-radius: 50%;
        background-color: ${primaryColor};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        transition: transform 0.2s ease, box-shadow 0.2s ease, background-color 0.3s ease;
      }
      .nexus-widget-bubble:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
      }
      .nexus-widget-bubble svg {
        width: ${bubbleSize * 0.5}px;
        height: ${bubbleSize * 0.5}px;
        fill: white;
      }
      .nexus-widget-chat {
        position: absolute;
        bottom: ${bubbleSize + 16}px;
        width: 380px;
        height: 550px;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
        display: none;
        background: #0D0B0A;
      }
      .nexus-widget-container.bottom-right .nexus-widget-chat {
        right: 0;
      }
      .nexus-widget-container.bottom-left .nexus-widget-chat {
        left: 0;
      }
      .nexus-widget-chat.open {
        display: block;
        animation: nexus-slide-up 0.3s ease;
      }
      .nexus-widget-chat iframe {
        width: 100%;
        height: 100%;
        border: none;
        overflow: hidden;
        overscroll-behavior: contain;
      }
      @keyframes nexus-slide-up {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @media (max-width: 420px) {
        .nexus-widget-chat {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          width: 100%;
          height: 100%;
          border-radius: 0;
        }
      }
    `;
  }

  // Apply dynamic color override
  function applyDynamicColor(primaryColor) {
    let dynamicStyle = document.getElementById('nexus-widget-dynamic-styles');
    if (!dynamicStyle) {
      dynamicStyle = document.createElement('style');
      dynamicStyle.id = 'nexus-widget-dynamic-styles';
      document.head.appendChild(dynamicStyle);
    }
    dynamicStyle.textContent = `
      .nexus-widget-bubble {
        background-color: ${primaryColor} !important;
      }
    `;
  }

  // Fetch config from server
  async function fetchConfig() {
    try {
      const response = await fetch(`${apiUrl}?slug=${widgetSlug}`);
      if (response.ok) {
        const config = await response.json();
        return config.settings?.primary_color || fallbackColor;
      }
    } catch (e) {
      console.warn('Nexus Widget: Failed to fetch config, using fallback color');
    }
    return fallbackColor;
  }

  // Render widget
  function renderWidget(primaryColor) {
    // Create style element
    const styleEl = document.createElement('style');
    styleEl.id = 'nexus-widget-base-styles';
    styleEl.textContent = createStyles(primaryColor);
    document.head.appendChild(styleEl);

    // Create widget container
    const container = document.createElement('div');
    container.className = `nexus-widget-container ${position}`;

    // Create chat container with iframe
    const chatContainer = document.createElement('div');
    chatContainer.className = 'nexus-widget-chat';
    chatContainer.innerHTML = `<iframe src="${embedUrl}" title="Chat"></iframe>`;

    // Create bubble
    const bubble = document.createElement('div');
    bubble.className = 'nexus-widget-bubble';
    bubble.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/>
      </svg>
    `;

    // Toggle chat on bubble click
    let isOpen = false;
    bubble.addEventListener('click', function() {
      isOpen = !isOpen;
      if (isOpen) {
        chatContainer.classList.add('open');
        bubble.innerHTML = `
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        `;
      } else {
        chatContainer.classList.remove('open');
        bubble.innerHTML = `
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/>
          </svg>
        `;
      }
    });

    // Assemble and append
    container.appendChild(chatContainer);
    container.appendChild(bubble);
    document.body.appendChild(container);
  }

  // Initialize widget
  async function init() {
    // Render immediately with fallback color (no delay)
    renderWidget(fallbackColor);
    
    // Fetch real color from server and update if different
    const realColor = await fetchConfig();
    if (realColor && realColor.toLowerCase() !== fallbackColor.toLowerCase()) {
      applyDynamicColor(realColor);
    }
  }

  init();
})();
