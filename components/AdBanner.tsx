// components/AdBanner.tsx
// Composant publicitaire Google AdSense
// Configurez vos ad slots dans Vercel → Environment Variables

'use client';

import { useEffect, useRef } from 'react';

interface AdBannerProps {
  slot: string;          // Votre Ad Slot ID (ex: "1234567890")
  format?: 'auto' | 'rectangle' | 'horizontal' | 'vertical';
  fullWidth?: boolean;
  style?: React.CSSProperties;
}

declare global {
  interface Window {
    adsbygoogle: unknown[];
  }
}

export default function AdBanner({ slot, format = 'auto', fullWidth = false, style }: AdBannerProps) {
  const initialized = useRef(false);

  const pubId = process.env.NEXT_PUBLIC_ADSENSE_PUB_ID;

  useEffect(() => {
    // Ne pas initialiser deux fois la même pub
    if (initialized.current || !pubId || !slot) return;
    initialized.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (_) {}
  }, [pubId, slot]);

  // Ne rien rendre si pas de pub configurée (dev local)
  if (!pubId || !slot || slot === 'YOUR_AD_SLOT_ID') {
    // Placeholder visible uniquement en développement
    if (process.env.NODE_ENV === 'development') {
      return (
        <div style={{
          background: 'rgba(79,142,247,.06)',
          border: '1px dashed rgba(79,142,247,.2)',
          borderRadius: 6,
          padding: '12px 16px',
          textAlign: 'center',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-disabled)',
          ...style,
        }}>
          📢 Emplacement publicitaire · Slot: {slot || 'non configuré'}
        </div>
      );
    }
    return null;
  }

  return (
    <div style={{ overflow: 'hidden', ...style }}>
      <ins
        className="adsbygoogle"
        style={{ display: 'block', ...(fullWidth ? { width: '100%' } : {}) }}
        data-ad-client={pubId}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive={fullWidth ? 'true' : 'false'}
      />
    </div>
  );
}
